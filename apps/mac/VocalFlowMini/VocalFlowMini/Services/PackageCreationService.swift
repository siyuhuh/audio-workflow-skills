import AppKit
import Foundation

@MainActor
final class PackageCreationService: ObservableObject {
    @Published var sourceText = ""
    @Published var selectedLocalFile: URL?
    @Published var outputRoot: URL = PackageCreationService.defaultOutputRoot()
    @Published var options = ProcessingOptions()
    @Published private(set) var isRunning = false
    @Published private(set) var progress = PipelineProgress.queued
    @Published private(set) var stageHistory: [PipelineStage: PipelineProgress] = [:]
    @Published private(set) var logs: [String] = []
    @Published private(set) var lastPackage: KaraokePackage?
    @Published private(set) var currentJob: ProcessingJob?
    @Published private(set) var startedAt: Date?
    @Published private(set) var finishedAt: Date?
    @Published private(set) var errorMessage: String?

    private let runner = AudioSubtitlesJobRunner()
    private var currentTask: Task<Void, Never>?

    var sourceSummary: String {
        if let selectedLocalFile {
            return selectedLocalFile.lastPathComponent
        }

        let trimmed = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "No URL or file selected" : trimmed
    }

    func chooseLocalFile() {
        let panel = NSOpenPanel()
        panel.title = "Choose source video or audio"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.audio, .movie]

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        selectedLocalFile = url
        sourceText = ""
    }

    func chooseOutputRoot() {
        let panel = NSOpenPanel()
        panel.title = "Choose package output folder"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = true
        panel.canChooseFiles = false

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        outputRoot = url
    }

    func clearSource() {
        selectedLocalFile = nil
        sourceText = ""
    }

    func start(onPackageCreated: @escaping (KaraokePackage) -> Void) {
        guard !isRunning else { return }

        do {
            let source = try makeSource()
            let job = ProcessingJob(
                source: source,
                options: options,
                outputDirectory: makeOutputDirectory(for: source)
            )
            isRunning = true
            errorMessage = nil
            logs = []
            stageHistory = [:]
            currentJob = job
            startedAt = Date()
            finishedAt = nil
            progress = PipelineProgress(stage: .queued, progress: 0, message: "Starting package job.", etaSec: nil, isDone: false, isFailed: false)
            stageHistory[.queued] = progress

            let serviceRef = WeakPackageCreationService(self)
            let runner = runner
            currentTask = Task.detached(priority: .userInitiated) { [serviceRef, job, runner] in
                do {
                    let package = try await runner.run(job: job) { event in
                        serviceRef.value?.handle(event)
                    }
                    await MainActor.run {
                        serviceRef.value?.lastPackage = package
                        serviceRef.value?.progress = PipelineProgress(stage: .complete, progress: 1, message: "Package ready.", etaSec: nil, isDone: true, isFailed: false)
                        serviceRef.value?.stageHistory[.complete] = serviceRef.value?.progress
                        serviceRef.value?.isRunning = false
                        serviceRef.value?.finishedAt = Date()
                        serviceRef.value?.currentTask = nil
                        onPackageCreated(package)
                    }
                } catch {
                    await MainActor.run {
                        serviceRef.value?.errorMessage = error.localizedDescription
                        serviceRef.value?.progress = PipelineProgress(stage: .failed, progress: 1, message: error.localizedDescription, etaSec: nil, isDone: true, isFailed: true)
                        serviceRef.value?.stageHistory[.failed] = serviceRef.value?.progress
                        serviceRef.value?.isRunning = false
                        serviceRef.value?.finishedAt = Date()
                        serviceRef.value?.currentTask = nil
                    }
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func cancelCurrentJob() {
        guard isRunning else { return }

        runner.cancel()
        currentTask?.cancel()
        currentTask = nil
        isRunning = false
        finishedAt = Date()
        errorMessage = "Job cancelled."
        progress = PipelineProgress(stage: .failed, progress: 1, message: "Job cancelled.", etaSec: nil, isDone: true, isFailed: true)
        stageHistory[.failed] = progress
    }

    private func handle(_ event: JobRunnerEvent) {
        switch event.kind {
        case .progress(let nextProgress):
            progress = nextProgress
            stageHistory[nextProgress.stage] = nextProgress
        case .log(let line):
            appendLog(line)
        }
    }

    private func appendLog(_ line: String) {
        let trimmed = line.trimmingCharacters(in: .newlines)
        guard !trimmed.isEmpty else { return }
        logs.append(trimmed)
        logs = Array(logs.suffix(80))
    }

    private func makeSource() throws -> KaraokeSource {
        if let selectedLocalFile {
            return .localFile(selectedLocalFile)
        }

        let trimmed = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw PackageCreationError.missingSource
        }
        return .url(trimmed)
    }

    private func makeOutputDirectory(for source: KaraokeSource) -> URL {
        let title = source.suggestedTitle.safeFileName(defaultValue: "karaoke")
        let suffix = ISO8601DateFormatter()
            .string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: ".", with: "-")
        return outputRoot.appendingPathComponent("\(title)-\(suffix)", isDirectory: true)
    }

    func revealCurrentOutput() {
        guard let outputDirectory = currentJob?.outputDirectory ?? lastPackage?.folderURL else {
            return
        }

        try? FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
        NSWorkspace.shared.activateFileViewerSelecting([outputDirectory])
    }

    nonisolated static func defaultOutputRoot() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Movies", isDirectory: true)
            .appendingPathComponent("VocalFlow Mini", isDirectory: true)
    }
}

enum PackageCreationError: LocalizedError {
    case missingSource

    var errorDescription: String? {
        switch self {
        case .missingSource:
            return "Paste a media URL or choose a local audio/video file first."
        }
    }
}

private extension String {
    func safeFileName(defaultValue: String) -> String {
        let invalid = CharacterSet(charactersIn: "/\\?%*|\"<>:")
            .union(.newlines)
            .union(.controlCharacters)
        let cleaned = components(separatedBy: invalid)
            .joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? defaultValue : String(cleaned.prefix(80))
    }
}

private final class WeakPackageCreationService: @unchecked Sendable {
    weak var value: PackageCreationService?

    init(_ value: PackageCreationService) {
        self.value = value
    }
}
