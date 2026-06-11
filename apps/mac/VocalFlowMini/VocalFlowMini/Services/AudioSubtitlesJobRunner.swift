import Foundation

struct JobRunnerEvent {
    enum Kind {
        case progress(PipelineProgress)
        case log(String)
    }

    let kind: Kind
}

final class AudioSubtitlesJobRunner: @unchecked Sendable {
    /// MDX-Net model: much faster than the default roformer on CPU while still
    /// producing usable vocal/instrumental stems for karaoke practice.
    static let fastSeparatorModel = "UVR-MDX-NET-Inst_HQ_3.onnx"

    /// Persistent cache so audio-separator does not re-download its model to
    /// /tmp on every run (the audio-separator default is wiped on reboot).
    static let separatorModelDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/VocalFlowMini/separator-models", isDirectory: true)

    private let processLock = NSLock()
    private var activeProcess: Process?

    private struct ScriptStageEvent: Decodable {
        let event: String
        let name: String
        let progress: Double?
        let message: String?
        let etaSec: Double?
        let done: Bool?
        let failed: Bool?
    }

    func run(job: ProcessingJob, onEvent: @escaping @MainActor (JobRunnerEvent) -> Void) async throws -> KaraokePackage {
        let resolvedRuntime = AudioSubtitlesRuntime.resolve()
        guard let runtime = resolvedRuntime.runtime else {
            throw JobRunnerError.failed(resolvedRuntime.diagnostics.joined(separator: "\n"))
        }

        try FileManager.default.createDirectory(at: job.outputDirectory, withIntermediateDirectories: true)

        let cliArguments = buildArguments(for: job)
        let invocation = runtime.makeProcessArguments(cliArguments: cliArguments)
        await MainActor.run {
            onEvent(JobRunnerEvent(kind: .progress(PipelineProgress(
                stage: .prepare,
                progress: -1,
                message: "Launching audio-subtitles.",
                etaSec: nil,
                isDone: false,
                isFailed: false
            ))))
            for diagnostic in runtime.diagnostics {
                onEvent(JobRunnerEvent(kind: .log(diagnostic + "\n")))
            }
            for check in Self.preflightChecks(job: job, environment: runtime.environment) {
                onEvent(JobRunnerEvent(kind: .log(check + "\n")))
            }
            onEvent(JobRunnerEvent(kind: .log(commandPreview(executableURL: invocation.executableURL, arguments: invocation.arguments) + "\n")))
        }

        let process = Process()
        process.executableURL = invocation.executableURL
        process.arguments = invocation.arguments
        process.environment = runtime.environment

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        let outputCollector = ProcessOutputCollector()
        let stderrLineBuffer = ProcessLineBuffer()
        setActiveProcess(process)
        defer { setActiveProcess(nil) }

        stdout.fileHandleForReading.readabilityHandler = { handle in
            let text = String(decoding: handle.availableData, as: UTF8.self)
            guard !text.isEmpty else { return }
            outputCollector.appendStdout(text)
            Task { @MainActor in
                onEvent(JobRunnerEvent(kind: .log(text)))
            }
        }

        stderr.fileHandleForReading.readabilityHandler = { handle in
            let text = String(decoding: handle.availableData, as: UTF8.self)
            guard !text.isEmpty else { return }

            for line in stderrLineBuffer.append(text) {
                Self.handleStderrLine(line, outputCollector: outputCollector, onEvent: onEvent)
            }
        }

        let terminationStatus = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Int32, any Error>) in
            process.terminationHandler = { proc in
                continuation.resume(returning: proc.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }

        stdout.fileHandleForReading.readabilityHandler = nil
        stderr.fileHandleForReading.readabilityHandler = nil
        for line in stderrLineBuffer.flush() {
            Self.handleStderrLine(line, outputCollector: outputCollector, onEvent: onEvent)
        }

        if terminationStatus != 0 {
            let message = outputCollector.stderrTail().suffix(12).joined(separator: "\n").nonEmpty ?? "audio-subtitles exited with status \(terminationStatus)."
            throw JobRunnerError.failed(message)
        }

        await MainActor.run {
            onEvent(JobRunnerEvent(kind: .progress(PipelineProgress(
                stage: .manifest,
                progress: 1,
                message: "Scanning generated package.",
                etaSec: nil,
                isDone: true,
                isFailed: false
            ))))
        }

        let package = try KaraokePackageScanner.scan(
            outputDirectory: job.outputDirectory,
            source: job.source,
            options: job.options,
            stdout: outputCollector.stdout()
        )
        try KaraokePackageScanner.writeManifest(package)
        return package
    }

    func cancel() {
        processLock.lock()
        let process = activeProcess
        processLock.unlock()

        guard let process, process.isRunning else {
            return
        }

        process.terminate()
    }

    private func setActiveProcess(_ process: Process?) {
        processLock.lock()
        activeProcess = process
        processLock.unlock()
    }

