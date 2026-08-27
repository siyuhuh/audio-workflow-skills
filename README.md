# VocalFlow

中文 | [English](README.en.md)

VocalFlow 可以把 YouTube、哔哩哔哩、本地音视频或已有的人声干音，制作成可携带的 K 歌包：MV、原唱、伴奏、人声和逐字歌词。制作完成的歌曲包可以在原生 Mac 客户端或跨平台 VocalFlow Studio 中播放。

## 下载

当前测试版：[VocalFlow v0.8.0-beta.5](https://github.com/siyuhuh/audio-workflow-skills/releases/tag/v0.8.0-beta.5)

| 下载文件 | 适用设备 | 用途 | 大小 |
| --- | --- | --- | ---: |
| `VocalFlow-0.8.0-beta.5-mac-arm64.dmg` | Apple Silicon Mac（M1/M2/M3/M4 等） | 推荐的原生 Mac K 歌客户端，包含 Room、录音和 Mac mini Agent | 约 995 MB |
| `VocalFlow.Studio-0.8.0-beta.5-mac-arm64.dmg` | Apple Silicon Mac（M1/M2/M3/M4 等） | 跨平台制作、检查和播放工作台 | 约 920 MB |
| `VocalFlow.Studio-0.8.0-beta.5-win-x64.exe` | 64 位 Windows | 跨平台制作、检查和播放工作台 | 约 874 MB |

目前没有 Intel Mac 安装包。iPhone 版本仍处于 TestFlight / Xcode 测试流程，本次 GitHub Release 不包含 iPhone 安装包。

## 下载后能直接用吗？

可以。桌面安装包已经包含默认工作流所需的 Python 运行时、处理依赖、`ffmpeg`、`yt-dlp`、Whisper 小模型和 UVR 人声分离模型，不需要用户先安装 Python、Homebrew 或另外配置模型。

1. 下载与设备匹配的安装包。
2. macOS 打开 DMG，把应用拖进“应用程序”；Windows 运行 EXE 完成安装。
3. 打开应用，导入本地文件或粘贴媒体链接即可开始制作。

这是未签名、未公证的测试版。首次打开时系统可能会拦截：

- macOS：在 Finder 中右键应用并选择“打开”；也可前往“系统设置 → 隐私与安全性”选择“仍要打开”。如果系统提示应用“已损坏”，确认文件来自本仓库 Release 后，可在终端执行：

  ```bash
  xattr -dr com.apple.quarantine "/Applications/VocalFlow.app"
  # VocalFlow Studio 使用：
  xattr -dr com.apple.quarantine "/Applications/VocalFlow Studio.app"
  ```

- Windows：SmartScreen 出现时选择“更多信息 → 仍要运行”。

## 模型、联网和磁盘空间

默认桌面流程不需要再次下载模型。beta.5 增加了安装包内部校验：缺少任一默认模型时，发布流程会直接失败。安装包内置：

| 内置内容 | 用途 | 约占空间 |
| --- | --- | ---: |
| `faster-whisper-small` | 本地歌词识别与时间轴 | 约 464–486 MB |
| `UVR-MDX-NET-Inst_HQ_3.onnx` | 默认人声 / 伴奏分离 | 约 64 MB |
| 模型合计 | 已包含在安装包中 | 约 527 MB |

在 Studio 的“高级”设置中改用更大的 Whisper 模型时，第一次使用会从 Hugging Face 下载并缓存在本机：

| 可选 Whisper 模型 | 首次下载约需 | 说明 |
| --- | ---: | --- |
| `small` | 已内置 | 默认选择，速度与质量较均衡 |
| `medium` | 约 1.53 GB | 更慢，部分复杂歌词可能更准确 |
| `large-v3-turbo` | 约 1.62 GB | 较大的快速模型 |
| `large-v3` | 约 3.09 GB | 体积和资源占用最高 |

下载体积会随上游模型文件更新略有变化。自定义人声分离模型也需要用户自行提供，常见体积为几十到数百 MB。歌曲演唱内容与普通语音不同，干净的人声分离通常比盲目选择最大的 Whisper 模型更能改善歌词效果。

- 本地文件处理、已导入歌曲包的播放和录音可以离线完成。
- YouTube / 哔哩哔哩链接下载、在线搜索、可选模型首次下载需要网络。
- 建议至少预留 5 GB 可用空间；如果使用 `large-v3` 或保留很多 MV / 中间文件，建议预留 10 GB 以上。
- 每首歌的输出通常会再占用几十到数百 MB，高清视频可能更大。

## 语言

- 本 README 以中文为默认语言，完整英文版见 [README.en.md](README.en.md)。Release 说明同样采用中文在前、英文在后的双语格式。
- VocalFlow Studio 首次启动会跟随系统语言：中文系统默认中文，其他系统默认英文；之后可在设置中随时切换中文 / English。
- 原生 Mac 客户端目前仍以英文界面为主，后续会继续补齐中文本地化。

## K 歌 Room 与录音

两个桌面 Room 都支持 MV 播放、自适应画面比例、前一句 / 当前 / 后一句歌词、逐字高亮、队列、原唱 / 伴奏切换和沉浸舞台。

原生 Mac 与 Studio 都可以录制演唱：

- 三秒倒计时。
- 麦克风原始人声保存为 WAV。
- 自动导出带伴奏的分享版混音（原生 Mac 为 M4A；Studio 支持 M4A、MP3 或 WAV）。
- 录音元数据会关联回歌曲包。
- 默认输出到 `~/Music/VocalFlow/Recordings`。

录音期间会锁定进度跳转、音源切换和队列切换，避免导出的混音错位。建议佩戴耳机，防止伴奏串入麦克风或产生啸叫。

## 私有 Mac mini + iPhone 流程

1. 在 Mac mini 上安装 VocalFlow，打开 **Remote**。
2. 点击 **Install Agent**。
3. iPhone 使用六位配对码，通过同一 Wi-Fi 下的 Bonjour 或私有 Tailscale 地址连接。
4. 从 iPhone 提交 YouTube / 哔哩哔哩链接。
5. Mac 在后台制作歌曲包，手机可以锁屏或暂时断开。
6. 完成后下载到 iPhone，之后可离线播放。

Agent 每次处理一个任务，重启后会继续保留任务状态。歌曲包默认存放在 `~/Movies/VocalFlow/Remote`。iPhone 本身不包含 Whisper、PyTorch 或分离模型，也不依赖公共云服务器。

## 命令行

如果需要自动化或自定义模型，也可以安装 CLI：

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

原生 macOS：

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

更多发布与签名说明见 [RELEASING.md](RELEASING.md)。

## 注意事项

- 只下载或处理你有权使用的媒体内容。
- 浏览器 Cookie 属于登录凭据，请勿提交到仓库或分享给他人。
- 驾驶时请勿操作应用；出发前准备好队列，或交由乘客控制。

## 许可证

代码使用 `AGPL-3.0-or-later` 许可证。VocalFlow 的名称、Logo、图标和产品标识不包含在代码许可证中。

更多：[原生 Mac](apps/mac/VocalFlowMini/README.md) · [iPhone](apps/ios/VocalFlowMobile/README.md) · [Electron](apps/desktop/README.md) · [Agent](apps/mac/VocalFlowAgent/README.md)
