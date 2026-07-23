import AppKit
import AVKit
import SwiftUI

private enum KaraokeAudioMode: String, CaseIterable, Identifiable {
    case original
    case backing

    var id: String { rawValue }

    var title: String {
        switch self {
        case .original: "Original"
        case .backing: "Backing"
        }
    }

    var symbolName: String {
        switch self {
        case .original: "music.note.list"
        case .backing: "music.mic"
        }
    }
}

private enum NativeLyricEffect: String, CaseIterable, Identifiable {
    case sweep
    case outline
    case neon
    case impact

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sweep: "Sweep"
        case .outline: "Outline"
        case .neon: "Neon"
        case .impact: "Impact"
        }
    }

    var detail: String {
        switch self {
        case .sweep: "Word-by-word color fill"
        case .outline: "Maximum contrast"
        case .neon: "Soft stage glow"
        case .impact: "Large performance type"
        }
    }
}

struct CompactKaraokeMixControl: View {
    @ObservedObject var karaokePlayer: KaraokePlayerService

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Vocal mix")
                        .font(.vocal(13, weight: .semibold))
                        .foregroundStyle(AppTheme.text)
                    Text("Switch presets or blend the original vocal with the backing stem.")
                        .font(.vocal(11, weight: .medium))
                        .foregroundStyle(AppTheme.mutedText)
                }

                Spacer()

                Picker("Audio mode", selection: audioModeBinding) {
                    ForEach(KaraokeAudioMode.allCases) { mode in
                        Label(mode.title, systemImage: mode.symbolName)
                            .tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 220)
            }

            HStack(spacing: 12) {
                CompactChannelSlider(
                    title: "Original vocal",
                    symbolName: "person.wave.2.fill",
                    value: Binding(
                        get: { Double(karaokePlayer.originalVocalVolume) },
                        set: { karaokePlayer.setOriginalVocalVolume(Float($0)) }
                    )
                )

                CompactChannelSlider(
                    title: "Backing",
                    symbolName: "music.mic",
                    value: Binding(
                        get: { Double(karaokePlayer.backingTrackVolume) },
                        set: { karaokePlayer.setBackingTrackVolume(Float($0)) }
                    )
                )
            }
        }
        .padding(14)
        .background(.thinMaterial)
        .background(AppTheme.glassTint)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private var audioModeBinding: Binding<KaraokeAudioMode> {
        Binding(
            get: { karaokePlayer.useBackingAudio ? .backing : .original },
            set: { karaokePlayer.setUseBackingAudio($0 == .backing) }
        )
    }
}

