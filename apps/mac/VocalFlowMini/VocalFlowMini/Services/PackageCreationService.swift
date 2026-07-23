import AppKit
import Foundation

@MainActor
final class PackageCreationService: ObservableObject {
    @Published var sourceText = ""
    @Published var selectedLocalFile: URL?
    @Published var outputRoot: URL = PackageCreationService.defaultOutputRoot()
    @Published var options = ProcessingOptions()
    @Published var appendKaraokeToSearch = false
    @Published private(set) var isRunning = false
    @Published private(set) var progress = PipelineProgress.queued
    @Published private(set) var stageHistory: [PipelineStage: PipelineProgress] = [:]
    @Published private(set) var logs: [String] = []
    @Published private(set) var lastPackage: KaraokePackage?
    @Published private(set) var currentJob: ProcessingJob?
    @Published private(set) var startedAt: Date?
    @Published private(set) var finishedAt: Date?
    @Published private(set) var errorMessage: String?
    @Published private(set) var searchResults: [MediaSearchResult] = []
    @Published private(set) var isSearching = false
    @Published private(set) var searchError: String?

    private let runner = AudioSubtitlesJobRunner()
    private let searchService = MediaSearchService()
    private var currentTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?
    private var activeJobID: UUID?
    private var activeSearchID: UUID?

    var sourceSummary: String {
        if let selectedLocalFile {
            return selectedLocalFile.lastPathComponent
        }

        let trimmed = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "No URL or file selected" : trimmed
    }

    var canSearchSource: Bool {
        selectedLocalFile == nil && searchQuery != nil
    }

    var normalizedSourceURL: String? {
        guard selectedLocalFile == nil else { return nil }
        return MediaURLNormalizer.normalize(sourceText)
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
        activeSearchID = nil
        searchTask?.cancel()
        searchTask = nil
        selectedLocalFile = nil
        sourceText = ""
        searchResults = []
        searchError = nil
        isSearching = false
    }

    func searchSource() {
        guard let query = searchQuery, !isSearching else { return }

        searchTask?.cancel()
        let searchID = UUID()
        activeSearchID = searchID
        searchResults = []
        searchError = nil
        isSearching = true
        let browser = options.normalizedBrowser
        let appendKaraoke = appendKaraokeToSearch

        searchTask = Task { [weak self, searchService] in
            do {
                let results = try await searchService.search(
                    query: query,
                    browser: browser,
                    appendKaraoke: appendKaraoke
                )
                try Task.checkCancellation()
                guard let self else { return }
                self.completeSearch(id: searchID, results: results)
            } catch is CancellationError {
                guard let self else { return }
                self.completeSearch(id: searchID)
            } catch {
                guard let self else { return }
                self.completeSearch(id: searchID, error: error.localizedDescription)
            }
        }
    }

    func selectSearchResult(_ result: MediaSearchResult) {
        activeSearchID = nil
        selectedLocalFile = nil
        sourceText = result.url
        searchResults = []
        searchError = nil
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
            activeJobID = job.id
            startedAt = Date()
            finishedAt = nil
            progress = PipelineProgress(stage: .queued, progress: 0, message: "Starting package job.", etaSec: nil, isDone: false, isFailed: false)
            stageHistory[.queued] = progress

            let serviceRef = WeakPackageCreationService(self)
            let runner = runner
            currentTask = Task.detached(priority: .userInitiated) { [serviceRef, job, runner] in
                do {
                    let package = try await runner.run(job: job) { event in
                        guard let service = serviceRef.value, service.activeJobID == job.id else { return }
                        service.handle(event)
                    }
                    await MainActor.run {
                        guard let service = serviceRef.value, service.activeJobID == job.id else { return }
                        let completeProgress = PipelineProgress(stage: .complete, progress: 1, message: "Package ready.", etaSec: nil, isDone: true, isFailed: false)
                        service.lastPackage = package
                        service.progress = completeProgress
                        service.stageHistory[.complete] = completeProgress
                        service.isRunning = false
                        service.finishedAt = Date()
                        service.currentTask = nil
                        service.activeJobID = nil
                        onPackageCreated(package)
                    }
                } catch is CancellationError {
                    await MainActor.run {
                        guard let service = serviceRef.value, service.activeJobID == job.id else { return }
                        service.finishCancelledJob()
                    }
                } catch {
                    await MainActor.run {
                        guard let service = serviceRef.value, service.activeJobID == job.id else { return }
                        let failedProgress = PipelineProgress(stage: .failed, progress: 1, message: error.localizedDescription, etaSec: nil, isDone: true, isFailed: true)
                        service.errorMessage = error.localizedDescription
                        service.progress = failedProgress
                        service.stageHistory[.failed] = failedProgress
                        service.isRunning = false
                        service.finishedAt = Date()
                        service.currentTask = nil
                        service.activeJobID = nil
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
        finishCancelledJob()
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

    private func finishCancelledJob() {
        activeJobID = nil
        isRunning = false
        finishedAt = Date()
        errorMessage = nil
        progress = PipelineProgress(
            stage: .failed,
            progress: 1,
            message: "Job cancelled.",
            etaSec: nil,
            isDone: true,
            isFailed: false
        )
        stageHistory[.failed] = progress
    }

    private func makeSource() throws -> KaraokeSource {
        switch parsedSource {
        case .missing:
            throw PackageCreationError.missingSource
        case .localFile(let url):
            return .localFile(url)
        case .remoteURL(let url):
            return .url(url)
        case .searchQuery(let query):
            return .url("ytsearch1:\(query)")
        }
    }

    private var searchQuery: String? {
        guard case .searchQuery(let query) = parsedSource else { return nil }
        return query
    }

    private var parsedSource: ParsedSource {
        if let selectedLocalFile {
            return .localFile(selectedLocalFile)
        }

        let trimmed = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .missing }

        let expandedPath = NSString(string: trimmed).expandingTildeInPath
        if FileManager.default.fileExists(atPath: expandedPath) {
            return .localFile(URL(fileURLWithPath: expandedPath))
        }

        if let normalizedURL = MediaURLNormalizer.normalize(trimmed) {
            return .remoteURL(normalizedURL)
        }

        return .searchQuery(trimmed)
    }

    private func completeSearch(id: UUID, results: [MediaSearchResult] = [], error: String? = nil) {
        guard activeSearchID == id else { return }
        activeSearchID = nil
        searchResults = results
        searchError = error
        isSearching = false
        searchTask = nil
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
            .appendingPathComponent("VocalFlow", isDirectory: true)
    }

    nonisolated static func legacyOutputRoot() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Movies", isDirectory: true)
            .appendingPathComponent("VocalFlow Mini", isDirectory: true)
    }
}

private enum ParsedSource {
    case missing
    case localFile(URL)
    case remoteURL(String)
    case searchQuery(String)
}

enum PackageCreationError: LocalizedError {
    case missingSource

    var errorDescription: String? {
        switch self {
        case .missingSource:
            return "Paste a media URL, search YouTube/Bilibili, or choose a local audio/video file first."
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
