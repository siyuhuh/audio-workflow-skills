import SwiftUI

private enum RoomCatalogFilter: String, CaseIterable, Identifiable {
    case all
    case mv
    case backing

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .mv: "MV"
        case .backing: "Backing"
        }
    }
}

struct KaraokeRoomWorkspace: View {
    @ObservedObject var karaokePlayer: KaraokePlayerService
    @ObservedObject var packageLibrary: PackageLibraryService
    @ObservedObject var monitor: AudioMonitorService
    @ObservedObject var recording: KaraokeRecordingService
    let onEnterStage: () -> Void

    @State private var searchText = ""
    @State private var filter: RoomCatalogFilter = .all
    @State private var showsMixer = false
    @State private var selectedPackageID: UUID?
    @State private var selectedQueueItemID: UUID?
    @State private var queueSearchText = ""

    var body: some View {
        HSplitView {
            catalogPane
                .frame(minWidth: 300, idealWidth: 430, maxWidth: 680)

            VSplitView {
                VStack(spacing: 0) {
                    roomHeader
                    GeometryReader { proxy in
                        stage(height: proxy.size.height)
                    }
                    nowPlayingBar
                }
                .frame(minWidth: 420, minHeight: 390, idealHeight: 560)

                queuePanel
                    .frame(minHeight: 118, idealHeight: 190, maxHeight: 320)
            }
        }
        .background(AppTheme.card)
    }