private struct CompactChannelSlider: View {
    let title: String
    let symbolName: String
    @Binding var value: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(title, systemImage: symbolName)
                    .font(.vocal(11, weight: .semibold))
                    .foregroundStyle(AppTheme.text)
                Spacer()
                Text("\(Int((value * 100).rounded()))%")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AppTheme.mutedText)
            }
            Slider(value: $value, in: 0...1)
                .tint(AppTheme.primary)
        }
        .padding(12)
        .background(Color.black.opacity(0.15))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct ImmersiveKaraokeRoom: View {
    @ObservedObject var karaokePlayer: KaraokePlayerService
    @ObservedObject var monitor: AudioMonitorService
    @ObservedObject var recording: KaraokeRecordingService
    let onExit: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var lyricEffect: NativeLyricEffect = .sweep
    @State private var showsMixer = false
    @State private var showsLyricStyle = false
    @State private var showsPlaylist = false
    @State private var showsSources = false

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                stageMedia
                stageScrim
                stageBrandWatermark

                VStack(spacing: 0) {
                    stageTopBar
                    Spacer(minLength: 40)
                    lyricStage(stageSize: proxy.size)
                    Spacer(minLength: 28)
                    controlDock
                }

                if case .countdown(let count) = recording.phase {
                    ImmersiveRecordingCountdown(count: count) {
                        recording.toggle(monitor: monitor, player: karaokePlayer)
                    }
                }
            }
            .overlay(alignment: .top) {
                if recording.phase.isRecording || recording.phase == .saving {
                    ImmersiveRecordingStatus(
                        title: recording.phase.isRecording
                            ? "REC \(formatTime(monitor.recordingDuration))"
                            : "SAVING PERFORMANCE"
                    )
                    .padding(.top, 28)
                }
            }
        }
        .background(Color.black)
        .ignoresSafeArea()
        .preferredColorScheme(.dark)
        .onExitCommand {
            if !recording.phase.isBusy {
                onExit()
            }
        }
    }

    @ViewBuilder
    private var stageMedia: some View {
        if karaokePlayer.selectedTrackIsVideo, let player = karaokePlayer.player {
            ImmersiveVideoPlayer(player: player)
                .ignoresSafeArea()
        } else {
            ZStack {
                LinearGradient(
                    colors: [AppTheme.backgroundTop, Color.black, AppTheme.backgroundBottom],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                RadialGradient(
                    colors: [AppTheme.primary.opacity(0.24), .clear],
                    center: .center,
                    startRadius: 20,
                    endRadius: 420
                )
                VStack(spacing: 24) {
                    VocalFlowBadge(size: 126)
                    Text("VOCALFLOW AUDIO STAGE")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .tracking(2)
                        .foregroundStyle(AppTheme.primary.opacity(0.78))
                    Text(karaokePlayer.selectedTrackName)
                        .font(.vocal(20, weight: .semibold))
                        .foregroundStyle(AppTheme.text.opacity(0.72))
                        .lineLimit(1)
                }
                .padding(.horizontal, 80)
            }
            .ignoresSafeArea()
        }
    }

    private var stageScrim: some View {
        ZStack {
            LinearGradient(
                colors: [Color.black.opacity(0.7), .clear, Color.black.opacity(0.7)],
                startPoint: .top,
                endPoint: .bottom
            )
            LinearGradient(
                colors: [Color.black.opacity(0.2), .clear, Color.black.opacity(0.2)],
                startPoint: .leading,
                endPoint: .trailing
            )
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }

    private var stageBrandWatermark: some View {
        VocalFlowMark(lineWidth: 0.7)
            .frame(width: 620, height: 334)
            .opacity(karaokePlayer.selectedTrackIsVideo ? 0.035 : 0)
            .allowsHitTesting(false)
    }

    private var stageTopBar: some View {
        HStack(alignment: .top, spacing: 16) {
            VocalFlowBadge(size: 46)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Circle()
                        .fill(karaokePlayer.isPlaying ? AppTheme.primary : AppTheme.mutedText)
                        .frame(width: 7, height: 7)
                    Text("NOW SINGING")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .tracking(1.4)
                }
                .foregroundStyle(Color.white.opacity(0.62))

                Text(karaokePlayer.selectedTrackName)
                    .font(.vocal(19, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .frame(maxWidth: 560, alignment: .leading)

                Text("\(audioModeTitle) · \(karaokePlayer.status)")
                    .font(.vocal(11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .lineLimit(1)

                if let next = karaokePlayer.nextQueueItem {
                    Text("UP NEXT · \(next.package.title)")
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .tracking(0.8)
                        .foregroundStyle(AppTheme.primary.opacity(0.8))
                        .lineLimit(1)
                }
            }

            Spacer()

            if karaokePlayer.isBuffering || karaokePlayer.isPreparingOnlineVideo {
                Label(
                    karaokePlayer.isPreparingOnlineVideo ? "Preparing MV" : "Buffering",
                    systemImage: "arrow.triangle.2.circlepath"
                )
                .font(.vocal(11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.74))
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(.ultraThinMaterial, in: Capsule())
            }

            Button(action: onExit) {
                Image(systemName: "arrow.down.right.and.arrow.up.left")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(ImmersiveCircleButtonStyle())
            .disabled(recording.phase.isBusy)
            .opacity(recording.phase.isBusy ? 0.42 : 1)
            .help("Exit full-screen stage")
        }
        .padding(.horizontal, 30)
        .padding(.top, 24)
    }

    private func lyricStage(stageSize: CGSize) -> some View {
        GeometryReader { proxy in
            let contentWidth = visibleVideoSize(in: stageSize).width
            let baseSize = min(82, max(32, min(contentWidth * 0.058, stageSize.height * 0.1)))
            let currentSize = lyricEffect == .impact ? baseSize * 1.12 : baseSize

            VStack(spacing: 12) {
                Text(karaokePlayer.previousCue?.text ?? "")
                    .font(.vocal(max(17, currentSize * 0.34), weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.34))
                    .lineLimit(1)
                    .frame(minHeight: 24)

                ImmersiveLyricLine(
                    cue: karaokePlayer.currentCue,
                    currentTime: karaokePlayer.currentTime,
                    effect: lyricEffect,
                    fontSize: currentSize,
                    reduceMotion: reduceMotion
                )
                .id(karaokePlayer.currentCue?.id)
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .bottom)))
                .animation(.easeOut(duration: reduceMotion ? 0.01 : 0.18), value: karaokePlayer.currentCue?.id)

                Text(karaokePlayer.nextCue?.text ?? "")
                    .font(.vocal(max(18, currentSize * 0.38), weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.58))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(minHeight: 28)
            }
            .frame(maxWidth: min(max(280, contentWidth * 0.9), 1280))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        }
        .frame(height: 260)
        .padding(.horizontal, 30)
    }

    private func visibleVideoSize(in availableSize: CGSize) -> CGSize {
        guard karaokePlayer.selectedTrackIsVideo else { return availableSize }
        let ratio = max(0.2, min(5, CGFloat(karaokePlayer.videoAspectRatio)))
        let availableRatio = availableSize.width / max(1, availableSize.height)
        if availableRatio > ratio {
            return CGSize(width: availableSize.height * ratio, height: availableSize.height)
        }
        return CGSize(width: availableSize.width, height: availableSize.width / ratio)
    }

    private var controlDock: some View {
        VStack(spacing: 13) {
            HStack(spacing: 10) {
                Text(formatTime(karaokePlayer.currentTime))
                Slider(
                    value: Binding(
                        get: { min(karaokePlayer.currentTime, timelineMaximum) },
                        set: karaokePlayer.seek
                    ),
                    in: 0...timelineMaximum
                )
                .tint(.white)
                .disabled(karaokePlayer.duration <= 0 || recording.phase.isBusy)
                Text(formatTime(karaokePlayer.duration))
            }
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .foregroundStyle(Color.white.opacity(0.55))

            HStack(spacing: 18) {
                audioModeControl

                Spacer(minLength: 12)

                HStack(spacing: 8) {
                    Button { karaokePlayer.skip(by: -10) } label: {
                        Image(systemName: "gobackward.10")
                            .frame(width: 42, height: 42)
                    }
                    .buttonStyle(ImmersiveTransportButtonStyle())
                    .disabled(recording.phase.isBusy)

                    Button { karaokePlayer.togglePlayback() } label: {
                        Image(systemName: karaokePlayer.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 20, weight: .bold))
                            .offset(x: karaokePlayer.isPlaying ? 0 : 1)
                            .frame(width: 58, height: 58)
                    }
                    .buttonStyle(ImmersivePrimaryButtonStyle())
                    .keyboardShortcut(.space, modifiers: [])
                    .disabled(recording.phase.isBusy)

                    Button { karaokePlayer.skip(by: 10) } label: {
                        Image(systemName: "goforward.10")
                            .frame(width: 42, height: 42)
                    }
                    .buttonStyle(ImmersiveTransportButtonStyle())
                    .disabled(recording.phase.isBusy)
                }

                Button {
                    recording.toggle(monitor: monitor, player: karaokePlayer)
                } label: {
                    Label(immersiveRecordingButtonTitle, systemImage: immersiveRecordingButtonSymbol)
                }
                .buttonStyle(ImmersiveRecordingButtonStyle(isRecording: recording.phase.isRecording))
                .disabled(
                    karaokePlayer.selectedTrackURL == nil ||
                    recording.phase == .preparing ||
                    recording.phase == .saving
                )

                Spacer(minLength: 12)

                HStack(spacing: 4) {
                    toolButton(symbol: "slider.horizontal.3", help: "Mixer") {
                        showsMixer.toggle()
                    }
                    .popover(isPresented: $showsMixer, arrowEdge: .bottom) {
                        NativeKaraokeMixer(karaokePlayer: karaokePlayer, monitor: monitor)
                    }
                    .disabled(recording.phase.isBusy)

                    toolButton(symbol: "textformat", help: "Lyrics style") {
                        showsLyricStyle.toggle()
                    }
                    .popover(isPresented: $showsLyricStyle, arrowEdge: .bottom) {
                        NativeLyricStylePanel(selection: $lyricEffect)
                    }

                    toolButton(symbol: "rectangle.stack", help: "Playback sources") {
                        showsSources.toggle()
                    }
                    .popover(isPresented: $showsSources, arrowEdge: .bottom) {
                        NativeStagePlaylist(karaokePlayer: karaokePlayer) {
                            showsSources = false
                        }
                    }
                    .disabled(recording.phase.isBusy)

                    toolButton(symbol: "music.note.list", help: "Up next") {
                        showsPlaylist.toggle()
                    }
                    .popover(isPresented: $showsPlaylist, arrowEdge: .bottom) {
                        NativeStageSongQueue(karaokePlayer: karaokePlayer) {
                            showsPlaylist = false
                        }
                    }
                    .disabled(recording.phase.isBusy)
                }
            }
        }
        .padding(.horizontal, 28)
        .padding(.top, 14)
        .padding(.bottom, 20)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.white.opacity(0.14))
                .frame(height: 1)
        }
    }

    private var audioModeControl: some View {
        HStack(spacing: 3) {
            ForEach(KaraokeAudioMode.allCases) { mode in
                let isSelected = (mode == .backing) == karaokePlayer.useBackingAudio
                Button {
                    karaokePlayer.setUseBackingAudio(mode == .backing)
                } label: {
                    Label(mode.title, systemImage: mode.symbolName)
                        .font(.vocal(11, weight: .semibold))
                        .foregroundStyle(isSelected ? Color.black.opacity(0.82) : Color.white.opacity(0.72))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(isSelected ? Color.white : Color.clear)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(recording.phase.isBusy || (mode == .backing && !karaokePlayer.hasBackingTrack))
                .opacity(
                    recording.phase.isBusy || (mode == .backing && !karaokePlayer.hasBackingTrack)
                        ? 0.36
                        : 1
                )
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.1), in: Capsule())
    }

    private func toolButton(symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .frame(width: 40, height: 40)
        }
        .buttonStyle(ImmersiveTransportButtonStyle())
        .help(help)
    }

    private var timelineMaximum: TimeInterval {
        max(1, karaokePlayer.duration)
    }

    private var audioModeTitle: String {
        if karaokePlayer.originalVocalVolume > 0.005, karaokePlayer.backingTrackVolume > 0.005 {
            return "Original + Backing"
        }
        return karaokePlayer.useBackingAudio ? "Backing" : "Original vocal"
    }

    private var immersiveRecordingButtonTitle: String {
        switch recording.phase {
        case .recording:
            "STOP \(formatTime(monitor.recordingDuration))"
        case .countdown:
            "CANCEL"
        case .preparing:
            "PREPARING"
        case .saving:
            "SAVING"
        case .complete:
            "RECORD AGAIN"
        case .failed, .idle:
            "RECORD"
        }
    }

    private var immersiveRecordingButtonSymbol: String {
        if recording.phase.isRecording {
            return "stop.fill"
        }
        if case .countdown = recording.phase {
            return "xmark"
        }
        return "record.circle"
    }

    private func formatTime(_ value: TimeInterval) -> String {
        guard value.isFinite else { return "00:00" }
        let totalSeconds = max(0, Int(value.rounded()))
        return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}

