# VocalFlow

[English](README.md) | 中文

VocalFlow 可以把 YouTube、Bilibili、本地视频/音频或已有的人声 stem 制作成可携带的 K 歌包：MV、原唱、伴奏、人声和逐词同步歌词。同一首歌可以在 Mac 原生 Room、Electron Studio 和 iPhone 客户端中播放。

## 下载

当前测试版：[v0.8.0-beta.4 Releases](https://github.com/siyuhuh/audio-workflow-skills/releases/tag/v0.8.0-beta.4)

| 客户端 | 适合什么场景 | 交付方式 |
| --- | --- | --- |
| **VocalFlow for Mac** | 推荐的 Apple Silicon 客户端：原生 Room、沉浸式全屏、录音、Mac mini Agent | 一个 `.dmg` |
| **VocalFlow Studio** | Electron 跨平台制作/检查流程和 Room | macOS `.dmg`、Windows `.exe` |
| **VocalFlow for iPhone** | 车上或离开 Mac 后离线播放；本地导入、从私有 Agent 下载 | TestFlight 工作流 / Xcode 测试版 |
| **VocalFlow Agent** | 用自己的 Mac mini 给 iPhone 私有处理歌曲 | 已内置在原生 Mac App |

如果没有配置 Apple 发布证书，beta 工作流会先生成 ad-hoc/未签名的测试安装包。要让公开下载的 macOS App 不出现 Gatekeeper 警告，还需要 Developer ID Application 证书和 notarization；TestFlight 需要 Apple Distribution 与 App Store Connect 配置。

## 用户还要另外下载模型吗？

默认桌面流程不需要额外安装。Release 安装包会内置：

- 独立 Python 3.12 和需要的 Python packages。
- `ffmpeg`、`yt-dlp`。
- 用于本地歌词识别的 `faster-whisper-small`。
- 用于人声/伴奏分离的 `UVR-MDX-NET-Inst_HQ_3.onnx`。
- `audio-subtitles` 处理脚本。

桌面 App 会直接读取安装包内的默认 Whisper 模型，并在需要时把小型分离模型写入应用数据目录；两者都不会再次联网下载。安装 Mac mini Agent 时会把内置默认模型复制到 Agent 的应用数据目录。更大的 Whisper 或 separator 模型仍是可选下载。处理网站链接当然仍需联网获取原始视频/音频。

iPhone 不会打包 Whisper、PyTorch 或分离模型。它可以：

- 把已经下载/导入的 K 歌包完全离线播放。
- 从“文件”、AirDrop、iCloud Drive 或 Finder 导入。
- 让自己的 Mac mini Agent 处理链接，再把结果下载到手机。

因此不必使用公共云服务器。

## K 歌 Room

两个桌面 Room 都支持 MV、自适应比例、上一句/当前句/下一句、逐词扫色歌词、播放队列、原唱/伴奏切换以及沉浸式舞台。

Mac 原生版和 Electron 都已经支持演唱录音：

- 3 秒倒数。
- 麦克风原始人声保存为 WAV。
- 输出可分享的音乐 + 人声混音（原生 Mac 为 `M4A`；Studio 可选 `M4A`、`MP3`、`WAV`）。
- 录音 metadata 会关联回歌曲包。
- 文件保存在 `~/Music/VocalFlow/Recordings`。

录音时会锁定拖动进度、切换音源和换歌，防止导出的混音与人声错位。

## Mac mini + iPhone 私有流程

1. 在 Mac mini 安装 VocalFlow，打开 **Remote**。
2. 点击 **Install Agent**。
3. iPhone 使用六位配对码连接：同一 Wi-Fi 走 Bonjour，外出可走私有 Tailscale URL。
4. 在 iPhone 提交 YouTube/Bilibili 链接。
5. Mac 在后台制作，手机可以锁屏或暂时断开。
6. 完成后下载到 iPhone，之后可离线唱歌。

Agent 一次只跑一个重任务，重启后队列仍会保留。结果位于 `~/Movies/VocalFlow/Remote`。

## CLI

需要自动化或自定义大模型时仍可使用 CLI：

```bash
git clone https://github.com/siyuhuh/audio-workflow-skills.git
cd audio-workflow-skills
./install.sh
```

示例：

```bash
audio-subtitles --separate --separator-format MP3 "https://www.bilibili.com/video/BV..."
audio-subtitles --separate --separator-format MP3 "https://www.youtube.com/watch?v=..."
audio-subtitles --subtitle-source local "/path/to/video.mp4"
media-mp3 "https://www.youtube.com/watch?v=..."
```

常见输出包括 `stems/`、`.lrc`、`.json`、`.srt`、`.vtt` 和 `.ass`。

## 开发

Electron：

```bash
pnpm install
pnpm dev
```

Mac 原生：

```bash
cd apps/mac/VocalFlowMini
swift run VocalFlow
```

iPhone：

```bash
cd apps/ios/VocalFlowMobile
xcodegen generate
open VocalFlowMobile.xcodeproj
```

构建本地原生 DMG：

```bash
apps/mac/VocalFlowMini/scripts/build-dmg.sh release
```

发布维护者在打包前准备独立运行时和模型：

```bash
cd apps/desktop
./scripts/prepare-bundled-runtime.sh
./scripts/fetch-bundled-models.sh
```

推送 `v*` tag 会同时构建原生 Mac DMG 和 Electron macOS/Windows 安装包。手动 `iOS TestFlight` 工作流需要的 Apple secrets 记录在 [RELEASING.md](RELEASING.md)。

## K 歌包兼容

- Electron 写入 `manifest.json`。
- Mac 原生写入 `vocalflow-package.json`。
- Mac 原生与 iPhone 都会识别两种清单，老文件夹或松散素材则安全回退到媒体扫描。
- 录音统一使用 `recording.json` 数据结构。

## 下一版优先级

1. 配好 Developer ID 签名、notarization 和首次安装引导，让公开 DMG 不再需要绕过 Gatekeeper。
2. 配置 App Store Connect secrets，用现有 TestFlight 工作流在真机 iPhone 上发布测试版。
3. 增加签名自动更新，并为可选大模型提供断点续传和清晰的磁盘占用提示。
4. 做一次由乘客操作的车内可用性测试：离线包下载、提前排队、音频路由、来电/断网恢复和大触控目标。

## 注意

- 歌曲比普通语音更难识别；干净的人声 stem 往往比更大的模型更能改善歌词。
- 麦克风监听请使用耳机，避免啸叫。
- 只处理你有权下载或使用的媒体。
- 浏览器 cookies 等同于登录凭据，不要提交或分享。
- 驾驶员不要在行车中操作 App。请提前准备队列，或交给乘客控制。

## 协议

代码使用 `AGPL-3.0-or-later`。VocalFlow 名称、Logo、图标和产品标识不包含在代码协议授权中。

更多：[Mac 原生](apps/mac/VocalFlowMini/README.md) · [iPhone](apps/ios/VocalFlowMobile/README.md) · [Electron](apps/desktop/README.md) · [Agent](apps/mac/VocalFlowAgent/README.md)
