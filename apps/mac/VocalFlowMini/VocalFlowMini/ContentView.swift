import AppKit
import AVKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var monitor: AudioMonitorService
    @EnvironmentObject private var karaokePlayer: KaraokePlayerService
    @EnvironmentObject private var packageCreator: PackageCreationService
    @EnvironmentObject private var packageLibrary: PackageLibraryService

    var body: some View {
        ZStack {
            background

            ScrollView {
                VStack(spacing: 24) {
                    header
                    createPackageCard
                    libraryCard
                    karaokeCard
                    monitorCard
                    controls
                }
                .padding(28)
            }
        }
        .frame(minWidth: 620, idealWidth: 760, maxWidth: 920, minHeight: 860)
        .onDisappear {
            if monitor.state.isListening {
                monitor.stopListening()
            }
            karaokePlayer.stopPlayback()
        }
    }

    private var background: some View {
        ZStack {
            LinearGradient(
                colors: [AppTheme.backgroundTop, AppTheme.backgroundBottom],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Circle()
                .fill(AppTheme.primary.opacity(0.14))
                .frame(width: 300, height: 300)
                .blur(radius: 90)
                .offset(x: -180, y: -230)

            Circle()
                .fill(Color.white.opacity(0.08))
                .frame(width: 220, height: 220)
                .blur(radius: 80)
                .offset(x: 190, y: 220)
        }
        .ignoresSafeArea()
    }

    private var header: some View {
        VStack(spacing: 8) {
            Text("VocalFlow Mini")
                .font(.vocal(30, weight: .semibold))
                .foregroundStyle(AppTheme.text)

            Text("One-click monitor mode for singing practice.")
                .font(.vocal(14, weight: .medium))
                .foregroundStyle(AppTheme.mutedText)
        }
        .frame(maxWidth: .infinity)
    }

    private var createPackageCard: some View {
        GlassPanel {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Image(systemName: "wand.and.stars")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(AppTheme.primary)

                    VStack(alignment: .leading, spacing: 3) {
                        Text("Create Package")
                            .font(.vocal(17, weight: .semibold))
                            .foregroundStyle(AppTheme.text)
                        Text("One-shot: link/media → vocal + backing stems → synced lyrics.")
                            .font(.vocal(12, weight: .medium))
                            .foregroundStyle(AppTheme.mutedText)
                    }

                    Spacer()

                    StatusPill(
                        state: packageCreator.isRunning ? .requestingPermission : (packageCreator.errorMessage == nil ? .ready : .failed(packageCreator.errorMessage ?? "Failed"))
                    )
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Source URL")
                        .font(.vocal(12, weight: .semibold))
                        .foregroundStyle(AppTheme.mutedText)
                    TextField("Paste YouTube, Bilibili, or any yt-dlp media URL", text: $packageCreator.sourceText)
                        .textFieldStyle(.plain)
                        .font(.vocal(13, weight: .medium))
                        .foregroundStyle(AppTheme.text)
                        .padding(12)
                        .background(.thinMaterial)
                        .background(AppTheme.glassTint)
                        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                                .stroke(AppTheme.border, lineWidth: 1)
                        )
                }

                HStack(spacing: 10) {
                    Button("Choose Local File") {
                        packageCreator.chooseLocalFile()
                    }
                    .buttonStyle(SecondaryButtonStyle())

                    Button("Clear Source") {
                        packageCreator.clearSource()
                    }
                    .buttonStyle(SecondaryButtonStyle())

                    Spacer()

                    Text(packageCreator.sourceSummary)
                        .font(.vocal(12, weight: .medium))
                        .foregroundStyle(AppTheme.mutedText)
                        .lineLimit(1)
                }

                HStack(spacing: 12) {
                    SummaryRow(label: "Output", value: packageCreator.outputRoot.path)
                    Button("Change") {
                        packageCreator.chooseOutputRoot()
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .padding(14)
                .background(.thinMaterial)
                .background(AppTheme.glassTint)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                        .stroke(AppTheme.border, lineWidth: 1)
                )

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ToggleRow(
                        title: "Create instrumental",
                        detail: "Generate a no-vocal backing track and share lyrics with the original.",
                        isOn: packageCreator.options.separateVocals
                    ) {
                        packageCreator.options.separateVocals = $0
                    }

                    ToggleRow(
                        title: "Save MV preview",
                        detail: "Keep a local video preview when the source supports it.",
                        isOn: packageCreator.options.saveVideoPreview
                    ) {
                        packageCreator.options.saveVideoPreview = $0
                    }

                    ToggleRow(
                        title: "Save audio",
                        detail: "Keep extracted 16 kHz audio for review and debugging.",
                        isOn: packageCreator.options.saveAudio
                    ) {
                        packageCreator.options.saveAudio = $0
                    }

                    ToggleRow(
                        title: "Local fallback",
                        detail: "Use local Whisper if platform captions are missing.",
                        isOn: packageCreator.options.localFallback
                    ) {
                        packageCreator.options.localFallback = $0
                    }
                }

                HStack(spacing: 12) {
                    Picker("Subtitle source", selection: Binding(
                        get: { packageCreator.options.subtitleSource },
                        set: { packageCreator.options.subtitleSource = $0 }
                    )) {
                        ForEach(SubtitleSource.allCases) { source in
                            Text(source.label).tag(source)
                        }
                    }
                    .pickerStyle(.menu)

                    Picker("Model", selection: $packageCreator.options.model) {
                        Text("small").tag("small")
                        Text("medium").tag("medium")
                        Text("large-v3-turbo").tag("large-v3-turbo")
                        Text("large-v3").tag("large-v3")
                    }
                    .pickerStyle(.menu)

                    TextField("Language, e.g. zh", text: $packageCreator.options.language)
                        .textFieldStyle(.plain)
                        .font(.vocal(13, weight: .medium))
                        .foregroundStyle(AppTheme.text)
                        .padding(10)
                        .frame(width: 150)
                        .background(.thinMaterial)
                        .background(AppTheme.glassTint)
                        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                                .stroke(AppTheme.border, lineWidth: 1)
                        )

                    Spacer()

                    if packageCreator.isRunning {
                        Button {
                            packageCreator.cancelCurrentJob()
                        } label: {
                            Label("Cancel", systemImage: "xmark")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }

                    Button {
                        packageCreator.start { package in
                            packageLibrary.addPackage(package)
                            karaokePlayer.loadPackage(package)
                        }
                    } label: {
                        Label(packageCreator.isRunning ? "Running" : "Start", systemImage: packageCreator.isRunning ? "hourglass" : "play.fill")
                    }
                    .buttonStyle(PrimaryCapsuleButtonStyle(isActive: packageCreator.isRunning))
                    .disabled(packageCreator.isRunning)
                }

                if let currentJob = packageCreator.currentJob {
                    JobSummaryView(
                        outputDirectory: currentJob.outputDirectory,
                        startedAt: packageCreator.startedAt,
                        finishedAt: packageCreator.finishedAt,
                        isRunning: packageCreator.isRunning
                    ) {
                        packageCreator.revealCurrentOutput()
                    }
                }

                PipelineProgressView(
                    progress: packageCreator.progress,
                    stageHistory: packageCreator.stageHistory,
                    errorMessage: packageCreator.errorMessage
                )

                if !packageCreator.logs.isEmpty {
                    LogTailView(lines: packageCreator.logs)
                }
            }
            .padding(18)
        }
    }

    private var libraryCard: some View {
        GlassPanel {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Image(systemName: "music.note.list")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(AppTheme.primary)

                    VStack(alignment: .leading, spacing: 3) {
                        Text("Library")
                            .font(.vocal(17, weight: .semibold))
                            .foregroundStyle(AppTheme.text)
                        Text(packageLibrary.lastError ?? packageLibrary.status)
                            .font(.vocal(12, weight: .medium))
                            .foregroundStyle(packageLibrary.lastError == nil ? AppTheme.mutedText : AppTheme.danger)
                            .lineLimit(1)
                    }

                    Spacer()

                    Button {
                        packageLibrary.refresh()
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(SecondaryButtonStyle())

                    Button {
                        packageLibrary.choosePackageFolder()
                    } label: {
                        Label("Import Folder", systemImage: "folder.badge.plus")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }

                if packageLibrary.packages.isEmpty {
                    Text("Generated packages and imported LALAL.AI-style output folders will stay here, even after restart.")
                        .font(.vocal(12, weight: .medium))
                        .foregroundStyle(AppTheme.mutedText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(.thinMaterial)
                        .background(AppTheme.glassTint)
                        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                                .stroke(AppTheme.border, lineWidth: 1)
                        )
                } else {
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(packageLibrary.packages) { package in
                                PackageLibraryRow(
                                    package: package,
                                    availability: packageLibrary.availability(for: package),
                                    isSelected: karaokePlayer.selectedTrackURL?.path == package.playback.backingURL?.path
                                        || karaokePlayer.selectedTrackURL?.path == package.playback.originalURL?.path
                                        || karaokePlayer.selectedTrackURL?.path == package.playback.mediaURL?.path
                                        || karaokePlayer.selectedTrackURL?.path == package.playback.videoURL?.path
                                ) {
                                    karaokePlayer.loadPackage(package)
                                } onReveal: {
                                    packageLibrary.revealPackage(package)
                                } onRemove: {
                                    packageLibrary.removePackage(package)
                                }
                            }
                        }
                    }
                    .frame(maxHeight: 230)
                }
            }
            .padding(18)
        }
    }

    private var monitorCard: some View {
        GlassPanel {
            VStack(spacing: 22) {
                StatusPill(state: monitor.state)

                Button {
                    monitor.toggleListening()
                } label: {
                    VStack(spacing: 10) {
                        Image(systemName: monitor.state.isListening ? "waveform.circle.fill" : "mic.circle.fill")
                            .font(.system(size: 54, weight: .semibold))
                        Text(monitor.state.actionTitle)
                            .font(.vocal(23, weight: .semibold))
                    }
                    .foregroundStyle(monitor.state.isListening ? Color.black.opacity(0.82) : AppTheme.text)
                    .frame(width: 190, height: 190)
                    .background(actionButtonFill)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(AppTheme.border, lineWidth: 1))
                    .shadow(color: AppTheme.primary.opacity(monitor.state.isListening ? 0.28 : 0.1), radius: 22, y: 10)
                }
                .buttonStyle(.plain)
                .disabled(monitor.state.isBusy)
                .keyboardShortcut(.space, modifiers: [])
                .accessibilityLabel(monitor.state.isListening ? "Stop listening" : "Start listening")

                VStack(spacing: 8) {
                    Text(monitor.state.statusTitle)
                        .font(.vocal(18, weight: .semibold))
                        .foregroundStyle(AppTheme.text)

                    Text(monitor.state.statusDetail)
                        .font(.vocal(13, weight: .medium))
                        .foregroundStyle(AppTheme.mutedText)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .frame(minHeight: 36)
                }

                LevelMeterView(level: monitor.inputLevel)
                    .frame(height: 12)

                if monitor.state == .permissionDenied {
                    Button("Open Microphone Settings") {
                        openMicrophoneSettings()
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
            .padding(26)
        }
    }

    private var karaokeCard: some View {
        GlassPanel {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Image(systemName: "music.mic.circle.fill")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(AppTheme.primary)

                    VStack(alignment: .leading, spacing: 3) {
                        Text("Karaoke")
                            .font(.vocal(17, weight: .semibold))
                            .foregroundStyle(AppTheme.text)
                        Text(karaokePlayer.status)
                            .font(.vocal(12, weight: .medium))
                            .foregroundStyle(AppTheme.mutedText)
                            .lineLimit(1)
                    }

                    Spacer()
                }

                VideoStageView(
                    player: karaokePlayer.player,
                    isVideo: karaokePlayer.selectedTrackIsVideo,
                    title: karaokePlayer.selectedTrackName,
                    currentLyric: karaokePlayer.currentLyric,
                    nextLyric: karaokePlayer.nextLyric
                )

                HStack(spacing: 10) {
                    Button("Choose Folder") {
                        karaokePlayer.choosePackageFolder()
                    }
                    .buttonStyle(SecondaryButtonStyle())

                    Button("Choose File") {
                        karaokePlayer.chooseAudioFile()
                    }
                    .buttonStyle(SecondaryButtonStyle())

                    Spacer()

                    Button {
                        karaokePlayer.togglePlayback()
                    } label: {
                        Label(karaokePlayer.isPlaying ? "Pause" : "Play", systemImage: karaokePlayer.isPlaying ? "pause.fill" : "play.fill")
                    }
                    .buttonStyle(PrimaryCapsuleButtonStyle(isActive: karaokePlayer.isPlaying))

                    Button {
                        karaokePlayer.stopPlayback()
                    } label: {
                        Label("Stop", systemImage: "stop.fill")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(karaokePlayer.selectedTrackURL == nil)
                }

                HStack(spacing: 12) {
                    ControlSlider(
                        title: "Video volume",
                        value: String(format: "%.0f%%", karaokePlayer.playbackVolume * 100),
                        range: 0...1,
                        binding: Binding(
                            get: { Double(karaokePlayer.playbackVolume) },
                            set: { karaokePlayer.setPlaybackVolume(Float($0)) }
                        )
                    )

                    ControlSlider(
                        title: "Speed",
                        value: String(format: "%.2fx", karaokePlayer.playbackRate),
                        range: 0.5...1.5,
                        binding: Binding(
                            get: { Double(karaokePlayer.playbackRate) },
                            set: { karaokePlayer.setPlaybackRate(Float($0)) }
                        )
                    )
                }

                if karaokePlayer.hasBackingTrack {
                    ToggleRow(
                        title: "Sing mode: MV + backing track",
                        detail: "Play the MV muted with the instrumental stem. Turn off to hear the original vocals.",
                        isOn: karaokePlayer.useBackingAudio
                    ) {
                        karaokePlayer.setUseBackingAudio($0)
                    }
                }

                HStack(alignment: .top, spacing: 12) {
                    PackageSummaryView(
                        folderName: karaokePlayer.packageFolderName,
                        trackName: karaokePlayer.selectedTrackName,
                        lyricName: karaokePlayer.selectedLyricName,
                        currentTime: karaokePlayer.currentTime
                    )

                    PlaylistView(
                        items: karaokePlayer.playlist,
                        selectedItemID: karaokePlayer.selectedItemID
                    ) { item in
                        karaokePlayer.selectItem(item)
                    }
                }
            }
            .padding(18)
        }
    }

    private var controls: some View {
        VStack(spacing: 16) {
            DevicePanel(devices: monitor.inputDevices, selectedDeviceID: $monitor.selectedInputDeviceID) {
                monitor.refreshInputDevices()
            }

            ControlSlider(
                title: "Input gain",
                value: String(format: "%.0f%%", monitor.inputGain * 100),
                range: 0...2,
                binding: Binding(
                    get: { Double(monitor.inputGain) },
                    set: { monitor.setInputGain(Float($0)) }
                )
            )

            ControlSlider(
                title: "Monitor volume",
                value: String(format: "%.0f%%", monitor.monitorVolume * 100),
                range: 0...1,
                binding: Binding(
                    get: { Double(monitor.monitorVolume) },
                    set: { monitor.setMonitorVolume(Float($0)) }
                )
            )

            ToggleRow(
                title: "Voice cleanup",
                detail: "A light high-pass and low-pass chain, similar to the Electron mic panel's noise reduction idea.",
                isOn: monitor.voiceCleanupEnabled
            ) {
                monitor.setVoiceCleanupEnabled($0)
            }

            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "headphones")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(AppTheme.warning)
                Text("Wear headphones before monitoring. Speaker playback can feed back into the microphone.")
                    .font(.vocal(12, weight: .medium))
                    .foregroundStyle(AppTheme.mutedText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.thinMaterial)
            .background(AppTheme.glassTint)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
        }
    }

    private var actionButtonFill: some ShapeStyle {
        if monitor.state.isListening {
            return AnyShapeStyle(AppTheme.primary)
        }

        return AnyShapeStyle(.regularMaterial)
    }

    private func openMicrophoneSettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") else {
            return
        }
        NSWorkspace.shared.open(url)
    }
}

