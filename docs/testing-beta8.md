# VocalFlow Studio 0.8.0-beta.8 — 本地测试版 / Local test build

## Build verification / 构建验证（2026-10-27）

- File: `VocalFlow Studio-0.8.0-beta.8-mac-arm64.dmg`
- Size: 895,379,623 bytes (approximately 895 MB).
- SHA-256: `610bd3690282d018329cb13a8d1aac26079b96d9480a0582541385f4554efd22`
- Passed: 14 mocked pipeline tests, error-classification tests, production build, bundled dependency imports, strict deep application signature check, and DMG checksum verification.
- Passed: bundled runtime with network denied, empty model caches and user packages disabled, producing two stems and subtitle files from a 7.7-second synthetic speech fixture.
- Passed: bundled downloader/extractor using a local HTTP media fixture. This does not establish public-site download reliability.
- Not yet verified: installation/UI on a separate clean Mac, actual-song lyric accuracy, and word-level singing alignment. Offline processing was exercised against the packaged app directory, not a fresh installation extracted from the final DMG.

## 中文

本版本面向 Apple Silicon Mac，尚未发布到 GitHub。默认模型和运行环境随安装包提供；本地文件处理不需要 Hugging Face token。在线视频搜索、下载和字幕获取仍需要网络，并可能受来源网站的登录和限流规则影响。

### 本次变化

- KTV 模式不再跳过平台字幕；获取字幕后仍会分离人声和伴奏。
- 自动模式优先尝试与指定语言或视频语言匹配的人工字幕。无法确定语言、只有自动字幕或翻译字幕时，可退回本地识别。
- 使用本地识别检查字幕内容和大致时间位置。内容不匹配且允许兜底时使用识别草稿；仅时间错位时保留文字并标记时间需要检查。
- 校验失败或证据不足时保留字幕并记录状态，不宣称歌词已准确验证。
- 不新增模型；有字幕时也可能增加一次本地识别的耗时。

### 已知边界

这是测试版，不是与参考项目功能完全一致的正式版。逐字强制对齐、界面来源标识、失败阶段独立重试仍未完成。匹配阈值尚未用真实多语言歌曲校准，繁简差异和识别错误可能影响选择。元数据中的检查状态不等于界面已经提供提示。

安装包采用临时签名，尚未完成 Developer ID 签名和 Apple 公证；因此不能承诺全新 Mac 无安全提示。不要关闭系统安全保护。若安装受阻，请提供完整提示以区分文件损坏与签名问题。

### 建议测试

1. 拖入 Applications 后运行，而不是直接从磁盘映像运行。
2. 断网导入一段有权使用的本地音频，检查伴奏、人声、歌词和播放。
3. 联网测试带原文人工字幕的视频，检查歌词是否与实际版本匹配。
4. 测试无字幕的视频，确认可以退回本地识别。
5. 留意重复副歌、长间奏、整句时间错位；保存来源链接和错误日志以便复现。不要分享 cookies 或 token。

## English

Local Apple Silicon test build; not published to GitHub. Default models and runtime are bundled. Local processing does not require an HF token. Online sources still require network access and may enforce authentication or rate limits.

Karaoke now attempts matching manual captions without skipping separation. Auto mode checks captions against independent local ASR. Text mismatches can fall back to an ASR draft; timing-only disagreement retains the text for timing review. Failed or inconclusive checks retain unverified captions. This adds no model dependency but can add a recognition pass.

Not yet implemented: forced word alignment, UI provenance indicators, and independently retryable stages. Heuristic thresholds have not been calibrated on real multilingual songs. Traditional/simplified text and ASR errors remain limitations.

The build is ad-hoc signed, not Developer ID signed or Apple-notarized. Do not disable system security. Test installation, offline local processing, matching-caption imports, caption-free fallback, repeated choruses and timing drift. Share reproducible logs, never credentials.
