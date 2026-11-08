# VocalFlow Studio beta.6 — local test build

## 中文

此版本先用于全新电脑测试，尚未作为正式版本发布。

- 适用：Apple Silicon Mac（M1/M2/M3/M4 等），不是 Intel 安装包。
- 内置 Python、FFmpeg、下载器、分离器、默认分离模型和 Whisper small。
- 修复下载器与分离器携带构建机器绝对路径的问题。
- 补齐 `audioread` 和分离模型所需的三个 JSON 配置文件。
- 默认模型处理本地文件无需 HF token。搜索、下载在线视频仍然需要联网，并受平台访问规则限制。选择其他模型可能需要额外下载。
- 测试包只有 ad-hoc 签名，尚未获得 Apple Developer ID 签名及公证。首次启动可能需要在系统“隐私与安全性”中允许打开；不要关闭全局系统安全保护。

测试步骤：

1. 退出旧版，将 DMG 内的 VocalFlow Studio 拖入 Applications，替换旧版。
2. 确认版本为 `0.8.0-beta.6`。
3. 先导入一段本地音频，检查人声、伴奏和字幕是否成功生成。
4. 再搜索并 Add 一个可公开访问的视频，检查下载和处理是否完成。
5. 保持默认模型，断网后再导入本地音频；无需安装 Python、Homebrew 或输入 HF token。
6. 如失败，请保留完整日志，并记录视频链接、Mac 芯片、系统版本及失败阶段。无需删除原有曲库或设置。

## English

This is a local clean-machine test build, not a public release.

- Apple Silicon only; not an Intel installer.
- Bundles Python, FFmpeg, downloader, separator, default separation model and Whisper small.
- Fixes build-machine paths in Python console entry points, missing `audioread`, and missing separator metadata.
- Default local processing does not require an HF token. Online search/download still requires network access and is subject to platform restrictions. Other models may require additional downloads.
- Ad-hoc signed, not Developer ID signed or notarized. macOS may require an explicit first-launch approval in Privacy & Security. Do not disable system-wide security protections.

Quit the previous version, replace the app in Applications, and confirm `0.8.0-beta.6`. Test local processing first, then Add a publicly accessible video, then process another local file while offline using default models. No Python, Homebrew or HF token should be necessary. Preserve full logs if anything fails; do not delete the existing library or settings.

## Build verification / 构建验证

- Built and tested on 2026-10-07, macOS arm64.
- DMG: 925,767,794 bytes (about 926 MB / 883 MiB).
- SHA-256: `0e12f09771ed7b26c73656277332a5b02dba6b30a6c1ed860392a079b03dd3f1`.
- Mounted the final DMG, copied its app to a fresh path, and detached the disk image before testing.
- Passed actual MP3 stem separation and nonempty Whisper small transcription with OS-level network denial, empty HF cache, disabled user site-packages, and PATH restricted to the bundled FFmpeg directory.
- Passed URL audio download/extraction using a loopback HTTP AAC fixture and the relocated packaged Python. This checks downloader startup and extraction, not YouTube/Bilibili access rules.
- Passed model/config seeding and repeated-start idempotence checks; passed deep code-signature integrity verification. Ad-hoc signature verification is not Apple notarization.
- 尚未在用户另一台全新 Mac 上验收，未进行自动化前端交互测试。
