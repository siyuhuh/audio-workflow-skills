import SwiftUI

struct MixerSheet: View {
    @ObservedObject var playback: KaraokePlaybackController
    @ObservedObject var microphone: MicrophoneMonitor
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    presetControl

                    channelSlider(
                        title: "总音量",
                        detail: "歌曲的整体输出",
                        symbol: "speaker.wave.2.fill",
                        value: Binding(
                            get: { Double(playback.masterVolume) },
                            set: { playback.setMasterVolume(Float($0)) }
                        )
                    )

                    channelSlider(
                        title: playback.package?.primaryIsVocalStem == true ? "人声 Stem" : "原唱",
                        detail: "调低即可减少原唱人声",
                        symbol: "person.wave.2.fill",
                        value: Binding(
                            get: { Double(playback.originalVolume) },
                            set: { playback.setOriginalVolume(Float($0)) }
                        )
                    )
                    .disabled(!playback.canPlayOriginal)
                    .opacity(playback.canPlayOriginal ? 1 : 0.38)

                    channelSlider(
                        title: "伴奏",
                        detail: "Mac 分离出的 instrumental stem",
                        symbol: "music.mic",
                        value: Binding(
                            get: { Double(playback.backingVolume) },
                            set: { playback.setBackingVolume(Float($0)) }
                        )
                    )
                    .disabled(!playback.hasBackingTrack)
                    .opacity(playback.hasBackingTrack ? 1 : 0.38)

                    Divider().overlay(Color.white.opacity(0.12))

                    microphoneControl
                }
                .padding(20)
            }
            .background(AppTheme.background.opacity(0.72))
            .navigationTitle("调音台")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    private var presetControl: some View {
        HStack(spacing: 5) {
            ForEach(KaraokeAudioPreset.allCases) { preset in
                let selected = playback.preset == preset
                Button {
                    playback.setPreset(preset)
                } label: {
                    Label(preset.title, systemImage: preset.symbolName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(selected ? Color.black.opacity(0.82) : AppTheme.text)
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                        .background(selected ? AppTheme.primary : Color.clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(PressScaleButtonStyle())
                .disabled((preset == .backing && !playback.hasBackingTrack) || (preset == .original && !playback.canPlayOriginal))
            }
        }
        .padding(4)
        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
    }

    private var microphoneControl: some View {
        VStack(spacing: 14) {
            HStack(spacing: 13) {
                Button {
                    microphone.toggle()
                } label: {
                    Image(systemName: microphone.isMonitoring ? "mic.fill" : "mic.slash.fill")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(microphone.isMonitoring ? Color.black.opacity(0.82) : AppTheme.text)
                        .frame(width: 46, height: 46)
                        .background(microphone.isMonitoring ? AppTheme.primary : Color.white.opacity(0.08), in: Circle())
                }
                .buttonStyle(PressScaleButtonStyle())

                VStack(alignment: .leading, spacing: 4) {
                    Text("麦克风耳返")
                        .font(.system(size: 15, weight: .semibold))
                    Text(microphone.isMonitoring ? "已开启 · 建议使用耳机" : "关闭 · 点击后请求麦克风权限")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondaryText)
                }

                Spacer()

                LevelMeter(level: microphone.level)
                    .frame(width: 52, height: 6)
            }

            channelSlider(
                title: "耳返音量",
                detail: "只影响麦克风监听",
                symbol: "headphones",
                value: Binding(
                    get: { Double(microphone.volume) },
                    set: { microphone.setVolume(Float($0)) }
                )
            )
            .disabled(!microphone.isMonitoring)
            .opacity(microphone.isMonitoring ? 1 : 0.45)

            if let issue = microphone.issue {
                Label(issue, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func channelSlider(
        title: String,
        detail: String,
        symbol: String,
        value: Binding<Double>
    ) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.primary)
                    .frame(width: 28, height: 28)
                    .background(AppTheme.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 13, weight: .semibold))
                    Text(detail)
                        .font(.system(size: 10))
                        .foregroundStyle(AppTheme.secondaryText)
                }

                Spacer()
                Text("\(Int((value.wrappedValue * 100).rounded()))%")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AppTheme.secondaryText)
            }

            Slider(value: value, in: 0...1)
                .tint(AppTheme.primary)
        }
    }
}

private struct LevelMeter: View {
    let level: Float

    var body: some View {
        Capsule()
            .fill(Color.white.opacity(0.08))
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(AppTheme.primary)
                    .scaleEffect(x: CGFloat(max(0.02, level)), anchor: .leading)
            }
    }
}

struct QueueSheet: View {
    @ObservedObject var queue: KaraokeQueueStore
    let onSelect: (MobileKaraokePackage) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if queue.items.isEmpty {
                    ContentUnavailableView(
                        "候唱列表是空的",
                        systemImage: "music.note.list",
                        description: Text("回到点歌台，点歌曲右侧的 + 加入候唱。")
                    )
                } else {
                    List {
                        if let next = queue.nextPackage {
                            Section {
                                Label("下一首：\(next.title)", systemImage: "forward.end.fill")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(AppTheme.primary)
                            }
                        }

                        Section("候唱顺序") {
                            ForEach(Array(queue.items.enumerated()), id: \.element.id) { index, package in
                                Button {
                                    onSelect(package)
                                } label: {
                                    HStack(spacing: 12) {
                                        Text(String(format: "%02d", index + 1))
                                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                            .foregroundStyle(queue.currentPackageID == package.id ? AppTheme.primary : AppTheme.secondaryText)
                                            .frame(width: 25)
                                        Image(systemName: package.hasVideo ? "play.rectangle.fill" : "waveform")
                                            .foregroundStyle(AppTheme.primary)
                                            .frame(width: 24)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(package.title)
                                                .font(.system(size: 14, weight: .semibold))
                                                .foregroundStyle(AppTheme.text)
                                                .lineLimit(1)
                                            Text(packageSummary(package))
                                                .font(.system(size: 10))
                                                .foregroundStyle(AppTheme.secondaryText)
                                        }
                                        Spacer()
                                        if queue.currentPackageID == package.id {
                                            Image(systemName: "speaker.wave.2.fill")
                                                .foregroundStyle(AppTheme.primary)
                                        }
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .listRowBackground(AppTheme.surface.opacity(0.72))
                            }
                            .onDelete(perform: queue.remove)
                            .onMove(perform: queue.move)
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .background(AppTheme.background.opacity(0.78))
            .navigationTitle("候唱列表")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    EditButton()
                        .disabled(queue.items.isEmpty)
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("清空候唱", role: .destructive) {
                        queue.clear()
                    }
                    .disabled(queue.items.isEmpty)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    private func packageSummary(_ package: MobileKaraokePackage) -> String {
        var parts = [package.hasVideo ? "MV" : "音频"]
        if package.hasBacking { parts.append("伴奏") }
        if package.lyricURL != nil { parts.append("歌词") }
        return parts.joined(separator: " · ")
    }
}
