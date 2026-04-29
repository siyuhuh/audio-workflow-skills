# VocalFlow Studio

中文 | [English](README.md)

VocalFlow Studio 是一个面向唱歌练习、视频字幕和人声分离的桌面工具和 CLI 工具集。它可以处理 YouTube、Bilibili 等 `yt-dlp` 支持的网站链接，也可以处理本地音频、视频和 UVR 人声 stem。

## 下载

最新版本：[v0.1.3](https://github.com/gottaegbert/audio-workflow-skills/releases/tag/v0.1.3)

- [下载 macOS Apple Silicon 版 (.dmg)](https://github.com/gottaegbert/audio-workflow-skills/releases/download/v0.1.3/VocalFlow.Studio-0.1.3-mac-arm64.dmg)
- [下载 Windows x64 版 (.exe)](https://github.com/gottaegbert/audio-workflow-skills/releases/download/v0.1.3/VocalFlow.Studio-0.1.3-win-x64.exe)

桌面 app 已内置 `audio-subtitles` 脚本、Python runtime 和 ffmpeg。首次使用时，它会在用户的 app data 目录创建本地 runtime，并按需安装 URL 下载、本地识别和可选人声分离需要的 Python packages。首次运行需要联网。

## 使用场景

### 1. 卡拉 OK / 练歌素材包

适合：复制 YouTube、Bilibili 或其他媒体网站链接，生成一套练歌素材。

```bash
audio-subtitles --separate --separator-format MP3 "https://www.bilibili.com/video/BV..."
audio-subtitles --separate --separator-format MP3 "https://www.youtube.com/watch?v=..."
```

输出通常包括：

- `stems/` 里的人声 stem。
- `stems/` 里的伴奏 / no-vocals stem。
- `.lrc` 同步歌词。
- `.srt` / `.vtt` 视频字幕。
- `.txt` / `.json` 方便检查和后续处理。

说明：

- `--separate` 会先做人声/伴奏分离，再转写人声。
- `--separator-format MP3` 会让分离出来的 stem 保存为 MP3；默认是 WAV。
- YouTube 通常会优先使用平台字幕或自动字幕。
- Bilibili 如果没有可用的平台字幕，`auto` 模式会默认下载音频并用本地 Whisper 识别。

### 2. 视频字幕提取

适合：给剪映、Premiere、DaVinci Resolve、Final Cut 或网页播放器准备字幕。

本地视频：

```bash
audio-subtitles "/path/to/video.mp4"
```

网站视频：

```bash
audio-subtitles "https://www.bilibili.com/video/BV..."
audio-subtitles "https://www.youtube.com/watch?v=..."
```

默认策略：

- 如果 `yt-dlp` 能读到平台字幕，先下载并转换字幕。
- 如果是 Bilibili 且没有平台字幕，默认 fallback 到本地 Whisper。
- 其他网站如果没有平台字幕，可以显式加 `--local-fallback`。

```bash
audio-subtitles --local-fallback "https://example.com/video"
```

### 3. 已有人声 stem / UVR 输出

适合：你已经用 Ultimate Vocal Remover GUI 或其他工具分离好人声。

```bash
audio-subtitles "/path/to/uvr-output-folder"
audio-subtitles "/path/to/vocals.wav"
```

工具会优先选择文件名包含 `vocals`、`vocal`、`voice`、`acapella` 的音频来生成歌词和字幕。

### 4. 只下载 MP3

`media-mp3` 可以下载 `yt-dlp` 支持的网站音频，例如 YouTube 或 Bilibili。

```bash
media-mp3 "https://www.bilibili.com/video/BV..."
media-mp3 "https://www.youtube.com/watch?v=..."
```

旧命令 `youtube-mp3` 仍然保留，作为兼容别名。

## CLI 安装

```bash
git clone https://github.com/gottaegbert/audio-workflow-skills.git
cd audio-workflow-skills
./install.sh
```

安装运行依赖：

```bash
# macOS
HOMEBREW_NO_AUTO_UPDATE=1 brew install ffmpeg yt-dlp

# 本地字幕/歌词识别
setup-audio-subtitles

# 可选：人声/伴奏分离
setup-audio-separator
```

`setup-audio-separator` 会安装 PyTorch 和 source separation 相关依赖，体积比转写依赖大。只在需要 `audio-subtitles --separate` 时安装。

## 桌面 App

在仓库根目录（pnpm workspace）执行：

```bash
./install.sh
pnpm install
pnpm dev
```

也可以先 `cd apps/desktop` 再执行同样的 `pnpm` 命令。

桌面 app 已内置 `audio-subtitles` 脚本、Python 和 ffmpeg。它会在首次使用时自动安装 Python packages，不需要普通用户手动运行 CLI setup 命令。它支持：

- 粘贴 YouTube / Bilibili URL。
- 选择本地音频、视频或 UVR 输出文件夹。
- 平台字幕优先、本地 Whisper、Bilibili 默认本地识别 fallback。
- 可选人声/伴奏分离。
- 输出目录、模型、语言、cookies、输出格式配置。
- 命令预览、日志、打开输出文件。

## 常用参数

选择字幕语言：

```bash
audio-subtitles --sub-langs "zh.*,en.*" "https://www.bilibili.com/video/BV..."
audio-subtitles --language zh "/path/to/video.mp4"
```

强制本地识别：

```bash
audio-subtitles --subtitle-source local "https://www.bilibili.com/video/BV..."
audio-subtitles --force-local "https://www.youtube.com/watch?v=..."
```

只用平台字幕，不做本地 fallback：

```bash
audio-subtitles --subtitle-source platform "https://www.youtube.com/watch?v=..."
```

保存到指定目录：

```bash
audio-subtitles --output-dir "/path/to/output" "/path/to/video.mp4"
```

需要登录态时使用浏览器 cookies：

```bash
audio-subtitles --browser chrome "https://www.bilibili.com/video/BV..."
media-mp3 --browser chrome "https://www.bilibili.com/video/BV..."
```

## 发布 DMG / EXE

维护者推送版本 tag 后，GitHub Actions 会自动构建桌面安装包并上传到 GitHub Release：

```bash
git tag v0.1.3
git push origin v0.1.3
```

Release 产物：

- macOS: `.dmg`
- Windows: `.exe`

注意：桌面 app 已内置 `audio-subtitles` 脚本、Python runtime 和 ffmpeg。首次使用时会把 `yt-dlp`、`faster-whisper` 和可选的 `audio-separator[cpu]` 安装到本地 app runtime。

## 输出文件

- `.lrc`：同步歌词。
- `.srt`：视频剪辑和字幕工具。
- `.vtt`：网页播放。
- `.txt`：带时间戳的文本检查。
- `.json`：机器可读的分段时间数据。
- `stems/`：启用 `--separate` 后的人声和伴奏文件。

## 注意事项

- 歌曲转写比普通讲话更难，副歌、和声、混响、重叠人声都可能需要人工修正。
- 干净的人声 stem 通常比单纯换更大的模型更能提升歌词准确度。
- 只处理你有权下载或处理的媒体。
- 浏览器 cookies 等同于登录凭据，不要提交到仓库或分享给别人。

## 协议

代码从当前版本开始使用 `AGPL-3.0-or-later`。之前已经按 MIT 发布的版本不受这个变更影响，别人仍可按当时的 MIT 条款使用那些版本。

`VocalFlow` 和 `VocalFlow Studio` 名称、Logo、图标、产品标识和发布素材不随代码协议授权。商业授权、闭源分发、白标版本或企业使用可以单独联系项目所有者。

## 更多

- 工作流说明：[docs/flow.md](docs/flow.md)
- 桌面 app 产品说明：[docs/desktop-app-prd.md](docs/desktop-app-prd.md)
- 上游工具：[yt-dlp](https://github.com/yt-dlp/yt-dlp)、[faster-whisper](https://github.com/SYSTRAN/faster-whisper)、[audio-separator](https://pypi.org/project/audio-separator/)、[Ultimate Vocal Remover GUI](https://github.com/Anjok07/ultimatevocalremovergui)
