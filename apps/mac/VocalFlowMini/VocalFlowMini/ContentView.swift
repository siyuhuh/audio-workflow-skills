import AppKit
import AVKit
import SwiftUI

private enum NativeSection: String, CaseIterable, Identifiable {
    case studio
    case remote
    case library
    case room
    case monitor

    var id: String { rawValue }

    var title: String {
        switch self {
        case .studio: "Studio"
        case .remote: "Remote"
        case .library: "Library"
        case .room: "Room"
        case .monitor: "Mic Monitor"
        }
    }

    var subtitle: String {
        switch self {
        case .studio: "Create a karaoke package"
        case .remote: "iPhone · Mac mini bridge"
        case .library: "Browse processed media"
        case .room: "Sing with synced lyrics"
        case .monitor: "Low-latency native audio"
        }
    }

    var symbolName: String {
        switch self {
        case .studio: "plus.rectangle.on.folder"
        case .remote: "iphone.and.arrow.forward"
        case .library: "music.note.list"
        case .room: "music.mic"
        case .monitor: "waveform"
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var monitor: AudioMonitorService
    @EnvironmentObject private var karaokePlayer: KaraokePlayerService
    @EnvironmentObject private var recording: KaraokeRecordingService
    @EnvironmentObject private var packageCreator: PackageCreationService
    @EnvironmentObject private var packageLibrary: PackageLibraryService
    @StateObject private var sourcePreview = SourcePreviewService()
    @StateObject private var remoteAgent = RemoteAgentStatusService()
    @State private var selectedSection: NativeSection? = .room
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var runtimeStatus = AudioSubtitlesRuntime.inspect()
    @State private var isImmersiveRoom = false

    private var currentSection: NativeSection {
        selectedSection ?? .studio
    }

    private var packageCreationStatus: AudioMonitorService.MonitorState {
        if packageCreator.isRunning {
            return .requestingPermission
        }
        if let errorMessage = packageCreator.errorMessage {
            return .failed(errorMessage)
        }
        return .ready
    }

    var body: some View {
        Group {
            if isImmersiveRoom {
                ImmersiveKaraokeRoom(
                    karaokePlayer: karaokePlayer,
                    monitor: monitor,
                    recording: recording,
                    onExit: exitImmersiveRoom
                )
            } else {
                appShell
            }
        }
        .frame(minWidth: 920, minHeight: 680)
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didExitFullScreenNotification)) { _ in
            isImmersiveRoom = false
        }
        .onAppear {
            refreshRuntimeStatus()
            remoteAgent.refresh()
        }
        .onDisappear {
            if recording.phase.isBusy {
                recording.cancel(monitor: monitor, player: karaokePlayer, removeOutput: true)
            }
            if monitor.state.isListening {
                monitor.stopListening()
            }
            karaokePlayer.stopPlayback()
            sourcePreview.clear()
        }
        .onChange(of: packageCreator.sourceText) { _, value in
            sourcePreview.sourceChanged(value, browser: packageCreator.options.normalizedBrowser)
        }
        .onChange(of: packageCreator.options.browser) { _, browser in
            sourcePreview.sourceChanged(packageCreator.sourceText, browser: browser)
        }
    }