    private var catalogPane: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 13) {
                HStack(spacing: 10) {
                    VocalFlowBadge(size: 38)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Songbook")
                            .font(.vocal(17, weight: .semibold))
                            .foregroundStyle(AppTheme.text)
                        Text("CHOOSE OR ADD TO QUEUE")
                            .font(.system(size: 8, weight: .semibold, design: .monospaced))
                            .tracking(1.1)
                            .foregroundStyle(AppTheme.mutedText)
                    }
                    Spacer()
                    Button {
                        packageLibrary.refresh()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .frame(width: 30, height: 30)
                    }
                    .buttonStyle(RoomIconButtonStyle())
                    .help("Refresh library")
                }

                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(AppTheme.mutedText)
                    TextField("Search songs", text: $searchText)
                        .textFieldStyle(.plain)
                        .font(.vocal(12, weight: .medium))
                    if !searchText.isEmpty {
                        Button {
                            searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(AppTheme.mutedText)
                    }
                }
                .padding(.horizontal, 11)
                .frame(height: 36)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                Picker("Filter", selection: $filter) {
                    ForEach(RoomCatalogFilter.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            .padding(16)

            HStack {
                Text("LIBRARY")
                Spacer()
                Text("\(filteredPackages.count) SONGS")
            }
            .font(.system(size: 8, weight: .semibold, design: .monospaced))
            .tracking(0.9)
            .foregroundStyle(AppTheme.mutedText)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(Color.black.opacity(0.12))

            if filteredPackages.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "music.note.list")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(AppTheme.primary)
                    Text(packageLibrary.packages.isEmpty ? "Import a package to start singing." : "No songs match this search.")
                        .font(.vocal(12, weight: .medium))
                        .foregroundStyle(AppTheme.mutedText)
                        .multilineTextAlignment(.center)
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                GeometryReader { proxy in
                    if proxy.size.width >= 470 {
                        expandedCatalogTable
                    } else {
                        compactCatalogTable
                    }
                }
                .onChange(of: selectedPackageID) { _, packageID in
                    guard !recording.phase.isBusy else { return }
                    guard let packageID,
                          let package = filteredPackages.first(where: { $0.id == packageID }) else { return }
                    karaokePlayer.playNow(package)
                }
            }

            HStack(spacing: 10) {
                Button {
                    packageLibrary.choosePackageFolder()
                } label: {
                    Label("Import", systemImage: "folder.badge.plus")
                }
                .buttonStyle(RoomCompactButtonStyle())

                Spacer()

                Text("LOCAL · PRIVATE")
                    .font(.system(size: 8, weight: .semibold, design: .monospaced))
                    .tracking(0.8)
                    .foregroundStyle(AppTheme.primary)
            }
            .padding(12)
            .background(Color.black.opacity(0.12))
        }
    }

    private var roomHeader: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Room")
                    .font(.vocal(20, weight: .semibold))
                    .foregroundStyle(AppTheme.text)
                Text(karaokePlayer.nextQueueItem.map { "Up next · \($0.package.title)" } ?? "Build a queue, then enter the full-screen stage.")
                    .font(.vocal(10, weight: .medium))
                    .foregroundStyle(AppTheme.mutedText)
                    .lineLimit(1)
            }

            Spacer()

            if karaokePlayer.isPreparingOnlineVideo {
                ProgressView()
                    .controlSize(.small)
            }

            Button(action: onEnterStage) {
                ViewThatFits(in: .horizontal) {
                    Label("Full-screen Stage", systemImage: "arrow.up.left.and.arrow.down.right")
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                }
            }
            .buttonStyle(RoomPrimaryButtonStyle())
            .disabled(karaokePlayer.selectedTrackURL == nil || recording.phase.isBusy)
        }
        .padding(.horizontal, 18)
        .frame(height: 62)
        .background(Color.black.opacity(0.11))
    }

    private func stage(height: CGFloat) -> some View {
        VideoStageView(
            player: karaokePlayer.player,
            isVideo: karaokePlayer.selectedTrackIsVideo,
            title: karaokePlayer.selectedTrackName,
            currentCue: karaokePlayer.currentCue,
            nextCue: karaokePlayer.nextCue,
            currentTime: karaokePlayer.currentTime,
            isBuffering: karaokePlayer.isBuffering,
            playbackIssue: karaokePlayer.playbackIssue,
            videoAspectRatio: karaokePlayer.videoAspectRatio,
            height: height
        )
        .clipShape(Rectangle())
        .overlay {
            if case .countdown(let count) = recording.phase {
                NativeRecordingCountdown(count: count) {
                    recording.toggle(monitor: monitor, player: karaokePlayer)
                }
            }
        }
        .overlay(alignment: .top) {
            if recording.phase.isRecording || recording.phase == .saving {
                NativeRecordingStatus(
                    title: recording.phase.isRecording
                        ? "REC \(formatTime(monitor.recordingDuration))"
                        : "SAVING"
                )
                .padding(.top, 18)
            }
        }
    }

    private var nowPlayingBar: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(karaokePlayer.selectedTrackName)
                        .font(.vocal(13, weight: .semibold))
                        .foregroundStyle(AppTheme.text)
                        .lineLimit(1)
                    Text(karaokePlayer.status)
                        .font(.vocal(9, weight: .medium))
                        .foregroundStyle(AppTheme.mutedText)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    karaokePlayer.setUseBackingAudio(!karaokePlayer.useBackingAudio)
                } label: {
                    ViewThatFits(in: .horizontal) {
                        Label(karaokePlayer.useBackingAudio ? "Backing" : "Original", systemImage: karaokePlayer.useBackingAudio ? "music.mic" : "person.wave.2.fill")
                        Image(systemName: karaokePlayer.useBackingAudio ? "music.mic" : "person.wave.2.fill")
                    }
                }
                .buttonStyle(RoomCompactButtonStyle(isSelected: karaokePlayer.useBackingAudio))
                .disabled(!karaokePlayer.hasBackingTrack || recording.phase.isBusy)

                Button {
                    showsMixer.toggle()
                } label: {
                    ViewThatFits(in: .horizontal) {
                        Label("Mix", systemImage: "slider.horizontal.3")
                        Image(systemName: "slider.horizontal.3")
                    }
                }
                .buttonStyle(RoomCompactButtonStyle())
                .disabled(recording.phase.isBusy)
                .popover(isPresented: $showsMixer, arrowEdge: .bottom) {
                    RoomMixerPanel(karaokePlayer: karaokePlayer)
                }

                Button {
                    recording.toggle(monitor: monitor, player: karaokePlayer)
                } label: {
                    Label(recordingButtonTitle, systemImage: recordingButtonSymbol)
                }
                .buttonStyle(RoomRecordingButtonStyle(isRecording: recording.phase.isRecording))
                .disabled(
                    karaokePlayer.selectedTrackURL == nil ||
                    recording.phase == .preparing ||
                    recording.phase == .saving
                )

                if recording.lastRecording != nil {
                    Button {
                        recording.openLastRecording()
                    } label: {
                        Image(systemName: "folder")
                    }
                    .buttonStyle(RoomIconButtonStyle())
                    .help(recording.message)
                }
            }

            HStack(spacing: 12) {
                Button { karaokePlayer.playPreviousInQueue() } label: {
                    Image(systemName: "backward.end.fill")
                }
                .buttonStyle(RoomIconButtonStyle())
                .disabled(!karaokePlayer.hasPreviousQueueItem || recording.phase.isBusy)

                Button { karaokePlayer.togglePlayback() } label: {
                    Image(systemName: karaokePlayer.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 14, weight: .bold))
                        .frame(width: 38, height: 38)
                }
                .buttonStyle(RoomPlayButtonStyle())
                .disabled(karaokePlayer.selectedTrackURL == nil || recording.phase.isBusy)

                Button { karaokePlayer.playNextInQueue() } label: {
                    Image(systemName: "forward.end.fill")
                }
                .buttonStyle(RoomIconButtonStyle())
                .disabled(!karaokePlayer.hasNextQueueItem || recording.phase.isBusy)

                Text(formatTime(karaokePlayer.currentTime))
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AppTheme.mutedText)

                Slider(
                    value: Binding(
                        get: { min(karaokePlayer.currentTime, max(1, karaokePlayer.duration)) },
                        set: karaokePlayer.seek
                    ),
                    in: 0...max(1, karaokePlayer.duration)
                )
                .tint(AppTheme.primary)
                .disabled(karaokePlayer.duration <= 0 || recording.phase.isBusy)

                Text("−\(formatTime(max(0, karaokePlayer.duration - karaokePlayer.currentTime)))")
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AppTheme.mutedText)
            }

            if karaokePlayer.playlist.count > 1 || karaokePlayer.isPreparingOnlineVideo {
                PlaybackSourcePicker(
                    items: karaokePlayer.playlist,
                    selectedItemID: karaokePlayer.selectedItemID,
                    isPreparingMV: karaokePlayer.isPreparingOnlineVideo,
                    onSelect: karaokePlayer.selectItem
                )
                .allowsHitTesting(!recording.phase.isBusy)
                .opacity(recording.phase.isBusy ? 0.55 : 1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(.ultraThinMaterial)
    }

    private var queuePanel: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Up Next", systemImage: "text.line.first.and.arrowtriangle.forward")
                    .font(.vocal(12, weight: .semibold))
                    .foregroundStyle(AppTheme.text)
                Text("\(karaokePlayer.songQueue.count) songs")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundStyle(AppTheme.mutedText)
                Spacer()

                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                    TextField("Filter queue", text: $queueSearchText)
                        .textFieldStyle(.plain)
                        .frame(width: 120)
                }
                .font(.vocal(9, weight: .medium))
                .foregroundStyle(AppTheme.mutedText)
                .padding(.horizontal, 9)
                .frame(height: 24)
                .background(Color.white.opacity(0.05), in: Capsule())

                Button("Clear") { karaokePlayer.clearQueue() }
                    .buttonStyle(.plain)
                    .font(.vocal(10, weight: .semibold))
                    .foregroundStyle(AppTheme.mutedText)
                    .disabled(karaokePlayer.songQueue.isEmpty)
            }
            .padding(.horizontal, 16)
            .frame(height: 36)
            .background(Color.black.opacity(0.16))

            if karaokePlayer.songQueue.isEmpty {
                Text("Use + in the songbook to build a karaoke queue.")
                    .font(.vocal(11, weight: .medium))
                    .foregroundStyle(AppTheme.mutedText)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Table(displayedQueueItems, selection: $selectedQueueItemID) {
                    TableColumn("#") { item in
                        Text(queueNumber(for: item))
                            .font(.system(size: 9, weight: .semibold, design: .monospaced))
                            .foregroundStyle(item.id == karaokePlayer.currentQueueItemID ? AppTheme.primary : AppTheme.mutedText)
                    }
                    .width(28)

                    TableColumn("Title") { item in
                        HStack(spacing: 8) {
                            Image(systemName: item.id == karaokePlayer.currentQueueItemID ? "speaker.wave.2.fill" : "music.note")
                                .foregroundStyle(AppTheme.primary)
                                .frame(width: 18)
                            Text(item.package.title)
                                .font(.vocal(11, weight: .semibold))
                                .foregroundStyle(AppTheme.text)
                                .lineLimit(1)
                        }
                    }
                    .width(min: 180, ideal: 300)

                    TableColumn("Format") { item in
                        Text(queueSummary(for: item))
                            .font(.system(size: 8, weight: .medium, design: .monospaced))
                            .foregroundStyle(AppTheme.mutedText)
                    }
                    .width(min: 72, ideal: 90, max: 110)

                    TableColumn("") { item in
                        QueueTableActions(
                            canMoveUp: canMoveQueueItem(item, by: -1),
                            canMoveDown: canMoveQueueItem(item, by: 1),
                            onMoveUp: { karaokePlayer.moveQueueItem(item, by: -1) },
                            onMoveDown: { karaokePlayer.moveQueueItem(item, by: 1) },
                            onRemove: { karaokePlayer.removeQueueItem(item) }
                        )
                    }
                    .width(78)
                }
                .tableStyle(.inset(alternatesRowBackgrounds: true))
                .onChange(of: selectedQueueItemID) { _, itemID in
                    guard !recording.phase.isBusy else { return }
                    guard let itemID,
                          let item = karaokePlayer.songQueue.first(where: { $0.id == itemID }) else { return }
                    karaokePlayer.playQueueItem(item)
                }
            }
        }
        .frame(maxHeight: .infinity)
        .background(Color.black.opacity(0.1))
    }

    private var filteredPackages: [KaraokePackage] {
        packageLibrary.packages.filter { package in
            let matchesSearch = searchText.isEmpty || package.title.localizedCaseInsensitiveContains(searchText)
            let matchesFilter: Bool
            switch filter {
            case .all: matchesFilter = true
            case .mv: matchesFilter = package.playback.videoURL != nil
            case .backing: matchesFilter = package.playback.backingURL != nil
            }
            return matchesSearch && matchesFilter
        }
    }

    private var displayedQueueItems: [KaraokePlayerService.SongQueueItem] {
        guard !queueSearchText.isEmpty else { return karaokePlayer.songQueue }
        return karaokePlayer.songQueue.filter {
            $0.package.title.localizedCaseInsensitiveContains(queueSearchText)
        }
    }

    private var expandedCatalogTable: some View {
        Table(filteredPackages, selection: $selectedPackageID) {
            TableColumn("Title") { package in
                CatalogTableTitleCell(package: package, isPlaying: isCurrent(package))
            }
            .width(min: 190, ideal: 270)

            TableColumn("Source") { package in
                Text(sourceLabel(for: package))
                    .font(.vocal(10, weight: .medium))
                    .foregroundStyle(AppTheme.mutedText)
            }
            .width(min: 72, ideal: 88, max: 104)

            TableColumn("Added") { package in
                Text(package.createdAt, format: .dateTime.month(.abbreviated).day())
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundStyle(AppTheme.mutedText)
            }
            .width(min: 52, ideal: 62, max: 72)

            TableColumn("") { package in
                CatalogQueueButton(
                    isQueued: karaokePlayer.songQueue.contains(where: { $0.package.id == package.id })
                ) {
                    karaokePlayer.enqueue(package)
                }
            }
            .width(34)
        }
        .tableStyle(.inset(alternatesRowBackgrounds: true))
    }

    private var compactCatalogTable: some View {
        Table(filteredPackages, selection: $selectedPackageID) {
            TableColumn("Song") { package in
                CatalogTableTitleCell(package: package, isPlaying: isCurrent(package))
            }

            TableColumn("") { package in
                CatalogQueueButton(
                    isQueued: karaokePlayer.songQueue.contains(where: { $0.package.id == package.id })
                ) {
                    karaokePlayer.enqueue(package)
                }
            }
            .width(34)
        }
        .tableStyle(.inset(alternatesRowBackgrounds: true))
    }

    private func isCurrent(_ package: KaraokePackage) -> Bool {
        karaokePlayer.songQueue.first(where: { $0.id == karaokePlayer.currentQueueItemID })?.package.id == package.id
    }

    private func sourceLabel(for package: KaraokePackage) -> String {
        switch package.source {
        case .localFile:
            return "Local"
        case .url(let value):
            if value.localizedCaseInsensitiveContains("bilibili") || value.localizedCaseInsensitiveContains("b23.tv") {
                return "Bilibili"
            }
            return "YouTube"
        }
    }

    private func queueNumber(for item: KaraokePlayerService.SongQueueItem) -> String {
        guard let index = karaokePlayer.songQueue.firstIndex(where: { $0.id == item.id }) else { return "--" }
        return String(format: "%02d", index + 1)
    }

    private func queueSummary(for item: KaraokePlayerService.SongQueueItem) -> String {
        var parts = [item.package.playback.videoURL == nil ? "AUDIO" : "MV"]
        if item.package.playback.backingURL != nil { parts.append("BACKING") }
        return parts.joined(separator: " · ")
    }

    private func canMoveQueueItem(_ item: KaraokePlayerService.SongQueueItem, by offset: Int) -> Bool {
        guard let index = karaokePlayer.songQueue.firstIndex(where: { $0.id == item.id }) else { return false }
        return karaokePlayer.songQueue.indices.contains(index + offset)
    }

    private func formatTime(_ value: TimeInterval) -> String {
        guard value.isFinite else { return "00:00" }
        let total = max(0, Int(value.rounded()))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }

    private var recordingButtonTitle: String {
        switch recording.phase {
        case .countdown:
            "Cancel"
        case .recording:
            formatTime(monitor.recordingDuration)
        case .saving:
            "Saving"
        default:
            "Record"
        }
    }

    private var recordingButtonSymbol: String {
        switch recording.phase {
        case .countdown, .recording:
            "stop.fill"
        case .saving:
            "hourglass"
        default:
            "record.circle"
        }
    }
}