private struct StatusPill: View {
    let state: AudioMonitorService.MonitorState

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(indicatorColor)
                .frame(width: 8, height: 8)
            Text(state.statusTitle.uppercased())
                .font(.vocal(11, weight: .semibold))
                .tracking(1.1)
        }
        .foregroundStyle(AppTheme.text)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.thinMaterial)
        .background(AppTheme.glassTintRaised)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(AppTheme.border, lineWidth: 1))
    }

    private var indicatorColor: Color {
        switch state {
        case .listening:
            AppTheme.primary
        case .permissionDenied, .failed:
            AppTheme.danger
        case .requestingPermission:
            AppTheme.warning
        case .ready:
            AppTheme.mutedText
        }
    }
}

private struct LevelMeterView: View {
    let level: Float

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.14))

                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [AppTheme.primaryDim, AppTheme.primary],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: geometry.size.width * CGFloat(level))
                    .animation(.easeOut(duration: 0.08), value: level)
            }
        }
        .accessibilityLabel("Microphone level")
        .accessibilityValue("\(Int(level * 100)) percent")
    }
}

private struct ControlSlider: View {
    let title: String
    let value: String
    let range: ClosedRange<Double>
    @Binding var binding: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.vocal(13, weight: .semibold))
                    .foregroundStyle(AppTheme.text)
                Spacer()
                Text(value)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AppTheme.mutedText)
            }

            Slider(value: $binding, in: range)
                .tint(AppTheme.primary)
        }
        .padding(16)
        .background(.thinMaterial)
        .background(AppTheme.glassTint)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }
}

