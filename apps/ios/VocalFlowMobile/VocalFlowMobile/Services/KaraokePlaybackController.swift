import AVFoundation
import Foundation

@MainActor
final class KaraokePlaybackController: ObservableObject {
    @Published private(set) var package: MobileKaraokePackage?
    @Published private(set) var player: AVPlayer?
    @Published private(set) var lyrics: [LyricCue] = []
    @Published private(set) var previousCue: LyricCue?
    @Published private(set) var currentCue: LyricCue?
    @Published private(set) var nextCue: LyricCue?
    @Published private(set) var currentTime: TimeInterval = 0
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var isBuffering = false
    @Published private(set) var playbackIssue: String?
    @Published private(set) var preset: KaraokeAudioPreset = .backing
    @Published private(set) var masterVolume: Float = 0.86
    @Published private(set) var originalVolume: Float = 0
    @Published private(set) var backingVolume: Float = 1
    @Published private(set) var playbackCompletionToken = 0
    @Published private(set) var videoAspectRatio: Double = 16.0 / 9.0

    private var backingPlayer: AVPlayer?
    private var timeObserver: Any?
    private var itemStatusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var playbackEndObserver: NSObjectProtocol?
    private var playbackRequested = false
    private var currentCueIndex: Int?

    var hasVideo: Bool { package?.hasVideo == true }
    var hasBackingTrack: Bool { package?.hasBacking == true }
    var canPlayOriginal: Bool {
        guard let package else { return false }
        return package.videoURL != nil || package.primaryAudioURL != nil || package.vocalURL != nil
    }

    var progress: Double {
        guard duration > 0 else { return 0 }
        return min(1, max(0, currentTime / duration))
    }

    func load(_ package: MobileKaraokePackage) {
        tearDownPlayers()
        self.package = package
        lyrics = LyricParser.parse(package.lyricURL)
        updateLyrics(at: 0, force: true)
        playbackIssue = nil
        duration = 0
        videoAspectRatio = 16.0 / 9.0

        guard let primaryURL = package.primaryPlaybackURL else {
            playbackIssue = "歌曲包里没有可播放的媒体。"
            return
        }

        configurePlaybackSession()
        let item = AVPlayerItem(url: primaryURL)
        let player = AVPlayer(playerItem: item)
        player.automaticallyWaitsToMinimizeStalling = true
        self.player = player

        if let backingURL = package.backingURL,
           backingURL.standardizedFileURL != primaryURL.standardizedFileURL {
            backingPlayer = AVPlayer(url: backingURL)
            backingPlayer?.automaticallyWaitsToMinimizeStalling = true
        }

        observe(item: item, player: player)
        addTimeObserver(to: player)
        setPreset(package.hasBacking ? .backing : .original)
    }

    func togglePlayback() {
        guard let player else { return }
        if playbackRequested {
            playbackRequested = false
            player.pause()
            backingPlayer?.pause()
            isPlaying = false
            isBuffering = false
        } else {
            playbackRequested = true
            playbackIssue = nil
            isPlaying = true
            syncBackingPlayer()
            player.play()
            if backingVolume > 0.005 {
                backingPlayer?.play()
            }
        }
    }

    func play() {
        guard !playbackRequested, player != nil else { return }
        togglePlayback()
    }

    func stop() {
        player?.pause()
        player?.seek(to: .zero)
        backingPlayer?.pause()
        backingPlayer?.seek(to: .zero)
        playbackRequested = false
        isPlaying = false
        isBuffering = false
        currentTime = 0
        updateLyrics(at: 0, force: true)
    }

