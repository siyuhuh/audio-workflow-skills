import AppKit
import AVFoundation
import Foundation
import UniformTypeIdentifiers

@MainActor
final class KaraokePlayerService: ObservableObject {
    struct SongQueueItem: Identifiable, Equatable {
        let id: UUID
        let package: KaraokePackage

        init(id: UUID = UUID(), package: KaraokePackage) {
            self.id = id
            self.package = package
        }
    }

    struct PlaylistItem: Identifiable, Equatable {
        enum PlaybackKind: String {
            case mv
            case backing
            case original

            var title: String {
                switch self {
                case .mv: "MV"
                case .backing: "Backing"
                case .original: "Original"
                }
            }

            var symbolName: String {
                switch self {
                case .mv: "play.rectangle.fill"
                case .backing: "music.mic"
                case .original: "waveform"
                }
            }
        }

        let id: String
        let title: String
        let mediaURL: URL
        let lyricURL: URL?
        let isVideo: Bool
        let kind: PlaybackKind
        /// Instrumental stem to play instead of the video's own audio
        /// (sing mode: muted MV + backing track).
        var backingAudioURL: URL? = nil
        var httpHeaders: [String: String] = [:]
    }

    struct LyricWord: Equatable {
        let text: String
        let start: TimeInterval
        let end: TimeInterval
    }

    struct LyricCue: Identifiable, Equatable {
        let id = UUID()
        let start: TimeInterval
        let end: TimeInterval
        let text: String
        let words: [LyricWord]

        init(start: TimeInterval, end: TimeInterval, text: String, words: [LyricWord] = []) {
            self.start = start
            self.end = end
            self.text = text
            self.words = words
        }
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
    @Published private(set) var previousCue: LyricCue?
    @Published private(set) var currentCue: LyricCue?
    @Published private(set) var nextCue: LyricCue?
    @Published private(set) var currentTime: TimeInterval = 0
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var isBuffering = false
    @Published private(set) var playbackIssue: String?
    @Published private(set) var isPreparingOnlineVideo = false
    @Published private(set) var status = "Choose a local song to start a karaoke session."
    @Published private(set) var player: AVPlayer?
    @Published private(set) var selectedTrackIsVideo = false
    @Published private(set) var videoAspectRatio: Double = 16.0 / 9.0
    @Published private(set) var playbackVolume: Float = 0.85
    @Published private(set) var playbackRate: Float = 1.0
    @Published private(set) var hasBackingTrack = false
    @Published private(set) var useBackingAudio = true
    @Published private(set) var originalVocalVolume: Float = 0
    @Published private(set) var backingTrackVolume: Float = 1
    @Published private(set) var songQueue: [SongQueueItem] = []
    @Published private(set) var currentQueueItemID: UUID?
    @Published private(set) var currentPackage: KaraokePackage?
    @Published private(set) var isRecordingSessionActive = false

    private var timeObserver: Any?
    private var backingPlayer: AVPlayer?
    private var itemStatusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var playbackEndObserver: NSObjectProtocol?
    private var playbackRequested = false

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

        let isVideo = Self.videoExtensions.contains(url.pathExtension.lowercased())
        let item = PlaylistItem(
            id: url.path,
            title: url.deletingPathExtension().lastPathComponent,
            mediaURL: url,
            lyricURL: nil,
            isVideo: isVideo,
            kind: isVideo ? .mv : .original
        )
        playlist = [item]
        currentPackage = nil
        packageFolderName = "Single file"
        loadItem(item)
    }

    func selectItem(_ item: PlaylistItem) {
        loadItem(item)
    }

    func enqueue(_ package: KaraokePackage) {
        guard !songQueue.contains(where: { $0.package.id == package.id }) else { return }
        songQueue.append(SongQueueItem(package: package))
    }

    func playNow(_ package: KaraokePackage, autoplay: Bool = true) {
        let queueItem: SongQueueItem
        if let existing = songQueue.first(where: { $0.package.id == package.id }) {
            queueItem = existing
        } else {
            queueItem = SongQueueItem(package: package)
            songQueue.append(queueItem)
        }

        currentQueueItemID = queueItem.id
        loadPackage(package)
        if autoplay {
            startPlayback()
        }
    }