private struct CatalogTableTitleCell: View {
    let package: KaraokePackage
    let isPlaying: Bool

    var body: some View {
        HStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(isPlaying ? AppTheme.primary.opacity(0.2) : Color.white.opacity(0.06))
                Image(systemName: symbolName)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(AppTheme.primary)
            }
            .frame(width: 31, height: 31)

            VStack(alignment: .leading, spacing: 3) {
                Text(package.title)
                    .font(.vocal(11, weight: .semibold))
                    .foregroundStyle(AppTheme.text)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    SongFeatureTag(package.playback.videoURL == nil ? "AUDIO" : "MV")
                    if package.playback.backingURL != nil { SongFeatureTag("BACKING") }
                    if package.playback.lyricURL != nil { SongFeatureTag("LYRICS") }
                }
            }
        }
        .padding(.vertical, 3)
    }

    private var symbolName: String {
        if isPlaying {
            return "speaker.wave.2.fill"
        }
        return package.playback.videoURL == nil ? "waveform" : "play.rectangle.fill"
    }
}

private struct CatalogQueueButton: View {
    let isQueued: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isQueued ? "checkmark" : "plus")
                .font(.system(size: 10, weight: .bold))
                .frame(width: 26, height: 26)
        }
        .buttonStyle(.borderless)
        .foregroundStyle(isQueued ? AppTheme.primary : AppTheme.text)
        .disabled(isQueued)
        .help(isQueued ? "Already queued" : "Add to queue")
    }
}

