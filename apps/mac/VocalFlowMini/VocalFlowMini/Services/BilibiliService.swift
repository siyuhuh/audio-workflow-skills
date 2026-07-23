import Foundation

struct BilibiliVideoInfo: Sendable {
    let pageURL: String
    let title: String
    let creator: String?
    let duration: TimeInterval?
    let thumbnailURL: URL?
    let bvid: String
    let cid: Int64
}

enum MediaURLNormalizer {
    static func normalize(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let components = URLComponents(string: trimmed),
           let scheme = components.scheme?.lowercased(),
           ["http", "https"].contains(scheme),
           components.host != nil {
            return trimmed
        }

        if trimmed.range(of: #"^(?:www\.|m\.)?(?:bilibili\.com|youtube\.com)/"#, options: .regularExpression) != nil
            || trimmed.range(of: #"^(?:b23\.tv|youtu\.be)/"#, options: .regularExpression) != nil {
            return "https://\(trimmed)"
        }

        if trimmed.range(of: #"^BV[0-9A-Za-z]+$"#, options: [.regularExpression, .caseInsensitive]) != nil
            || trimmed.range(of: #"^av[0-9]+$"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return "https://www.bilibili.com/video/\(trimmed)"
        }

        return nil
    }

    static func platform(for value: String) -> MediaPlatform {
        guard let normalized = normalize(value), let host = URL(string: normalized)?.host?.lowercased() else {
            return .web
        }
        if host == "youtu.be" || host == "youtube.com" || host.hasSuffix(".youtube.com") {
            return .youtube
        }
        if host == "b23.tv" || host == "bilibili.com" || host.hasSuffix(".bilibili.com") {
            return .bilibili
        }
        return .web
    }
}

enum BilibiliService {
    private struct SearchResponse: Decodable {
        let code: Int
        let message: String?
        let data: SearchData?
    }

    private struct SearchData: Decodable {
        let result: [SearchItem]?
    }

    private struct SearchItem: Decodable {
        let bvid: String?
        let aid: Int64?
        let title: String?
        let author: String?
        let duration: String?
        let pic: String?
    }

    private struct ViewResponse: Decodable {
        let code: Int
        let message: String?
        let data: ViewData?
    }

    private struct ViewData: Decodable {
        let bvid: String
        let title: String
        let pic: String?
        let duration: TimeInterval?
        let cid: Int64
        let owner: Owner?
    }

    private struct Owner: Decodable {
        let name: String?
    }

    private struct PlayResponse: Decodable {
        let code: Int
        let message: String?
        let data: PlayData?
    }

    private struct PlayData: Decodable {
        let durl: [PlayURL]?
    }

    private struct PlayURL: Decodable {
        let url: String
        let backupURL: [String]?

        enum CodingKeys: String, CodingKey {
            case url
            case backupURL = "backup_url"
        }
    }

    private enum VideoIdentifier {
        case bvid(String)
        case aid(String)
    }

    static let playbackHeaders = [
        "Referer": "https://www.bilibili.com/",
        "User-Agent": browserUserAgent
    ]

    static func search(query: String, limit: Int = 8) async throws -> [MediaSearchResult] {
        let normalizedQuery = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        guard !normalizedQuery.isEmpty else { throw BilibiliError.emptyQuery }

        var components = URLComponents(string: "https://api.bilibili.com/x/web-interface/search/type")!
        components.queryItems = [
            URLQueryItem(name: "search_type", value: "video"),
            URLQueryItem(name: "keyword", value: normalizedQuery),
            URLQueryItem(name: "page", value: "1"),
            URLQueryItem(name: "page_size", value: String(limit))
        ]
        guard let url = components.url else { throw BilibiliError.invalidResponse }

        let buvid = "XY" + UUID().uuidString.replacingOccurrences(of: "-", with: "").uppercased()
        let payload: SearchResponse = try await fetch(
            url,
            referer: "https://search.bilibili.com/",
            extraHeaders: [
                "Origin": "https://search.bilibili.com",
                "Cookie": "buvid3=\(buvid); buvid4=\(buvid); b_nut=\(Int(Date().timeIntervalSince1970));"
            ]
        )
        guard payload.code == 0 else {
            throw BilibiliError.api(payload.message ?? "Bilibili search failed.")
        }

        return (payload.data?.result ?? []).compactMap { item in
            let videoID = item.bvid ?? item.aid.map { "av\($0)" }
            guard let videoID else { return nil }
            return MediaSearchResult(
                id: "bilibili:\(videoID.lowercased())",
                title: decodeHTML(item.title ?? "Untitled"),
                url: "https://www.bilibili.com/video/\(videoID)",
                creator: item.author,
                duration: parseDuration(item.duration),
                platform: .bilibili,
                thumbnailURL: normalizedURL(item.pic)
            )
        }
    }

    static func videoInfo(for pageURL: String) async throws -> BilibiliVideoInfo {
        let canonicalURL = try await canonicalPageURL(from: pageURL)
        guard let identifier = videoIdentifier(from: canonicalURL) else {
            throw BilibiliError.invalidVideoURL
        }

        var components = URLComponents(string: "https://api.bilibili.com/x/web-interface/view")!
        switch identifier {
        case .bvid(let bvid):
            components.queryItems = [URLQueryItem(name: "bvid", value: bvid)]
        case .aid(let aid):
            components.queryItems = [URLQueryItem(name: "aid", value: aid)]
        }
        guard let url = components.url else { throw BilibiliError.invalidResponse }

        let payload: ViewResponse = try await fetch(url, referer: canonicalURL)
        guard payload.code == 0, let data = payload.data else {
            throw BilibiliError.api(payload.message ?? "Could not load Bilibili video information.")
        }

        return BilibiliVideoInfo(
            pageURL: "https://www.bilibili.com/video/\(data.bvid)",
            title: data.title,
            creator: data.owner?.name,
            duration: data.duration,
            thumbnailURL: normalizedURL(data.pic),
            bvid: data.bvid,
            cid: data.cid
        )
    }

    static func resolveStreamURL(for pageURL: String) async throws -> URL {
        let info = try await videoInfo(for: pageURL)
        var components = URLComponents(string: "https://api.bilibili.com/x/player/playurl")!
        components.queryItems = [
            URLQueryItem(name: "bvid", value: info.bvid),
            URLQueryItem(name: "cid", value: String(info.cid)),
            URLQueryItem(name: "qn", value: "64"),
            URLQueryItem(name: "fnval", value: "0"),
            URLQueryItem(name: "fourk", value: "0")
        ]
        guard let apiURL = components.url else { throw BilibiliError.invalidResponse }

        let payload: PlayResponse = try await fetch(apiURL, referer: info.pageURL)
        guard payload.code == 0, let playURL = payload.data?.durl?.first else {
            throw BilibiliError.api(payload.message ?? "No Bilibili preview stream is available.")
        }

        let candidates = [playURL.url] + (playURL.backupURL ?? [])
        guard let resolved = candidates.lazy.compactMap(URL.init(string:)).first else {
            throw BilibiliError.invalidResponse
        }
        return resolved
    }

    private static func canonicalPageURL(from input: String) async throws -> String {
        guard let normalized = MediaURLNormalizer.normalize(input), let url = URL(string: normalized) else {
            throw BilibiliError.invalidVideoURL
        }
        guard url.host?.lowercased() == "b23.tv" else { return normalized }

        var request = URLRequest(url: url)
        request.setValue(browserUserAgent, forHTTPHeaderField: "User-Agent")
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let finalURL = response.url else { throw BilibiliError.invalidVideoURL }
        return finalURL.absoluteString
    }

    private static func videoIdentifier(from value: String) -> VideoIdentifier? {
        guard let url = URL(string: value) else { return nil }
        let components = url.pathComponents.filter { $0 != "/" }
        guard let videoIndex = components.firstIndex(where: { $0.lowercased() == "video" }),
              components.indices.contains(videoIndex + 1) else {
            return nil
        }
        let identifier = components[videoIndex + 1]
        if identifier.lowercased().hasPrefix("bv") {
            return .bvid(identifier)
        }
        if identifier.lowercased().hasPrefix("av") {
            return .aid(String(identifier.dropFirst(2)))
        }
        return nil
    }

    private static func fetch<T: Decodable>(
        _ url: URL,
        referer: String,
        extraHeaders: [String: String] = [:]
    ) async throws -> T {
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
        request.setValue("zh-CN,zh;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        request.setValue(browserUserAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(referer, forHTTPHeaderField: "Referer")
        for (field, value) in extraHeaders {
            request.setValue(value, forHTTPHeaderField: field)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw BilibiliError.invalidResponse
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private static func parseDuration(_ value: String?) -> TimeInterval? {
        guard let value else { return nil }
        let parts = value.split(separator: ":").compactMap { TimeInterval($0) }
        if parts.count == 2 {
            return parts[0] * 60 + parts[1]
        }
        if parts.count == 3 {
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
        }
        return nil
    }

    private static func normalizedURL(_ value: String?) -> URL? {
        guard var value, !value.isEmpty else { return nil }
        if value.hasPrefix("//") {
            value = "https:\(value)"
        }
        return URL(string: value)
    }

    private static func decodeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&amp;", with: "&")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static let browserUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
}

enum BilibiliError: LocalizedError {
    case emptyQuery
    case invalidVideoURL
    case invalidResponse
    case api(String)

    var errorDescription: String? {
        switch self {
        case .emptyQuery:
            return "Bilibili search query is empty."
        case .invalidVideoURL:
            return "This is not a supported Bilibili video URL."
        case .invalidResponse:
            return "Bilibili returned an unreadable response."
        case .api(let message):
            return message
        }
    }
}