private struct NativeKaraokeMixer: View {
    @ObservedObject var karaokePlayer: KaraokePlayerService
    @ObservedObject var monitor: AudioMonitorService

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Mixer")
                    .font(.vocal(15, weight: .semibold))
                Text("Blend the song and your live microphone.")
                    .font(.vocal(11, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            mixerSlider(
                title: "Master",
                symbolName: "speaker.wave.2.fill",
                value: Binding(
                    get: { Double(karaokePlayer.playbackVolume) },
                    set: { karaokePlayer.setPlaybackVolume(Float($0)) }
                )
            )

            mixerSlider(
                title: "Original vocal",
                symbolName: "person.wave.2.fill",
                value: Binding(
                    get: { Double(karaokePlayer.originalVocalVolume) },
                    set: { karaokePlayer.setOriginalVocalVolume(Float($0)) }
                )
            )

            mixerSlider(
                title: "Backing",
                symbolName: "music.mic",
                value: Binding(
                    get: { Double(karaokePlayer.backingTrackVolume) },
                    set: { karaokePlayer.setBackingTrackVolume(Float($0)) }
                )
            )
            .disabled(!karaokePlayer.hasBackingTrack)
            .opacity(karaokePlayer.hasBackingTrack ? 1 : 0.4)

            Divider()

            HStack(spacing: 10) {
                Button {
                    monitor.toggleListening()
                } label: {
                    Image(systemName: monitor.state.isListening ? "mic.fill" : "mic.slash.fill")
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.borderedProminent)
                .tint(monitor.state.isListening ? AppTheme.primary : Color.gray)

                VStack(alignment: .leading, spacing: 3) {
                    Text("Microphone monitor")
                        .font(.vocal(12, weight: .semibold))
                    Text(monitor.state.isListening ? "Live — use headphones" : "Off")
                        .font(.vocal(10, weight: .medium))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Capsule()
                    .fill(AppTheme.primary.opacity(0.22))
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(AppTheme.primary)
                            .scaleEffect(x: CGFloat(max(0.02, monitor.inputLevel)), anchor: .leading)
                    }
                    .frame(width: 54, height: 5)
            }

            mixerSlider(
                title: "Mic monitor",
                symbolName: "headphones",
                value: Binding(
                    get: { Double(monitor.monitorVolume) },
                    set: { monitor.setMonitorVolume(Float($0)) }
                )
            )
        }
        .padding(18)
        .frame(width: 340)
    }

