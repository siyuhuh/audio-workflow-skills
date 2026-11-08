# VocalFlow product review — 2026-11-08

Scope: branch `beta6-9-wip` (Electron 44, beta 9 behaviour) measured on the Mac mini, plus the Codex/Cursor/Claude history from 2026-04-23 to 2026-11-03 and the `Trinkle23897/karaoke` reference. Numbers below were measured, not estimated, unless marked "est.".

## Facts

| Item | Value |
| --- | --- |
| GitHub releases | 5 betas, 850 MB–1.4 GB each, 15 downloads in total |
| Offline Studio DMG (beta 9, signed) | 1,084 MB; installed app 2.0 GB |
| Where the bytes go (DMG, est.) | models 55–58 %, Python runtime ~30 %, Electron ~12 % |
| Python runtime | 1.1 GB; torch 412 MB is imported by `audio-separator` but inference runs on onnxruntime; PyAV ships a second FFmpeg next to `ffmpeg-static` |
| Models | faster-whisper `small` 464 MB, `UVR-MDX-NET-Inst_HQ_3.onnx` 64 MB, both used on the default karaoke path |
| Clients | Studio (Electron, 18.2k lines), VocalFlowMini (SwiftUI, 10.3k) + Agent (1.1k), VocalFlowMobile (SwiftUI, 3.5k), promo (Remotion) |
| Implemented three times | Stage playback, lyric parsing, recording/monitoring, package scanning; search twice |
| Largest files | `main.ts` 4,525 lines (184 functions), `App.tsx` 4,028 lines (65 `useState`, 32 `useEffect`) |
| Tests | 4 Node scripts (125 lines), 18 Python tests, no renderer tests; CI ran none before beta 10 |
| Renderer bundle (before → after beta 10) | 1,517 kB → 621 kB JS; three.js was 57 % of it for a hover effect |

The 854 MB unsigned beta 9 DMG in `apps/desktop/release/` is missing the `Electron Framework` binary and cannot launch; compare sizes against the 1,084 MB signed one.

## Done in beta 10 (branch `beta10`)

- LAN API: only `/remote`, `/api/health`, `/api/room/*` and the two search routes accept non-loopback callers, all token-checked. Before, any device on the Wi-Fi could call `/api/run-job`, `/api/open-path` (opens any file or app), history, logs and media routes.
- WebGL library cards replaced by CSS (`AlbumCoverCard`); three/fiber/drei/maath removed. The old card held one GPU context per package and Chromium drops contexts past about 16.
- Stage is immersive (no brand header); the top bar clears the traffic lights and is the drag strip.
- "Create backing" appears once (plan panel); the header job pill hides while the inline status is visible.
- Room lobby copy explains the readout and drops developer wording; capture checkboxes use the UI sans.
- `experiments/`, `output/playwright`, `electron-builder-squirrel-windows` removed; CI workflow added.

## Recommended next

### P1 — package size without breaking "download and use"

| Change | DMG saving (est.) | Effort |
| --- | --- | --- |
| Replace `audio-separator` with direct onnxruntime MDX inference (drops torch, llvmlite, scipy, sklearn, sympy, numba) | −220…−250 MB | L |
| Prune runtime: tests, `__pycache__`, pip/setuptools/Cython, headers | −35 MB | S |
| Run yt-dlp's JS challenge through `ELECTRON_RUN_AS_NODE` instead of a bundled Node (106 MB) | −35 MB | M |
| DMG `UDBZ` compression | −20…−40 MB | S |
| Target | about 850 → 500–550 MB | |

Bundling whisper `base` and fetching `small` on first use would save another 300+ MB but lowers offline accuracy; product decision.

### P1 — one producer, thin players

Studio is the only producer. Fold the Agent into Studio's existing server; make the iPhone app a remote and player only (or use the web remote); freeze or delete VocalFlowMini. This removes about 14.7k untested Swift/Python lines and three of the four version bumps per release.

### P2 — fewer decisions, fewer surfaces

- Decide language, subtitle source and model automatically; keep them in Advanced only.
- One package has three surfaces (Room lobby, Stage, Lyrics review) across three overlapping state axes (`workspaceMode`, `appScene`, `reviewTab`, 29 transitions). Aim for Library → Stage with review as a Stage tool.
- One error classifier (`errorReason.ts`; delete the copy in `App.tsx`), one stage vocabulary (Python emits 7 names, the renderer maps to 8).
- `styles.css` (6,071 lines) still has 8 `backdrop-filter` uses that `DESIGN.md` forbids; `tokens.md` is stale.

### P2 — from the reference project

- Published lyrics first (LRCLIB, NetEase, LINE MUSIC), then align; for Chinese songs this beats a bigger Whisper.
- Label candidates "lyrics found / unconfirmed" before the user commits to a long job.
- Keep playback clients thin: processing and playback separate; players fetch segments.
- Do not copy its RoFormer separation or online ASR; they need 24 GB RAM or network and would break "download and use".

### P0 before a public release

- Licensing: the app is AGPL with a commercial option in `NOTICE.md`, but `ffmpeg-static` is a GPL build (x264/x265) and no third-party notices ship for Python, torch, onnxruntime, yt-dlp, Whisper or the UVR weights; the separator weights come from a community mirror without a checksum.
- The HF token is stored in plain text in `settings.json`.
- Vercel on lykos/whothree only deploys commits authored as `gottaegbert`; not this repo, but the same account split affects release tooling.

## Decisions Siyu owns

1. Native Mac and iPhone clients: freeze, thin, or keep.
2. Keep whisper `small` bundled, or bundle `base` and fetch `small` lazily.
3. Commercial licensing: if yes, switch to an LGPL FFmpeg build and ship third-party notices.