private struct QueueTableActions: View {
    let canMoveUp: Bool
    let canMoveDown: Bool
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            tableButton("chevron.up", disabled: !canMoveUp, action: onMoveUp)
            tableButton("chevron.down", disabled: !canMoveDown, action: onMoveDown)
            tableButton("xmark", disabled: false, action: onRemove)
        }
    }

    private func tableButton(_ symbol: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .semibold))
                .frame(width: 22, height: 22)
        }
        .buttonStyle(.borderless)
        .foregroundStyle(AppTheme.mutedText)
        .disabled(disabled)
        .opacity(disabled ? 0.25 : 1)
    }
}

private struct SongFeatureTag: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: 7, weight: .semibold, design: .monospaced))
            .tracking(0.4)
            .foregroundStyle(AppTheme.mutedText)
    }
}

private struct RoomMixerPanel: View {
    @ObservedObject var karaokePlayer: KaraokePlayerService

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Personalize")
                    .font(.vocal(15, weight: .semibold))
                Text("Tune the live song mix.")
                    .font(.vocal(10, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            mixSlider("Master", value: Binding(
                get: { Double(karaokePlayer.playbackVolume) },
                set: { karaokePlayer.setPlaybackVolume(Float($0)) }
            ))
            mixSlider("Lead vocal", value: Binding(
                get: { Double(karaokePlayer.originalVocalVolume) },
                set: { karaokePlayer.setOriginalVocalVolume(Float($0)) }
            ))
            mixSlider("Backing", value: Binding(
                get: { Double(karaokePlayer.backingTrackVolume) },
                set: { karaokePlayer.setBackingTrackVolume(Float($0)) }
            ))
            .disabled(!karaokePlayer.hasBackingTrack)
            .opacity(karaokePlayer.hasBackingTrack ? 1 : 0.35)
            mixSlider("Tempo", value: Binding(
                get: { Double(karaokePlayer.playbackRate) },
                set: { karaokePlayer.setPlaybackRate(Float($0)) }
            ), range: 0.75...1.25, valueText: String(format: "%.0f%%", (karaokePlayer.playbackRate - 1) * 100))
        }
        .padding(18)
        .frame(width: 310)
    }

