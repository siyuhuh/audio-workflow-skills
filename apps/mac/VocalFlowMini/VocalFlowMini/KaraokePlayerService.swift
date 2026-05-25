import AppKit
import AVFoundation
import Foundation
import UniformTypeIdentifiers

@MainActor
final class KaraokePlayerService: ObservableObject {
    struct PlaylistItem: Identifiable, Equatable {
        let id: String
        let title: String
        let mediaURL: URL
        let lyricURL: URL?
        let isVideo: Bool
    }

    struct LyricCue: Identifiable, Equatable {
        let id = UUID()
        let start: TimeInterval
        let end: TimeInterval
        let text: String
    }

    @Published private(set) var packageFolderName = "No folder selected"
    @Published private(set) var playlist: [PlaylistItem] = []
    @Published private(set) var selectedItemID: String?
    @Published private(set) var selectedTrackName = "No song selected"
    @Published private(set) var selectedTrackURL: URL?
    @Published private(set) var selectedLyricName = "No lyrics loaded"
    @Published private(set) var lyrics: [LyricCue] = []
    @Published private(set) var currentLyric = "Choose a song to show lyrics."
    @Published private(set) var nextLyric = ""
    @Published private(set) var currentTime: TimeInterval = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var status = "Choose a local song to start a karaoke session."
    @Published private(set) var player: AVPlayer?
    @Published private(set) var selectedTrackIsVideo = false
    @Published private(set) var playbackVolume: Float = 0.85
    @Published private(set) var playbackRate: Float = 1.0

    private var timeObserver: Any?

    private static let mediaExtensions = Set(["mp3", "m4a", "wav", "flac", "aac", "mp4", "mov", "m4v"])
    private static let videoExtensions = Set(["mp4", "mov", "m4v"])
    private static let lyricExtensions = ["lrc", "srt", "json"]

    func choosePackageFolder() {
        let panel = NSOpenPanel()
        panel.title = "Choose a karaoke package folder"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = true
        panel.canChooseFiles = false

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        if let package = try? KaraokePackageScanner.readManifest(in: url) {
            loadPackage(package)
            status = "Loaded saved package."
            return
        }

        loadPackageFolder(url)
    }

