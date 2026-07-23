import AVFoundation
import Combine
import CoreAudio
import Foundation

@MainActor
final class AudioMonitorService: ObservableObject {
    struct AudioInputDevice: Identifiable, Equatable {
        let id: String
        let name: String
        let audioDeviceID: AudioDeviceID
    }

    enum MonitorState: Equatable {
        case ready
        case requestingPermission
        case listening
        case permissionDenied
        case failed(String)

        var isBusy: Bool {
            self == .requestingPermission
        }

        var isListening: Bool {
            self == .listening
        }

        var statusTitle: String {
            switch self {
            case .ready:
                "Ready"
            case .requestingPermission:
                "Requesting microphone access"
            case .listening:
                "Listening"
            case .permissionDenied:
                "Microphone permission needed"
            case .failed:
                "Monitor unavailable"
            }
        }

        var statusDetail: String {
            switch self {
            case .ready:
                "Click once to route your microphone into the output."
            case .requestingPermission:
                "macOS will ask before VocalFlow can hear your mic."
            case .listening:
                "Your microphone is live. Use headphones to avoid feedback."
            case .permissionDenied:
                "Allow microphone access in System Settings, then try again."
            case .failed(let message):
                message
            }
        }

        var actionTitle: String {
            switch self {
            case .listening:
                "Stop"
            case .requestingPermission:
                "Waiting"
            default:
                "Listen"
            }
        }
    }

    enum AudioMonitorError: LocalizedError {
        case noInputDevice
        case invalidInputFormat
        case inputUnitUnavailable
        case deviceSelectionFailed(String)
        case recordingUnavailable
        case recordingWriteFailed(String)

        var errorDescription: String? {
            switch self {
            case .noInputDevice:
                "No microphone input device is available."
            case .invalidInputFormat:
                "The current microphone format cannot be monitored."
            case .inputUnitUnavailable:
                "The microphone input unit is not available yet. Try System Default or restart monitoring."
            case .deviceSelectionFailed(let name):
                "Could not switch to \(name). Choose System Default or refresh devices."
            case .recordingUnavailable:
                "The microphone input is not ready for recording."
            case .recordingWriteFailed(let message):
                "The microphone take could not be written. \(message)"
            }
        }
    }

    @Published private(set) var state: MonitorState = .ready
    @Published private(set) var inputLevel: Float = 0
    @Published private(set) var inputDevices: [AudioInputDevice] = []
    @Published var selectedInputDeviceID: String = ""
    @Published private(set) var inputGain: Float = 1.0
    @Published private(set) var monitorVolume: Float = 0.75
    @Published private(set) var voiceCleanupEnabled = false
    @Published private(set) var isRecording = false
    @Published private(set) var recordingDuration: TimeInterval = 0

    private var engine: AVAudioEngine?
    private var gainMixer: AVAudioMixerNode?
    private var voiceCleanupEQ: AVAudioUnitEQ?
    private var outputMixer: AVAudioMixerNode?
    private var lastMeterUpdate = Date.distantPast
    private var hasInputTap = false
    private let recordingSlot = AudioRecordingSlot()
    private var recordingURL: URL?
    private var recordingStartedAt: Date?
    private var recordingClockTask: Task<Void, Never>?

    init() {
        refreshInputDevices()
    }

    func toggleListening() {
        if state.isListening {
            stopListening()
            return
        }

        Task { @MainActor in
            await startListening()
        }
    }

    func setInputGain(_ value: Float) {
        inputGain = value.clamped(to: 0.0...2.0)
        gainMixer?.volume = inputGain
    }

    func setMonitorVolume(_ value: Float) {
        monitorVolume = value.clamped(to: 0.0...1.0)
        outputMixer?.volume = monitorVolume
    }

    func setVoiceCleanupEnabled(_ enabled: Bool) {
        voiceCleanupEnabled = enabled
        voiceCleanupEQ?.bypass = !enabled
    }

    func refreshInputDevices() {
        inputDevices = Self.availableInputDevices()
        if !selectedInputDeviceID.isEmpty,
           !inputDevices.contains(where: { $0.id == selectedInputDeviceID }) {
            selectedInputDeviceID = ""
        }
    }

    func startListening() async {
        guard !state.isBusy, !state.isListening else { return }

        state = .requestingPermission
        let granted = await Self.requestMicrophoneAccess()
        guard granted else {
            teardownEngine()
            state = .permissionDenied
            return
        }

        do {
            try configureEngine()
            try engine?.start()
            state = .listening
        } catch {
            teardownEngine()
            state = .failed(error.localizedDescription)
        }
    }