private struct JobSummaryView: View {
    let outputDirectory: URL
    let startedAt: Date?
    let finishedAt: Date?
    let isRunning: Bool
    let onReveal: () -> Void

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            HStack(spacing: 12) {
                SummaryRow(label: "Current Output", value: outputDirectory.lastPathComponent)
                SummaryRow(label: isRunning ? "Elapsed" : "Duration", value: elapsedText(now: context.date))

                Spacer()

                Button {
                    onReveal()
                } label: {
                    Label("Show Folder", systemImage: "folder")
                }
                .buttonStyle(SecondaryButtonStyle())
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
    }

    private func elapsedText(now: Date) -> String {
        guard let startedAt else {
            return "--"
        }

        let end = finishedAt ?? now
        let seconds = max(0, end.timeIntervalSince(startedAt))
        let totalSeconds = Int(seconds.rounded())

        if totalSeconds >= 3600 {
            return String(format: "%dh %02dm", totalSeconds / 3600, (totalSeconds % 3600) / 60)
        }

        return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}

private struct PackageLibraryRow: View {
    let package: KaraokePackage
    let availability: PackageLibraryService.PackageAvailability
    let isSelected: Bool
    let onLoad: () -> Void
    let onReveal: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button {
                onLoad()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: package.playback.videoURL == nil ? "music.note" : "film.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.primary)
                        .frame(width: 20)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(package.title)
                            .font(.vocal(13, weight: .semibold))
                            .foregroundStyle(AppTheme.text)
                            .lineLimit(1)

                        Text("\(package.folderURL.lastPathComponent) · \(assetSummary) · \(createdAtText)")
                            .font(.vocal(11, weight: .medium))
                            .foregroundStyle(AppTheme.mutedText)
                            .lineLimit(1)
                    }