    func playQueueItem(_ item: SongQueueItem, autoplay: Bool = true) {
        guard songQueue.contains(where: { $0.id == item.id }) else { return }
        currentQueueItemID = item.id
        loadPackage(item.package)
        if autoplay {
            startPlayback()
        }
    }

    func playNextInQueue(autoplay: Bool = true) {
        guard let next = queueItem(offsetFromCurrent: 1) else { return }
        playQueueItem(next, autoplay: autoplay)
    }

    func playPreviousInQueue(autoplay: Bool = true) {
        guard let previous = queueItem(offsetFromCurrent: -1) else { return }
        playQueueItem(previous, autoplay: autoplay)
    }

    func removeQueueItem(_ item: SongQueueItem) {
        guard let index = songQueue.firstIndex(where: { $0.id == item.id }) else { return }
        let wasCurrent = item.id == currentQueueItemID
        let shouldResume = isPlaying
        songQueue.remove(at: index)

        guard wasCurrent else { return }
        if songQueue.indices.contains(index) {
            playQueueItem(songQueue[index], autoplay: shouldResume)
        } else if let last = songQueue.last {
            playQueueItem(last, autoplay: shouldResume)
        } else {
            currentQueueItemID = nil
        }
    }

    func moveQueueItem(_ item: SongQueueItem, by offset: Int) {
        guard let index = songQueue.firstIndex(where: { $0.id == item.id }) else { return }
        let destination = index + offset
        guard songQueue.indices.contains(destination) else { return }
        songQueue.swapAt(index, destination)
    }

    func clearQueue() {
        songQueue.removeAll()
        currentQueueItemID = nil
    }

    var hasNextQueueItem: Bool {
        queueItem(offsetFromCurrent: 1) != nil
    }

    var hasPreviousQueueItem: Bool {
        queueItem(offsetFromCurrent: -1) != nil
    }

    var nextQueueItem: SongQueueItem? {
        queueItem(offsetFromCurrent: 1)
    }

    func loadPackage(_ package: KaraokePackage) {
        currentPackage = package
        packageFolderName = package.folderURL.lastPathComponent
        playlist = Self.playlistItems(for: package)
        let preferredLyricURL = Self.firstAssetURL(
            in: package.assets,
            roles: [.jsonTiming, .lyrics, .subtitle]
        ) ?? package.playback.lyricURL

        if let preferredItem = playlist.first {
            loadItem(preferredItem)
            status = "Loaded generated package."
        } else {
            loadPackageFolder(package.folderURL)
        }

        // Default to streaming the online MV when the package came from a URL
        // and no local video file exists in the package.
        if package.playback.videoURL == nil, case .url(let pageURL) = package.source {
            resolveOnlineVideo(
                pageURL: pageURL,
                title: package.title,
                lyricURL: preferredLyricURL,
                backingURL: package.playback.backingURL,
                browser: package.options.normalizedBrowser
            )
        }
    }

    private func resolveOnlineVideo(pageURL: String, title: String, lyricURL: URL?, backingURL: URL?, browser: String?) {
        isPreparingOnlineVideo = true
        status = "Preparing local MV cache..."
        let anchorItemID = selectedItemID

        Task { [weak self] in
            do {
                let stream = try await OnlineStreamResolver.resolveStream(for: pageURL, browser: browser)
                guard let self else { return }
                // Don't yank playback away if the user switched tracks meanwhile.
                guard self.selectedItemID == anchorItemID else {
                    self.isPreparingOnlineVideo = false
                    return
                }

                let item = PlaylistItem(
                    id: "online:\(pageURL)",
                    title: "\(title) (Online MV)",
                    mediaURL: stream.url,
                    lyricURL: lyricURL,
                    isVideo: true,
                    kind: .mv,
                    backingAudioURL: backingURL,
                    httpHeaders: stream.httpHeaders
                )
                if !self.playlist.contains(where: { $0.id == item.id }) {
                    self.playlist.insert(item, at: 0)
                }
                self.isPreparingOnlineVideo = false
                self.loadItem(item)
            } catch {
                self?.isPreparingOnlineVideo = false
                self?.playbackIssue = error.localizedDescription
                self?.status = "Online MV unavailable. Select Backing to keep singing."
            }
        }
    }

