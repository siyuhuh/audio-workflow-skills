# AGENTS.md — VocalFlow (audio-workflow-skills)

Instruction file for every coding agent. Read it first, then `AGENT.md` (architecture, playback/history rules, development plan), `DESIGN.md` (required before any UI change), `RELEASING.md` and `.cursor/rules/agent-behavior.mdc`. This file holds the dated decisions, pitfalls and release knowledge distilled from past Codex, Cursor, Claude Code and Grok Bot sessions (2026-04 → 2026-11-07). Add new findings here.

## Project

- Siyu's own product, open source under `AGPL-3.0-or-later` (see `LICENSE`, `NOTICE.md`). GitHub `siyuhuh/audio-workflow-skills`, default branch `main`. On the mini both `origin` and `siyuhuh` point at it (corrected 2026-11-07); the old `gottaegbert/audio-workflow-skills` remote is dead.
- What it is: "万能 KTV". Turn a YouTube/Bilibili link or local media into a local karaoke package (MV, original, backing track, lyrics), then sing, record and mix in the Room. Clients: Electron **VocalFlow Studio** (`apps/desktop`, the main product), native Swift **VocalFlowMini** + Mac mini Agent (`apps/mac`), iPhone remote client (`apps/ios/VocalFlowMobile`), Remotion promo (`apps/promo`). The Python CLI `skills/audio-subtitles/scripts/generate_subtitles.py` is the processing source of truth.
- Working checkout: Mac mini `~/Downloads/project/tars/audio-workflow-skills` (about 14 GB with `apps/` models; tracked files are only a few MB).
- Website: `https://vocalflow.whothree.com` (Vercel project `vocalflow-site`, DNSPod CNAME to Vercel). Its source is not in this repo; it was built and deployed by the Grok Bot "VocalFlow" agent on 2026-11-03. Locate that source before changing the site; do not rebuild it from scratch.
- Installer hosting: Cloudflare R2 (see Distribution). GitHub Releases carry the CI builds; the latest public GitHub release is still `v0.8.0-beta.5` (unsigned).

## State as of 2026-11-08 (read before releasing)

- 2026-11-08: branch `beta10` (from `beta6-9-wip`) is the current line of work: LAN API locked to this machine, WebGL library cards replaced by CSS, dead 3D dependencies and `experiments/` removed, CI added. Verified on the mini: type-check, build, `test-*.mjs`, Python tests, app launch, LAN probes from the MacBook (403 for job/file/history/log routes, 200 for the phone remote with its token).
- 2026-11-08: the 854 MB `apps/desktop/release/VocalFlow Studio-0.8.0-beta.9-mac-arm64.dmg` is **broken**: its `Electron Framework.framework/Versions/A/` has no `Electron Framework` binary (the 10-29 "DMG lost framework binaries" pitfall). The 1,084 MB signed DMG is the complete one. A correct Electron 44 Studio DMG is about 1.05–1.1 GB; size work has to come from the Python runtime (1.1 GB, torch 412 MB is only imported) and the models (whisper-small 464 MB), not from the Electron side.
- 2026-11-08: Beta 6–9 work (previously uncommitted in the mini checkout, 2026-10-07 → 11-03) is committed on branch `beta6-9-wip` and merged with the security PRs #1–#4 (npm overrides, Electron 37 → 44.8.0, undici/next). On that branch `pnpm run build`, `scripts/test-*.mjs` and `skills/audio-subtitles/scripts/test_*.py` pass and the app launches on Electron 44. A build from `main` does **not** contain beta 6–9 behaviour. Before releasing from the branch, rebuild the offline DMG, notarize, and re-run the acceptance checklist in `docs/testing-beta9.md`. The mini checkout may still hold the same changes uncommitted on `main`; do not discard them until Siyu has switched to the branch.
- `apps/desktop/package.json` in the working tree is `0.8.0-beta.9`; `origin/main` still says `0.8.0-beta.5`.
- The 2026-11-03 mobile QR-page change (search-first, Chinese default) is source-only; the notarized beta 9 DMG does not include it.

## Commands