    private func mixSlider(
        _ title: String,
        value: Binding<Double>,
        range: ClosedRange<Double> = 0...1,
        valueText: String? = nil
    ) -> some View {
        VStack(spacing: 7) {
            HStack {
                Text(title).font(.vocal(11, weight: .semibold))
                Spacer()
                Text(valueText ?? "\(Int((value.wrappedValue * 100).rounded()))%")
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Slider(value: value, in: range)
                .tint(AppTheme.primary)
        }
    }
}

private struct NativeRecordingCountdown: View {
    let count: Int
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text("GET READY")
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .tracking(1.2)
                .foregroundStyle(Color.white.opacity(0.62))
            Text("\(count)")
                .font(.system(size: 72, weight: .medium, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white)
            Button("Cancel", action: onCancel)
                .buttonStyle(.plain)
                .font(.vocal(11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.72))
        }
        .padding(.horizontal, 34)
        .padding(.vertical, 24)
        .background(.ultraThinMaterial)
        .background(Color.black.opacity(0.44))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.white.opacity(0.14), lineWidth: 1)
        )
    }
}

private struct NativeRecordingStatus: View {
    let title: String

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color.red)
                .frame(width: 8, height: 8)
            Text(title)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .monospacedDigit()
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .frame(height: 32)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 1))
    }
}