    func togglePlayback() {
        guard let player else {
            choosePackageFolder()
            return
        }

        if playbackRequested {
            playbackRequested = false
            player.pause()
            backingPlayer?.pause()
            isPlaying = false
            isBuffering = false
            status = "Paused."
        } else {
            startPlayback()
        }
    }

    func playFromBeginning() {
        guard player != nil else { return }
        playbackRequested = false
        player?.pause()
        backingPlayer?.pause()
        seek(to: 0)
        startPlayback()
    }

    func pausePlayback() {
        guard playbackRequested || isPlaying else { return }
        playbackRequested = false
        player?.pause()
        backingPlayer?.pause()
        isPlaying = false
        isBuffering = false
        status = "Paused."
    }

    func setRecordingSessionActive(_ active: Bool) {
        isRecordingSessionActive = active
    }

    func attachRecording(_ recording: KaraokeRecordingPackage) throws {
        guard var package = currentPackage else { return }
        package.recordings = [recording] + (package.recordings ?? []).filter { $0.id != recording.id }
        try KaraokePackageScanner.writeManifest(package)
        currentPackage = package
    }

    var recordingSourceIdentifier: String? {
        if let currentPackage {
            return currentPackage.id.uuidString
        }
        return selectedTrackURL?.absoluteString
    }

    var recordingSourceTitle: String {
        selectedTrackName.nonEmpty ?? "Untitled song"
    }

    var preferredRecordingMusicURL: URL? {
        guard let selectedItemID,
              let selected = playlist.first(where: { $0.id == selectedItemID }) else {
            return nil
        }
        if useBackingAudio,
           let backingURL = selected.backingAudioURL,
           backingURL.isFileURL,
           FileManager.default.fileExists(atPath: backingURL.path) {
            return backingURL
        }
        if selected.mediaURL.isFileURL,
           FileManager.default.fileExists(atPath: selected.mediaURL.path) {
            return selected.mediaURL
        }
        if let backingURL = currentPackage?.playback.backingURL,
           backingURL.isFileURL,
           FileManager.default.fileExists(atPath: backingURL.path) {
            return backingURL
        }
        return nil
    }

    private func startPlayback() {
        guard let player else { return }
        playbackRequested = true
        playbackIssue = nil
        isPlaying = true
        isBuffering = selectedTrackIsVideo
        status = selectedTrackIsVideo ? "Starting MV..." : "Starting track..."
        player.playImmediately(atRate: playbackRate)
        if backingAudioActive {
            syncBackingToVideo()
            backingPlayer?.playImmediately(atRate: playbackRate)
        }
    }

    private func queueItem(offsetFromCurrent offset: Int) -> SongQueueItem? {
        guard !songQueue.isEmpty else { return nil }
        guard let currentQueueItemID,
              let currentIndex = songQueue.firstIndex(where: { $0.id == currentQueueItemID }) else {
            return offset > 0 ? songQueue.first : nil
        }
        let targetIndex = currentIndex + offset
        return songQueue.indices.contains(targetIndex) ? songQueue[targetIndex] : nil
    }

    func stopPlayback() {
        player?.pause()
        player?.seek(to: .zero)
        backingPlayer?.pause()
        backingPlayer?.seek(to: .zero)
        playbackRequested = false
        isPlaying = false
        isBuffering = false
        currentTime = 0
        updateLyrics(at: 0)
        if selectedTrackURL != nil {
            status = "Stopped."
        }
    }

    func setPlaybackVolume(_ value: Float) {
        playbackVolume = value.clamped(to: 0...1)
        applyAudioRouting()
    }

    func setPlaybackRate(_ value: Float) {
        playbackRate = value.clamped(to: 0.5...1.5)
        if isPlaying {
            player?.rate = playbackRate
            if backingAudioActive {
                backingPlayer?.rate = playbackRate
            }
        }
    }