    func stopListening() {
        if isRecording {
            abortRecording()
        }
        teardownEngine()
        state = .ready
    }

    func prepareForRecording() async throws {
        if !state.isListening {
            await startListening()
        }
        guard state.isListening, engine != nil else {
            throw AudioMonitorError.recordingUnavailable
        }
    }

    func beginRecording(to url: URL) throws {
        guard !isRecording,
              let engine,
              state.isListening else {
            throw AudioMonitorError.recordingUnavailable
        }
        let format = engine.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw AudioMonitorError.invalidInputFormat
        }

        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        recordingSlot.install(file)
        recordingURL = url
        recordingStartedAt = Date()
        recordingDuration = 0
        isRecording = true
        startRecordingClock()
    }

    func finishRecording() throws -> URL {
        guard isRecording, let recordingURL else {
            throw AudioMonitorError.recordingUnavailable
        }
        recordingClockTask?.cancel()
        recordingClockTask = nil
        recordingDuration = Date().timeIntervalSince(recordingStartedAt ?? Date())
        let writeError = recordingSlot.finish()
        isRecording = false
        recordingStartedAt = nil
        self.recordingURL = nil
        if let writeError {
            throw AudioMonitorError.recordingWriteFailed(writeError)
        }
        return recordingURL
    }

    func abortRecording() {
        recordingClockTask?.cancel()
        recordingClockTask = nil
        _ = recordingSlot.finish()
        if let recordingURL {
            try? FileManager.default.removeItem(at: recordingURL)
        }
        self.recordingURL = nil
        recordingStartedAt = nil
        recordingDuration = 0
        isRecording = false
    }

    private func configureEngine() throws {
        teardownEngine()

        let engine = AVAudioEngine()
        let input = engine.inputNode
        try applySelectedInputDevice(to: input)
        let inputFormat = input.outputFormat(forBus: 0)

        guard inputFormat.channelCount > 0 else {
            throw AudioMonitorError.noInputDevice
        }
        guard inputFormat.sampleRate > 0 else {
            throw AudioMonitorError.invalidInputFormat
        }

        let gainMixer = AVAudioMixerNode()
        let voiceCleanupEQ = Self.makeVoiceCleanupEQ(enabled: voiceCleanupEnabled)
        let outputMixer = AVAudioMixerNode()
        gainMixer.volume = inputGain
        outputMixer.volume = monitorVolume

        engine.attach(gainMixer)
        engine.attach(voiceCleanupEQ)
        engine.attach(outputMixer)
        engine.connect(input, to: gainMixer, format: inputFormat)
        engine.connect(gainMixer, to: voiceCleanupEQ, format: inputFormat)
        engine.connect(voiceCleanupEQ, to: outputMixer, format: inputFormat)
        engine.connect(outputMixer, to: engine.mainMixerNode, format: inputFormat)

        let recordingSlot = self.recordingSlot
        input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
            recordingSlot.write(buffer)
            let level = Self.normalizedLevel(from: buffer)
            Task { @MainActor [weak self] in
                self?.publishMeterLevel(level)
            }
        }
        hasInputTap = true

        engine.prepare()

        self.engine = engine
        self.gainMixer = gainMixer
        self.voiceCleanupEQ = voiceCleanupEQ
        self.outputMixer = outputMixer
    }

    private func applySelectedInputDevice(to inputNode: AVAudioInputNode) throws {
        guard let selectedDevice = inputDevices.first(where: { $0.id == selectedInputDeviceID }) else {
            return
        }
        guard let audioUnit = inputNode.audioUnit else {
            throw AudioMonitorError.inputUnitUnavailable
        }

        var deviceID = selectedDevice.audioDeviceID
        let status = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &deviceID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )

        if status != noErr {
            throw AudioMonitorError.deviceSelectionFailed(selectedDevice.name)
        }
    }

    private func teardownEngine() {
        if hasInputTap, let input = engine?.inputNode {
            input.removeTap(onBus: 0)
        }
        engine?.stop()
        engine?.reset()
        engine = nil
        gainMixer = nil
        voiceCleanupEQ = nil
        outputMixer = nil
        inputLevel = 0
        lastMeterUpdate = .distantPast
        hasInputTap = false
    }

    private func publishMeterLevel(_ level: Float) {
        let now = Date()
        guard now.timeIntervalSince(lastMeterUpdate) >= 1.0 / 30.0 else { return }
        lastMeterUpdate = now
        inputLevel = level
    }

    private func startRecordingClock() {
        recordingClockTask?.cancel()
        recordingClockTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self, self.isRecording else { return }
                self.recordingDuration = Date().timeIntervalSince(self.recordingStartedAt ?? Date())
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
    }

    nonisolated private static func requestMicrophoneAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            true
        case .notDetermined:
            await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    continuation.resume(returning: granted)
                }
            }
        case .denied, .restricted:
            false
        @unknown default:
            false
        }
    }

    nonisolated private static func makeVoiceCleanupEQ(enabled: Bool) -> AVAudioUnitEQ {
        let eq = AVAudioUnitEQ(numberOfBands: 2)

        let highPass = eq.bands[0]
        highPass.filterType = .highPass
        highPass.frequency = 85
        highPass.bypass = false

        let lowPass = eq.bands[1]
        lowPass.filterType = .lowPass
        lowPass.frequency = 12_000
        lowPass.bypass = false

        eq.globalGain = 0
        eq.bypass = !enabled
        return eq
    }

    nonisolated private static func availableInputDevices() -> [AudioInputDevice] {
        coreAudioDeviceIDs().compactMap { deviceID in
            guard hasInputChannels(deviceID), let name = stringProperty(.name, for: deviceID) else {
                return nil
            }

            let uid = stringProperty(.uid, for: deviceID) ?? String(deviceID)
            return AudioInputDevice(id: uid, name: name, audioDeviceID: deviceID)
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    nonisolated private static func coreAudioDeviceIDs() -> [AudioDeviceID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize: UInt32 = 0
        let sizeStatus = AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &dataSize
        )
        guard sizeStatus == noErr, dataSize > 0 else { return [] }

        let count = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
        var deviceIDs = Array(repeating: AudioDeviceID(), count: count)
        let dataStatus = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &dataSize,
            &deviceIDs
        )
        guard dataStatus == noErr else { return [] }

        return deviceIDs
    }

    nonisolated private static func hasInputChannels(_ deviceID: AudioDeviceID) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize: UInt32 = 0
        let sizeStatus = AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &dataSize)
        guard sizeStatus == noErr, dataSize > 0 else { return false }

        let bufferListPointer = UnsafeMutableRawPointer.allocate(
            byteCount: Int(dataSize),
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer {
            bufferListPointer.deallocate()
        }

        let dataStatus = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &dataSize, bufferListPointer)
        guard dataStatus == noErr else { return false }

        let bufferList = bufferListPointer.bindMemory(to: AudioBufferList.self, capacity: 1)
        let buffers = UnsafeMutableAudioBufferListPointer(bufferList)
        return buffers.reduce(0) { count, buffer in
            count + Int(buffer.mNumberChannels)
        } > 0
    }

    nonisolated private static func stringProperty(_ property: CoreAudioStringProperty, for deviceID: AudioDeviceID) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: property.selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var value: Unmanaged<CFString>?
        let status = withUnsafeMutablePointer(to: &value) { pointer in
            AudioObjectGetPropertyData(deviceID, &address, 0, nil, &dataSize, pointer)
        }
        guard status == noErr, let value else { return nil }

        return value.takeUnretainedValue() as String
    }

    nonisolated private static func normalizedLevel(from buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData else { return 0 }

        let channelCount = Int(buffer.format.channelCount)
        let frameLength = Int(buffer.frameLength)
        guard channelCount > 0, frameLength > 0 else { return 0 }

        var sum: Float = 0
        for channel in 0..<channelCount {
            let samples = channelData[channel]
            for frame in 0..<frameLength {
                let sample = samples[frame]
                sum += sample * sample
            }
        }

        let rms = sqrt(sum / Float(channelCount * frameLength))
        guard rms.isFinite, rms > 0 else { return 0 }

        let decibels = 20 * log10(rms)
        return ((decibels + 60) / 60).clamped(to: 0...1)
    }
}

private final class AudioRecordingSlot: @unchecked Sendable {
    private let lock = NSLock()
    private var file: AVAudioFile?
    private var writeError: String?

    func install(_ file: AVAudioFile) {
        lock.lock()
        self.file = file
        writeError = nil
        lock.unlock()
    }

    func write(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard let file, writeError == nil else { return }
        do {
            try file.write(from: buffer)
        } catch {
            writeError = error.localizedDescription
        }
    }

    func finish() -> String? {
        lock.lock()
        defer { lock.unlock() }
        file = nil
        let error = writeError
        writeError = nil
        return error
    }
}

private extension Float {
    func clamped(to range: ClosedRange<Float>) -> Float {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

private enum CoreAudioStringProperty {
    case name
    case uid

    var selector: AudioObjectPropertySelector {
        switch self {
        case .name:
            kAudioObjectPropertyName
        case .uid:
            kAudioDevicePropertyDeviceUID
        }
    }
}
