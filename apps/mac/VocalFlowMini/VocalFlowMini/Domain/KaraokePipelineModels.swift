import Foundation

enum KaraokeSource: Codable, Equatable {
    case url(String)
    case localFile(URL)

    var displayValue: String {
        switch self {
        case .url(let value):
            return value
        case .localFile(let url):
            return url.path
        }
    }

    var cliValue: String {
        displayValue
    }

    var suggestedTitle: String {
        switch self {
        case .url(let value):
            return URL(string: value)?.lastPathComponent.nonEmpty ?? "Web Media"
        case .localFile(let url):
            return url.deletingPathExtension().lastPathComponent.nonEmpty ?? "Local Media"
        }
    }
}

enum SubtitleSource: String, CaseIterable, Codable, Identifiable {
    case auto
    case platform
    case local

    var id: String { rawValue }

    var cliValue: String {
        switch self {
        case .auto:
            return "auto"
        case .platform:
            return "platform"
        case .local:
            return "local"
        }
    }

    var label: String {
        switch self {
        case .auto:
            return "Auto"
        case .platform:
            return "Platform captions"
        case .local:
            return "Local Whisper"
        }
    }
}

struct ProcessingOptions: Codable, Equatable {
    var separateVocals = true
    var saveVideoPreview = false
    var saveAudio = false
    var exportMp3 = true
    var localFallback = true
    var subtitleSource: SubtitleSource = .auto
    var model = "medium"
    var language = ""
    var formats: [String] = ["lrc", "json"]

    var normalizedLanguage: String? {
        let trimmed = language.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

enum PipelineStage: String, CaseIterable, Codable, Identifiable {
    case queued
    case prepare
    case download
    case preview
    case captions
    case separate
    case convert
    case transcribe
    case write
    case manifest
    case complete
    case failed

    var id: String { rawValue }

    var label: String {
        switch self {
        case .queued:
            return "Queued"
        case .prepare:
            return "Preparing"
        case .download:
            return "Downloading"
        case .preview:
            return "Saving MV"
        case .captions:
            return "Captions"
        case .separate:
            return "Separating"
        case .convert:
            return "Converting"
        case .transcribe:
            return "Transcribing"
        case .write:
            return "Writing"
        case .manifest:
            return "Packaging"
        case .complete:
            return "Complete"
        case .failed:
            return "Failed"
        }
    }

    static func fromScriptName(_ name: String) -> PipelineStage {
        switch name {
        case "prepare":
            return .prepare
        case "download":
            return .download
        case "preview":
            return .preview
        case "captions":
            return .captions
        case "separate":
            return .separate
        case "convert":
            return .convert
        case "transcribe":
            return .transcribe
        case "write":
            return .write
        case "manifest":
            return .manifest
        default:
            return .prepare
        }
    }
}

struct PipelineProgress: Codable, Equatable {
    var stage: PipelineStage
    var progress: Double
    var message: String
    var etaSec: Double?
    var isDone: Bool
    var isFailed: Bool

    static let queued = PipelineProgress(
        stage: .queued,
        progress: 0,
        message: "Ready to start.",
        etaSec: nil,
        isDone: false,
        isFailed: false
    )
}

struct ProcessingJob: Identifiable, Codable, Equatable {
    let id: UUID
    let source: KaraokeSource
    let options: ProcessingOptions
    let outputDirectory: URL
    let createdAt: Date

    init(
        id: UUID = UUID(),
        source: KaraokeSource,
        options: ProcessingOptions,
        outputDirectory: URL,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.source = source
        self.options = options
        self.outputDirectory = outputDirectory
        self.createdAt = createdAt
    }
}

enum PackageAssetRole: String, Codable, Equatable {
    case videoPreview
    case originalAudio
    case vocalStem
    case backingStem
    case lyrics
    case subtitle
    case jsonTiming
    case assKaraoke
    case other
}

struct PackageAsset: Identifiable, Codable, Equatable {
    let id: UUID
    let url: URL
    let role: PackageAssetRole

    init(id: UUID = UUID(), url: URL, role: PackageAssetRole) {
        self.id = id
        self.url = url
        self.role = role
    }
}

struct PlaybackBundle: Codable, Equatable {
    var mediaURL: URL?
    var videoURL: URL?
    var lyricURL: URL?
    var originalURL: URL?
    var backingURL: URL?
    var vocalURL: URL?
}

struct KaraokePackage: Identifiable, Codable, Equatable {
    let id: UUID
    let title: String
    let folderURL: URL
    let source: KaraokeSource
    let options: ProcessingOptions
    let assets: [PackageAsset]
    let playback: PlaybackBundle
    let createdAt: Date
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