private struct RoomIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(AppTheme.text)
            .background(Color.white.opacity(configuration.isPressed ? 0.12 : 0.065), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct RoomRecordingButtonStyle: ButtonStyle {
    let isRecording: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .monospacedDigit()
            .foregroundStyle(isRecording ? Color.white : AppTheme.text)
            .padding(.horizontal, 11)
            .frame(height: 30)
            .background(
                isRecording
                    ? Color.red.opacity(configuration.isPressed ? 0.56 : 0.34)
                    : Color.white.opacity(configuration.isPressed ? 0.12 : 0.065),
                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct RoomCompactButtonStyle: ButtonStyle {
    var isSelected = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.vocal(10, weight: .semibold))
            .foregroundStyle(isSelected ? Color.black.opacity(0.82) : AppTheme.text)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(isSelected ? AppTheme.primary : Color.white.opacity(configuration.isPressed ? 0.12 : 0.065), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct RoomPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.vocal(11, weight: .semibold))
            .foregroundStyle(Color.black.opacity(0.84))
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(AppTheme.primary.opacity(configuration.isPressed ? 0.78 : 1), in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct RoomPlayButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.black.opacity(0.84))
            .background(Color.white.opacity(configuration.isPressed ? 0.76 : 1), in: Circle())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
