import AppKit
import Foundation

@MainActor
final class KaraokeRecordingService: ObservableObject {
    enum Phase: Equatable {
        case idle
        case preparing
        case countdown(Int)
        case recording
        case saving
        case complete
        case failed(String)

        var isBusy: Bool {
            switch self {
            case .preparing, .countdown, .recording, .saving:
                true
            case .idle, .complete, .failed:
                false
            }
        }

        var isRecording: Bool {
            self == .recording
        }
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var message = "Record a performance with a vocal WAV and share-ready mix."
    @Published private(set) var lastRecording: KaraokeRecordingPackage?

    private var generation = 0
    private var activeOutputDirectory: URL?
    private var activeSourcePackageID: String?
    private var activeSourceTitle = "Untitled song"
    private var activeMusicURL: URL?
    private var monitorWasListening = false
    private var completionWatcher: Task<Void, Never>?

    func toggle(monitor: AudioMonitorService, player: KaraokePlayerService) {
        if phase.isRecording || isCountingDown {
            Task { @MainActor in
                await stop(monitor: monitor, player: player)
            }
            return
        }

        guard !phase.isBusy else { return }
        Task { @MainActor in
            await start(monitor: monitor, player: player)
        }
    }

    func start(monitor: AudioMonitorService, player: KaraokePlayerService) async {
        guard let sourceID = player.recordingSourceIdentifier,
              player.selectedTrackURL != nil else {
            phase = .failed("Choose a playable song before recording.")
            message = "Choose a playable song before recording."
            return
        }

        generation += 1
        let currentGeneration = generation
        phase = .preparing
        message = "Preparing microphone..."
        lastRecording = nil
        monitorWasListening = monitor.state.isListening

        do {
            try await monitor.prepareForRecording()
            guard generation == currentGeneration else { return }

            let outputDirectory = try makeOutputDirectory(
                title: player.recordingSourceTitle,
                id: UUID().uuidString
            )
            activeOutputDirectory = outputDirectory
            activeSourcePackageID = sourceID
            activeSourceTitle = player.recordingSourceTitle
            activeMusicURL = player.preferredRecordingMusicURL

            player.pausePlayback()
            player.seek(to: 0)
            for count in stride(from: 3, through: 1, by: -1) {
                guard generation == currentGeneration else { return }
                phase = .countdown(count)
                message = "Recording starts in \(count)..."
                try await Task.sleep(for: .milliseconds(900))
            }
            guard generation == currentGeneration else { return }

            let rawURL = outputDirectory
                .appendingPathComponent("takes", isDirectory: true)
                .appendingPathComponent("take-01-vocal.wav")
            try monitor.beginRecording(to: rawURL)
            player.setRecordingSessionActive(true)
            player.playFromBeginning()
            phase = .recording
            message = "Recording · sing into your selected microphone."
            watchForPlaybackCompletion(monitor: monitor, player: player)
        } catch is CancellationError {
            cancel(monitor: monitor, player: player)
        } catch {
            cancel(monitor: monitor, player: player, removeOutput: true)
            phase = .failed(error.localizedDescription)
            message = error.localizedDescription
        }
    }

    func stop(monitor: AudioMonitorService, player: KaraokePlayerService) async {
        if isCountingDown || phase == .preparing {
            generation += 1
            cancel(monitor: monitor, player: player, removeOutput: true)
            phase = .idle
            message = "Recording cancelled."
            return
        }
        guard phase.isRecording,
              let outputDirectory = activeOutputDirectory,
              let sourcePackageID = activeSourcePackageID else {
            return
        }

        completionWatcher?.cancel()
        completionWatcher = nil
        phase = .saving
        message = "Saving vocal WAV and rendering mix..."
        player.pausePlayback()
        player.setRecordingSessionActive(false)

        do {
            let rawURL = try monitor.finishRecording()
            let duration = monitor.recordingDuration
            let package = try await renderPackage(
                rawURL: rawURL,
                musicURL: activeMusicURL,
                outputDirectory: outputDirectory,
                sourcePackageID: sourcePackageID,
                sourceTitle: activeSourceTitle,
                duration: duration,
                deviceID: monitor.selectedInputDeviceID.nonEmpty,
                deviceLabel: monitor.inputDevices.first(where: { $0.id == monitor.selectedInputDeviceID })?.name,
                musicGain: player.playbackVolume
            )

            try persistRecording(package)
            try player.attachRecording(package)
            lastRecording = package
            phase = .complete
            message = package.exports.isEmpty
                ? "Vocal WAV saved. No local music track was available for the mix."
                : "Vocal WAV and M4A mix saved."
        } catch {
            phase = .failed(error.localizedDescription)
            message = error.localizedDescription
        }

        if !monitorWasListening {
            monitor.stopListening()
        }
        clearActiveSession()
    }

