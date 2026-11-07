# VocalFlow Studio 0.8.0-beta.9 — 本地测试版 / Local test build

## Artifact verification — 2026-10-28

- File: `VocalFlow Studio-0.8.0-beta.9-mac-arm64.dmg`
- Size: 895,895,822 bytes (approximately 896 MB).
- SHA-256: `847bf22d8c864e8593898d3b19b2166fe2278cd15ead6cccdeb81fee60e5f762`
- Passed: 18 Python tests, four backend test scripts, production build, bundled dependency checks, strict deep signature verification and DMG checksum verification.
- Passed: packaged-runtime recovery smoke test with network denied, disabled user packages and empty model caches. Forced transcription failure retained two stems; retry reused verified separation and produced nonempty subtitle cues.
- Runtime smoke test used the packaged app directory, not a fresh app installation extracted from the final DMG. Separate-computer installation and UI interaction remain manual acceptance steps.

## 中文

本次整合 beta.8 之后的恢复能力：

- 点歌队列持久化；重启后，中断任务标记为失败，待用户处理。
- 相同输入和设置再次处理时，关联上次未完成目录；完成后清除重试关联。
- 人声分离结果按输入、模型、版本和输出内容校验，通过才复用。
- 分离已完成而后续处理失败时，把有效伴奏保留到曲库，支持无歌词进入 KTV；任务依然显示失败，可重试。
- 取消任务不视为完成，失败重做不会降级已有完整歌曲。

这是 Apple Silicon Mac 测试版，不是已经完成所有路线图功能的正式版本。下载和识别阶段仍可能重跑；没有完整的逐字强制对齐。队列中断项不会自动重新处理。队列损坏时保留原文件并阻止覆盖，目前没有专门的恢复界面。

默认运行环境和模型随包提供，本地处理不需要 HF token。联网视频仍受来源网站的可用性、登录和限流规则限制。安装包只有临时签名，没有 Developer ID 签名及 Apple 公证，不要为安装关闭系统安全保护。

### 手动验收

1. 保留旧安装包，退出旧应用后，把新应用复制到 Applications。
2. 断网导入一段有权使用的本地音频，检查分离、歌词和播放。
3. 点几首歌后退出、重开，检查队列顺序；中断项应显示失败而不是一直运行。
4. 如遇歌词处理失败，检查伴奏是否仍在曲库，并能在无歌词状态播放。
5. 相同设置重试，日志中应出现 `Reusing verified separation outputs.`；只有校验通过才会显示。

## English

This local Apple Silicon test build integrates persistent room queues, unfinished-job directory recovery, content-checked separation reuse and partial backing playback after downstream failures. A failed job remains failed; it is not reported as fully complete merely because audio is available.

Downloads and recognition may still rerun. Forced word alignment and a full recovery UI are not implemented. Interrupted queue items do not automatically restart. Real-site access remains subject to source restrictions. Default runtime/models are bundled, but this build is ad-hoc signed and not Apple-notarized.

Manually verify installation, offline import/playback, queue persistence, partial playback and same-settings retry. Keep the old installer. Do not disable system security or share cookies/tokens in logs.

## Verification scope

- Backend checks: queue persistence, retry journal, partial-output selection, error classification and Python caption/checkpoint regression tests.
- Production build includes renderer and main-process compilation.
- Packaged-runtime recovery smoke test uses a short synthetic speech fixture, an intentionally missing transcription model, then the bundled model. It checks retained stems, verified reuse and nonempty subtitle cues under network denial.
- These checks do not establish real-song lyric quality or verify the Electron UI interaction on a separate clean Mac. No automated frontend interaction test is claimed.