                    Spacer()

                    Text(availability.label)
                        .font(.vocal(10, weight: .semibold))
                        .tracking(0.7)
                        .foregroundStyle(availabilityColor)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(availabilityColor.opacity(0.13))
                        .clipShape(Capsule())
                }
                .padding(.horizontal, 11)
                .padding(.vertical, 9)
                .background(isSelected ? AppTheme.primary.opacity(0.16) : Color.white.opacity(0.045))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)

            Button {
                onReveal()
            } label: {
                Image(systemName: "folder")
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(SecondaryIconButtonStyle())
            .accessibilityLabel("Show package folder")

            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark")
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(SecondaryIconButtonStyle())
            .accessibilityLabel("Remove package from library")
        }
    }

    private var availabilityColor: Color {
        switch availability {
        case .ready:
            return AppTheme.primary
        case .missingFolder, .missingMedia:
            return AppTheme.warning
        }
    }

    private var assetSummary: String {
        var parts: [String] = []
        if package.playback.backingURL != nil {
            parts.append("instrumental")
        }
        if package.playback.originalURL != nil {
            parts.append("original")
        }
        if package.playback.lyricURL != nil {
            parts.append("lyrics")
        }
        if package.playback.videoURL != nil {
            parts.append("MV")
        }
        return parts.isEmpty ? "\(package.assets.count) files" : parts.joined(separator: ", ")
    }

    private var createdAtText: String {
        DateFormatter.localizedString(from: package.createdAt, dateStyle: .medium, timeStyle: .short)
    }
}