    func chooseAudioFile() {
        let panel = NSOpenPanel()
        panel.title = "Choose a karaoke track or MV"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.audio, .movie]

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        let item = PlaylistItem(
            id: url.path,
            title: url.deletingPathExtension().lastPathComponent,
            mediaURL: url,
            lyricURL: nil,
            isVideo: Self.videoExtensions.contains(url.pathExtension.lowercased())
        )
        playlist = [item]
        packageFolderName = "Single file"
        loadItem(item)
    }

    func selectItem(_ item: PlaylistItem) {
        loadItem(item)
    }

    func loadPackage(_ package: KaraokePackage) {
        packageFolderName = package.folderURL.lastPathComponent
        playlist = Self.playlistItems(for: package)

        if let preferredItem = playlist.first {
            loadItem(preferredItem)
            status = "Loaded generated package."
            return
        }

        loadPackageFolder(package.folderURL)
    }

    func togglePlayback() {
        guard let player else {
            choosePackageFolder()
            return
        }

        if isPlaying {
            player.pause()
            isPlaying = false
            status = "Paused."
        } else {
            player.rate = playbackRate
            isPlaying = true
            status = selectedTrackIsVideo ? "Playing MV." : "Playing track."
        }
    }

    func stopPlayback() {
        player?.pause()
        player?.seek(to: .zero)
        isPlaying = false
        if selectedTrackURL != nil {
            status = "Stopped."
        }
    }

    func setPlaybackVolume(_ value: Float) {
        playbackVolume = value.clamped(to: 0...1)
        player?.volume = playbackVolume
    }

    func setPlaybackRate(_ value: Float) {
        playbackRate = value.clamped(to: 0.5...1.5)
        if isPlaying {
            player?.rate = playbackRate
        }
    }

    private func loadPackageFolder(_ url: URL) {
        packageFolderName = url.lastPathComponent
        playlist = Self.scanPackageFolder(url)
        if let firstItem = playlist.first {
            loadItem(firstItem)
            status = "Loaded \(playlist.count) item\(playlist.count == 1 ? "" : "s")."
        } else {
            resetSelection()
            status = "No audio or video files found in this folder."
        }
    }

    private func loadItem(_ item: PlaylistItem) {
        player?.pause()
        removeTimeObserver()

        let player = AVPlayer(url: item.mediaURL)
        player.volume = playbackVolume

        selectedItemID = item.id
        selectedTrackURL = item.mediaURL
        selectedTrackName = item.title
        selectedTrackIsVideo = item.isVideo
        self.player = player
        isPlaying = false
        currentTime = 0
        loadLyrics(from: item.lyricURL)
        addTimeObserver(to: player)
        status = item.isVideo ? "MV ready." : "Track ready."
    }

    private func resetSelection() {
        player?.pause()
        removeTimeObserver()
        player = nil
        selectedItemID = nil
        selectedTrackURL = nil
        selectedTrackName = "No song selected"
        selectedTrackIsVideo = false
        selectedLyricName = "No lyrics loaded"
        lyrics = []
        currentLyric = "Choose a song to show lyrics."
        nextLyric = ""
        currentTime = 0
        isPlaying = false
    }

    private func addTimeObserver(to player: AVPlayer) {
        let interval = CMTime(seconds: 0.2, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            Task { @MainActor [weak self] in
                self?.updateLyrics(at: time.seconds)
            }
        }
    }

    private func removeTimeObserver() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
    }

    private func loadLyrics(from url: URL?) {
        guard let url else {
            selectedLyricName = "No lyrics loaded"
            lyrics = []
            currentLyric = "No lyric file found for this track."
            nextLyric = ""
            return
        }

        selectedLyricName = url.lastPathComponent
        lyrics = Self.parseLyrics(from: url)
        if lyrics.isEmpty {
            currentLyric = "Could not read lyrics from \(url.lastPathComponent)."
            nextLyric = ""
        } else {
            currentLyric = lyrics[0].text
            nextLyric = lyrics.count > 1 ? lyrics[1].text : ""
        }
    }

    private func updateLyrics(at time: TimeInterval) {
        currentTime = time
        guard !lyrics.isEmpty else { return }

        let index = lyrics.lastIndex { cue in
            cue.start <= time
        } ?? 0
        currentLyric = lyrics[index].text
        nextLyric = index + 1 < lyrics.count ? lyrics[index + 1].text : ""
    }

    private static func scanPackageFolder(_ folderURL: URL) -> [PlaylistItem] {
        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(
            at: folderURL,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        var mediaURLs: [URL] = []
        var lyricURLs: [String: URL] = [:]
        var allLyricURLs: [URL] = []

        for case let fileURL as URL in enumerator {
            let ext = fileURL.pathExtension.lowercased()
            if mediaExtensions.contains(ext) {
                if !shouldHideFromPlaylist(fileURL) {
                    mediaURLs.append(fileURL)
                }
            } else if lyricExtensions.contains(ext) {
                let key = normalizedStem(fileURL)
                let current = lyricURLs[key]
                if current == nil || lyricPriority(fileURL) < lyricPriority(current!) {
                    lyricURLs[key] = fileURL
                }
                allLyricURLs.append(fileURL)
            }
        }

        let fallbackLyric = allLyricURLs.count == 1 ? allLyricURLs[0] : nil

        return mediaURLs
            .sorted { left, right in
                let leftPriority = playlistPriority(left)
                let rightPriority = playlistPriority(right)
                if leftPriority == rightPriority {
                    return left.lastPathComponent.localizedCaseInsensitiveCompare(right.lastPathComponent) == .orderedAscending
                }
                return leftPriority < rightPriority
            }
            .map { mediaURL in
                let key = normalizedStem(mediaURL)
                return PlaylistItem(
                    id: mediaURL.path,
                    title: playlistTitle(for: mediaURL),
                    mediaURL: mediaURL,
                    lyricURL: lyricURLs[key] ?? fallbackLyric,
                    isVideo: videoExtensions.contains(mediaURL.pathExtension.lowercased())
                )
            }
    }

    private static func playlistItems(for package: KaraokePackage) -> [PlaylistItem] {
        let sharedLyricURL = package.playback.lyricURL ?? firstAssetURL(in: package.assets, roles: [.lyrics, .jsonTiming, .subtitle])
        let originalURL = package.playback.originalURL
            ?? firstAssetURL(in: package.assets, roles: [.originalAudio])
            ?? package.playback.mediaURL
        let backingURL = package.playback.backingURL
        let videoURL = package.playback.videoURL
        let packageTitle = cleanTrackTitle(package.title)
        var items: [PlaylistItem] = []

        appendPlaylistItem(
            url: backingURL,
            title: "\(packageTitle) (Instrumental)",
            lyricURL: sharedLyricURL,
            to: &items
        )

        let originalSourceURL = originalURL ?? (items.isEmpty ? videoURL : nil)
        appendPlaylistItem(
            url: originalSourceURL,
            title: "\(packageTitle) (Original)",
            lyricURL: sharedLyricURL,
            to: &items
        )

        return items.isEmpty ? scanPackageFolder(package.folderURL) : items
    }

    private static func appendPlaylistItem(url: URL?, title: String, lyricURL: URL?, to items: inout [PlaylistItem]) {
        guard let url, !items.contains(where: { $0.mediaURL.path == url.path }) else {
            return
        }

        items.append(PlaylistItem(
            id: url.path,
            title: title,
            mediaURL: url,
            lyricURL: lyricURL,
            isVideo: videoExtensions.contains(url.pathExtension.lowercased())
        ))
    }

    private static func firstAssetURL(in assets: [PackageAsset], roles: [PackageAssetRole]) -> URL? {
        for role in roles {
            if let asset = assets.first(where: { $0.role == role }) {
                return asset.url
            }
        }
        return nil
    }

    private static func parseLyrics(from url: URL) -> [LyricCue] {
        switch url.pathExtension.lowercased() {
        case "lrc":
            return parseLRC(url)
        case "srt":
            return parseSRT(url)
        case "json":
            return parseAudioSubtitlesJSON(url)
        default:
            return []
        }
    }

    private static func parseLRC(_ url: URL) -> [LyricCue] {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return [] }

        let pattern = #"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }

        var timedLines: [(TimeInterval, String)] = []
        for line in contents.components(separatedBy: .newlines) {
            let range = NSRange(line.startIndex..<line.endIndex, in: line)
            let matches = regex.matches(in: line, range: range)
            guard !matches.isEmpty else { continue }

            let textStart = matches.last?.range.upperBound ?? 0
            let text = String(line[String.Index(utf16Offset: textStart, in: line)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }

            for match in matches {
                guard let start = lrcTime(from: line, match: match) else { continue }
                timedLines.append((start, text))
            }
        }

        return cues(from: timedLines)
    }

    private static func parseSRT(_ url: URL) -> [LyricCue] {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        let normalized = contents.replacingOccurrences(of: "\r\n", with: "\n")

        return normalized
            .components(separatedBy: "\n\n")
            .compactMap { block -> LyricCue? in
                let lines = block.components(separatedBy: .newlines).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                guard let timeLine = lines.first(where: { $0.contains("-->") }) else { return nil }
                let parts = timeLine.components(separatedBy: "-->")
                guard parts.count == 2,
                      let start = subtitleTime(parts[0]),
                      let end = subtitleTime(parts[1]) else {
                    return nil
                }

                let text = lines
                    .filter { !$0.contains("-->") && Int($0.trimmingCharacters(in: .whitespaces)) == nil }
                    .joined(separator: " ")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return nil }

                return LyricCue(start: start, end: end, text: text)
            }
            .sorted { $0.start < $1.start }
    }

    private static func parseAudioSubtitlesJSON(_ url: URL) -> [LyricCue] {
        struct Payload: Decodable {
            let cues: [Cue]
        }

        struct Cue: Decodable {
            let start: TimeInterval
            let end: TimeInterval
            let text: String
        }

        guard let data = try? Data(contentsOf: url),
              let payload = try? JSONDecoder().decode(Payload.self, from: data) else {
            return []
        }

        return payload.cues
            .map { LyricCue(start: $0.start, end: $0.end, text: $0.text.trimmingCharacters(in: .whitespacesAndNewlines)) }
            .filter { !$0.text.isEmpty }
            .sorted { $0.start < $1.start }
    }

    private static func cues(from timedLines: [(TimeInterval, String)]) -> [LyricCue] {
        let sortedLines = timedLines.sorted { $0.0 < $1.0 }
        return sortedLines.enumerated().map { index, line in
            let end = index + 1 < sortedLines.count ? sortedLines[index + 1].0 : line.0 + 4
            return LyricCue(start: line.0, end: end, text: line.1)
        }
    }

    private static func lrcTime(from line: String, match: NSTextCheckingResult) -> TimeInterval? {
        guard match.numberOfRanges >= 3,
              let minutes = Int(capture(1, in: line, match: match) ?? ""),
              let seconds = Int(capture(2, in: line, match: match) ?? "") else {
            return nil
        }

        let fractionText = capture(3, in: line, match: match) ?? "0"
        let fractionDivisor = pow(10.0, Double(fractionText.count))
        let fraction = (Double(fractionText) ?? 0) / fractionDivisor
        return TimeInterval(minutes * 60 + seconds) + fraction
    }

    private static func subtitleTime(_ text: String) -> TimeInterval? {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: ".")
        let parts = cleaned.components(separatedBy: ":")
        guard parts.count == 3,
              let hours = Double(parts[0]),
              let minutes = Double(parts[1]),
              let seconds = Double(parts[2]) else {
            return nil
        }

        return hours * 3600 + minutes * 60 + seconds
    }

    private static func capture(_ index: Int, in line: String, match: NSTextCheckingResult) -> String? {
        let range = match.range(at: index)
        guard range.location != NSNotFound, let swiftRange = Range(range, in: line) else {
            return nil
        }

        return String(line[swiftRange])
    }

    private static func shouldHideFromPlaylist(_ url: URL) -> Bool {
        let role = inferredMediaRole(url)
        return role == .vocalStem || url.deletingPathExtension().lastPathComponent.lowercased().contains("transcribe")
    }

    private static func playlistPriority(_ url: URL) -> Int {
        switch inferredMediaRole(url) {
        case .backingStem:
            return 0
        case .originalAudio:
            return 1
        case .videoPreview:
            return 2
        case .vocalStem:
            return 8
        default:
            return 5
        }
    }

    private static func playlistTitle(for url: URL) -> String {
        let title = cleanTrackTitle(url.deletingPathExtension().lastPathComponent)
        switch inferredMediaRole(url) {
        case .backingStem:
            return "\(title) (Instrumental)"
        case .originalAudio:
            return "\(title) (Original)"
        case .videoPreview:
            return "\(title) (MV)"
        default:
            return title
        }
    }

    private static func inferredMediaRole(_ url: URL) -> PackageAssetRole {
        let ext = url.pathExtension.lowercased()
        let name = url.deletingPathExtension().lastPathComponent.lowercased()
        let path = url.path.lowercased()

        if videoExtensions.contains(ext) {
            return .videoPreview
        }

        let looksLikeStem = path.contains("/stems/") || path.contains("\\stems\\")
        let hasBackingMarker = name.contains("instrumental")
            || name.contains("no_vocals")
            || name.contains("no-vocals")
            || name.contains("backing")
            || name.contains("karaoke")
        let hasVocalMarker = name.contains("vocals")
            || name.contains("vocal")
            || name.contains("voice")
            || name.contains("acapella")

        if hasBackingMarker {
            return .backingStem
        }
        if looksLikeStem || hasVocalMarker {
            return hasVocalMarker ? .vocalStem : .other
        }
        return .originalAudio
    }

    private static func normalizedStem(_ url: URL) -> String {
        cleanTrackTitle(url.deletingPathExtension().lastPathComponent).lowercased()
    }

    private static func cleanTrackTitle(_ title: String) -> String {
        var cleaned = title
        let patterns = [
            #"(?i)_?\((?:instrumental|vocals?|voice|acapella)\).*"#,
            #"(?i)[_\s-]+(?:instrumental|vocals?|voice|acapella|no[_\s-]?vocals?|backing|karaoke|preview|transcribe)(?:[_\s-].*)?$"#
        ]

        for pattern in patterns {
            cleaned = cleaned.replacingOccurrences(of: pattern, with: "", options: .regularExpression)
        }

        return cleaned.trimmingCharacters(in: CharacterSet(charactersIn: " _-")).nonEmpty ?? title
    }

    private static func lyricPriority(_ url: URL) -> Int {
        switch url.pathExtension.lowercased() {
        case "lrc":
            return 0
        case "json":
            return 1
        case "srt":
            return 2
        default:
            return 9
        }
    }
}

private extension Float {
    func clamped(to range: ClosedRange<Float>) -> Float {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
