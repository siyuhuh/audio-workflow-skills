import SwiftUI

struct KaraokeStageView: View {
    let package: MobileKaraokePackage
    @ObservedObject var queue: KaraokeQueueStore
    let onExit: () -> Void

    @StateObject private var playback = KaraokePlaybackController()
    @StateObject private var microphone = MicrophoneMonitor()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var controlsVisible = true
    @State private var controlRevealToken = 0
    @State private var showsMixer = false
    @State private var showsQueue = false

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                stageMedia
                stageScrim
                VocalFlowMark()
                    .frame(width: min(430, proxy.size.width * 0.64))
                    .opacity(playback.hasVideo ? 0.038 : 0)
                    .allowsHitTesting(false)

                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture(perform: toggleControls)

                lyricStage(in: proxy)

                VStack(spacing: 0) {
                    topBar(safeTop: proxy.safeAreaInsets.top)
                        .opacity(controlsVisible ? 1 : 0)
                        .allowsHitTesting(controlsVisible)
                    Spacer()
                    controlDock(
                        compact: proxy.size.height > proxy.size.width,
                        safeBottom: proxy.safeAreaInsets.bottom
                    )
                        .opacity(controlsVisible ? 1 : 0)
                        .offset(y: controlsVisible || reduceMotion ? 0 : 18)
                        .allowsHitTesting(controlsVisible)
                }

                if playback.isBuffering {
                    ProgressView()
                        .controlSize(.large)
                        .tint(.white)
                        .padding(18)
                        .background(.ultraThinMaterial, in: Circle())
                }