private struct PipelineProgressView: View {
    let progress: PipelineProgress
    let stageHistory: [PipelineStage: PipelineProgress]
    let errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(progress.stage.label)
                    .font(.vocal(13, weight: .semibold))
                    .foregroundStyle(progress.isFailed ? AppTheme.danger : AppTheme.text)
                Spacer()
                Text(progressText)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AppTheme.mutedText)
            }

            ProgressView(value: normalizedProgress)
                .tint(progress.isFailed ? AppTheme.danger : AppTheme.primary)

            Text(errorMessage ?? progress.message)
                .font(.vocal(12, weight: .medium))
                .foregroundStyle(errorMessage == nil ? AppTheme.mutedText : AppTheme.danger)
                .lineLimit(2)

            PipelineStageTimelineView(progress: progress, stageHistory: stageHistory)
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

    private var normalizedProgress: Double {
        if progress.progress < 0 {
            return 0
        }
        return min(max(progress.progress, 0), 1)
    }

    private var progressText: String {
        if let etaSec = progress.etaSec, etaSec.isFinite, etaSec > 1 {
            return "\(Int(normalizedProgress * 100))% · \(formatDuration(etaSec)) left"
        }

        return progress.progress < 0 ? "..." : "\(Int(normalizedProgress * 100))%"
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        let totalSeconds = max(0, Int(seconds.rounded()))
        if totalSeconds >= 3600 {
            return String(format: "%dh %02dm", totalSeconds / 3600, (totalSeconds % 3600) / 60)
        }
        return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}