    func seek(to seconds: TimeInterval) {
        guard let player else { return }
        let targetSeconds = min(max(0, seconds), duration > 0 ? duration : seconds)
        let target = CMTime(seconds: targetSeconds, preferredTimescale: 600)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.syncBackingToVideo()
            }
        }
        updateLyrics(at: targetSeconds)
    }

    func skip(by seconds: TimeInterval) {
        seek(to: currentTime + seconds)
    }

    func setUseBackingAudio(_ enabled: Bool) {
        useBackingAudio = enabled
        originalVocalVolume = enabled ? 0 : 1
        backingTrackVolume = enabled ? 1 : 0
        applyAudioRouting()
        if enabled, isPlaying {
            syncBackingToVideo()
        }
        if hasBackingTrack {
            status = enabled ? "MV with backing track." : "MV with original audio."
        }
    }

    func setOriginalVocalVolume(_ value: Float) {
        originalVocalVolume = value.clamped(to: 0...1)
        applyAudioRouting()
        updateMixStatus()
    }

    func setBackingTrackVolume(_ value: Float) {
        backingTrackVolume = value.clamped(to: 0...1)
        applyAudioRouting()
        if backingAudioActive, isPlaying {
            syncBackingToVideo()
        }
        updateMixStatus()
    }

    private var backingAudioActive: Bool {
        backingTrackVolume > 0.005 && backingPlayer != nil
    }

    private func applyAudioRouting() {
        guard selectedTrackIsVideo, let backingPlayer else {
            player?.isMuted = false
            player?.volume = playbackVolume
            self.backingPlayer?.pause()
            return
        }

        player?.isMuted = originalVocalVolume <= 0.005
        player?.volume = playbackVolume * originalVocalVolume
        backingPlayer.volume = playbackVolume * backingTrackVolume
        if !backingAudioActive {
            backingPlayer.pause()
        }
    }

    private func updateMixStatus() {
        guard hasBackingTrack else { return }
        if originalVocalVolume > 0.005, backingTrackVolume > 0.005 {
            status = "Original vocals and backing are mixed."
        } else if backingAudioActive {
            status = "Backing track enabled."
        } else {
            status = "Original vocals enabled."
        }
    }

    /// The video player is the master clock; snap the backing stem to it.
    private func syncBackingToVideo() {
        guard backingAudioActive, let player, let backingPlayer else { return }
        backingPlayer.seek(to: player.currentTime(), toleranceBefore: .zero, toleranceAfter: .zero)
        if isPlaying {
            backingPlayer.rate = playbackRate
        }
    }

    private func correctBackingDrift(videoTime: TimeInterval) {
        guard isPlaying, backingAudioActive, let backingPlayer else { return }
        let backingTime = backingPlayer.currentTime().seconds
        guard backingTime.isFinite, videoTime.isFinite else { return }
        if abs(backingTime - videoTime) > 0.4 {
            backingPlayer.seek(
                to: CMTime(seconds: videoTime, preferredTimescale: 600),
                toleranceBefore: .zero,
                toleranceAfter: .zero
            )
        }
    }

    private func loadPackageFolder(_ url: URL) {
        currentPackage = nil
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
        backingPlayer?.pause()
        backingPlayer = nil
        removePlaybackObservers()
        removeTimeObserver()

        let asset = AVURLAsset(
            url: item.mediaURL,
            options: item.httpHeaders.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": item.httpHeaders]
        )
        let playerItem = AVPlayerItem(asset: asset)
        let player = AVPlayer(playerItem: playerItem)
        player.volume = playbackVolume

        if item.isVideo, let backingURL = item.backingAudioURL {
            backingPlayer = AVPlayer(url: backingURL)
        }
        hasBackingTrack = backingPlayer != nil

        selectedItemID = item.id
        selectedTrackURL = item.mediaURL
        selectedTrackName = item.title
        selectedTrackIsVideo = item.isVideo
        videoAspectRatio = 16.0 / 9.0
        self.player = player
        applyAudioRouting()
        playbackRequested = false
        isPlaying = false
        isBuffering = item.isVideo
        playbackIssue = nil
        isPreparingOnlineVideo = false
        currentTime = 0
        duration = 0
        loadLyrics(from: item.lyricURL)
        addTimeObserver(to: player)
        observePlayback(player: player, item: playerItem)
        status = item.isVideo ? "Loading MV..." : "Loading track..."
    }

    private func resetSelection() {
        player?.pause()
        backingPlayer?.pause()
        backingPlayer = nil
        hasBackingTrack = false
        removePlaybackObservers()
        removeTimeObserver()
        player = nil
        selectedItemID = nil
        selectedTrackURL = nil
        selectedTrackName = "No song selected"
        selectedTrackIsVideo = false
        videoAspectRatio = 16.0 / 9.0
        selectedLyricName = "No lyrics loaded"
        lyrics = []
        currentLyric = "Choose a song to show lyrics."
        nextLyric = ""
        previousCue = nil
        currentCue = nil
        nextCue = nil
        currentTime = 0
        duration = 0
        playbackRequested = false
        isPlaying = false
        isBuffering = false
        playbackIssue = nil
        isPreparingOnlineVideo = false
    }

    private func addTimeObserver(to player: AVPlayer) {
        let interval = CMTime(seconds: 0.2, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            Task { @MainActor [weak self] in
                self?.updateLyrics(at: time.seconds)
                self?.correctBackingDrift(videoTime: time.seconds)
            }
        }
    }

    private func removeTimeObserver() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
    }

    private func observePlayback(player: AVPlayer, item: AVPlayerItem) {
        itemStatusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
            Task { @MainActor [weak self, weak item] in
                guard let self, let item else { return }
                self.handleItemStatus(item)
            }
        }

        timeControlObservation = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self, weak player] _, _ in
            Task { @MainActor [weak self, weak player] in
                guard let self, let player else { return }
                self.handleTimeControlStatus(player.timeControlStatus)
            }
        }

        playbackEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handlePlaybackEnded()
            }
        }
    }

    private func removePlaybackObservers() {
        itemStatusObservation?.invalidate()
        itemStatusObservation = nil
        timeControlObservation?.invalidate()
        timeControlObservation = nil
        if let playbackEndObserver {
            NotificationCenter.default.removeObserver(playbackEndObserver)
        }
        playbackEndObserver = nil
    }

    private func handleItemStatus(_ item: AVPlayerItem) {
        switch item.status {
        case .readyToPlay:
            let seconds = item.duration.seconds
            duration = seconds.isFinite && seconds > 0 ? seconds : 0
            let presentationSize = item.presentationSize
            if selectedTrackIsVideo, presentationSize.width > 0, presentationSize.height > 0 {
                videoAspectRatio = Double(presentationSize.width / presentationSize.height)
            }
            playbackIssue = nil
            if !playbackRequested, !isPreparingOnlineVideo {
                isBuffering = false
                status = readyStatus
            }
        case .failed:
            let message = item.error?.localizedDescription ?? "The selected media could not be played."
            playbackRequested = false
            isPlaying = false
            isBuffering = false
            backingPlayer?.pause()
            playbackIssue = message
            status = selectedTrackIsVideo ? "MV failed. Select Backing to keep singing." : "Playback failed."
        case .unknown:
            isBuffering = selectedTrackIsVideo
        @unknown default:
            break
        }
    }

    private func handleTimeControlStatus(_ playbackStatus: AVPlayer.TimeControlStatus) {
        switch playbackStatus {
        case .playing:
            guard playbackRequested else { return }
            isPlaying = true
            isBuffering = false
            syncBackingToVideo()
            status = playingStatus
        case .waitingToPlayAtSpecifiedRate:
            guard playbackRequested else { return }
            isPlaying = true
            isBuffering = true
            status = selectedTrackIsVideo ? "Buffering MV..." : "Buffering track..."
        case .paused:
            if !playbackRequested {
                isPlaying = false
                backingPlayer?.pause()
            }
        @unknown default:
            break
        }
    }

    private func handlePlaybackEnded() {
        playbackRequested = false
        isPlaying = false
        isBuffering = false
        backingPlayer?.pause()
        if isRecordingSessionActive {
            status = "Performance finished. Saving recording..."
            return
        }
        if hasNextQueueItem {
            playNextInQueue(autoplay: true)
        } else {
            status = "Queue finished."
        }
    }

    private var readyStatus: String {
        if hasBackingTrack {
            return "MV ready with synced backing track."
        }
        return selectedTrackIsVideo ? "MV ready." : "Track ready."
    }

    private var playingStatus: String {
        if backingAudioActive, originalVocalVolume > 0.005 {
            return "Playing MV with original vocals and backing."
        }
        if backingAudioActive {
            return "Playing MV with synced backing track."
        }
        return selectedTrackIsVideo ? "Playing MV." : "Playing track."
    }

    private func loadLyrics(from url: URL?) {
        guard let url else {
            selectedLyricName = "No lyrics loaded"
            lyrics = []
            currentLyric = "No lyric file found for this track."
            nextLyric = ""
            previousCue = nil
            currentCue = nil
            nextCue = nil
            return
        }

        selectedLyricName = url.lastPathComponent
        lyrics = Self.parseLyrics(from: url)
        if lyrics.isEmpty {
            currentLyric = "Could not read lyrics from \(url.lastPathComponent)."
            nextLyric = ""
            previousCue = nil
            currentCue = nil
            nextCue = nil
        } else {
            currentLyric = lyrics[0].text
            nextLyric = lyrics.count > 1 ? lyrics[1].text : ""
            previousCue = nil
            currentCue = lyrics[0]
            nextCue = lyrics.count > 1 ? lyrics[1] : nil
        }
    }

    private func updateLyrics(at time: TimeInterval) {
        currentTime = time
        guard !lyrics.isEmpty else { return }

        let index = lyrics.lastIndex { cue in
            cue.start <= time
        } ?? 0
        previousCue = index > 0 ? lyrics[index - 1] : nil
        currentCue = lyrics[index]
        nextCue = index + 1 < lyrics.count ? lyrics[index + 1] : nil
        currentLyric = currentCue?.text ?? ""
        nextLyric = nextCue?.text ?? ""
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
                    isVideo: videoExtensions.contains(mediaURL.pathExtension.lowercased()),
                    kind: playbackKind(for: mediaURL)
                )
            }
    }

    private static func playlistItems(for package: KaraokePackage) -> [PlaylistItem] {
        let sharedLyricURL = firstAssetURL(in: package.assets, roles: [.jsonTiming, .lyrics, .subtitle])
            ?? package.playback.lyricURL
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
            kind: .backing,
            to: &items
        )

        let originalSourceURL = originalURL ?? (items.isEmpty ? videoURL : nil)
        appendPlaylistItem(
            url: originalSourceURL,
            title: "\(packageTitle) (Original)",
            lyricURL: sharedLyricURL,
            kind: .original,
            to: &items
        )

        // Local MV plays first, muted, over the backing stem when one exists.
        if let videoURL, !items.contains(where: { $0.mediaURL.path == videoURL.path }) {
            items.insert(PlaylistItem(
                id: videoURL.path,
                title: "\(packageTitle) (MV)",
                mediaURL: videoURL,
                lyricURL: sharedLyricURL,
                isVideo: true,
                kind: .mv,
                backingAudioURL: backingURL
            ), at: 0)
        }

        return items.isEmpty ? scanPackageFolder(package.folderURL) : items
    }

    private static func appendPlaylistItem(
        url: URL?,
        title: String,
        lyricURL: URL?,
        kind: PlaylistItem.PlaybackKind,
        to items: inout [PlaylistItem]
    ) {
        guard let url, !items.contains(where: { $0.mediaURL.path == url.path }) else {
            return
        }

        items.append(PlaylistItem(
            id: url.path,
            title: title,
            mediaURL: url,
            lyricURL: lyricURL,
            isVideo: videoExtensions.contains(url.pathExtension.lowercased()),
            kind: kind
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
            struct Word: Decodable {
                let text: String
                let start: TimeInterval
                let end: TimeInterval
            }

            let start: TimeInterval
            let end: TimeInterval
            let text: String
            let words: [Word]?
        }

        guard let data = try? Data(contentsOf: url),
              let payload = try? JSONDecoder().decode(Payload.self, from: data) else {
            return []
        }

        return payload.cues
            .map { cue in
                LyricCue(
                    start: cue.start,
                    end: cue.end,
                    text: cue.text.trimmingCharacters(in: .whitespacesAndNewlines),
                    words: (cue.words ?? []).map {
                        LyricWord(text: $0.text, start: $0.start, end: $0.end)
                    }
                )
            }
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

    private static func playbackKind(for url: URL) -> PlaylistItem.PlaybackKind {
        switch inferredMediaRole(url) {
        case .videoPreview:
            return .mv
        case .backingStem:
            return .backing
        default:
            return .original
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
        case "json":
            return 0
        case "lrc":
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