    private func mixerSlider(title: String, symbolName: String, value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(title, systemImage: symbolName)
                    .font(.vocal(11, weight: .semibold))
                Spacer()
                Text("\(Int((value.wrappedValue * 100).rounded()))%")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Slider(value: value, in: 0...1)
                .tint(AppTheme.primary)
        }
    }
}

private struct NativeLyricStylePanel: View {
    @Binding var selection: NativeLyricEffect

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Lyrics style")
                    .font(.vocal(15, weight: .semibold))
                Text("Changes apply live on stage.")
                    .font(.vocal(11, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            ForEach(NativeLyricEffect.allCases) { effect in
                Button {
                    selection = effect
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: selection == effect ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selection == effect ? AppTheme.primary : Color.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(effect.title)
                                .font(.vocal(12, weight: .semibold))
                            Text(effect.detail)
                                .font(.vocal(10, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(18)
        .frame(width: 300)
    }
}

private struct NativeStagePlaylist: View {
    @ObservedObject var karaokePlayer: KaraokePlayerService
    let onSelect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Playback sources")
                    .font(.vocal(15, weight: .semibold))
                Text("Switch MV, backing, or original media.")
                    .font(.vocal(11, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            ForEach(karaokePlayer.playlist) { item in
                Button {
                    karaokePlayer.selectItem(item)
                    onSelect()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: item.kind.symbolName)
                            .foregroundStyle(AppTheme.primary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.kind.title)
                                .font(.vocal(12, weight: .semibold))
                            Text(item.title)
                                .font(.vocal(10, weight: .medium))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        if item.id == karaokePlayer.selectedItemID {
                            Image(systemName: "checkmark")
                                .foregroundStyle(AppTheme.primary)
                        }
                    }
                    .padding(10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .background(
                    item.id == karaokePlayer.selectedItemID ? AppTheme.primary.opacity(0.12) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
            }
        }
        .padding(18)
        .frame(width: 360)
    }
}

private struct NativeStageSongQueue: View {
    @ObservedObject var karaokePlayer: KaraokePlayerService
    let onSelect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Up next")
                        .font(.vocal(15, weight: .semibold))
                    Text("The next song starts automatically.")
                        .font(.vocal(11, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(karaokePlayer.songQueue.count)")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AppTheme.primary)
            }

            if karaokePlayer.songQueue.isEmpty {
                Text("Add songs from the Room songbook.")
                    .font(.vocal(11, weight: .medium))
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 20)
                    .frame(maxWidth: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: 3) {
                        ForEach(Array(karaokePlayer.songQueue.enumerated()), id: \.element.id) { index, item in
                            HStack(spacing: 9) {
                                Text(String(format: "%02d", index + 1))
                                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(item.id == karaokePlayer.currentQueueItemID ? AppTheme.primary : Color.secondary)
                                    .frame(width: 22)

                                Button {
                                    karaokePlayer.playQueueItem(item)
                                    onSelect()
                                } label: {
                                    HStack {
                                        Image(systemName: item.id == karaokePlayer.currentQueueItemID ? "speaker.wave.2.fill" : "music.note")
                                            .foregroundStyle(AppTheme.primary)
                                        Text(item.package.title)
                                            .font(.vocal(11, weight: .semibold))
                                            .lineLimit(1)
                                        Spacer()
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)

                                Button {
                                    karaokePlayer.removeQueueItem(item)
                                } label: {
                                    Image(systemName: "xmark")
                                        .frame(width: 24, height: 24)
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 8)
                            .frame(height: 36)
                            .background(
                                item.id == karaokePlayer.currentQueueItemID ? AppTheme.primary.opacity(0.12) : Color.clear,
                                in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                            )
                        }
                    }
                }
                .frame(maxHeight: 290)
            }
        }
        .padding(18)
        .frame(width: 380)
    }
}

private struct ImmersiveLyricLine: View {
    let cue: KaraokePlayerService.LyricCue?
    let currentTime: TimeInterval
    let effect: NativeLyricEffect
    let fontSize: CGFloat
    let reduceMotion: Bool

    var body: some View {
        Group {
            if let cue, !cue.words.isEmpty {
                KaraokeWordFlowLayout(itemSpacing: effect == .impact ? 4 : 1, lineSpacing: 2) {
                    ForEach(Array(cue.words.enumerated()), id: \.offset) { _, word in
                        ImmersiveSweepWord(
                            text: word.text,
                            progress: progress(for: word),
                            effect: effect,
                            fontSize: fontSize,
                            reduceMotion: reduceMotion
                        )
                    }
                }
            } else {
                ImmersiveLineSweep(
                    text: cue?.text ?? "Play to start lyrics.",
                    progress: lineProgress,
                    effect: effect,
                    fontSize: fontSize,
                    reduceMotion: reduceMotion
                )
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(cue?.text ?? "Play to start lyrics")
    }

    private var lineProgress: Double {
        guard let cue else { return 0 }
        return normalizedProgress(currentTime, start: cue.start, end: cue.end)
    }

    private func progress(for word: KaraokePlayerService.LyricWord) -> Double {
        normalizedProgress(currentTime, start: word.start, end: word.end)
    }

    private func normalizedProgress(_ time: TimeInterval, start: TimeInterval, end: TimeInterval) -> Double {
        guard end > start else { return time >= end ? 1 : 0 }
        return min(1, max(0, (time - start) / (end - start)))
    }
}

private struct ImmersiveSweepWord: View {
    let text: String
    let progress: Double
    let effect: NativeLyricEffect
    let fontSize: CGFloat
    let reduceMotion: Bool

    var body: some View {
        ZStack(alignment: .leading) {
            styledText(color: baseColor)
            styledText(color: fillColor)
                .mask(alignment: .leading) {
                    GeometryReader { proxy in
                        Rectangle()
                            .frame(width: proxy.size.width * progress)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
        }
        .fixedSize()
        .padding(.horizontal, isCompactScript ? 1 : 5)
        .scaleEffect(effect == .impact && progress > 0 && progress < 1 ? 1.045 : 1)
        .animation(.easeOut(duration: reduceMotion ? 0.01 : 0.14), value: progress > 0 && progress < 1)
    }

    private var isCompactScript: Bool {
        !text.contains(" ") && text.unicodeScalars.allSatisfy { scalar in
            scalar.value > 0x2E7F
        }
    }

    private func styledText(color: Color) -> some View {
        Text(text)
            .font(.vocal(fontSize, weight: effect == .impact ? .black : .bold))
            .foregroundStyle(color)
            .shadow(color: .black.opacity(0.92), radius: 1, x: 1, y: 2)
            .shadow(color: glowColor, radius: effect == .neon ? 14 : 7, y: 3)
    }

    private var baseColor: Color {
        effect == .outline ? .white.opacity(0.76) : .white.opacity(0.3)
    }

    private var fillColor: Color {
        switch effect {
        case .sweep: AppTheme.primary
        case .outline, .impact: .white
        case .neon: Color(red: 0.72, green: 1, blue: 0.78)
        }
    }

    private var glowColor: Color {
        effect == .neon ? fillColor.opacity(0.72) : .black.opacity(0.72)
    }
}

private struct ImmersiveLineSweep: View {
    let text: String
    let progress: Double
    let effect: NativeLyricEffect
    let fontSize: CGFloat
    let reduceMotion: Bool

    var body: some View {
        ZStack {
            styledText(color: effect == .outline ? .white.opacity(0.76) : .white.opacity(0.3))
            styledText(color: fillColor)
                .mask(alignment: .leading) {
                    GeometryReader { proxy in
                        Rectangle()
                            .frame(width: proxy.size.width * progress)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
        }
        .animation(.linear(duration: reduceMotion ? 0.01 : 0.08), value: progress)
    }

    private func styledText(color: Color) -> some View {
        Text(text)
            .font(.vocal(fontSize, weight: effect == .impact ? .black : .bold))
            .foregroundStyle(color)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .shadow(color: .black.opacity(0.9), radius: 1, x: 1, y: 2)
            .shadow(color: effect == .neon ? fillColor.opacity(0.7) : .black.opacity(0.7), radius: 10, y: 3)
    }

    private var fillColor: Color {
        switch effect {
        case .sweep: AppTheme.primary
        case .outline, .impact: .white
        case .neon: Color(red: 0.72, green: 1, blue: 0.78)
        }
    }
}

private struct KaraokeWordFlowLayout: Layout {
    let itemSpacing: CGFloat
    let lineSpacing: CGFloat

    struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let maxWidth = proposal.width ?? 1_200
        let rows = makeRows(maxWidth: maxWidth, subviews: subviews)
        let height = rows.reduce(0) { $0 + $1.height } + CGFloat(max(0, rows.count - 1)) * lineSpacing
        return CGSize(width: maxWidth, height: height)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let rows = makeRows(maxWidth: bounds.width, subviews: subviews)
        var y = bounds.minY

        for row in rows {
            var x = bounds.minX + max(0, (bounds.width - row.width) / 2)
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(size)
                )
                x += size.width + itemSpacing
            }
            y += row.height + lineSpacing
        }
    }

    private func makeRows(maxWidth: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()

        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let proposedWidth = row.indices.isEmpty ? size.width : row.width + itemSpacing + size.width
            if proposedWidth > maxWidth, !row.indices.isEmpty {
                rows.append(row)
                row = Row(indices: [index], width: size.width, height: size.height)
            } else {
                row.indices.append(index)
                row.width = proposedWidth
                row.height = max(row.height, size.height)
            }
        }

        if !row.indices.isEmpty {
            rows.append(row)
        }
        return rows
    }
}

private struct ImmersiveVideoPlayer: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = .none
        view.videoGravity = .resizeAspect
        view.player = player
        return view
    }

    func updateNSView(_ nsView: AVPlayerView, context: Context) {
        if nsView.player !== player {
            nsView.player = player
        }
        nsView.controlsStyle = .none
        nsView.videoGravity = .resizeAspect
    }

    static func dismantleNSView(_ nsView: AVPlayerView, coordinator: ()) {
        nsView.player = nil
    }
}

private struct ImmersiveCircleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .background(.ultraThinMaterial, in: Circle())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

private struct ImmersiveTransportButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.white.opacity(configuration.isPressed ? 0.64 : 0.86))
            .contentShape(Circle())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

private struct ImmersivePrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.black.opacity(0.86))
            .background(Color.white, in: Circle())
            .shadow(color: .black.opacity(0.22), radius: 16, y: 8)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

private struct ImmersiveRecordingButtonStyle: ButtonStyle {
    let isRecording: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .monospacedDigit()
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(
                isRecording
                    ? Color.red.opacity(configuration.isPressed ? 0.62 : 0.44)
                    : Color.white.opacity(configuration.isPressed ? 0.18 : 0.1),
                in: Capsule()
            )
            .overlay(
                Capsule()
                    .stroke(isRecording ? Color.red.opacity(0.72) : Color.white.opacity(0.14), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

private struct ImmersiveRecordingCountdown: View {
    let count: Int
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("GET READY")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .tracking(1.6)
                .foregroundStyle(Color.white.opacity(0.64))
            Text("\(count)")
                .font(.system(size: 112, weight: .medium, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
            Button("Cancel", action: onCancel)
                .buttonStyle(.plain)
                .font(.vocal(12, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.74))
        }
        .padding(.horizontal, 50)
        .padding(.vertical, 32)
        .background(.ultraThinMaterial)
        .background(Color.black.opacity(0.48))
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(Color.white.opacity(0.16), lineWidth: 1)
        )
    }
}

private struct ImmersiveRecordingStatus: View {
    let title: String

    var body: some View {
        HStack(spacing: 9) {
            Circle()
                .fill(Color.red)
                .frame(width: 9, height: 9)
            Text(title)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .monospacedDigit()
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .frame(height: 36)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.16), lineWidth: 1))
    }
}