                if let issue = playback.playbackIssue {
                    issueBanner(issue)
                }
            }
            .background(Color.black)
        }
        .ignoresSafeArea()
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .preferredColorScheme(.dark)
        .onAppear {
            queue.playNow(package)
            playback.load(package)
            revealControls()
        }
        .onDisappear {
            playback.stop()
            microphone.stop()
        }
        .onChange(of: playback.isPlaying) { _, _ in
            revealControls()
        }
        .onChange(of: playback.playbackCompletionToken) { _, _ in
            playNext()
        }
        .task(id: controlRevealToken) {
            guard playback.isPlaying else { return }
            try? await Task.sleep(for: .seconds(3.2))
            guard !Task.isCancelled, playback.isPlaying, !showsMixer, !showsQueue else { return }
            withAnimation(.easeOut(duration: reduceMotion ? 0.01 : 0.2)) {
                controlsVisible = false
            }
        }
        .sheet(isPresented: $showsMixer, onDismiss: revealControls) {
            MixerSheet(playback: playback, microphone: microphone)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
        }
        .sheet(isPresented: $showsQueue, onDismiss: revealControls) {
            QueueSheet(
                queue: queue
            ) { selected in
                queue.select(selected)
                playback.load(selected)
                playback.play()
                showsQueue = false
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
        }
    }

    @ViewBuilder
    private var stageMedia: some View {
        if playback.hasVideo, let player = playback.player {
            VideoSurface(player: player)
                .ignoresSafeArea()
        } else {
            ZStack {
                LinearGradient(
                    colors: [AppTheme.surface, Color.black, AppTheme.background],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                RadialGradient(
                    colors: [AppTheme.primary.opacity(0.22), .clear],
                    center: .center,
                    startRadius: 20,
                    endRadius: 430
                )

                VStack(spacing: 14) {
                    VocalFlowBadge(size: 92)
                    Text("VOCALFLOW")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .tracking(1.8)
                        .foregroundStyle(AppTheme.primary.opacity(0.76))
                    Text("音频舞台")
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .tracking(1.4)
                        .foregroundStyle(Color.white.opacity(0.55))
                    Text("这个歌曲包没有保存本地 MV")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.35))
                }
            }
            .ignoresSafeArea()
        }
    }

    private var stageScrim: some View {
        ZStack {
            LinearGradient(
                colors: [Color.black.opacity(0.74), .clear, Color.black.opacity(0.86)],
                startPoint: .top,
                endPoint: .bottom
            )
            LinearGradient(
                colors: [Color.black.opacity(0.18), .clear, Color.black.opacity(0.18)],
                startPoint: .leading,
                endPoint: .trailing
            )
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }

    private func topBar(safeTop: CGFloat) -> some View {
        HStack(spacing: 12) {
            Button {
                playback.stop()
                onExit()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 42, height: 42)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(PressScaleButtonStyle())
            .accessibilityLabel("退出 K 歌房")

            VocalFlowBadge(size: 36)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(playback.isPlaying ? AppTheme.primary : Color.white.opacity(0.35))
                        .frame(width: 6, height: 6)
                    Text(playback.isPlaying ? "NOW SINGING" : "READY")
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .tracking(1.2)
                }
                .foregroundStyle(Color.white.opacity(0.58))

                Text(playback.package?.title ?? package.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }

            Spacer()

            HStack(spacing: 7) {
                if microphone.isMonitoring {
                    Label("LIVE", systemImage: "mic.fill")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(AppTheme.primary)
                        .padding(.horizontal, 10)
                        .frame(height: 34)
                        .background(.ultraThinMaterial, in: Capsule())
                }

                Button {
                    showsQueue = true
                } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "music.note.list")
                            .font(.system(size: 14, weight: .semibold))
                            .frame(width: 42, height: 42)
                            .background(.ultraThinMaterial, in: Circle())
                        if !queue.items.isEmpty {
                            Text("\(queue.items.count)")
                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                                .foregroundStyle(Color.black.opacity(0.84))
                                .frame(minWidth: 17, minHeight: 17)
                                .background(AppTheme.primary, in: Circle())
                                .offset(x: 3, y: -3)
                        }
                    }
                }
                .buttonStyle(PressScaleButtonStyle())
                .accessibilityLabel("歌单")
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, max(13, safeTop + 5))
        .animation(.easeOut(duration: reduceMotion ? 0.01 : 0.2), value: controlsVisible)
    }

    private func lyricStage(in proxy: GeometryProxy) -> some View {
        let size = proxy.size
        let isPortrait = size.height > size.width
        let contentRect = visibleMediaRect(in: size)
        let fontSize = min(
            58,
            max(21, min(contentRect.width * (isPortrait ? 0.082 : 0.06), contentRect.height * 0.12))
        )
        let lyricWidth = max(190, min(contentRect.width * 0.9, 980))
        let lyricHeight = max(110, min(contentRect.height * 0.78, 270))

        return ViewThatFits(in: .vertical) {
            lyricLines(fontSize: fontSize, includePrevious: true)
            lyricLines(fontSize: fontSize, includePrevious: false)
            ActiveLyricLine(
                cue: playback.currentCue,
                currentTime: playback.currentTime,
                fontSize: fontSize,
                reduceMotion: reduceMotion
            )
        }
        .frame(width: lyricWidth, height: lyricHeight)
        .background(
            RadialGradient(
                colors: [Color.black.opacity(0.34), .clear],
                center: .center,
                startRadius: 8,
                endRadius: lyricWidth * 0.52
            )
        )
        .position(x: contentRect.midX, y: contentRect.midY)
        .allowsHitTesting(false)
    }

    private func lyricLines(fontSize: CGFloat, includePrevious: Bool) -> some View {
        VStack(spacing: 9) {
            if includePrevious {
                Text(playback.previousCue?.text ?? "")
                    .font(.system(size: max(11, fontSize * 0.42), weight: .semibold, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.28))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(minHeight: 18)
            }

            ActiveLyricLine(
                cue: playback.currentCue,
                currentTime: playback.currentTime,
                fontSize: fontSize,
                reduceMotion: reduceMotion
            )
            .id(playback.currentCue?.id)
            .transition(.opacity)
            .animation(.easeOut(duration: reduceMotion ? 0.01 : 0.18), value: playback.currentCue?.id)
            .lineLimit(2)
            .minimumScaleFactor(0.55)

            Text(playback.nextCue?.text ?? "")
                .font(.system(size: max(12, fontSize * 0.48), weight: .semibold, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.52))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.65)
                .frame(minHeight: 20)
        }
    }

    private func visibleMediaRect(in availableSize: CGSize) -> CGRect {
        guard playback.hasVideo else {
            return CGRect(origin: .zero, size: availableSize)
        }

        let ratio = max(0.2, min(5, CGFloat(playback.videoAspectRatio)))
        let availableRatio = availableSize.width / max(1, availableSize.height)
        let contentSize: CGSize
        if availableRatio > ratio {
            contentSize = CGSize(width: availableSize.height * ratio, height: availableSize.height)
        } else {
            contentSize = CGSize(width: availableSize.width, height: availableSize.width / ratio)
        }
        return CGRect(
            x: (availableSize.width - contentSize.width) / 2,
            y: (availableSize.height - contentSize.height) / 2,
            width: contentSize.width,
            height: contentSize.height
        )
    }

    private func controlDock(compact: Bool, safeBottom: CGFloat) -> some View {
        VStack(spacing: compact ? 13 : 10) {
            timeline

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 18) {
                    audioPresetControl
                    Spacer(minLength: 4)
                    transportControls
                    Spacer(minLength: 4)
                    mixerButton
                }

                VStack(spacing: 8) {
                    HStack {
                        audioPresetControl
                        Spacer()
                        mixerButton
                    }
                    HStack {
                        Spacer()
                        transportControls
                        Spacer()
                    }
                }
            }
        }
        .padding(.horizontal, compact ? 16 : 24)
        .padding(.top, 13)
        .padding(.bottom, max(compact ? 28 : 18, safeBottom + 10))
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Rectangle().fill(Color.white.opacity(0.12)).frame(height: 0.5)
        }
        .animation(.easeOut(duration: reduceMotion ? 0.01 : 0.2), value: controlsVisible)
    }

    private var mixerButton: some View {
        Button {
            showsMixer = true
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 42, height: 42)
                .background(Color.white.opacity(0.09), in: Circle())
        }
        .buttonStyle(PressScaleButtonStyle())
        .accessibilityLabel("调音台")
    }

    private var timeline: some View {
        HStack(spacing: 10) {
            Text(formatTime(playback.currentTime))
            Slider(
                value: Binding(
                    get: { min(playback.currentTime, max(1, playback.duration)) },
                    set: playback.seek
                ),
                in: 0...max(1, playback.duration)
            )
            .tint(.white)
            .disabled(playback.duration <= 0)
            Text(formatTime(playback.duration))
        }
        .font(.system(size: 9, weight: .semibold, design: .monospaced))
        .foregroundStyle(Color.white.opacity(0.5))
    }

    private var audioPresetControl: some View {
        HStack(spacing: 2) {
            ForEach(KaraokeAudioPreset.allCases) { preset in
                let selected = playback.preset == preset
                Button {
                    playback.setPreset(preset)
                    revealControls()
                } label: {
                    Label(preset.title, systemImage: preset.symbolName)
                        .labelStyle(.iconOnly)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(selected ? Color.black.opacity(0.82) : Color.white.opacity(0.68))
                        .frame(width: 40, height: 34)
                        .background(selected ? Color.white : Color.clear, in: Capsule())
                }
                .buttonStyle(PressScaleButtonStyle())
                .disabled((preset == .backing && !playback.hasBackingTrack) || (preset == .original && !playback.canPlayOriginal))
                .opacity((preset == .backing && !playback.hasBackingTrack) || (preset == .original && !playback.canPlayOriginal) ? 0.3 : 1)
                .accessibilityLabel(preset.title)
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.09), in: Capsule())
    }

    private var transportControls: some View {
        HStack(spacing: 9) {
            Button {
                playback.skip(by: -10)
                revealControls()
            } label: {
                Image(systemName: "gobackward.10")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(PressScaleButtonStyle())

            Button {
                playback.togglePlayback()
            } label: {
                Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 19, weight: .bold))
                    .offset(x: playback.isPlaying ? 0 : 1)
                    .frame(width: 54, height: 54)
                    .foregroundStyle(Color.black.opacity(0.86))
                    .background(Color.white, in: Circle())
            }
            .buttonStyle(PressScaleButtonStyle())
            .accessibilityLabel(playback.isPlaying ? "暂停" : "播放")

            Button {
                playback.skip(by: 10)
                revealControls()
            } label: {
                Image(systemName: "goforward.10")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(PressScaleButtonStyle())

            Button {
                playNext()
            } label: {
                Image(systemName: "forward.end.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 36, height: 40)
            }
            .buttonStyle(PressScaleButtonStyle())
            .disabled(queue.nextPackage == nil)
            .opacity(queue.nextPackage == nil ? 0.3 : 1)
            .accessibilityLabel("下一首")
        }
        .foregroundStyle(.white)
    }

    private func issueBanner(_ issue: String) -> some View {
        VStack {
            Spacer()
            Label(issue, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(Color.red.opacity(0.72), in: Capsule())
                .padding(.bottom, 128)
        }
        .padding(.horizontal, 18)
    }

    private func toggleControls() {
        controlRevealToken += 1
        withAnimation(.easeOut(duration: reduceMotion ? 0.01 : 0.2)) {
            controlsVisible.toggle()
        }
    }

    private func revealControls() {
        controlRevealToken += 1
        withAnimation(.easeOut(duration: reduceMotion ? 0.01 : 0.2)) {
            controlsVisible = true
        }
    }

    private func playNext() {
        guard let next = queue.advance() else { return }
        playback.load(next)
        playback.play()
        revealControls()
    }

    private func formatTime(_ value: TimeInterval) -> String {
        guard value.isFinite else { return "00:00" }
        let total = max(0, Int(value.rounded()))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

private struct ActiveLyricLine: View {
    let cue: LyricCue?
    let currentTime: TimeInterval
    let fontSize: CGFloat
    let reduceMotion: Bool

    var body: some View {
        Group {
            if let cue, !cue.words.isEmpty {
                WordFlowLayout(itemSpacing: 0, lineSpacing: 3) {
                    ForEach(Array(cue.words.enumerated()), id: \.offset) { _, word in
                        SweepWord(
                            text: word.text,
                            progress: normalizedProgress(start: word.start, end: word.end),
                            fontSize: fontSize,
                            reduceMotion: reduceMotion
                        )
                    }
                }
            } else {
                SweepLine(
                    text: cue?.text ?? "播放歌曲后歌词会出现在这里",
                    progress: cue.map { normalizedProgress(start: $0.start, end: $0.end) } ?? 0,
                    fontSize: fontSize
                )
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(cue?.text ?? "歌词尚未开始")
    }

    private func normalizedProgress(start: TimeInterval, end: TimeInterval) -> Double {
        guard end > start else { return currentTime >= end ? 1 : 0 }
        return min(1, max(0, (currentTime - start) / (end - start)))
    }
}

private struct SweepWord: View {
    let text: String
    let progress: Double
    let fontSize: CGFloat
    let reduceMotion: Bool

    var body: some View {
        ZStack(alignment: .leading) {
            lyricText(color: .white.opacity(0.28))
            lyricText(color: AppTheme.primary)
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
        .scaleEffect(!reduceMotion && progress > 0 && progress < 1 ? 1.025 : 1)
    }

    private var isCompactScript: Bool {
        !text.contains(" ") && text.unicodeScalars.allSatisfy { $0.value > 0x2E7F }
    }

    private func lyricText(color: Color) -> some View {
        Text(text)
            .font(.system(size: fontSize, weight: .bold, design: .rounded))
            .foregroundStyle(color)
            .shadow(color: .black.opacity(0.9), radius: 2, x: 1, y: 2)
            .shadow(color: AppTheme.primary.opacity(progress > 0 && progress < 1 ? 0.48 : 0), radius: 10)
    }
}

private struct SweepLine: View {
    let text: String
    let progress: Double
    let fontSize: CGFloat

    var body: some View {
        ZStack(alignment: .leading) {
            lyricText(color: .white.opacity(0.28))
            lyricText(color: AppTheme.primary)
                .mask(alignment: .leading) {
                    GeometryReader { proxy in
                        Rectangle()
                            .frame(width: proxy.size.width * progress)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
        }
        .multilineTextAlignment(.center)
    }

    private func lyricText(color: Color) -> some View {
        Text(text)
            .font(.system(size: fontSize, weight: .bold, design: .rounded))
            .foregroundStyle(color)
            .shadow(color: .black.opacity(0.9), radius: 2, x: 1, y: 2)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct WordFlowLayout: Layout {
    let itemSpacing: CGFloat
    let lineSpacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let result = layout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let result = layout(proposal: ProposedViewSize(width: bounds.width, height: proposal.height), subviews: subviews)
        for row in result.rows {
            let rowWidth = row.reduce(CGFloat.zero) { $0 + $1.size.width } + CGFloat(max(0, row.count - 1)) * itemSpacing
            var x = bounds.midX - rowWidth / 2
            for item in row {
                item.subview.place(
                    at: CGPoint(x: x, y: bounds.minY + item.y),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(item.size)
                )
                x += item.size.width + itemSpacing
            }
        }
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, rows: [[Item]]) {
        let maxWidth = proposal.width ?? .greatestFiniteMagnitude
        var rows: [[Item]] = [[]]
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var y: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            let proposedWidth = rows[rows.count - 1].isEmpty ? size.width : rowWidth + itemSpacing + size.width
            if proposedWidth > maxWidth, !rows[rows.count - 1].isEmpty {
                y += rowHeight + lineSpacing
                rows.append([])
                rowWidth = 0
                rowHeight = 0
            }

            let item = Item(subview: subview, size: size, y: y)
            rows[rows.count - 1].append(item)
            rowWidth = rows[rows.count - 1].count == 1 ? size.width : rowWidth + itemSpacing + size.width
            rowHeight = max(rowHeight, size.height)
        }

        let widest = rows.map { row in
            row.reduce(CGFloat.zero) { $0 + $1.size.width } + CGFloat(max(0, row.count - 1)) * itemSpacing
        }.max() ?? 0
        return (CGSize(width: min(maxWidth, widest), height: y + rowHeight), rows)
    }

    private struct Item {
        let subview: LayoutSubview
        let size: CGSize
        let y: CGFloat
    }
}