    func seek(to seconds: TimeInterval) {
        guard let player else { return }
        let upperBound = duration > 0 ? duration : max(0, seconds)
        let targetSeconds = min(max(0, seconds), upperBound)
        let target = CMTime(seconds: targetSeconds, preferredTimescale: 600)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.syncBackingPlayer()
            }
        }
        updateLyrics(at: targetSeconds, force: true)
    }

    func skip(by seconds: TimeInterval) {
        seek(to: currentTime + seconds)
    }

    func setPreset(_ preset: KaraokeAudioPreset) {
        guard preset != .original || canPlayOriginal else { return }
        guard preset != .backing || hasBackingTrack else { return }
        self.preset = preset

        switch preset {
        case .original:
            originalVolume = 1
            backingVolume = package?.primaryIsVocalStem == true ? 1 : 0
        case .backing:
            originalVolume = 0
            backingVolume = 1
        }
        applyAudioMix()
        resumeBackingIfNeeded()
    }

    func setMasterVolume(_ value: Float) {
        masterVolume = value.clamped(to: 0...1)
        applyAudioMix()
    }

    func setOriginalVolume(_ value: Float) {
        originalVolume = value.clamped(to: 0...1)
        refreshPresetFromMix()
        applyAudioMix()
    }

    func setBackingVolume(_ value: Float) {
        backingVolume = value.clamped(to: 0...1)
        refreshPresetFromMix()
        applyAudioMix()
        resumeBackingIfNeeded()
    }

    private func refreshPresetFromMix() {
        preset = originalVolume > 0.005 ? .original : .backing
    }

    private func applyAudioMix() {
        guard let package else { return }
        if package.primaryPlaybackURL?.standardizedFileURL == package.backingURL?.standardizedFileURL {
            player?.volume = masterVolume * backingVolume
        } else {
            player?.volume = masterVolume * originalVolume
        }
        backingPlayer?.volume = masterVolume * backingVolume
        if backingVolume <= 0.005 {
            backingPlayer?.pause()
        }
    }

    private func configurePlaybackSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            playbackIssue = error.localizedDescription
        }
    }

    private func addTimeObserver(to player: AVPlayer) {
        let interval = CMTime(seconds: 0.05, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let seconds = time.seconds
                guard seconds.isFinite else { return }
                self.updateLyrics(at: seconds)
                self.correctBackingDrift(primaryTime: seconds)
            }
        }
    }

    private func observe(item: AVPlayerItem, player: AVPlayer) {
        itemStatusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
            Task { @MainActor [weak self, weak item] in
                guard let self, let item else { return }
                switch item.status {
                case .readyToPlay:
                    let seconds = item.duration.seconds
                    self.duration = seconds.isFinite && seconds > 0 ? seconds : 0
                    let presentationSize = item.presentationSize
                    if self.hasVideo, presentationSize.width > 0, presentationSize.height > 0 {
                        self.videoAspectRatio = Double(presentationSize.width / presentationSize.height)
                    }
                    self.isBuffering = false
                case .failed:
                    self.playbackIssue = item.error?.localizedDescription ?? "媒体无法播放。"
                    self.playbackRequested = false
                    self.isPlaying = false
                    self.isBuffering = false
                case .unknown:
                    self.isBuffering = true
                @unknown default:
                    break
                }
            }
        }

        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self, weak player] _, _ in
            Task { @MainActor [weak self, weak player] in
                guard let self, let player else { return }
                switch player.timeControlStatus {
                case .playing:
                    self.isPlaying = self.playbackRequested
                    self.isBuffering = false
                    self.syncBackingPlayer()
                case .waitingToPlayAtSpecifiedRate:
                    self.isBuffering = self.playbackRequested
                case .paused:
                    if !self.playbackRequested {
                        self.isPlaying = false
                    }
                @unknown default:
                    break
                }
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

    private func handlePlaybackEnded() {
        backingPlayer?.pause()
        playbackRequested = false
        isPlaying = false
        isBuffering = false
        playbackCompletionToken += 1
    }

    private func updateLyrics(at time: TimeInterval, force: Bool = false) {
        currentTime = time
        guard !lyrics.isEmpty else {
            previousCue = nil
            currentCue = nil
            nextCue = nil
            return
        }

        let index = lyrics.lastIndex(where: { $0.start <= time }) ?? 0
        guard force || index != currentCueIndex else { return }
        currentCueIndex = index
        previousCue = index > 0 ? lyrics[index - 1] : nil
        currentCue = lyrics[index]
        nextCue = index + 1 < lyrics.count ? lyrics[index + 1] : nil
    }

    private func syncBackingPlayer() {
        guard let player, let backingPlayer, backingVolume > 0.005 else { return }
        backingPlayer.seek(to: player.currentTime(), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func resumeBackingIfNeeded() {
        guard isPlaying, backingVolume > 0.005 else { return }
        syncBackingPlayer()
        backingPlayer?.play()
    }

    private func correctBackingDrift(primaryTime: TimeInterval) {
        guard isPlaying, backingVolume > 0.005, let backingPlayer else { return }
        let secondaryTime = backingPlayer.currentTime().seconds
        guard secondaryTime.isFinite, abs(secondaryTime - primaryTime) > 0.25 else { return }
        backingPlayer.seek(
            to: CMTime(seconds: primaryTime, preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
    }

    private func tearDownPlayers() {
        player?.pause()
        backingPlayer?.pause()
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        itemStatusObservation?.invalidate()
        itemStatusObservation = nil
        timeControlObservation?.invalidate()
        timeControlObservation = nil
        if let playbackEndObserver {
            NotificationCenter.default.removeObserver(playbackEndObserver)
        }
        playbackEndObserver = nil
        player = nil
        backingPlayer = nil
        playbackRequested = false
        isPlaying = false
        isBuffering = false
        currentCueIndex = nil
    }
}

private extension Float {
    func clamped(to range: ClosedRange<Float>) -> Float {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
