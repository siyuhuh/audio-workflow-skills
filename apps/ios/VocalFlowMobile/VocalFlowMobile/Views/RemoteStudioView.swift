import SwiftUI

struct RemoteStudioView: View {
    @ObservedObject var service: RemoteAgentService
    @ObservedObject var library: KaraokeLibrary
    let onPlay: (MobileKaraokePackage) -> Void

    @StateObject private var browser = BonjourAgentBrowser()
    @Environment(\.dismiss) private var dismiss
    @State private var pairingCode = ""
    @State private var source = ""
    @State private var title = ""
    @State private var options = RemoteJobOptions()
    @State private var isEditingEndpoint = false
    @State private var endpointDraft = ""

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    connectionCard
                    if service.isPaired {
                        createJobCard
                        jobList
                    } else {
                        pairingCard
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 10)
                .padding(.bottom, 36)
            }
        }
        .navigationTitle("Remote Studio")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(AppTheme.background.opacity(0.94), for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("完成") { dismiss() }
                    .foregroundStyle(AppTheme.primary)
            }
            ToolbarItem(placement: .principal) {
                VocalFlowLockup(badgeSize: 28, caption: "MAC MINI STUDIO")
            }
        }
        .task {
            browser.start()
            await service.pollJobs()
        }
        .onDisappear { browser.stop() }
        .alert("VocalFlow", isPresented: messageBinding) {
            Button("好", role: .cancel) { service.message = nil }
        } message: {
            Text(service.message ?? "")
        }
        .alert("更换 Mac 地址", isPresented: $isEditingEndpoint) {
            TextField("https://your-mac.tailnet.ts.net", text: $endpointDraft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("取消", role: .cancel) {}
            Button("连接") {
                service.switchEndpoint(to: endpointDraft)
            }
            .disabled(endpointDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: {
            Text("局域网可使用自动发现的 Mac；车载网络可填写同一 Tailscale 网络中的 HTTPS 地址。")
        }
    }

    private var connectionCard: some View {
        HStack(spacing: 14) {
            VocalFlowBadge(size: 54)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Circle()
                        .fill(service.isConnected ? AppTheme.primary : AppTheme.secondaryText)
                        .frame(width: 7, height: 7)
                    Text(service.isConnected ? "MAC MINI ONLINE" : service.isPaired ? "WAITING FOR MAC" : "PRIVATE REMOTE")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .tracking(1.1)
                        .foregroundStyle(service.isConnected ? AppTheme.primary : AppTheme.secondaryText)
                }
                Text(service.isPaired ? service.pairedName : "Mac 负责重活，iPhone 负责点歌")
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(AppTheme.text)
                Text(service.baseURLText)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(AppTheme.secondaryText)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if service.isPaired {
                Menu {
                    if !browser.agents.isEmpty {
                        Section("局域网中的 Mac") {
                            ForEach(browser.agents) { agent in
                                Button {
                                    service.switchEndpoint(to: agent.baseURL)
                                } label: {
                                    Label(agent.name, systemImage: "wifi")
                                }
                            }
                        }
                    }
                    Button {
                        endpointDraft = service.baseURLText
                        isEditingEndpoint = true
                    } label: {
                        Label("更换连接地址", systemImage: "network")
                    }
                    Divider()
                    Button("解除配对", role: .destructive) { service.disconnect() }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(AppTheme.secondaryText)
                        .frame(width: 30, height: 30)
                }
            }
        }
        .padding(17)
        .remoteCardStyle()
    }

    private var pairingCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            RemoteSectionLabel(symbol: "link.badge.plus", title: "连接你的 Mac mini")

            if !browser.agents.isEmpty {
                VStack(spacing: 8) {
                    ForEach(browser.agents) { agent in
                        Button {
                            service.useDiscoveredAgent(agent)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "macmini.fill")
                                    .foregroundStyle(AppTheme.primary)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(agent.name)
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(AppTheme.text)
                                    Text(agent.baseURL)
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundStyle(AppTheme.secondaryText)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(AppTheme.secondaryText)
                            }
                            .padding(13)
                            .background(AppTheme.elevatedSurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                        }
                        .buttonStyle(PressScaleButtonStyle())
                    }
                }
            } else if browser.isSearching {
                Label("正在局域网寻找 VocalFlow…", systemImage: "dot.radiowaves.left.and.right")
                    .font(.system(size: 12))
                    .foregroundStyle(AppTheme.secondaryText)
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("MAC 地址")
                    .remoteFieldLabel()
                TextField("https://mini-name.tailnet.ts.net", text: $service.baseURLText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .remoteTextField()
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("六位配对码")
                    .remoteFieldLabel()
                TextField("000000", text: $pairingCode)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .remoteTextField()
                    .onChange(of: pairingCode) { _, value in
                        pairingCode = String(value.filter(\.isNumber).prefix(6))
                    }
            }

            Button {
                Task { await service.pair(code: pairingCode) }
            } label: {
                HStack {
                    if service.isPairing { ProgressView().tint(Color.black.opacity(0.8)) }
                    Text(service.isPairing ? "正在建立私密连接…" : "与 Mac mini 配对")
                    Spacer()
                    Image(systemName: "lock.shield.fill")
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.82))
                .padding(.horizontal, 17)
                .frame(height: 52)
                .background(AppTheme.primary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(PressScaleButtonStyle())
            .disabled(pairingCode.count != 6 || service.isPairing)

            Text("同一 Wi-Fi 会自动发现；在车上使用时，iPhone 登录同一个 Tailscale，再使用上面的 HTTPS 地址。")
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.secondaryText)
                .lineSpacing(3)
        }
        .padding(18)
        .remoteCardStyle()
    }

    private var createJobCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            RemoteSectionLabel(symbol: "sparkles.rectangle.stack.fill", title: "制作一首 K 歌")

            VStack(alignment: .leading, spacing: 7) {
                Text("视频链接或 BILIBILI BV 号")
                    .remoteFieldLabel()
                TextField("YouTube / Bilibili / 直链", text: $source, axis: .vertical)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .lineLimit(2...4)
                    .remoteTextField()
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("歌曲名（可选）")
                    .remoteFieldLabel()
                TextField("显示在本地歌单中的名字", text: $title)
                    .remoteTextField()
            }

            VStack(spacing: 0) {
                RemoteToggleRow(
                    title: "生成伴奏与原唱",
                    detail: "在 Mac 上分离双轨",
                    symbol: "slider.horizontal.3",
                    isOn: $options.separateVocals
                )
                Divider().overlay(AppTheme.border)
                RemoteToggleRow(
                    title: "下载 MV 预览",
                    detail: "用于沉浸式全屏 K 歌",
                    symbol: "play.rectangle.fill",
                    isOn: $options.saveVideoPreview
                )
                Divider().overlay(AppTheme.border)
                RemoteToggleRow(
                    title: "歌词转简体中文",
                    detail: "适合繁体字幕来源",
                    symbol: "character.book.closed.fill.zh",
                    isOn: $options.simplifiedChinese
                )
            }
            .background(AppTheme.elevatedSurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            HStack {
                Text("转写质量")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.secondaryText)
                Spacer()
                Picker("转写质量", selection: $options.model) {
                    Text("快速").tag("small")
                    Text("平衡").tag("medium")
                    Text("高质量").tag("large-v3-turbo")
                }
                .labelsHidden()
                .tint(AppTheme.primary)
            }

            Button {
                Task {
                    if await service.submit(source: source, title: title, options: options) {
                        source = ""
                        title = ""
                    }
                }
            } label: {
                HStack {
                    if service.isSubmitting { ProgressView().tint(Color.black.opacity(0.8)) }
                    Text(service.isSubmitting ? "正在送到 Mac mini…" : "开始制作")
                    Spacer()
                    Image(systemName: "arrow.up.forward.app.fill")
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.82))
                .padding(.horizontal, 17)
                .frame(height: 52)
                .background(AppTheme.primary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(PressScaleButtonStyle())
            .disabled(source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || service.isSubmitting)
        }
        .padding(18)
        .remoteCardStyle()
    }

    private var jobList: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("制作队列")
                    .font(.system(size: 19, weight: .semibold, design: .rounded))
                    .foregroundStyle(AppTheme.text)
                Spacer()
                Text("\(service.jobs.count) 个任务")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(AppTheme.secondaryText)
            }

            if service.jobs.isEmpty {
                Text("从上面提交第一首歌，处理可以在后台继续。")
                    .font(.system(size: 13))
                    .foregroundStyle(AppTheme.secondaryText)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 26)
                    .remoteCardStyle()
            } else {
                ForEach(service.jobs) { job in
                    RemoteJobCard(
                        job: job,
                        isDownloading: service.downloadingJobID == job.id,
                        downloadProgress: service.downloadingJobID == job.id ? service.downloadProgress : 0,
                        onCancel: { Task { await service.cancel(job) } },
                        onDelete: { Task { await service.delete(job) } },
                        onDownload: {
                            Task {
                                if let package = await service.downloadAndImport(job, into: library) {
                                    onPlay(package)
                                }
                            }
                        }
                    )
                }
            }
        }
    }

    private var messageBinding: Binding<Bool> {
        Binding(
            get: { service.message != nil },
            set: { if !$0 { service.message = nil } }
        )
    }
}