private struct PipelineStageTimelineView: View {
    let progress: PipelineProgress
    let stageHistory: [PipelineStage: PipelineProgress]

    private let stages: [PipelineStage] = [
        .prepare,
        .download,
        .preview,
        .captions,
        .separate,
        .convert,
        .transcribe,
        .write,
        .manifest
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(stages) { stage in
                    HStack(spacing: 5) {
                        Image(systemName: iconName(for: stage))
                            .font(.system(size: 11, weight: .semibold))
                        Text(stage.label)
                            .font(.vocal(11, weight: .semibold))
                            .lineLimit(1)
                    }
                    .foregroundStyle(color(for: stage))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                    .background(color(for: stage).opacity(0.12))
                    .clipShape(Capsule())
                }
            }
        }
    }

    private func iconName(for stage: PipelineStage) -> String {
        if stageHistory[stage]?.isFailed == true {
            return "xmark.circle.fill"
        }
        if progress.stage == stage && !progress.isDone {
            return "clock.fill"
        }
        if progress.stage == .complete || stageHistory[stage]?.isDone == true {
            return "checkmark.circle.fill"
        }
        return "circle"
    }

    private func color(for stage: PipelineStage) -> Color {
        if stageHistory[stage]?.isFailed == true {
            return AppTheme.danger
        }
        if progress.stage == stage && !progress.isDone {
            return AppTheme.primary
        }
        if progress.stage == .complete || stageHistory[stage]?.isDone == true {
            return AppTheme.text
        }
        return AppTheme.mutedText
    }
}

