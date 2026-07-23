import AVFoundation
import Foundation

@MainActor
final class MicrophoneMonitor: ObservableObject {
    @Published private(set) var isMonitoring = false
    @Published private(set) var level: Float = 0
    @Published private(set) var issue: String?
    @Published private(set) var volume: Float = 0.55

    private let engine = AVAudioEngine()
    private var hasInputTap = false

    func toggle() {
        isMonitoring ? stop() : requestPermissionAndStart()
    }

    func setVolume(_ value: Float) {
        volume = min(max(value, 0), 1)
        engine.mainMixerNode.outputVolume = volume
    }

    func stop() {
        let input = engine.inputNode
        if hasInputTap {
            input.removeTap(onBus: 0)
            hasInputTap = false
        }
        if engine.isRunning {
            engine.stop()
        }
        engine.disconnectNodeOutput(input)
        engine.reset()
        isMonitoring = false
        level = 0
        restorePlaybackSession()
    }

    private func requestPermissionAndStart() {
        AVAudioApplication.requestRecordPermission { [weak self] granted in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if granted {
                    self.start()
                } else {
                    self.issue = "需要麦克风权限才能开启耳返。"
                }
            }
        }
    }

    private func start() {
        issue = nil
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.defaultToSpeaker, .allowAirPlay, .allowBluetoothA2DP, .allowBluetoothHFP]
            )
            try session.setPreferredIOBufferDuration(0.005)
            try session.setActive(true)

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                throw MicrophoneMonitorError.noInputRoute
            }

            engine.connect(input, to: engine.mainMixerNode, format: format)
            engine.mainMixerNode.outputVolume = volume
            input.installTap(onBus: 0, bufferSize: 512, format: format) { [weak self] buffer, _ in
                guard let channel = buffer.floatChannelData?.pointee else { return }
                let frames = Int(buffer.frameLength)
                guard frames > 0 else { return }
                var sum: Float = 0
                for index in 0..<frames {
                    sum += channel[index] * channel[index]
                }
                let rms = sqrt(sum / Float(frames))
                let normalized = min(1, max(0, (20 * log10(max(rms, 0.000_001)) + 55) / 55))
                Task { @MainActor [weak self] in
                    self?.level = normalized
                }
            }
            hasInputTap = true

            engine.prepare()
            try engine.start()
            isMonitoring = true
        } catch {
            issue = error.localizedDescription
            stop()
        }
    }

    private func restorePlaybackSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay, .allowBluetoothA2DP])
        try? session.setActive(true)
    }
}

enum MicrophoneMonitorError: LocalizedError {
    case noInputRoute

    var errorDescription: String? {
        "没有可用的麦克风输入；模拟器可能未连接音频输入。"
    }
}
