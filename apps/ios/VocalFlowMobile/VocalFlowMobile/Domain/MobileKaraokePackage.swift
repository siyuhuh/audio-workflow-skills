import Foundation

struct MobileKaraokePackage: Identifiable, Codable, Equatable, Hashable {
    let id: UUID
    var title: String
    let folderURL: URL
    let importedAt: Date
    let videoURL: URL?
    let primaryAudioURL: URL?
    let backingURL: URL?
    let vocalURL: URL?
    let lyricURL: URL?

    var hasVideo: Bool { videoURL != nil }
    var hasBacking: Bool { backingURL != nil }
    var hasWordTiming: Bool { lyricURL?.pathExtension.lowercased() == "json" }

    var primaryPlaybackURL: URL? {
        videoURL ?? primaryAudioURL ?? vocalURL ?? backingURL
    }

    var primaryIsVocalStem: Bool {
        videoURL == nil && primaryAudioURL == nil && vocalURL != nil
    }
}
struct LyricWord: Equatable, Hashable {
    let text: String
    let start: TimeInterval
    let end: TimeInterval
}

struct LyricCue: Identifiable, Equatable, Hashable {
    let id: String
    let start: TimeInterval
    let end: TimeInterval
    let text: String
    let words: [LyricWord]

    init(start: TimeInterval, end: TimeInterval, text: String, words: [LyricWord] = []) {
        self.id = "\(start)-\(end)-\(text)"
        self.start = start
        self.end = end
        self.text = text
        self.words = words
    }
}

enum KaraokeAudioPreset: String, CaseIterable, Identifiable {
    case original
    case backing

    var id: String { rawValue }

    var title: String {
        switch self {
        case .original: "原唱"
        case .backing: "伴奏"
        }
    }

    var symbolName: String {
        switch self {
        case .original: "person.wave.2.fill"
        case .backing: "music.mic"
        }
    }
}
