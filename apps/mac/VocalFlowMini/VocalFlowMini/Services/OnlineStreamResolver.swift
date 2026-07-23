import CryptoKit
import Foundation

struct ResolvedOnlineStream: Sendable {
    let url: URL
    let httpHeaders: [String: String]
}

/// Resolves a media page URL (YouTube, Bilibili, ...) into media AVPlayer can
/// play. Remote video is cached locally because AVFoundation can reject some
/// otherwise valid CDN connections when their TLS certificate does not match
/// the rotating googlevideo host returned by yt-dlp.
enum OnlineStreamResolver {
    enum ResolverError: LocalizedError {
        case ytDlpMissing
        case resolutionFailed(String)
        case noStreamFound

        var errorDescription: String? {
            switch self {
            case .ytDlpMissing:
                return "The bundled media downloader is missing. Reinstall VocalFlow and try again."
            case .resolutionFailed(let message):
                return "Could not resolve online stream: \(message)"
            case .noStreamFound:
                return "yt-dlp returned no playable stream URL."
            }
        }
    }

    static func resolveStream(for pageURL: String, browser: String? = nil) async throws -> ResolvedOnlineStream {
        let environment = AudioSubtitlesRuntime.childProcessEnvironment()
        guard let ytDlp = AudioSubtitlesRuntime.executableURL(named: "yt-dlp", environment: environment) else {
            throw ResolverError.ytDlpMissing
        }

        let cacheURL = try cachedMediaURL(for: pageURL)
        if isUsableCacheFile(cacheURL) {
            return ResolvedOnlineStream(url: cacheURL, httpHeaders: [:])
        }

        let process = Process()
        process.executableURL = ytDlp
        let isBilibili = MediaURLNormalizer.platform(for: pageURL) == .bilibili
        let format = isBilibili
            ? "b[height<=720][ext=mp4][vcodec^=avc1]/b[height<=720][ext=mp4]/bv*[height<=720][ext=mp4][vcodec^=avc1]+ba/bv*[height<=720][ext=mp4]+ba"
            : "b[height<=720][ext=mp4][vcodec^=avc1]/b[ext=mp4][vcodec^=avc1]/b[height<=720][ext=mp4]/b[ext=mp4]"
        var arguments = [
            "--no-playlist",
            "--socket-timeout", "20",
            "-f", format,
            "--no-progress",
            "--no-warnings",
            "--merge-output-format", "mp4",
            "--output", cacheURL.path,
            pageURL
        ]
        if let browser, !browser.isEmpty {
            arguments.insert(contentsOf: ["--cookies-from-browser", browser], at: 0)
        }
        process.arguments = arguments
        process.environment = environment

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        let status: Int32 = try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { proc in
                continuation.resume(returning: proc.terminationStatus)
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }

        _ = stdout.fileHandleForReading.readDataToEndOfFile()
        let errData = stderr.fileHandleForReading.readDataToEndOfFile()

        guard status == 0 else {
            let tail = String(decoding: errData, as: UTF8.self)
                .components(separatedBy: .newlines)
                .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                .suffix(2)
                .joined(separator: " ")
            throw ResolverError.resolutionFailed(tail.isEmpty ? "yt-dlp exited with status \(status)" : tail)
        }

        guard isUsableCacheFile(cacheURL) else {
            throw ResolverError.noStreamFound
        }
        return ResolvedOnlineStream(url: cacheURL, httpHeaders: [:])
    }

    static func resolveStreamURL(for pageURL: String) async throws -> URL {
        try await resolveStream(for: pageURL).url
    }

    private static func cachedMediaURL(for pageURL: String) throws -> URL {
        let baseURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VocalFlow", isDirectory: true)
            .appendingPathComponent("OnlineMedia", isDirectory: true)
        try FileManager.default.createDirectory(at: baseURL, withIntermediateDirectories: true)

        let digest = SHA256.hash(data: Data(pageURL.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return baseURL.appendingPathComponent("\(digest).mp4")
    }

    private static func isUsableCacheFile(_ url: URL) -> Bool {
        guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]) else {
            return false
        }
        return values.isRegularFile == true && (values.fileSize ?? 0) > 100_000
    }
}