    func cancel(monitor: AudioMonitorService, player: KaraokePlayerService, removeOutput: Bool = false) {
        generation += 1
        completionWatcher?.cancel()
        completionWatcher = nil
        if monitor.isRecording {
            monitor.abortRecording()
        }
        player.pausePlayback()
        player.setRecordingSessionActive(false)
        if removeOutput, let activeOutputDirectory {
            try? FileManager.default.removeItem(at: activeOutputDirectory)
        }
        if !monitorWasListening, monitor.state.isListening {
            monitor.stopListening()
        }
        clearActiveSession()
    }

    func openLastRecording() {
        guard let path = lastRecording?.outputDir else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: path, isDirectory: true))
    }

    private var isCountingDown: Bool {
        if case .countdown = phase { return true }
        return false
    }

    private func watchForPlaybackCompletion(
        monitor: AudioMonitorService,
        player: KaraokePlayerService
    ) {
        completionWatcher?.cancel()
        completionWatcher = Task { @MainActor [weak self, weak monitor, weak player] in
            while !Task.isCancelled {
                guard let self, let monitor, let player, self.phase.isRecording else { return }
                if player.duration > 0,
                   player.currentTime >= max(0, player.duration - 0.25),
                   !player.isPlaying {
                    await self.stop(monitor: monitor, player: player)
                    return
                }
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
    }

    private func makeOutputDirectory(title: String, id: String) throws -> URL {
        let root = FileManager.default.urls(for: .musicDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Music", isDirectory: true)
        let stamp = Self.fileTimestamp(Date())
        let folder = root
            .appendingPathComponent("VocalFlow", isDirectory: true)
            .appendingPathComponent("Recordings", isDirectory: true)
            .appendingPathComponent(Self.sanitizedFileName(title), isDirectory: true)
            .appendingPathComponent("\(stamp)-\(id.prefix(8))", isDirectory: true)
        try FileManager.default.createDirectory(
            at: folder.appendingPathComponent("takes", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: folder.appendingPathComponent("exports", isDirectory: true),
            withIntermediateDirectories: true
        )
        return folder
    }

    private func renderPackage(
        rawURL: URL,
        musicURL: URL?,
        outputDirectory: URL,
        sourcePackageID: String,
        sourceTitle: String,
        duration: TimeInterval,
        deviceID: String?,
        deviceLabel: String?,
        musicGain: Float
    ) async throws -> KaraokeRecordingPackage {
        let packageID = "recording:\(UUID().uuidString)"
        let takeID = "take:\(UUID().uuidString)"
        let createdAt = ISO8601DateFormatter().string(from: Date())
        let take = KaraokeRecordingTake(
            id: takeID,
            recordingPackageId: packageID,
            sourceSongPackageId: sourcePackageID,
            createdAt: createdAt,
            updatedAt: createdAt,
            title: "Take 01",
            path: rawURL.path,
            mimeType: "audio/wav",
            duration: duration,
            deviceId: deviceID,
            deviceLabel: deviceLabel,
            status: "complete"
        )

        var exports: [KaraokeRecordingExport] = []
        if let musicURL, musicURL.isFileURL {
            let mixURL = outputDirectory
                .appendingPathComponent("exports", isDirectory: true)
                .appendingPathComponent("take-01-mix.m4a")
            do {
                try await Task.detached {
                    try Self.renderMix(
                        musicURL: musicURL,
                        vocalURL: rawURL,
                        outputURL: mixURL,
                        duration: duration,
                        musicGain: musicGain
                    )
                }.value
                exports.append(
                    KaraokeRecordingExport(
                        id: "export:\(UUID().uuidString)",
                        recordingPackageId: packageID,
                        takeId: takeID,
                        createdAt: createdAt,
                        path: mixURL.path,
                        format: "m4a",
                        duration: duration
                    )
                )
            } catch {
                try? FileManager.default.removeItem(at: mixURL)
            }
        }

        return KaraokeRecordingPackage(
            id: packageID,
            packageType: "recordingPackage",
            sourceSongPackageId: sourcePackageID,
            title: "\(sourceTitle) — Take 01",
            createdAt: createdAt,
            updatedAt: createdAt,
            outputDir: outputDirectory.path,
            takes: [take],
            mix: KaraokeRecordingMixSettings(
                activeTakeId: takeID,
                vocalGain: 1,
                musicGain: musicGain,
                preferBackingTrack: true,
                exportFormat: "m4a"
            ),
            exports: exports
        )
    }

    private func persistRecording(_ package: KaraokeRecordingPackage) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(package)
        let packageURL = URL(fileURLWithPath: package.outputDir, isDirectory: true)
            .appendingPathComponent("recording.json")
        try data.write(to: packageURL, options: .atomic)

        let indexURL = try Self.recordingIndexURL()
        var packages: [KaraokeRecordingPackage] = []
        if let currentData = try? Data(contentsOf: indexURL),
           let current = try? JSONDecoder().decode([KaraokeRecordingPackage].self, from: currentData) {
            packages = current
        }
        packages = [package] + packages.filter { $0.id != package.id }
        try encoder.encode(Array(packages.prefix(500))).write(to: indexURL, options: .atomic)
    }

    nonisolated private static func renderMix(
        musicURL: URL,
        vocalURL: URL,
        outputURL: URL,
        duration: TimeInterval,
        musicGain: Float
    ) throws {
        guard let ffmpeg = AudioSubtitlesRuntime.executableURL(named: "ffmpeg") else {
            throw RecordingError.ffmpegMissing
        }
        let process = Process()
        process.executableURL = ffmpeg
        process.arguments = [
            "-y",
            "-i", musicURL.path,
            "-i", vocalURL.path,
            "-filter_complex",
            "[0:a]volume=\(musicGain.clamped(to: 0...1))[music];[1:a]volume=1.0[vocal];[music][vocal]amix=inputs=2:duration=longest:dropout_transition=0,alimiter=limit=0.95[mix]",
            "-map", "[mix]",
            "-t", String(format: "%.3f", max(0.1, duration)),
            "-c:a", "aac",
            "-b:a", "256k",
            "-movflags", "+faststart",
            outputURL.path
        ]
        let errorPipe = Pipe()
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errorPipe
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let data = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let detail = String(data: data, encoding: .utf8)?
                .split(separator: "\n")
                .last
                .map(String.init)
                ?? "ffmpeg exited with code \(process.terminationStatus)."
            throw RecordingError.mixFailed(detail)
        }
    }

    nonisolated private static func recordingIndexURL() throws -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)
        let directory = base.appendingPathComponent("VocalFlow", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("recordings.json")
    }

    nonisolated private static func sanitizedFileName(_ value: String) -> String {
        let forbidden = CharacterSet(charactersIn: "/:\\?%*|\"<>")
        let pieces = value.components(separatedBy: forbidden)
        let cleaned = pieces.joined(separator: " ")
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(cleaned.prefix(72)).nonEmpty ?? "Untitled song"
    }

    nonisolated private static func fileTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd'T'HHmmss"
        return formatter.string(from: date)
    }

    private func clearActiveSession() {
        activeOutputDirectory = nil
        activeSourcePackageID = nil
        activeSourceTitle = "Untitled song"
        activeMusicURL = nil
        monitorWasListening = false
    }
}

private enum RecordingError: LocalizedError {
    case ffmpegMissing
    case mixFailed(String)

    var errorDescription: String? {
        switch self {
        case .ffmpegMissing:
            "VocalFlow could not find its bundled ffmpeg runtime."
        case .mixFailed(let detail):
            "The vocal WAV was saved, but the M4A mix failed. \(detail)"
        }
    }
}

private extension Float {
    func clamped(to range: ClosedRange<Float>) -> Float {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