private struct LogTailView: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Logs")
                .font(.vocal(12, weight: .semibold))
                .foregroundStyle(AppTheme.text)

            ScrollView {
                Text(lines.suffix(18).joined(separator: "\n"))
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(AppTheme.mutedText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .frame(maxHeight: 130)
        }
        .padding(14)
        .background(Color.black.opacity(0.22))
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }
}

private struct VideoStageView: View {
    let player: AVPlayer?
    let isVideo: Bool
    let title: String
    let currentLyric: String
    let nextLyric: String

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                if isVideo, let player {
                    AppKitVideoPlayer(player: player)
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "music.note.tv")
                            .font(.system(size: 46, weight: .semibold))
                            .foregroundStyle(AppTheme.primary)
                        Text(title)
                            .font(.vocal(17, weight: .semibold))
                            .foregroundStyle(AppTheme.text)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(
                        LinearGradient(
                            colors: [AppTheme.glassTintRaised, Color.black.opacity(0.32)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                }
            }

            VStack(spacing: 8) {
                Text(currentLyric)
                    .font(.vocal(26, weight: .bold))
                    .foregroundStyle(AppTheme.primary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .shadow(color: .black.opacity(0.7), radius: 8, y: 3)

                if !nextLyric.isEmpty {
                    Text(nextLyric)
                        .font(.vocal(15, weight: .semibold))
                        .foregroundStyle(AppTheme.text.opacity(0.72))
                        .multilineTextAlignment(.center)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 18)
            .frame(maxWidth: .infinity)
            .background(
                LinearGradient(
                    colors: [.clear, Color.black.opacity(0.72)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .frame(height: 300)
        .background(Color.black.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.cardRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }
}

private struct AppKitVideoPlayer: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = .floating
        view.videoGravity = .resizeAspect
        view.player = player
        return view
    }

    func updateNSView(_ nsView: AVPlayerView, context: Context) {
        if nsView.player !== player {
            nsView.player = player
        }
    }

    static func dismantleNSView(_ nsView: AVPlayerView, coordinator: ()) {
        nsView.player = nil
    }
}

private struct PackageSummaryView: View {
    let folderName: String
    let trackName: String
    let lyricName: String
    let currentTime: TimeInterval

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SummaryRow(label: "Folder", value: folderName)
            SummaryRow(label: "Track", value: trackName)
            SummaryRow(label: "Lyrics", value: lyricName)
            SummaryRow(label: "Time", value: formatTime(currentTime))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial)
        .background(AppTheme.glassTint)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private func formatTime(_ value: TimeInterval) -> String {
        guard value.isFinite else { return "00:00" }

        let totalSeconds = max(0, Int(value.rounded()))
        return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}

private struct SummaryRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.vocal(10, weight: .semibold))
                .tracking(0.9)
                .foregroundStyle(AppTheme.mutedText)
            Text(value)
                .font(.vocal(13, weight: .semibold))
                .foregroundStyle(AppTheme.text)
                .lineLimit(1)
        }
    }
}