    private func buildArguments(for job: ProcessingJob) -> [String] {
        var args: [String] = [
            "--output-dir", job.outputDirectory.path,
            "--formats", job.options.formats.joined(separator: ","),
            "--subtitle-source", job.options.subtitleSource.cliValue,
            "--model", job.options.model,
            "--word-engine", "faster_whisper"
        ]

        if job.options.saveAudio {
            args.append("--save-audio")
        }
        if job.options.saveVideoPreview {
            args.append("--save-video-preview")
        }
        if job.options.localFallback {
            args.append("--local-fallback")
        }
        if job.options.separateVocals {
            args.append("--separate")
            args += ["--separator-model", Self.fastSeparatorModel]
            args += ["--separator-model-dir", Self.separatorModelDirectory.path]
            if job.options.exportMp3 {
                args += ["--separator-format", "MP3"]
            }
        }
        if let language = job.options.normalizedLanguage {
            args += ["--language", language]
        }

        args.append(job.source.cliValue)
        return args
    }

    private static func preflightChecks(job: ProcessingJob, environment: [String: String]) -> [String] {
        var lines: [String] = []

        func locate(_ name: String) -> String? {
            for directory in (environment["PATH"] ?? "").split(separator: ":") {
                let candidate = URL(fileURLWithPath: String(directory)).appendingPathComponent(name)
                if FileManager.default.isExecutableFile(atPath: candidate.path) {
                    return candidate.path
                }
            }
            return nil
        }

        lines.append("[check] ffmpeg: " + (locate("ffmpeg") ?? "MISSING - brew install ffmpeg"))

        if case .url = job.source {
            lines.append("[check] yt-dlp: " + (locate("yt-dlp") ?? "MISSING - brew install yt-dlp"))
        }

        if job.options.separateVocals {
            lines.append("[check] audio-separator: " + (locate("audio-separator") ?? "MISSING - run setup_audio_separator.sh"))
            let modelFile = separatorModelDirectory.appendingPathComponent(fastSeparatorModel)
            if FileManager.default.fileExists(atPath: modelFile.path) {
                lines.append("[check] separator model cached: \(modelFile.path)")
            } else {
                lines.append("[check] separator model \(fastSeparatorModel) not cached yet; first run downloads it once to \(separatorModelDirectory.path)")
            }
        }

        return lines
    }

    private func commandPreview(executableURL: URL, arguments: [String]) -> String {
        ([executableURL.path] + arguments)
            .map { part in
                part.contains(" ") ? "\"\(part)\"" : part
            }
            .joined(separator: " ")
    }

    private static func handleStderrLine(
        _ line: String,
        outputCollector: ProcessOutputCollector,
        onEvent: @escaping @MainActor (JobRunnerEvent) -> Void
    ) {
        let trimmed = line.trimmingCharacters(in: .newlines)
        guard !trimmed.isEmpty else { return }

        outputCollector.appendStderr(trimmed)
        if let progress = Self.parseStageEvent(trimmed) {
            Task { @MainActor in
                onEvent(JobRunnerEvent(kind: .progress(progress)))
            }
        } else {
            Task { @MainActor in
                onEvent(JobRunnerEvent(kind: .log(trimmed + "\n")))
            }
        }
    }

    private static func parseStageEvent(_ line: String) -> PipelineProgress? {
        guard let data = line.data(using: .utf8),
              let event = try? JSONDecoder().decode(ScriptStageEvent.self, from: data),
              event.event == "stage" else {
            return nil
        }

        let stage = PipelineStage.fromScriptName(event.name)
        return PipelineProgress(
            stage: stage,
            progress: event.progress ?? -1,
            message: event.message ?? stage.label,
            etaSec: event.etaSec,
            isDone: event.done ?? false,
            isFailed: event.failed ?? false
        )
    }
}

enum JobRunnerError: LocalizedError {
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .failed(let message):
            return message
        }
    }
}

private final class ProcessOutputCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var stdoutText = ""
    private var stderrLines: [String] = []

    func appendStdout(_ text: String) {
        lock.lock()
        stdoutText += text
        lock.unlock()
    }

    func appendStderr(_ line: String) {
        lock.lock()
        stderrLines.append(line)
        stderrLines = Array(stderrLines.suffix(60))
        lock.unlock()
    }

    func stdout() -> String {
        lock.lock()
        defer { lock.unlock() }
        return stdoutText
    }

    func stderrTail() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return stderrLines
    }
}

private final class ProcessLineBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var pending = ""

    func append(_ text: String) -> [String] {
        lock.lock()
        defer { lock.unlock() }

        let normalized = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        pending += normalized

        let endsWithNewline = pending.hasSuffix("\n")
        var parts = pending.components(separatedBy: "\n")
        if endsWithNewline {
            pending = ""
        } else {
            pending = parts.popLast() ?? ""
        }

        return parts.filter { !$0.isEmpty }
    }

    func flush() -> [String] {
        lock.lock()
        defer { lock.unlock() }

        guard !pending.isEmpty else {
            return []
        }

        let line = pending
        pending = ""
        return [line]
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
