import Foundation

struct DiscoveredAgent: Identifiable, Equatable {
    let id: String
    let name: String
    let host: String
    let port: Int

    var baseURL: String {
        "http://\(host):\(port)"
    }
}

struct RemoteAgentHealth: Decodable {
    let ok: Bool
    let name: String
    let version: String
}

struct RemotePairResponse: Decodable {
    let token: String
    let name: String
    let version: String
}

struct RemoteJobOptions: Codable, Equatable {
    var separateVocals = true
    var saveVideoPreview = true
    var localFallback = true
    var simplifiedChinese = false
    var model = "medium"
    var subtitleSource = "auto"
    var browser: String?
    var language: String?
}

struct RemoteFile: Decodable, Identifiable, Equatable {
    var id: String { path }

    let path: String
    let name: String
    let size: Int64
    let contentType: String
    let role: String
    let url: String
}

struct RemoteJob: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let source: String
    let options: RemoteJobOptions
    let status: String
    let stage: String
    let progress: Double
    let overallProgress: Double
    let message: String
    let etaSec: Double?
    let createdAt: String
    let updatedAt: String
    let completedAt: String?
    let files: [RemoteFile]

    var isActive: Bool { status == "queued" || status == "running" }
    var isComplete: Bool { status == "complete" }
    var isFailed: Bool { status == "failed" || status == "cancelled" }

    var downloadableSize: Int64 {
        files.reduce(0) { $0 + $1.size }
    }
}

struct RemoteJobsEnvelope: Decodable {
    let jobs: [RemoteJob]
}

struct RemoteAgentErrorEnvelope: Decodable {
    let error: String
}

enum RemoteAgentError: LocalizedError {
    case invalidURL
    case invalidResponse
    case server(String)
    case unsafeFilePath

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Mac mini 地址无效。"
        case .invalidResponse:
            return "Mac mini 返回了无法识别的数据。"
        case .server(let message):
            return message
        case .unsafeFilePath:
            return "歌曲包里包含不安全的文件路径。"
        }
    }
}