- Dev: `pnpm dev` (Vite on `127.0.0.1:5174` plus Electron), `pnpm dev:ui` (renderer only). After changing `main.ts`/titlebar config, restart Electron.
- Type-check (allowed by default): `pnpm --filter @vocalflow/desktop exec tsc --noEmit` and `... exec tsc -p tsconfig.electron.json --noEmit`.
- Do not run `pnpm build`/`dist` unless Siyu asks (rule in `AGENT.md`). She often asks "release 一版" or "build 可打开看看"; then it is allowed.
- Lite installer: `pnpm dist:mac` / `dist:win`. Full offline installer: run `apps/desktop/scripts/fetch-bundled-models.sh`, then `pnpm dist:mac:offline` / `dist:win:offline`. Check: `node apps/desktop/scripts/verify-bundled-release.mjs <release-dir>`.
- Native Mac: `apps/mac/VocalFlowMini/scripts/build-dmg.sh release` with `MACOS_SIGNING_IDENTITY`, `APPLE_NOTARY_KEYCHAIN_PROFILE`, `REQUIRE_BUNDLED_RUNTIME=1`.
- CI release: push a `v*` tag (`git push origin v0.8.0-beta.N`). The `Desktop Release` workflow builds the native DMG, Studio DMG and Windows EXE, unsigned or ad-hoc. Signed and notarized builds are made locally on the mini.
- Promo video: `pnpm promo`, `pnpm promo:render` (45 s 1920×1080 `VocalFlowIntro`).
- CI (`.github/workflows/ci.yml`, on push to `main`/`beta*` and PRs): both type-checks, `pnpm build`, `apps/desktop/scripts/test-*.mjs`, and `python -m unittest discover -s skills/audio-subtitles/scripts -p "test_*.py"`. Run the same four locally before pushing.
- Driving the running app without Playwright: start it with `electron . --remote-debugging-port=9333`, then screenshot or evaluate JS over the DevTools protocol (a 60-line Node 22 script, no dependencies; `Input.dispatchMouseEvent` hangs when the mini's display is asleep, so scroll and hover via DOM calls instead). `screencapture` over SSH fails without a live display session.

## Release, signing and notarization (Studio DMG)

- 2026-10-29: Developer ID Application certificate created through Xcode → Settings → Accounts → paid team → Manage Certificates → `+`. "Apple Development" certificates cannot sign for distribution. The notarytool credentials live in the login keychain profile `vocalflow-notary`. The `asc` CLI is set up with an App Store Connect API key under `~/.asc/` (dir 700, file 600). Never print, copy or commit the key, key ID, issuer ID or team details.
- Build: `CSC_NAME="<team name> (<TEAMID>)"` without the `Developer ID Application:` prefix, `electron-builder --mac dmg --publish never --config.directories.output=release-signed --config.mac.notarize=false`. A separate output dir keeps earlier unsigned artifacts.
- Gate, in order: strict deep `codesign --verify` on the staging app → mount the DMG read-only and verify the app **inside the image** → sign the DMG with timestamp → `xcrun notarytool submit <dmg> --keychain-profile vocalflow-notary --wait` and require `Accepted` → `stapler staple` + `stapler validate` → `hdiutil verify` → `spctl --assess --type open --context context:primary-signature` → SHA-256 **after** stapling → clean-Mac install test. The full steps are in the working-tree `RELEASING.md`.
- Pitfall (2026-10-29): the first submission came back `Invalid` because electron-builder's DMG lost framework binaries, even though the staging app and the image checksum passed. Fix: recreate with `hdiutil create -srcfolder <signed-app-dir> -format UDZO <dmg>` and re-verify the mounted contents.
- Pitfall (10-29 → 11-03): the 1.1 GB upload from the mini timed out; Apple then showed a stale `In Progress` record that was really a failed upload, and a "follow-up task" silently never finished. Check `notarytool history`/`info` and that an upload process is still alive. Use a recurring check (a 15-minute heartbeat worked on 11-03) and never report success before `Accepted` + stapled + validated.
- Result: `VocalFlow Studio-0.8.0-beta.9-mac-arm64-notarized.dmg` (1,136,632,840 bytes, SHA-256 `410913ef…0bee18`), notarized 2026-11-03 and kept in the mini's `~/Downloads`. Signing is not notarization, and neither proves model quality, site access or clean-machine behaviour.

## Distribution (R2 / COS) and download site

- 2026-11-03 decision: landing page on Vercel; installers on Cloudflare R2 (store and egress about $0 at current volume). Never put the 1.1 GB DMG in a Vercel deploy (deploy size limits, bandwidth billing). GitHub Releases downloads are slow in China.
- Tencent COS + CDN is the China-speed alternative (direct egress about ¥0.5/GB). It was costed, not chosen. Ask before enabling any paid storage, CDN or billing.
- 2026-11-03 decision: **keep whothree.com DNS on DNSPod; do not move NS.** Cloudflare Free cannot reproduce DNSPod's 境内 line records for `@`/`www`. An inactive whothree.com zone exists in Cloudflare and is harmless. Consequence: no R2 custom domain such as `download.vocalflow.whothree.com` (partial CNAME needs the Business plan, about $200/month).
- Current download: the site's button points at the public `r2.dev` URL of the R2 object `studio/0.8.0-beta.9/VocalFlow-Studio-0.8.0-beta.9-mac-arm64.dmg`. Cloudflare rate-limits r2.dev, so it is not meant for mass distribution.
- Password download: Siyu wants it ("防止不停有人下载"). A Cloudflare Worker `vocalflow-download` (workers.dev) is tested: 5 wrong passwords → 10-minute lockout, resumable download. As of 11-03 it was waiting for Siyu to choose the password; then switch the site button to it and disable the r2.dev URL. The password is entered by her through a private input and never goes into chat, code or docs.
- Uploading: the Cloudflare connector cannot create R2 S3 credentials. The beta 9 upload used a temporary upload Worker, deleted afterwards (about 35 min at 0.5–0.8 MB/s from the mini). For future releases, ask Siyu for a bucket-scoped R2 API token.
- Enabling R2 for the first time must be done by Siyu in the Cloudflare dashboard (API error 10042). Stop and hand over for any login, 2FA, card or terms step.
- Site design (11-03): built from the app's real `apps/desktop/src/renderer/styles.css` (sage grey-green + clay orange, stripe texture, logo, follows system dark mode). `apps/desktop/src/renderer/tokens.md` is stale (green accent, JetBrains Mono); trust `styles.css`. The site avoids saying "内置模型"; beta 9 does bundle the default models, so that claim can be added.
- The small Tencent server (checked 2026-10-07: 4 vCPU, about 3.6 GiB RAM, no GPU, YouTube/Hugging Face unreachable) is unfit for separation. Use it only for light services such as an update manifest or diagnostics.

## Decisions

- 2026-04-24: product name VocalFlow; bilingual READMEs. 2026-08-27: Chinese is the default language for README and release notes, with English one click away.
- 2026-04-24: copyright posture. Local processing of content the user has rights to; avoid "youtube-mp3"-style naming and copy.
- 2026-05-23: the karaoke package stays minimal. Original + backing (instrumental) + one lyric file (LRC), one folder per song with `manifest.json`. The Vocal stem is a hidden secondary option; the primary toggle is 原唱/伴奏.
- 2026-04/05 defaults: split vocals on by default; monitoring on by default but only inside the Room; MV muted plus backing stem in "sing mode".
- 2026-07-15: default theme 墨黑 (`ink`); palettes `sage`/`slate`/`ink`/`clay`. Simplified-Chinese output option after Whisper returned Traditional.
- 2026-07-27: real-time monitor latency (about 202 ms device) is separate from recording alignment (default 0 ms, user-calibrated, ±500 ms).
- 2026-10-07: download-and-use is the release bar. Default runtime + models are bundled; HF token, mirror and model dir go to Advanced only; no silent pip/model downloads at runtime.
- 2026-10-07: browser-local separation proven. The 67 MB separator ran in Chrome WebGPU (30 s audio in about 5 s on an M4 Pro; prototype in `experiments/browser-separator`). Chrome-extension direction approved 10-07; desktop kept.
- 2026-10-15: keep the "万能 KTV" positioning ("这个点我也想打"). Use `Trinkle23897/karaoke` as the engineering reference: text vs timing separation, stage cache, persistent queue. Do not narrow the product.
- 2026-10-25/26: KTV auto mode prefers matching-language manual platform subtitles even when separating, then checks them against local ASR and falls back to an ASR draft. Store lyric source, needs-review flag and timing precision. Never fake word-level timing from line timing.
- 2026-10-27/28 (beta 8/9): persistent room queue (interrupted → failed, no auto-restart); retry reuses separation only after input/model/output verification; if separation succeeded but lyrics failed, keep the backing track playable while the job stays failed.
- 2026-11-08: library covers are CSS (`components/visual/AlbumCoverCard.tsx`: tilt, sheen, muted video preview while active), not WebGL. The three.js card cost one GPU context per package (Chromium drops contexts past about 16) and 57% of the renderer JS for a hover effect; the bundle went from 1,517 kB to 621 kB. Do not reintroduce three/fiber for decoration.
- 2026-11-08: the Stage scene renders without the brand header (`appSceneFrame--stage`); navigation there is the floating dock and the exit key. Keep the header on Studio and Lyrics review. Full review and roadmap: `docs/product-review-2026-11-08.md`.
- 2026-11-08: the room web server stays on `0.0.0.0` for the phone remote, but only `/remote`, `/api/health`, `/api/room/*` and the two search routes accept non-loopback callers, all token-checked via `assertRoomAccess`. Any new route is loopback-only unless it is added to `remoteAllowedPaths` **and** checks the token.
- 2026-07-20: RideTogether moved to its own repo `~/Downloads/project/tars/RideTogether`. Do not develop it under `apps/ios/RideTogether`.

## Pitfalls

- beta 4 (2026-08-27): Studio `dist:mac` omitted the models (only the offline config had them), so clean Macs hit the anonymous Hugging Face rate limit. Fixed in beta 5 by bundling the models and verifying the bundle.
- beta 5 (2026-10-07): console scripts kept `#!/Users/runner/work/.../python3` shebangs, so Add failed with `FileNotFoundError` while search worked. Fix: always invoke tools through the bundled interpreter (`sys.executable -m yt_dlp`, same for the separator). Dependency checks must import, not just check files. yt-dlp needs the bundled Node + EJS. Add timeouts.
- "File exists" checks once led to a false "下载即用" promise. Only a run of the **final DMG**, relocated, with network denied and empty caches, counts (`smoke-bundled-runtime.py`). Real-song quality and the UI on another Mac stay manual.
- A plain HTTP 403 from a site is not "sign-in required"; do not tell users to paste cookies (fixed 10-15 in `errorReason.ts`). Do not suggest Homebrew fixes for bundled tools.
- ffmpeg "no timestamp" sentinel (`-9223372036855s`) leaked into progress; clamp it (fixed 07-15).
- Bilibili: search can return HTTP 412; thumbnails need the local `/api/thumbnail` proxy with Referer + UA. YouTube embedding in Electron is unstable (`net_error -100`); play the local preview video.
- Shared output dirs mixed songs and stems; keep one folder per job and dedupe history by package.
- Mini disk is tight (2.8 GB free on 10-16 blocked packaging; about 6 GB on 11-07). Each DMG is about 0.9–1.1 GB, and `apps/desktop/release*` already holds many betas. Check `df -h /` and ask before deleting anything.
- A copied beta 6 DMG reported "The disk image is corrupted"; compare SHA-256 before and after copying and run `hdiutil verify`.
- `styles.css` rules are unlayered, so they beat Tailwind utilities (which live in `@layer utilities`). A component base class must not set `position`/`display` that callers override with `absolute inset-0`; the cover tile collapsed to zero height this way on 2026-11-08.
- The renderer's HTTP fallback (`createHttpAudioWorkflowApi`, `http://127.0.0.1:5175`) and the Electron bridge are the only legitimate callers of the non-room web routes; both are loopback. The native Mac client and the iPhone app talk to the Agent on port 8766, never to Studio's 5175.

## Acceptance / verification

- Siyu tests on a second, clean Apple Silicon Mac (MacBook user `hu`): quit the old app, drag in the new one, test offline local audio first, then search → Add, queue persistence after relaunch, and same-settings retry (log line `Reusing verified separation outputs.`). Keep the old installer.
- Report exactly what was verified (type-check, Python tests, `test-*.mjs`, packaged smoke test, signature/notarization) and what was not (UI, phone, real-song accuracy). Do not use Playwright on her behalf; she inspects the UI herself.

## Siyu's preferences for this project

- "我希望用户下载即可用": zero setup, no tokens, cookies or terminal steps for normal users. State installer size and model sizes in README and release notes.
- UI: simple, clear hierarchy, no clutter ("简单 高级"). Green or theme accent, never stray orange/pink; thin transparent scrollbars matching the theme; icons over wrapped text buttons; radius hierarchy (square CTAs, Braun-like); immersive full-screen Room; iOS-native feel on Mac/iOS; her Foundations SVG logo everywhere.
- Process: Linear for planning (team prefix `WHO-`); "commit push" means push to `siyuhuh/main` directly, not a new branch. Default reply language is Chinese.