private struct PlaylistView: View {
    let items: [KaraokePlayerService.PlaylistItem]
    let selectedItemID: String?
    let onSelect: (KaraokePlayerService.PlaylistItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Playlist")
                .font(.vocal(13, weight: .semibold))
                .foregroundStyle(AppTheme.text)

            if items.isEmpty {
                Text("Choose a folder to scan songs and MVs.")
                    .font(.vocal(12, weight: .medium))
                    .foregroundStyle(AppTheme.mutedText)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(items) { item in
                            Button {
                                onSelect(item)
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: item.isVideo ? "film.fill" : "music.note")
                                        .foregroundStyle(AppTheme.primary)
                                    Text(item.title)
                                        .lineLimit(1)
                                    Spacer()
                                    if item.lyricURL != nil {
                                        Image(systemName: "text.quote")
                                            .foregroundStyle(AppTheme.mutedText)
                                    }
                                }
                                .font(.vocal(12, weight: .semibold))
                                .foregroundStyle(AppTheme.text)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .background(selectedItemID == item.id ? AppTheme.primary.opacity(0.18) : Color.white.opacity(0.04))
                                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: 132)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(.thinMaterial)
        .background(AppTheme.glassTint)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }
}

private struct DevicePanel: View {
    let devices: [AudioMonitorService.AudioInputDevice]
    @Binding var selectedDeviceID: String
    let onRefresh: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "mic.badge.plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(AppTheme.primary)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Input device")
                        .font(.vocal(13, weight: .semibold))
                        .foregroundStyle(AppTheme.text)
                    Text(deviceSummary)
                        .font(.vocal(12, weight: .medium))
                        .foregroundStyle(AppTheme.mutedText)
                        .lineLimit(1)
                }

                Spacer()

                Button("Refresh", action: onRefresh)
                    .buttonStyle(SecondaryButtonStyle())
            }

            Picker("Microphone", selection: $selectedDeviceID) {
                Text("System Default").tag("")
                ForEach(devices) { device in
                    Text(device.name).tag(device.id)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(.thinMaterial)
        .background(AppTheme.glassTint)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private var deviceSummary: String {
        guard let selectedDevice = devices.first(where: { $0.id == selectedDeviceID }) else {
            return devices.isEmpty ? "No microphone detected" : "Using system default"
        }

        return selectedDevice.name
    }
}

private struct ToggleRow: View {
    let title: String
    let detail: String
    let isOn: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.vocal(13, weight: .semibold))
                    .foregroundStyle(AppTheme.text)
                Text(detail)
                    .font(.vocal(12, weight: .medium))
                    .foregroundStyle(AppTheme.mutedText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            Toggle("", isOn: Binding(get: { isOn }, set: onChange))
                .toggleStyle(.switch)
                .tint(AppTheme.primary)
                .labelsHidden()
        }
        .padding(16)
        .background(.thinMaterial)
        .background(AppTheme.glassTint)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }
}

private struct PrimaryCapsuleButtonStyle: ButtonStyle {
    let isActive: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.vocal(13, weight: .semibold))
            .foregroundStyle(Color.black.opacity(0.82))
            .padding(.horizontal, 15)
            .padding(.vertical, 10)
            .background(isActive || configuration.isPressed ? AppTheme.primary.opacity(0.82) : AppTheme.primary)
            .clipShape(Capsule())
            .shadow(color: AppTheme.primary.opacity(0.22), radius: 12, y: 6)
    }
}

private struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.vocal(13, weight: .semibold))
            .foregroundStyle(AppTheme.text)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(configuration.isPressed ? AppTheme.glassTint : AppTheme.glassTintRaised)
            .background(.thinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
    }
}

private struct SecondaryIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(AppTheme.text)
            .background(configuration.isPressed ? AppTheme.glassTint : AppTheme.glassTintRaised)
            .background(.thinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
    }
}