    private var appShell: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            sidebar
                .navigationSplitViewColumnWidth(min: 210, ideal: 236, max: 280)
        } detail: {
            ZStack {
                background

                if currentSection == .room {
                    KaraokeRoomWorkspace(
                        karaokePlayer: karaokePlayer,
                        packageLibrary: packageLibrary,
                        monitor: monitor,
                        recording: recording,
                        onEnterStage: enterImmersiveRoom
                    )
                    .ignoresSafeArea(.container, edges: [.top, .bottom])
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 22) {
                            pageHeader
                            pageContent
                        }
                        .padding(28)
                        .frame(maxWidth: 980, alignment: .topLeading)
                        .frame(maxWidth: .infinity, alignment: .top)
                    }
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    private func enterImmersiveRoom() {
        isImmersiveRoom = true
        DispatchQueue.main.async {
            guard let window = NSApp.keyWindow, !window.styleMask.contains(.fullScreen) else { return }
            window.toggleFullScreen(nil)
        }
    }

    private func exitImmersiveRoom() {
        isImmersiveRoom = false
        guard let window = NSApp.keyWindow, window.styleMask.contains(.fullScreen) else { return }
        window.toggleFullScreen(nil)
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 11) {
                VocalFlowBadge(size: 40)

                VStack(alignment: .leading, spacing: 2) {
                    Text("VocalFlow")
                        .font(.vocal(17, weight: .semibold))
                        .foregroundStyle(AppTheme.text)
                    Text("NATIVE KARAOKE STUDIO")
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .tracking(1.3)
                        .foregroundStyle(AppTheme.mutedText)
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 12)

            List(
                NativeSection.allCases,
                selection: Binding(
                    get: { selectedSection },
                    set: { nextSection in
                        guard !recording.phase.isBusy else { return }
                        selectedSection = nextSection
                    }
                )
            ) { section in
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(section.title)
                            .font(.vocal(13, weight: .semibold))
                        Text(section.subtitle)
                            .font(.vocal(10, weight: .medium))
                            .foregroundStyle(AppTheme.mutedText)
                    }
                    .padding(.vertical, 3)
                } icon: {
                    Image(systemName: section.symbolName)
                        .foregroundStyle(selectedSection == section ? AppTheme.text : AppTheme.primary)
                }
                .tag(section)
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
            .disabled(recording.phase.isBusy)

            HStack(spacing: 8) {
                Circle()
                    .fill(runtimeStatus.isReady ? AppTheme.primary : AppTheme.warning)
                    .frame(width: 8, height: 8)
                Text(runtimeStatus.isReady ? "Processing ready" : "Setup required")
                    .font(.vocal(11, weight: .medium))
                    .foregroundStyle(AppTheme.mutedText)
                Spacer()
            }
            .padding(16)
        }
        .background(AppTheme.backgroundBottom)
    }

    private var background: some View {
        ZStack {
            LinearGradient(
                colors: [AppTheme.backgroundTop, AppTheme.backgroundBottom],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack {
                Spacer()
                HStack {
                    Spacer()
                    VocalFlowMark(lineWidth: 0.7)
                        .frame(width: 560, height: 300)
                        .foregroundStyle(AppTheme.primary.opacity(0.026))
                        .opacity(0.055)
                        .offset(x: 82, y: 70)
                }
            }
            .allowsHitTesting(false)
        }
        .ignoresSafeArea()
    }

    private var pageHeader: some View {
        HStack(alignment: .bottom, spacing: 16) {
            VStack(alignment: .leading, spacing: 7) {
                Text(currentSection.title)
                    .font(.vocal(30, weight: .semibold))
                    .foregroundStyle(AppTheme.text)
                Text(currentSection.subtitle)
                    .font(.vocal(13, weight: .medium))
                    .foregroundStyle(AppTheme.mutedText)
            }
            Spacer()
            HStack(spacing: 8) {
                VocalFlowMark(lineWidth: 0.6)
                    .frame(width: 27, height: 15)
                Text("MAC NATIVE · 0.7")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .tracking(1.4)
            }
            .foregroundStyle(AppTheme.primary)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(AppTheme.brandBase.opacity(0.24), in: Capsule())
            .overlay(Capsule().stroke(AppTheme.border, lineWidth: 1))
            .padding(.bottom, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var pageContent: some View {
        switch currentSection {
        case .studio:
            RuntimeStatusCard(status: runtimeStatus, onRefresh: refreshRuntimeStatus)
            createPackageCard
        case .remote:
            remoteAgentCard
        case .library:
            libraryCard
        case .room:
            karaokeCard
        case .monitor:
            monitorCard
            controls
        }
    }

    private func refreshRuntimeStatus() {
        runtimeStatus = AudioSubtitlesRuntime.inspect()
    }

    private var remoteAgentCard: some View {
        GlassPanel {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 14) {
                    VocalFlowBadge(size: 58)

                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 7) {
                            Circle()
                                .fill(remoteAgent.isOnline ? AppTheme.primary : AppTheme.warning)
                                .frame(width: 8, height: 8)
                            Text(remoteAgent.isOnline ? "PRIVATE AGENT ONLINE" : "AGENT OFFLINE")
                                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                .tracking(1.2)
                                .foregroundStyle(remoteAgent.isOnline ? AppTheme.primary : AppTheme.warning)
                        }
                        Text(remoteAgent.name)
                            .font(.vocal(19, weight: .semibold))
                            .foregroundStyle(AppTheme.text)
                        Text(remoteAgent.statusMessage)
                            .font(.vocal(12, weight: .medium))
                            .foregroundStyle(AppTheme.mutedText)
                    }

                    Spacer()

                    if !remoteAgent.isOnline {
                        Button {
                            remoteAgent.installBundledAgent()
                        } label: {
                            if remoteAgent.isInstalling {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Label("Install Agent", systemImage: "iphone.and.arrow.forward")
                            }
                        }
                        .buttonStyle(PrimaryCapsuleButtonStyle(isActive: false))
                        .disabled(remoteAgent.isInstalling)
                    }

                    Button {
                        remoteAgent.refresh()
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }

                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("IPHONE PAIRING CODE")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .tracking(1.2)
                            .foregroundStyle(AppTheme.mutedText)
                        Text(remoteAgent.pairingCode)
                            .font(.system(size: 34, weight: .bold, design: .monospaced))
                            .tracking(7)
                            .foregroundStyle(AppTheme.text)
                            .textSelection(.enabled)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        copyRemoteValue(remoteAgent.pairingCode)
                    } label: {
                        Label("Copy Code", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(PrimaryCapsuleButtonStyle(isActive: false))
                    .disabled(remoteAgent.pairingCode == "------")
                }
                .padding(18)
                .background(.thinMaterial)
                .background(AppTheme.glassTint)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.cardRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AppTheme.cardRadius, style: .continuous)
                        .stroke(AppTheme.border, lineWidth: 1)
                )

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    RemoteAddressCard(
                        eyebrow: "SAME WI-FI",
                        title: "Bonjour / Local",
                        address: remoteAgent.localURL,
                        symbol: "wifi"
                    ) {
                        copyRemoteValue(remoteAgent.localURL)
                    }

                    RemoteAddressCard(
                        eyebrow: "IN THE CAR",
                        title: "Tailscale Private HTTPS",
                        address: remoteAgent.tailscaleURL,
                        symbol: "car.fill"
                    ) {
                        copyRemoteValue(remoteAgent.tailscaleURL)
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Remote Queue")
                            .font(.vocal(16, weight: .semibold))
                            .foregroundStyle(AppTheme.text)
                        Spacer()
                        Text("\(remoteAgent.jobs.count) jobs")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(AppTheme.mutedText)
                    }

                    if remoteAgent.jobs.isEmpty {
                        Text("Open Remote Studio on iPhone and send a YouTube or Bilibili link. The Mac can keep processing while the phone is away.")
                            .font(.vocal(12, weight: .medium))
                            .foregroundStyle(AppTheme.mutedText)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 12)
                    } else {
                        ForEach(remoteAgent.jobs.prefix(6)) { job in
                            HStack(spacing: 12) {
                                Image(systemName: remoteJobSymbol(job.status))
                                    .foregroundStyle(job.status == "failed" ? AppTheme.danger : AppTheme.primary)
                                    .frame(width: 28, height: 28)
                                    .background(AppTheme.brandBase.opacity(0.28), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(job.title)
                                        .font(.vocal(12, weight: .semibold))
                                        .foregroundStyle(AppTheme.text)
                                        .lineLimit(1)
                                    Text(job.message)
                                        .font(.vocal(10, weight: .medium))
                                        .foregroundStyle(AppTheme.mutedText)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Text(job.status.uppercased())
                                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                    .tracking(0.8)
                                    .foregroundStyle(job.status == "failed" ? AppTheme.danger : AppTheme.primary)
                                if job.isActive {
                                    ProgressView(value: job.overallProgress)
                                        .tint(AppTheme.primary)
                                        .frame(width: 84)
                                }
                            }
                            .padding(10)
                            .background(AppTheme.glassTint.opacity(0.42), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                }

                HStack(spacing: 10) {
                    Button {
                        NSWorkspace.shared.open(remoteAgent.outputDirectory)
                    } label: {
                        Label("Open Remote Packages", systemImage: "folder")
                    }
                    .buttonStyle(SecondaryButtonStyle())

                    Button {
                        NSWorkspace.shared.activateFileViewerSelecting([remoteAgent.logFile])
                    } label: {
                        Label("Show Agent Log", systemImage: "doc.text.magnifyingglass")
                    }
                    .buttonStyle(SecondaryButtonStyle())

                    Spacer()

                    Text("Token-authenticated · one job at a time · LaunchAgent managed")
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundStyle(AppTheme.mutedText)
                }
            }
            .padding(18)
        }
    }

    private func copyRemoteValue(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    private func remoteJobSymbol(_ status: String) -> String {
        switch status {
        case "queued": "clock.fill"
        case "running": "waveform"
        case "complete": "checkmark.circle.fill"
        case "cancelled": "xmark.circle"
        default: "exclamationmark.triangle.fill"
        }
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

                    StatusPill(state: packageCreationStatus)
                }

                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Source URL or Search")
                            .font(.vocal(12, weight: .semibold))
                            .foregroundStyle(AppTheme.mutedText)
                        Spacer()
                        if packageCreator.canSearchSource {
                            Toggle("Favor karaoke/backing", isOn: $packageCreator.appendKaraokeToSearch)
                                .toggleStyle(.switch)
                                .controlSize(.mini)
                                .font(.vocal(10, weight: .medium))
                                .foregroundStyle(AppTheme.mutedText)
                        }
                    }
                    HStack(spacing: 10) {
                        TextField("Paste a YouTube/Bilibili URL, BV ID, or song name", text: $packageCreator.sourceText)
                            .textFieldStyle(.plain)
                            .font(.vocal(13, weight: .medium))
                            .foregroundStyle(AppTheme.text)
                            .onSubmit {
                                packageCreator.searchSource()
                            }

                        if packageCreator.canSearchSource || packageCreator.isSearching {
                            Button {
                                packageCreator.searchSource()
                            } label: {
                                if packageCreator.isSearching {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Label("Search", systemImage: "magnifyingglass")
                                }
                            }
                            .buttonStyle(SecondaryButtonStyle())
                            .disabled(packageCreator.isSearching)
                        }
                    }
                    .padding(12)
                    .background(.thinMaterial)
                    .background(AppTheme.glassTint)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                            .stroke(AppTheme.border, lineWidth: 1)
                    )
                }

                if let searchError = packageCreator.searchError {
                    Label(searchError, systemImage: "exclamationmark.triangle.fill")
                        .font(.vocal(11, weight: .medium))
                        .foregroundStyle(AppTheme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if !packageCreator.searchResults.isEmpty {
                    MediaSearchResultsView(results: packageCreator.searchResults) { result in
                        packageCreator.selectSearchResult(result)
                    } onProcess: { result in
                        packageCreator.selectSearchResult(result)
                        packageCreator.start { package in
                            packageLibrary.addPackage(package)
                            karaokePlayer.loadPackage(package)
                        }
                    } onOpen: { result in
                        if let url = URL(string: result.url) {
                            NSWorkspace.shared.open(url)
                        }
                    }
                }

                if let sourceURL = packageCreator.normalizedSourceURL {
                    SourcePreviewCard(
                        sourceURL: sourceURL,
                        metadata: sourcePreview.metadata,
                        player: sourcePreview.player,
                        isLoadingMetadata: sourcePreview.isLoadingMetadata,
                        isLoadingVideo: sourcePreview.isLoadingVideo,
                        errorMessage: sourcePreview.errorMessage
                    ) {
                        sourcePreview.loadVideo(for: sourceURL, browser: packageCreator.options.normalizedBrowser)
                    } onStop: {
                        sourcePreview.stopVideo()
                    } onOpen: {
                        if let url = URL(string: sourceURL) {
                            NSWorkspace.shared.open(url)
                        }
                    }
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

                Grid(horizontalSpacing: 12, verticalSpacing: 12) {
                    GridRow {
                        ToggleRow(
                            title: "Create instrumental",
                            detail: "Generate a no-vocal backing track and share lyrics with the original.",
                            isOn: packageCreator.options.separateVocals
                        ) {
                            packageCreator.options.separateVocals = $0
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        ToggleRow(
                            title: "Save MV preview",
                            detail: "Keep a local video preview when the source supports it.",
                            isOn: packageCreator.options.saveVideoPreview
                        ) {
                            packageCreator.options.saveVideoPreview = $0
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    GridRow {
                        ToggleRow(
                            title: "Save audio",
                            detail: "Keep extracted 16 kHz audio for review and debugging.",
                            isOn: packageCreator.options.saveAudio
                        ) {
                            packageCreator.options.saveAudio = $0
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        ToggleRow(
                            title: "Local fallback",
                            detail: "Use local Whisper if platform captions are missing.",
                            isOn: packageCreator.options.localFallback
                        ) {
                            packageCreator.options.localFallback = $0
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    GridRow {
                        ToggleRow(
                            title: "Simplified Chinese",
                            detail: "Normalize Chinese captions and local transcription before export.",
                            isOn: packageCreator.options.simplifiedChinese
                        ) {
                            packageCreator.options.simplifiedChinese = $0
                        }
                        .gridCellColumns(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
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

                    Picker("Browser", selection: $packageCreator.options.browser) {
                        Text("No cookies").tag(String?.none)
                        Text("Chrome cookies").tag(String?.some("chrome"))
                        Text("Safari cookies").tag(String?.some("safari"))
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
                        Label(packageCreator.isRunning ? "Running" : "Create Package", systemImage: packageCreator.isRunning ? "hourglass" : "play.fill")
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

                    if monitor.state.isListening {
                        Text(monitor.latencyGuidance)
                            .font(.vocal(11, weight: .medium))
                            .foregroundStyle(AppTheme.primary.opacity(0.9))
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
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

                    Button {
                        enterImmersiveRoom()
                    } label: {
                        Label("Enter Stage", systemImage: "arrow.up.left.and.arrow.down.right")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(karaokePlayer.selectedTrackURL == nil)
                }

                if karaokePlayer.playlist.count > 1 || karaokePlayer.isPreparingOnlineVideo {
                    PlaybackSourcePicker(
                        items: karaokePlayer.playlist,
                        selectedItemID: karaokePlayer.selectedItemID,
                        isPreparingMV: karaokePlayer.isPreparingOnlineVideo
                    ) { item in
                        karaokePlayer.selectItem(item)
                    }
                }

                VideoStageView(
                    player: karaokePlayer.player,
                    isVideo: karaokePlayer.selectedTrackIsVideo,
                    title: karaokePlayer.selectedTrackName,
                    currentCue: karaokePlayer.currentCue,
                    nextCue: karaokePlayer.nextCue,
                    currentTime: karaokePlayer.currentTime,
                    isBuffering: karaokePlayer.isBuffering,
                    playbackIssue: karaokePlayer.playbackIssue
                )

                KaraokeTimeline(
                    currentTime: karaokePlayer.currentTime,
                    duration: karaokePlayer.duration,
                    onSeek: karaokePlayer.seek,
                    onSkip: karaokePlayer.skip
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
                    CompactKaraokeMixControl(karaokePlayer: karaokePlayer)
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
                Text(monitor.latencyGuidance)
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

private struct MediaSearchResultsView: View {
    let results: [MediaSearchResult]
    let onSelect: (MediaSearchResult) -> Void
    let onProcess: (MediaSearchResult) -> Void
    let onOpen: (MediaSearchResult) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Media Results", systemImage: "magnifyingglass")
                    .font(.vocal(12, weight: .semibold))
                    .foregroundStyle(AppTheme.text)
                Spacer()
                Text("YOUTUBE + BILIBILI · \(results.count) FOUND")
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .tracking(1)
                    .foregroundStyle(AppTheme.mutedText)
            }

            ScrollView {
                LazyVStack(spacing: 7) {
                    ForEach(Array(results.enumerated()), id: \.element.id) { index, result in
                        HStack(spacing: 11) {
                            Text(String(format: "%02d", index + 1))
                                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                .foregroundStyle(AppTheme.primary)
                                .frame(width: 24)

                            MediaThumbnailView(url: result.thumbnailURL, platform: result.platform)
                                .frame(width: 92, height: 52)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.title)
                                    .font(.vocal(12, weight: .semibold))
                                    .foregroundStyle(AppTheme.text)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)

                                HStack(spacing: 7) {
                                    Label(result.platform.rawValue, systemImage: result.platform.symbolName)
                                    if let creator = result.creator, !creator.isEmpty {
                                        Text(creator)
                                    }
                                    if let duration = result.durationText {
                                        Text(duration)
                                    }
                                }
                                .font(.system(size: 10, weight: .regular, design: .monospaced))
                                .foregroundStyle(AppTheme.mutedText)
                            }

                            Spacer()

                            Button {
                                onSelect(result)
                            } label: {
                                Image(systemName: "checkmark.circle")
                                    .frame(width: 26, height: 26)
                            }
                            .buttonStyle(SecondaryIconButtonStyle())
                            .help("Use this link")

                            Button {
                                onProcess(result)
                            } label: {
                                Image(systemName: "play.fill")
                                    .frame(width: 26, height: 26)
                            }
                            .buttonStyle(SecondaryIconButtonStyle())
                            .help("Use and create package")

                            Button {
                                onOpen(result)
                            } label: {
                                Image(systemName: "safari")
                                    .frame(width: 26, height: 26)
                            }
                            .buttonStyle(SecondaryIconButtonStyle())
                            .help("Open in browser")
                        }
                        .padding(.horizontal, 11)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(AppTheme.glassTintRaised)
                        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
                    }
                }
            }
            .frame(maxHeight: 340)
        }
        .padding(13)
        .background(AppTheme.backgroundBottom.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }
}

private struct SourcePreviewCard: View {
    let sourceURL: String
    let metadata: MediaMetadataPreview?
    let player: AVPlayer?
    let isLoadingMetadata: Bool
    let isLoadingVideo: Bool
    let errorMessage: String?
    let onPreview: () -> Void
    let onStop: () -> Void
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 12) {
                if let metadata {
                    MediaThumbnailView(url: metadata.thumbnailURL, platform: metadata.platform)
                        .frame(width: 118, height: 67)

                    VStack(alignment: .leading, spacing: 5) {
                        Text(metadata.title)
                            .font(.vocal(13, weight: .semibold))
                            .foregroundStyle(AppTheme.text)
                            .lineLimit(2)

                        Text(metadataLine(metadata))
                            .font(.system(size: 10, weight: .regular, design: .monospaced))
                            .foregroundStyle(AppTheme.mutedText)
                            .lineLimit(1)
                    }
                } else if isLoadingMetadata {
                    ProgressView()
                        .controlSize(.small)
                    Text("Loading media details…")
                        .font(.vocal(12, weight: .medium))
                        .foregroundStyle(AppTheme.mutedText)
                } else {
                    Image(systemName: MediaURLNormalizer.platform(for: sourceURL).symbolName)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(AppTheme.primary)
                    Text(errorMessage ?? sourceURL)
                        .font(.vocal(11, weight: .medium))
                        .foregroundStyle(errorMessage == nil ? AppTheme.mutedText : AppTheme.warning)
                        .lineLimit(2)
                }

                Spacer()

                Button {
                    onOpen()
                } label: {
                    Label("Browser", systemImage: "safari")
                }
                .buttonStyle(SecondaryButtonStyle())

                if player == nil {
                    Button {
                        onPreview()
                    } label: {
                        if isLoadingVideo {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Label("Video Preview", systemImage: "play.rectangle.fill")
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(isLoadingVideo)
                } else {
                    Button {
                        onStop()
                    } label: {
                        Label("Close Preview", systemImage: "xmark")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }

            if let player {
                AppKitVideoPlayer(player: player)
                    .frame(height: 260)
                    .background(Color.black)
                    .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
            }

            if let errorMessage, metadata != nil {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.vocal(10, weight: .medium))
                    .foregroundStyle(AppTheme.warning)
            }
        }
        .padding(12)
        .background(AppTheme.glassTintRaised)
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private func metadataLine(_ metadata: MediaMetadataPreview) -> String {
        [metadata.platform.rawValue, metadata.creator, metadata.durationText]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}

private struct MediaThumbnailView: View {
    let url: URL?
    let platform: MediaPlatform

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .scaledToFill()
            default:
                ZStack {
                    AppTheme.backgroundBottom
                    Image(systemName: platform.symbolName)
                        .foregroundStyle(AppTheme.primary)
                }
            }
        }
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }
}

private struct RuntimeStatusCard: View {
    let status: AudioSubtitlesRuntimeStatus
    let onRefresh: () -> Void

    var body: some View {
        GlassPanel {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Image(systemName: status.isReady ? "checkmark.seal.fill" : "wrench.and.screwdriver.fill")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(status.isReady ? AppTheme.primary : AppTheme.warning)

                    VStack(alignment: .leading, spacing: 3) {
                        Text("System Check")
                            .font(.vocal(16, weight: .semibold))
                            .foregroundStyle(AppTheme.text)
                        Text(status.summary)
                            .font(.vocal(12, weight: .medium))
                            .foregroundStyle(status.isReady ? AppTheme.mutedText : AppTheme.warning)
                    }

                    Spacer()

                    Button {
                        onRefresh()
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(status.components) { component in
                        HStack(alignment: .top, spacing: 9) {
                            Image(systemName: iconName(for: component))
                                .foregroundStyle(iconColor(for: component))

                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(component.name)
                                        .font(.vocal(12, weight: .semibold))
                                        .foregroundStyle(AppTheme.text)
                                    if !component.isRequired {
                                        Text("OPTIONAL")
                                            .font(.system(size: 8, weight: .semibold, design: .monospaced))
                                            .tracking(0.8)
                                            .foregroundStyle(AppTheme.mutedText)
                                    }
                                }
                                Text(component.detail)
                                    .font(.system(size: 10, weight: .regular, design: .monospaced))
                                    .foregroundStyle(AppTheme.mutedText)
                                    .lineLimit(2)
                                    .textSelection(.enabled)
                            }

                            Spacer(minLength: 0)
                        }
                        .padding(11)
                        .frame(maxWidth: .infinity, minHeight: 66, alignment: .topLeading)
                        .background(AppTheme.glassTintRaised)
                        .clipShape(RoundedRectangle(cornerRadius: AppTheme.controlRadius, style: .continuous))
                    }
                }

                if !status.isReady {
                    Text("Reinstall VocalFlow to restore its bundled runtime. For a source checkout, run `./install.sh`, then refresh this check.")
                        .font(.vocal(11, weight: .medium))
                        .foregroundStyle(AppTheme.mutedText)
                        .textSelection(.enabled)
                }
            }
            .padding(18)
        }
    }

    private func iconName(for component: RuntimeComponentStatus) -> String {
        if component.isAvailable {
            return "checkmark.circle.fill"
        }
        return component.isRequired ? "xmark.circle.fill" : "minus.circle"
    }

    private func iconColor(for component: RuntimeComponentStatus) -> Color {
        if component.isAvailable {
            return AppTheme.primary
        }
        return component.isRequired ? AppTheme.danger : AppTheme.mutedText
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

private struct RemoteAddressCard: View {
    let eyebrow: String
    let title: String
    let address: String
    let symbol: String
    let onCopy: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.primary)
                Text(eyebrow)
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .tracking(1.1)
                    .foregroundStyle(AppTheme.mutedText)
                Spacer()
                Button(action: onCopy) {
                    Image(systemName: "doc.on.doc")
                }
                .buttonStyle(.plain)
                .foregroundStyle(AppTheme.primary)
                .accessibilityLabel("Copy \(title) address")
            }

            Text(title)
                .font(.vocal(14, weight: .semibold))
                .foregroundStyle(AppTheme.text)
            Text(address)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(AppTheme.mutedText)
                .lineLimit(1)
                .textSelection(.enabled)
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

struct PlaybackSourcePicker: View {
    let items: [KaraokePlayerService.PlaylistItem]
    let selectedItemID: String?
    let isPreparingMV: Bool
    let onSelect: (KaraokePlayerService.PlaylistItem) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            fullPicker
            compactPicker
        }
    }

    private var fullPicker: some View {
        HStack(spacing: 8) {
            Text("Source")
                .font(.vocal(11, weight: .semibold))
                .foregroundStyle(AppTheme.mutedText)

            if isPreparingMV, !items.contains(where: { $0.kind == .mv }) {
                HStack(spacing: 7) {
                    ProgressView()
                        .controlSize(.mini)
                    Text("MV Preparing")
                }
                .font(.vocal(12, weight: .semibold))
                .foregroundStyle(AppTheme.mutedText)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.05))
                .clipShape(Capsule())
            }

            ForEach(items) { item in
                Button {
                    onSelect(item)
                } label: {
                    Label(item.kind.title, systemImage: item.kind.symbolName)
                        .font(.vocal(12, weight: .semibold))
                        .foregroundStyle(selectedItemID == item.id ? Color.black.opacity(0.82) : AppTheme.text)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(selectedItemID == item.id ? AppTheme.primary : Color.white.opacity(0.07))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .help(item.title)
                .fixedSize()
            }

            Spacer()

            Label("Word-synced lyrics", systemImage: "quote.bubble.fill")
                .font(.vocal(10, weight: .semibold))
                .foregroundStyle(AppTheme.primary)
        }
    }

    private var compactPicker: some View {
        HStack(spacing: 10) {
            Label("Source", systemImage: "rectangle.stack")
                .font(.vocal(10, weight: .semibold))
                .foregroundStyle(AppTheme.mutedText)

            Menu {
                ForEach(items) { item in
                    Button {
                        onSelect(item)
                    } label: {
                        Label(item.kind.title, systemImage: item.id == selectedItemID ? "checkmark" : item.kind.symbolName)
                    }
                }
            } label: {
                Text(selectedTitle)
                    .font(.vocal(11, weight: .semibold))
            }
            .menuStyle(.borderlessButton)

            if isPreparingMV {
                ProgressView()
                    .controlSize(.mini)
            }

            Spacer()

            Image(systemName: "quote.bubble.fill")
                .foregroundStyle(AppTheme.primary)
                .help("Word-synced lyrics")
        }
    }

    private var selectedTitle: String {
        items.first(where: { $0.id == selectedItemID })?.kind.title ?? "Choose"
    }
}

private struct KaraokeTimeline: View {
    let currentTime: TimeInterval
    let duration: TimeInterval
    let onSeek: (TimeInterval) -> Void
    let onSkip: (TimeInterval) -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button {
                onSkip(-10)
            } label: {
                Image(systemName: "gobackward.10")
            }
            .buttonStyle(.plain)
            .foregroundStyle(AppTheme.text)

            Text(formatTime(currentTime))
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(AppTheme.text)
                .frame(width: 42)

            Slider(
                value: Binding(get: { min(currentTime, sliderMaximum) }, set: onSeek),
                in: 0...sliderMaximum
            )
            .tint(AppTheme.primary)
            .disabled(duration <= 0)

            Text("−\(formatTime(max(0, duration - currentTime)))")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(AppTheme.mutedText)
                .frame(width: 48)

            Button {
                onSkip(10)
            } label: {
                Image(systemName: "goforward.10")
            }
            .buttonStyle(.plain)
            .foregroundStyle(AppTheme.text)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.black.opacity(0.2))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var sliderMaximum: TimeInterval {
        max(1, duration)
    }

    private func formatTime(_ value: TimeInterval) -> String {
        guard value.isFinite else { return "00:00" }
        let totalSeconds = max(0, Int(value.rounded()))
        return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}

struct VideoStageView: View {
    let player: AVPlayer?
    let isVideo: Bool
    let title: String
    let currentCue: KaraokePlayerService.LyricCue?
    let nextCue: KaraokePlayerService.LyricCue?
    let currentTime: TimeInterval
    let isBuffering: Bool
    let playbackIssue: String?
    var videoAspectRatio: Double = 16.0 / 9.0
    var height: CGFloat = 300

    var body: some View {
        GeometryReader { proxy in
            let contentSize = fittedContentSize(in: proxy.size)

            ZStack {
                Color.black

                ZStack(alignment: .bottom) {
                    media
                    mediaBadge
                    lyricOverlay(in: contentSize)
                }
                .frame(width: contentSize.width, height: contentSize.height)
                .clipShape(RoundedRectangle(cornerRadius: isVideo ? 8 : 0, style: .continuous))

                if isBuffering {
                    VStack(spacing: 10) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Loading video")
                            .font(.vocal(11, weight: .semibold))
                    }
                    .foregroundStyle(AppTheme.text)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                }
            }
        }
        .frame(height: height)
        .background(Color.black.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.cardRadius, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var media: some View {
        if isVideo, let player {
            AppKitVideoPlayer(player: player, showsControls: false)
        } else {
            VStack(spacing: 12) {
                VocalFlowBadge(size: 72)
                Text("VOCALFLOW AUDIO STAGE")
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .tracking(1.5)
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

    private var mediaBadge: some View {
        VStack {
            HStack {
                Label(isVideo ? "MV · FIT" : "AUDIO", systemImage: isVideo ? "play.rectangle.fill" : "waveform")
                    .font(.vocal(9, weight: .semibold))
                    .foregroundStyle(AppTheme.text)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
                Spacer()
            }
            Spacer()
        }
        .padding(12)
    }

    private func lyricOverlay(in size: CGSize) -> some View {
        let currentFontSize = min(42, max(18, min(size.width * 0.048, size.height * 0.12)))
        let nextFontSize = min(21, max(12, currentFontSize * 0.52))

        return VStack(spacing: max(5, size.height * 0.018)) {
            if let playbackIssue {
                Label(playbackIssue, systemImage: "exclamationmark.triangle.fill")
                    .font(.vocal(11, weight: .semibold))
                    .foregroundStyle(AppTheme.warning)
                    .lineLimit(2)
            }

            if let currentCue {
                KaraokeLyricLine(cue: currentCue, currentTime: currentTime)
                    .font(.vocal(currentFontSize, weight: .bold))
                    .foregroundStyle(AppTheme.primary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.55)
                    .shadow(color: .black.opacity(0.94), radius: 2, x: 1, y: 2)
                    .shadow(color: .black.opacity(0.58), radius: 9, y: 3)
            } else {
                Text("Choose a song to show lyrics.")
                    .font(.vocal(max(16, currentFontSize * 0.72), weight: .semibold))
                    .foregroundStyle(AppTheme.mutedText)
            }

            if let nextCue, size.height > 210 {
                Text(nextCue.text)
                    .font(.vocal(nextFontSize, weight: .semibold))
                    .foregroundStyle(AppTheme.text.opacity(0.72))
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }
        }
        .padding(.horizontal, max(18, size.width * 0.055))
        .padding(.top, max(34, size.height * 0.18))
        .padding(.bottom, max(14, size.height * 0.055))
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(
                colors: [.clear, Color.black.opacity(0.78)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private func fittedContentSize(in availableSize: CGSize) -> CGSize {
        guard isVideo else { return availableSize }
        let ratio = max(0.2, min(5, CGFloat(videoAspectRatio)))
        let availableRatio = availableSize.width / max(1, availableSize.height)
        if availableRatio > ratio {
            return CGSize(width: availableSize.height * ratio, height: availableSize.height)
        }
        return CGSize(width: availableSize.width, height: availableSize.width / ratio)
    }
}

private struct KaraokeLyricLine: View {
    let cue: KaraokePlayerService.LyricCue
    let currentTime: TimeInterval

    var body: some View {
        highlightedText
    }

    private var highlightedText: Text {
        guard !cue.words.isEmpty else {
            return Text(cue.text).foregroundColor(AppTheme.primary)
        }

        return cue.words.enumerated().reduce(Text("")) { result, element in
            let (index, word) = element
            let prefix = index == 0 ? "" : " "
            let color: Color
            if currentTime >= word.end {
                color = AppTheme.primary
            } else if currentTime >= word.start {
                color = AppTheme.text
            } else {
                color = AppTheme.text.opacity(0.5)
            }
            return result + Text(prefix + word.text).foregroundColor(color)
        }
    }
}

private struct AppKitVideoPlayer: NSViewRepresentable {
    let player: AVPlayer
    var showsControls = true

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = showsControls ? .floating : .none
        view.videoGravity = .resizeAspect
        view.player = player
        return view
    }

    func updateNSView(_ nsView: AVPlayerView, context: Context) {
        if nsView.player !== player {
            nsView.player = player
        }
        nsView.controlsStyle = showsControls ? .floating : .none
        nsView.videoGravity = .resizeAspect
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
            .foregroundStyle(AppTheme.text)
            .padding(.horizontal, 15)
            .padding(.vertical, 10)
            .background(isActive || configuration.isPressed ? AppTheme.action.opacity(0.82) : AppTheme.action)
            .clipShape(Capsule())
            .shadow(color: AppTheme.action.opacity(0.18), radius: 10, y: 5)
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
