import SwiftUI

struct LibraryView: View {
    @ObservedObject var library: KaraokeLibrary
    @ObservedObject var queue: KaraokeQueueStore
    let onImport: () -> Void
    let onRemoteStudio: () -> Void
    let onPlay: (MobileKaraokePackage) -> Void
    @State private var searchText = ""

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    if library.packages.isEmpty {
                        hero
                    } else {
                        compactHeader
                    }

                    if library.packages.isEmpty {
                        emptyState
                    } else {
                        packageList
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 36)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(AppTheme.background.opacity(0.92), for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VocalFlowLockup(badgeSize: 30, caption: "IPHONE KARAOKE")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: onImport) {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .bold))
                }
                .disabled(library.isImporting)
                .accessibilityLabel("导入歌曲包")
            }
        }
    }

    private var compactHeader: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack(spacing: 12) {
                VocalFlowBadge(size: 50)
                VStack(alignment: .leading, spacing: 4) {
                    Text("点歌台")
                        .font(.system(size: 25, weight: .bold, design: .rounded))
                        .foregroundStyle(AppTheme.text)
                    Text("本地曲库 · 候唱 \(queue.items.count) 首")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AppTheme.secondaryText)
                }
                Spacer()
                Button(action: onRemoteStudio) {
                    Image(systemName: "macmini.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 42, height: 42)
                        .background(AppTheme.elevatedSurface, in: Circle())
                }
                .buttonStyle(PressScaleButtonStyle())
                .accessibilityLabel("连接 Mac mini 制作")
            }

            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(AppTheme.secondaryText)
                TextField("搜索歌曲", text: $searchText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(AppTheme.secondaryText)
                }
            }
            .font(.system(size: 14, weight: .medium))
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(AppTheme.elevatedSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .padding(18)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 8) {
                VocalFlowMark()
                    .frame(width: 28, height: 16)
                Text("LOCAL KARAOKE")
                    .tracking(1.3)
            }
            .font(.system(size: 11, weight: .semibold, design: .monospaced))
            .foregroundStyle(AppTheme.primary)

            VStack(alignment: .leading, spacing: 7) {
                Text("把你的 K 歌房\n带进 iPhone")
                    .font(.system(size: 35, weight: .bold, design: .rounded))
                    .foregroundStyle(AppTheme.text)
                    .tracking(-1.1)

                Text("把链接交给家里的 Mac mini。它会生成 MV、逐词歌词、原唱与伴奏，再自动送回这台 iPhone。")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(AppTheme.secondaryText)
                    .lineSpacing(4)
            }

            Button(action: onRemoteStudio) {
                HStack(spacing: 9) {
                    Image(systemName: "macmini.fill")
                    Text("连接 Mac mini 制作")
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 13, weight: .bold))
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.82))
                .padding(.horizontal, 17)
                .frame(height: 52)
                .background(AppTheme.primary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(PressScaleButtonStyle())

            Button(action: onImport) {
                Label(library.isImporting ? "正在复制歌曲包…" : "或从“文件”导入现有歌曲包", systemImage: "folder.badge.plus")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(PressScaleButtonStyle())
            .disabled(library.isImporting)
        }
        .padding(22)
        .background(
            LinearGradient(
                colors: [AppTheme.surface, AppTheme.surface.opacity(0.7)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
        .overlay(alignment: .topTrailing) {
            VocalFlowMark()
                .frame(width: 188, height: 102)
                .opacity(0.075)
                .offset(x: 44, y: 24)
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private var emptyState: some View {
        VStack(spacing: 13) {
            VocalFlowBadge(size: 68)
            Text("还没有本地歌曲")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(AppTheme.text)
            Text("在 Mac 端勾选“保存 MV”，处理完成后把整个 VocalFlow 文件夹传到 iPhone。")
                .font(.system(size: 14))
                .foregroundStyle(AppTheme.secondaryText)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 42)
    }

    private var packageList: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("本地歌单")
                    .font(.system(size: 19, weight: .semibold, design: .rounded))
                    .foregroundStyle(AppTheme.text)
                Spacer()
                Text("\(filteredPackages.count) 首")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AppTheme.secondaryText)
            }

            ForEach(filteredPackages) { package in
                PackageRow(package: package, isQueued: queue.contains(package)) {
                    onPlay(package)
                } onQueue: {
                    queue.enqueue(package)
                }
                .contextMenu {
                    Button(role: .destructive) {
                        library.delete(package)
                    } label: {
                        Label("从 iPhone 删除", systemImage: "trash")
                    }
                }
            }
        }
    }

    private var filteredPackages: [MobileKaraokePackage] {
        guard !searchText.isEmpty else { return library.packages }
        return library.packages.filter { $0.title.localizedCaseInsensitiveContains(searchText) }
    }
}

private struct PackageRow: View {
    let package: MobileKaraokePackage
    let isQueued: Bool
    let onPlay: () -> Void
    let onQueue: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onPlay) {
                HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(AppTheme.elevatedSurface)
                    Image(systemName: package.hasVideo ? "play.rectangle.fill" : "waveform")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(AppTheme.primary)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 6) {
                    Text(package.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(AppTheme.text)
                        .lineLimit(1)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 6) {
                        PackageBadge(title: package.hasVideo ? "MV" : "音频", symbol: package.hasVideo ? "video.fill" : "waveform")
                        if package.hasBacking {
                            PackageBadge(title: "伴奏", symbol: "music.mic")
                        }
                        if package.lyricURL != nil {
                            PackageBadge(title: package.hasWordTiming ? "逐词" : "歌词", symbol: "captions.bubble.fill")
                        }
                    }
                }

                Spacer(minLength: 4)
                Image(systemName: "play.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(AppTheme.primary)
                    .frame(width: 28, height: 28)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressScaleButtonStyle())

            Button(action: onQueue) {
                Image(systemName: isQueued ? "checkmark" : "plus")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(isQueued ? Color.black.opacity(0.82) : AppTheme.text)
                    .frame(width: 36, height: 36)
                    .background(isQueued ? AppTheme.primary : AppTheme.elevatedSurface, in: Circle())
            }
            .buttonStyle(PressScaleButtonStyle())
            .disabled(isQueued)
            .accessibilityLabel(isQueued ? "已加入候唱" : "加入候唱")
        }
        .padding(10)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }
}

private struct PackageBadge: View {
    let title: String
    let symbol: String

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(AppTheme.secondaryText)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(Color.white.opacity(0.055), in: Capsule())
    }
}
