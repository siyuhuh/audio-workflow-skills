# VocalFlow Studio 0.8.0-beta.10 — Developer ID 签名并公证 / Signed and notarized test build

## 中文

beta.10 由 `main` 的 `cfa010c` 构建，处理流程与 beta.9 相同。和 2026-10-29 构建的 beta.9 公证包相比，有两处变化：

- Electron 从 37 升到 44.8.0，并带上 npm 依赖安全补丁（PR #1–#4）。
- 手机遥控页（扫码进入）改为搜索优先，默认中文，可一键切到英文，语言选择会被记住。请求进行中按钮会禁用。

安装包使用 Developer ID 签名，已通过 Apple 公证，公证票据已 staple 到 DMG。默认运行环境和模型随包提供，本地处理不需要 HF token。联网视频仍受来源网站的可用性、登录和限流规则限制。这是 Apple Silicon 测试版，beta.9 文档里列出的限制仍然适用。

### 手动验收

1. 保留 beta.9 安装包，退出旧应用后，把新应用拖进 Applications，打开时不应出现“无法验证开发者”提示。
2. 断网导入一段有权使用的本地音频，检查分离、歌词和播放。
3. 手机扫码打开遥控页：默认中文，切换英文后刷新仍是英文；搜索点歌和直接粘贴链接都能加入队列。
4. 点几首歌后退出、重开，检查队列顺序；中断项应显示失败而不是一直运行。
5. 相同设置重试，日志中应出现 `Reusing verified separation outputs.`。

## Artifact verification — 2026-11-10

- File: `VocalFlow Studio-0.8.0-beta.10-mac-arm64.dmg` (local `apps/desktop/release-signed/0.8.0-beta.10/`, not committed).
- Size: 1,152,855,754 bytes (approximately 1.15 GB).
- SHA-256 (after stapling): `b64e225cba69349893fba8ef80cbc644651600dbc4c58ebd447de04fa868192a`
- Source: `main` at `cfa010c`; app version `0.8.0-beta.10`; Electron 44.8.0.
- Signed with the project's Developer ID Application certificate, hardened runtime and a secure timestamp. The DMG was created with `hdiutil create -srcfolder` from the signed app directory; the file inventory of the mounted image matched the staging app (19,099 entries).
- Notarization submission `a2fa3a23-1243-4678-9c4f-f604b19cf47d`, uploaded 2026-11-10 00:30. Apple took more than two hours; the ticket was issued and stapled at 07:05 (`stapler staple` succeeds only for an accepted submission). The `notarytool info` status text was not read because the login keychain was locked at the time.
- Passed on the DMG: `stapler validate`, `codesign --verify --strict`, `hdiutil verify`, and `spctl --assess --type open --context context:primary-signature` (`source=Notarized Developer ID`).
- Passed on the app **inside the mounted image**: `codesign --verify --deep --strict` and `spctl --assess --type execute` (`Notarized Developer ID`). Electron, Mantle, ReactiveObjC and Squirrel frameworks are present.
- Passed with the bundled Python **from the mounted final DMG**, user site-packages disabled and empty Hugging Face caches:
  - Recovery smoke test with all network denied (`sandbox-exec … (deny network*)`). A forced transcription failure kept two stems and the separation checkpoint; the retry logged `Reusing verified separation outputs.` and produced nonempty subtitle cues.
  - Download smoke test with only loopback allowed. The bundled yt-dlp 2026.08.19 downloaded audio from a local HTTP server and extracted it with the bundled ffmpeg.
- Passed on `main` at `cfa010c`: `pnpm install --frozen-lockfile`, the production build (renderer plus `tsc -p tsconfig.electron.json`), the four `scripts/test-*.mjs` checks and 18 Python unit tests.
- The packaged `app.asar` contains the Chinese-default remote page with `appendKaraoke: false`. This is a string check, not a phone test.

## Not verified

- Installing on a clean Mac and interacting with the UI. Siyu tests this manually on the MacBook.
- The phone remote page on a real phone.
- Real-song lyric quality and real YouTube/Bilibili downloads. The download test used a local file server.
- The ticket is stapled to the DMG only, not to the `.app`. First launch of the copied app without network access has not been tested.
- Not uploaded to R2. The site's download button still points at beta.9.

## GitHub prerelease — 2026-11-12

- Published as prerelease `v0.8.0-beta.10` (annotated tag on `6904dc1`) with this DMG as the only asset, `VocalFlow.Studio-0.8.0-beta.10-mac-arm64.dmg`. Notes: `docs/releases/v0.8.0-beta.10.md`.
- GitHub reports the uploaded asset as 1,152,855,754 bytes with digest `sha256:b64e225c…68192a`, matching the local file. The public download link redirects to the release-asset host.
- The tag push triggered the `Desktop Release` workflow; that run was cancelled after about 11 seconds, before any job finished, so it published nothing.
