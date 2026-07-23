import Foundation

enum MediaPlatform: String, Sendable {
    case youtube = "YouTube"
    case bilibili = "Bilibili"
    case web = "Web"

    var symbolName: String {
        switch self {
        case .youtube:
            return "play.rectangle.fill"
        case .bilibili:
            return "tv.fill"
        case .web:
            return "globe"
        }
    }
}

struct MediaSearchResult: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let url: String
    let creator: String?
    let duration: TimeInterval?
    let platform: MediaPlatform
    let thumbnailURL: URL?

    var durationText: String? {
        guard let duration, duration.isFinite, duration > 0 else { return nil }
        let totalSeconds = Int(duration.rounded())
        if totalSeconds >= 3600 {
            return String(format: "%d:%02d:%02d", totalSeconds / 3600, (totalSeconds % 3600) / 60, totalSeconds % 60)
        }
        return String(format: "%d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}

final class MediaSearchService: @unchecked Sendable {
    private struct SearchOutcome: Sendable {
        let results: [MediaSearchResult]
        let error: String?
    }

    private struct SearchPayload: Decodable {
        let entries: [SearchEntry]?
    }

    private struct SearchEntry: Decodable {
        let id: String?
        let title: String?
        let url: String?
        let webpageURL: String?
        let channel: String?
        let uploader: String?
        let duration: TimeInterval?
        let thumbnail: String?

        enum CodingKeys: String, CodingKey {
            case id
            case title
            case url
            case webpageURL = "webpage_url"
            case channel
            case uploader
            case duration
            case thumbnail
        }
    }

    func search(query: String, browser: String?, appendKaraoke: Bool = false) async throws -> [MediaSearchResult] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw MediaSearchError.noResults }
        let effectiveQuery = String((appendKaraoke ? "\(trimmed) karaoke" : trimmed).prefix(200))

        let outcomes = await withTaskGroup(of: SearchOutcome.self, returning: [SearchOutcome].self) { group in
            group.addTask { [self] in
                do {
                    return SearchOutcome(results: try await searchYouTube(query: effectiveQuery, browser: browser), error: nil)
                } catch {
                    return SearchOutcome(results: [], error: "YouTube: \(error.localizedDescription)")
                }
            }
            group.addTask {
                do {
                    return SearchOutcome(results: try await BilibiliService.search(query: effectiveQuery), error: nil)
                } catch {
                    return SearchOutcome(results: [], error: "Bilibili: \(error.localizedDescription)")
                }
            }

            var values: [SearchOutcome] = []
            for await outcome in group {
                values.append(outcome)
            }
            return values
        }

        let results = Self.rankAndDeduplicate(outcomes.flatMap(\.results))
        guard !results.isEmpty else {
            let errors = outcomes.compactMap(\.error)
            if !errors.isEmpty {
                throw MediaSearchError.failed(errors.joined(separator: "\n"))
            }
            throw MediaSearchError.noResults
        }
        return results
    }

    private func searchYouTube(query: String, browser: String?) async throws -> [MediaSearchResult] {
        try await Task.detached(priority: .userInitiated) {
            let environment = AudioSubtitlesRuntime.childProcessEnvironment()
            guard let ytDLP = AudioSubtitlesRuntime.executableURL(named: "yt-dlp", environment: environment) else {
                throw MediaSearchError.missingYtDLP
            }

            var arguments = [
                "--flat-playlist",
                "--no-warnings",
                "--dump-single-json",
                "ytsearch8:\(query)"
            ]
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
            let outputData = stdout.fileHandleForReading.readDataToEndOfFile()
            let errorData = stderr.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            try Task.checkCancellation()

            guard process.terminationStatus == 0 else {
                let message = String(decoding: errorData, as: UTF8.self)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                throw MediaSearchError.failed(message.isEmpty ? "yt-dlp exited with status \(process.terminationStatus)." : message)
            }

            let payload: SearchPayload
            do {
                payload = try JSONDecoder().decode(SearchPayload.self, from: outputData)
            } catch {
                throw MediaSearchError.invalidResponse
            }

            let results = (payload.entries ?? []).compactMap(Self.makeResult)
            guard !results.isEmpty else {
                throw MediaSearchError.noResults
            }
            return results
        }.value
    }

    private static func makeResult(from entry: SearchEntry) -> MediaSearchResult? {
        guard let title = entry.title?.trimmingCharacters(in: .whitespacesAndNewlines),
              !title.isEmpty else {
            return nil
        }

        let resolvedURL: String?
        if let webpageURL = entry.webpageURL, webpageURL.hasPrefix("http") {
            resolvedURL = webpageURL
        } else if let url = entry.url, url.hasPrefix("http") {
            resolvedURL = url
        } else if let id = entry.id, !id.isEmpty {
            resolvedURL = "https://www.youtube.com/watch?v=\(id)"
        } else {
            resolvedURL = nil
        }

        guard let resolvedURL else { return nil }
        return MediaSearchResult(
            id: resolvedURL,
            title: title,
            url: resolvedURL,
            creator: entry.channel ?? entry.uploader,
            duration: entry.duration,
            platform: .youtube,
            thumbnailURL: entry.thumbnail.flatMap(URL.init(string:))
        )
    }

    private static func rankAndDeduplicate(_ rows: [MediaSearchResult]) -> [MediaSearchResult] {
        var seen = Set<String>()
        var uniqueRows: [MediaSearchResult] = []
        for row in rows where seen.insert(row.url.lowercased()).inserted {
            uniqueRows.append(row)
        }

        return uniqueRows
            .enumerated()
            .sorted { lhs, rhs in
                let leftRank = durationRank(lhs.element.duration)
                let rightRank = durationRank(rhs.element.duration)
                return leftRank == rightRank ? lhs.offset < rhs.offset : leftRank < rightRank
            }
            .map(\.element)
    }

    private static func durationRank(_ duration: TimeInterval?) -> Int {
        guard let duration, duration.isFinite else { return 2 }
        if (45...720).contains(duration) { return 0 }
        return 1
    }
}

enum MediaSearchError: LocalizedError {
    case missingYtDLP
    case failed(String)
    case invalidResponse
    case noResults

    var errorDescription: String? {
        switch self {
        case .missingYtDLP:
            return "The bundled media search component is missing. Reinstall VocalFlow and try again."
        case .failed(let message):
            return message
        case .invalidResponse:
            return "Media search returned an unreadable response."
        case .noResults:
            return "No YouTube or Bilibili results found for this search."
        }
    }
}
