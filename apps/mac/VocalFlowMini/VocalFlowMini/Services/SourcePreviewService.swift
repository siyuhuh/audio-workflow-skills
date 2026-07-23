import AVFoundation
import Foundation

struct MediaMetadataPreview: Equatable, Sendable {
    let sourceURL: String
    let title: String
    let creator: String?
    let duration: TimeInterval?
    let platform: MediaPlatform
    let thumbnailURL: URL?

    var durationText: String? {
        guard let duration, duration.isFinite, duration > 0 else { return nil }
        let total = Int(duration.rounded())
        if total >= 3600 {
            return String(format: "%d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
        }
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

final class MediaMetadataService: @unchecked Sendable {
    private struct MetadataPayload: Decodable {
        let title: String?
        let uploader: String?
        let channel: String?
        let duration: TimeInterval?
        let thumbnail: String?
        let webpageURL: String?

        enum CodingKeys: String, CodingKey {
            case title
            case uploader
            case channel
            case duration
            case thumbnail
            case webpageURL = "webpage_url"
        }
    }

    func fetch(for input: String, browser: String?) async throws -> MediaMetadataPreview {
        guard let normalized = MediaURLNormalizer.normalize(input) else {
            throw SourcePreviewError.unsupportedSource
        }

        if MediaURLNormalizer.platform(for: normalized) == .bilibili {
            let info = try await BilibiliService.videoInfo(for: normalized)
            return MediaMetadataPreview(
                sourceURL: info.pageURL,
                title: info.title,
                creator: info.creator,
                duration: info.duration,
                platform: .bilibili,
                thumbnailURL: info.thumbnailURL
            )
        }

        return try await Task.detached(priority: .userInitiated) {
            let environment = AudioSubtitlesRuntime.childProcessEnvironment()
            guard let ytDLP = AudioSubtitlesRuntime.executableURL(named: "yt-dlp", environment: environment) else {
                throw MediaSearchError.missingYtDLP
            }

            var arguments = ["--no-playlist", "--no-warnings", "--skip-download", "--dump-single-json", normalized]
            if let browser, !browser.isEmpty {
                arguments.insert(contentsOf: ["--cookies-from-browser", browser], at: 0)
            }

            let process = Process()
            process.executableURL = ytDLP
            process.arguments = arguments
            process.environment = environment
            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr

            try process.run()
            let data = stdout.fileHandleForReading.readDataToEndOfFile()
            let errorData = stderr.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            try Task.checkCancellation()

            guard process.terminationStatus == 0 else {
                let message = String(decoding: errorData, as: UTF8.self)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                throw MediaSearchError.failed(message.isEmpty ? "yt-dlp could not load this media URL." : message)
            }

            let payload = try JSONDecoder().decode(MetadataPayload.self, from: data)
            return MediaMetadataPreview(
                sourceURL: payload.webpageURL ?? normalized,
                title: payload.title ?? URL(string: normalized)?.lastPathComponent ?? "Online media",
                creator: payload.channel ?? payload.uploader,
                duration: payload.duration,
                platform: MediaURLNormalizer.platform(for: normalized),
                thumbnailURL: payload.thumbnail.flatMap { URL(string: $0) }
            )
        }.value
    }
}

@MainActor
final class SourcePreviewService: ObservableObject {
    @Published private(set) var metadata: MediaMetadataPreview?
    @Published private(set) var player: AVPlayer?
    @Published private(set) var isLoadingMetadata = false
    @Published private(set) var isLoadingVideo = false
    @Published private(set) var errorMessage: String?

    private let metadataService = MediaMetadataService()
    private var metadataTask: Task<Void, Never>?
    private var videoTask: Task<Void, Never>?
    private var metadataRequestID: UUID?
    private var videoRequestID: UUID?
    private var videoSource: String?

    func sourceChanged(_ input: String, browser: String?) {
        metadataTask?.cancel()
        videoTask?.cancel()
        videoRequestID = nil
        stopVideo()
        metadata = nil
        errorMessage = nil
        isLoadingVideo = false

        guard let normalized = MediaURLNormalizer.normalize(input) else {
            metadataRequestID = nil
            isLoadingMetadata = false
            return
        }

        let id = UUID()
        metadataRequestID = id
        isLoadingMetadata = true
        metadataTask = Task { [weak self, metadataService] in
            do {
                try await Task.sleep(for: .milliseconds(350))
                let value = try await metadataService.fetch(for: normalized, browser: browser)
                try Task.checkCancellation()
                guard let self, self.metadataRequestID == id else { return }
                self.metadata = value
                self.metadataRequestID = nil
                self.isLoadingMetadata = false
                self.metadataTask = nil
            } catch is CancellationError {
                return
            } catch {
                guard let self, self.metadataRequestID == id else { return }
                self.errorMessage = error.localizedDescription
                self.metadataRequestID = nil
                self.isLoadingMetadata = false
                self.metadataTask = nil
            }
        }
    }

    func loadVideo(for input: String, browser: String?) {
        guard let normalized = MediaURLNormalizer.normalize(input), !isLoadingVideo else { return }
        if videoSource == normalized, player != nil {
            player?.play()
            return
        }

        videoTask?.cancel()
        stopVideo()
        errorMessage = nil
        isLoadingVideo = true
        let id = UUID()
        videoRequestID = id
        videoTask = Task { [weak self] in
            do {
                let stream = try await OnlineStreamResolver.resolveStream(for: normalized, browser: browser)
                try Task.checkCancellation()
                guard let self, self.videoRequestID == id else { return }
                let asset = AVURLAsset(
                    url: stream.url,
                    options: stream.httpHeaders.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": stream.httpHeaders]
                )
                let player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
                self.player = player
                self.videoSource = normalized
                self.videoRequestID = nil
                self.isLoadingVideo = false
                self.videoTask = nil
                player.play()
            } catch is CancellationError {
                return
            } catch {
                guard let self, self.videoRequestID == id else { return }
                self.errorMessage = error.localizedDescription
                self.videoRequestID = nil
                self.isLoadingVideo = false
                self.videoTask = nil
            }
        }
    }

    func stopVideo() {
        player?.pause()
        player = nil
        videoSource = nil
    }

    func clear() {
        metadataRequestID = nil
        videoRequestID = nil
        metadataTask?.cancel()
        videoTask?.cancel()
        metadataTask = nil
        videoTask = nil
        metadata = nil
        errorMessage = nil
        isLoadingMetadata = false
        isLoadingVideo = false
        stopVideo()
    }
}

enum SourcePreviewError: LocalizedError {
    case unsupportedSource

    var errorDescription: String? {
        "Paste a YouTube, Bilibili, or other supported media URL to preview it."
    }
}