private struct RemoteJobCard: View {
    let job: RemoteJob
    let isDownloading: Bool
    let downloadProgress: Double
    let onCancel: () -> Void
    let onDelete: () -> Void
    let onDownload: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: statusSymbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(statusColor)
                    .frame(width: 36, height: 36)
                    .background(statusColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 11, style: .continuous))

                VStack(alignment: .leading, spacing: 5) {
                    Text(job.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.text)
                        .lineLimit(2)
                    Text(statusTitle)
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .tracking(0.9)
                        .foregroundStyle(statusColor)
                }
                Spacer()
                if job.isActive {
                    Button("取消", action: onCancel)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(AppTheme.secondaryText)
                } else {
                    Menu {
                        Button("清除远端记录", role: .destructive, action: onDelete)
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(AppTheme.secondaryText)
                            .frame(width: 28, height: 28)
                    }
                }
            }

            if job.isActive || isDownloading {
                VStack(alignment: .leading, spacing: 7) {
                    ProgressView(value: isDownloading ? downloadProgress : job.overallProgress)
                        .tint(AppTheme.primary)
                    HStack {
                        Text(isDownloading ? "正在下载歌曲包" : job.message)
                            .lineLimit(2)
                        Spacer()
                        Text("\(Int((isDownloading ? downloadProgress : job.overallProgress) * 100))%")
                    }
                    .font(.system(size: 11))
                    .foregroundStyle(AppTheme.secondaryText)
                }
            } else {
                Text(job.message)
                    .font(.system(size: 12))
                    .foregroundStyle(job.isFailed ? AppTheme.warm : AppTheme.secondaryText)
                    .lineLimit(3)
            }

            if job.isComplete {
                Button(action: onDownload) {
                    HStack {
                        Image(systemName: "arrow.down.circle.fill")
                        Text(isDownloading ? "正在下载…" : "下载并开始 K 歌")
                        Spacer()
                        Text(ByteCountFormatter.string(fromByteCount: job.downloadableSize, countStyle: .file))
                            .font(.system(size: 10, design: .monospaced))
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.black.opacity(0.82))
                    .padding(.horizontal, 14)
                    .frame(height: 44)
                    .background(AppTheme.primary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(PressScaleButtonStyle())
                .disabled(isDownloading)
            }
        }
        .padding(16)
        .remoteCardStyle()
    }

    private var statusTitle: String {
        if isDownloading { return "DOWNLOADING" }
        switch job.status {
        case "queued": return "QUEUED ON MAC"
        case "running": return job.stage.uppercased()
        case "complete": return "READY ON MAC"
        case "cancelled": return "CANCELLED"
        default: return "NEEDS ATTENTION"
        }
    }

    private var statusSymbol: String {
        if isDownloading { return "arrow.down" }
        switch job.status {
        case "queued": return "clock.fill"
        case "running": return "waveform"
        case "complete": return "checkmark"
        case "cancelled": return "xmark"
        default: return "exclamationmark"
        }
    }

    private var statusColor: Color {
        job.isFailed ? AppTheme.warm : AppTheme.primary
    }
}

private struct RemoteToggleRow: View {
    let title: String
    let detail: String
    let symbol: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(AppTheme.primary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.text)
                Text(detail)
                    .font(.system(size: 10))
                    .foregroundStyle(AppTheme.secondaryText)
            }
            Spacer()
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(AppTheme.primary)
        }
        .padding(.horizontal, 13)
        .frame(minHeight: 58)
    }
}

private struct RemoteSectionLabel: View {
    let symbol: String
    let title: String

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(AppTheme.text)
    }
}

private extension View {
    func remoteCardStyle() -> some View {
        background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
    }

    func remoteFieldLabel() -> some View {
        font(.system(size: 10, weight: .semibold, design: .monospaced))
            .tracking(0.8)
            .foregroundStyle(AppTheme.secondaryText)
    }

    func remoteTextField() -> some View {
        font(.system(size: 14))
            .foregroundStyle(AppTheme.text)
            .padding(.horizontal, 13)
            .frame(minHeight: 46)
            .background(AppTheme.elevatedSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
    }
}
