import Foundation

/// Resolves a media page URL (YouTube, Bilibili, ...) into a direct stream URL
/// that AVPlayer can play, using yt-dlp. Stream URLs expire after a few hours,
/// so resolution happens at playback time and is never persisted.
enum OnlineStreamResolver {
    enum ResolverError: LocalizedError {
        case ytDlpMissing
        case resolutionFailed(String)
        case noStreamFound

        var errorDescription: String? {
            switch self {
            case .ytDlpMissing:
                return "yt-dlp not found. Install it with: brew install yt-dlp"
            case .resolutionFailed(let message):
                return "Could not resolve online stream: \(message)"
            case .noStreamFound:
                return "yt-dlp returned no playable stream URL."
            }
        }
    }

    static func resolveStreamURL(for pageURL: String) async throws -> URL {
        guard let ytDlp = findYtDlp() else {
            throw ResolverError.ytDlpMissing
        }

        let process = Process()
        process.executableURL = ytDlp
        // Progressive mp4 keeps audio+video in one stream AVPlayer can play
        // directly; fall back to the best muxed format otherwise.
        process.arguments = ["--no-playlist", "-f", "b[ext=mp4]/b", "-g", pageURL]

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

        // Output is one or two short URL lines, far below the pipe buffer
        // size, so reading after termination cannot deadlock.
        let outData = stdout.fileHandleForReading.readDataToEndOfFile()
        let errData = stderr.fileHandleForReading.readDataToEndOfFile()

        guard status == 0 else {
            let tail = String(decoding: errData, as: UTF8.self)
                .components(separatedBy: .newlines)
                .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                .suffix(2)
                .joined(separator: " ")
            throw ResolverError.resolutionFailed(tail.isEmpty ? "yt-dlp exited with status \(status)" : tail)
        }

        let firstLine = String(decoding: outData, as: UTF8.self)
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }

        guard let firstLine, let url = URL(string: firstLine) else {
            throw ResolverError.noStreamFound
        }
        return url
    }

    private static func findYtDlp() -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "/opt/homebrew/bin/yt-dlp",
            "/usr/local/bin/yt-dlp",
            "\(home)/.local/bin/yt-dlp",
            "\(home)/.local/share/audio-subtitles-venv/bin/yt-dlp"
        ]
        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return URL(fileURLWithPath: candidate)
        }
        return nil
    }
}
