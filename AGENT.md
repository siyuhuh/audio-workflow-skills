# VocalFlow Desktop Development Notes

This file is for future AI/dev handoff. Keep implementation details in English where they map to code, APIs, or filenames.

## Current Goal

VocalFlow Desktop should feel like a simple KTV/subtitle packaging tool:

1. Paste a YouTube/Bilibili URL or choose local media.
2. Generate a local controllable package.
3. Review lyrics/subtitles.
4. Play in Karaoke Room, optionally with backing/vocal stems and microphone monitoring.

The desktop app should orchestrate the workflow and UI. The CLI remains the media-processing source of truth.

## Important Constraints

- Do not run `pnpm build` unless the user explicitly asks.
- Do not use Playwright/browser automation directly; let the user inspect the browser.
- Type-check is allowed (from repo root):
  - `pnpm --filter @vocalflow/desktop exec tsc --noEmit`
  - `pnpm --filter @vocalflow/desktop exec tsc -p tsconfig.electron.json --noEmit`
  - Equivalent: `pnpm -C apps/desktop exec tsc ...`
- Treat existing uncommitted work as the current baseline. Do not revert unrelated changes.

## Current Architecture

- `apps/desktop/src/main/main.ts`
  - Electron main process.
  - Runs the audio-subtitles CLI.
  - Builds `SavedJobHistory` and `PlaybackBundle`.
  - Serves local media through `vocalflow-media://` and a local HTTP fallback.
  - Handles history, asset discovery, media access, and microphone permission.
  - Parses CLI stderr into structured `JobEvent`s (queued / stage / log / succeeded / failed) and broadcasts on the unified `job:event` channel.
- `apps/desktop/src/main/lib/`
  - `errorReason.ts` — maps CLI stderr + exit codes to `JobErrorReason` + `JobErrorHint` (auth_required, no_captions, model_missing, ffmpeg_missing, …) for the `job:failed` toast pipeline.
  - `jobProgressParser.ts` — turns yt-dlp `[download] X%` lines, ffmpeg `-progress pipe:2` key/value blocks, and the Python `emit_progress` JSON envelope into canonical `JobStage` events; throttled emit + ffmpeg fragment suppression keep the IPC stream clean.
  - `packageManifest.ts` — `buildPackageManifest()` + atomic `writePackageManifest()` (writes `manifest.json.tmp` then `renameSync`); `readPackageManifest()` returns null on missing/corrupt/unknown-schema files; `hydrateHistoryFromManifest()` lifts manifest-canonical fields onto a `SavedJobHistory` row when `packageId` matches.
  - `urlMetadata.ts` (added by SAG-D) — yt-dlp `--dump-single-json` prefetch with LRU cache + inflight dedupe; backs the `metadata:prefetch` IPC handler.
- `apps/desktop/src/renderer/App.tsx`
  - Main React UI.
  - Contains guided input flow, review views, Karaoke Room, playback controller, and microphone monitor.
  - `usePlaybackController()` is the single owner of play/pause/seek/currentTime/duration and preview sync.
  - `useMicrophoneMonitor()` lists audio input devices and routes mic input to local output in monitor mode.
  - Subscribes to `audioWorkflow.onJobFailed` for localized toasts (with hint actions) and to `useActiveJobStream()` for the live progress indicator.
- `apps/desktop/src/renderer/lib/`
  - `notifications.ts` — singleton toast store (`useNotifications()`); used by the toaster + by job lifecycle effects.
  - `jobStream.ts` — singleton job-event store (`useActiveJobStream()`, `useJobStream(jobId)`); subscribes to `audioWorkflow.onJobEvent` once per session, evicts terminal snapshots after 60 s.
  - `packageStats.ts` — single source of truth for shelf / featured / dedup counts derived from history.
- `apps/desktop/src/renderer/components/`
  - `NotificationToaster.tsx` — bottom-right (desktop) / bottom-center (narrow) toast stack with `motion/react`.
  - `LiveJobStatus.tsx` — fine-grained progress line above the legacy `<StageChain>`. Indeterminate state when `progress < 0`.
  - `StageChain.tsx` — coarse stage chain (legacy `progressStages` map). Coexists with `LiveJobStatus`; do not remove.
  - `HeaderJobStatusPill.tsx` — compact status pill mounted in the brand header. Surfaces the same `useActiveJobStream()` snapshot as `LiveJobStatus` but stays visible regardless of scroll. Click scrolls the inline `<LiveJobStatus>` into view; terminal pills auto-fade (success 6 s, failure 12 s).
  - `UrlPreviewCard.tsx` (added by SAG-D) — shows title / duration / uploader for a pasted URL before the user clicks Run.
- `apps/desktop/src/shared/`
  - `types.ts` — shared Electron/preload/renderer types. Important: `SavedJobHistory`, `PlaybackBundle`, `GeneratedAsset`, `GeneratedAssetRole`, `AudioWorkflowApi`, `UrlMetadataPreview`.
  - `job-events.ts` — `JobEvent` union + `JobStage` (`queued | metadata | captions | audio | separation | transcribe | writeOutputs | manifest`) + `JobErrorReason`/`JobErrorHint`.
  - `package-manifest.ts` — `PackageManifest` + `PackageSourceKey` + `PackageAsset`. Filename: `manifest.json` at the root of every package output dir. Schema version: 1.
- `skills/audio-subtitles/scripts/generate_subtitles.py`
  - CLI source for subtitle generation, download, local package creation, and optional separation.
  - Emits structured `emit_progress` JSON envelopes to stderr at every stage boundary; yt-dlp runs with `--newline`; ffmpeg runs with `-progress pipe:2 -nostats -loglevel warning`; faster-whisper streams per-segment progress through a callback.
  - Whisper preload: `should_preload_whisper()` decides whether to spawn a daemon thread (`_start_whisper_preload()`) that runs the model load in parallel with download/separation. `transcribe()` joins the thread before running and reuses the loaded model when the engine matches. Add `--no-preload-whisper` to disable on low-RAM systems.
- Whisper engine selection: the desktop `pickWordEngine(model)` helper sends `--word-engine faster_whisper` for any model whose name contains `turbo` (currently `large-v3-turbo`) and `--word-engine auto` for everything else. Rationale: `whisper-timestamped` runs OpenAI whisper with `beam_size=5 + best_of=5 + 6-temperature fallback + per-word cross-attention alignment`, which is dramatically slower than `faster-whisper` (CTranslate2). For the `turbo` checkpoint, the alignment quality is no better than CTranslate2's native word timestamps so the speed cost isn't worth it. For older `medium`/`large` checkpoints the alignment precision is more useful, so `auto` keeps preferring `whisper-timestamped`.

## Current Playback Rules

- Local media is authoritative for in-app playback.
- External URLs are references only; the UI should show “Open original” separately.
- A link job should use local audio for playback and optional local preview video for background.
- Preview video must belong to the same media family as the selected local audio/video.
- Original / Backing / Vocal switching should preserve the same timeline and progress position.
- Cue clicks and progress dragging must go through `usePlaybackController().seek()`.

## Current History Rules

- The same URL/local input should map to one package entry.
- Split and non-split results for the same input should merge into the same history/package.
- `history:list` deduplicates old entries and writes the cleaned history back.
- The home resource shelf groups repeated Karaoke packages by source URL, sample id, or normalized song title. Deleting a home card removes all duplicate history ids in that group.
- Bundled samples can be hidden by user deletion; hidden sample ids are stored in `hidden-samples.json`.
- Do not scan an entire output folder as the current package without filtering. Shared output folders can contain assets from older songs.
- Treat media and subtitles as package-bound assets, not two independent selectors. A selected song package owns its canonical media, lyrics, preview, and stems.

## Information Architecture Direction

- Top level: packages, not loose files.
- Package types:
  - `songPackage`: one imported/downloaded song with media, lyrics, preview video, stems, exports, and package metadata.
  - `recordingPackage`: one user recording/session derived from a song package, with microphone take(s), mix/export data, and recording metadata.
- A package detail page should own editing:
  - metadata/title/source
  - lyrics/timing
  - assets/files
  - stem status
  - recording takes
- Karaoke Room should consume one package at a time. It should not expose subtitle and media as parallel unrelated choices.
- The right-side Karaoke Room selector is a song/package selector, not an audio-file selector. Track switching belongs only to Original / Backing / Vocal.
- Karaoke Room visual priority: show the package preview/local video when available; otherwise show an abstract playback visualizer.

## Desktop Design System Rules

> Read `[DESIGN.md](./DESIGN.md)` before any visual or UI change. It is the source of truth for color, typography, spacing, motion, surfaces (Studio vs Stage), and refactor priorities. The bullets below are the operational rules that complement it; visual decisions live in `DESIGN.md`.

- Always consult `DESIGN.md` before adding colors, font sizes, radii, easing values, or new components. If a token you need is missing, add it to `DESIGN.md` first (with a Decisions Log entry), then use it.
- Keep `apps/desktop/src/renderer/App.tsx` as the current component source of truth until the renderer is split into smaller modules.
- Keep global styles in `apps/desktop/src/renderer/styles.css`; introduce reusable CSS variables before adding one-off colors, shadows, easing, or spacing. New tokens must come from `DESIGN.md`.
- Use React + TypeScript, plain CSS, and `motion/react`; do not add a UI framework unless the user explicitly asks.
- Prefer package-level UI concepts: home resource cards, package detail/review, and Karaoke Room. Avoid exposing loose media/subtitle selectors as primary IA.
- Default UI should be sparse and task-first. Advanced controls, logs, raw formats, command preview, model settings, and low-frequency options should be hidden behind drawers or popovers.
- Buttons, inputs, selects, details summaries, and cue items need visible `:focus-visible` states. Do not use `outline: none` without a replacement.
- Animations must use explicit `transform`/`opacity`/size transitions only. Never use `transition: all`.
- Respect `prefers-reduced-motion`; reduce transform distance and duration or disable decorative motion.
- Dense grouped controls should use one shared HoverFill surface per group. Do not create isolated hover backgrounds on every sibling item.
- Keep text resilient: use `min-width: 0`, truncation, or wrapping on long song titles and filenames.
- Use responsive layout rules even for the desktop app because the web fallback at `127.0.0.1:5174` can run in browser windows.
- When closing a UI task, log the converted styles in the `DESIGN.md` Refactor Budget so the next agent can see progress.

## Karaoke Room UI Rules

- The lyrics are the primary content. Default controls must not cover the active lyric line.
- Use a small bottom-center transport dock, a compact left metadata card, and collapsed room settings. Open panels may temporarily overlay content, but closed state should stay lightweight.
- Track role switching belongs inside Original / Backing / Vocal controls. Song/package switching belongs in the room settings panel.
- The primary Karaoke Room track switch should only expose Original and Backing. Vocal-only stem playback is an optional advanced control inside the room settings panel.
- Keep playback position stable across Original / Backing / Vocal switches.
- Use package video as the background when available. If no video exists, show a music visualizer rather than an empty panel.
- Karaoke font/effect controls should be available but not always visible; use an `Aa` popover or equivalent compact affordance.
- Cue clicks must seek through `usePlaybackController().seek()` and never bypass the shared playback controller.

## Recently Addressed Problems

- Transcription on `large-v3-turbo` was 4–12× slower than expected because `--word-engine auto` routed it through `whisper-timestamped` (OpenAI whisper + multi-temperature + cross-attention alignment). Desktop now uses `pickWordEngine(model)` which sends `--word-engine faster_whisper` for any turbo checkpoint and `auto` for everything else.
- Vocal separation failures fell through silently — the user only saw `Separation skipped` in the stage chain. The CLI still emits `emit_progress("separate", failed=True)` for the recoverable path, but the `JobEvent.stage` payload now carries `failed?: boolean`, the renderer's `JobStreamSnapshot` records `failedStages`, and a dedicated effect in `App.tsx` pushes a one-shot warning toast (with "Disable separation" / "Copy setup command" / "Copy log" actions) the moment a stage flips into the failed state.
- Vocal separation always failed when the user had no HF Hub access. Three layered fixes ship together:
  1. **Local model reuse**. `UserSettings` gained `separatorModelDir` (Settings → "Vocal separator models folder"). The desktop forwards it as `--separator-model-dir <dir>` to the CLI, which passes it through to `audio-separator --model_file_dir`. Combined with `--separator-model <name>` the entire run stays offline.
  2. **UVR auto-detect**. `apps/desktop/src/main/lib/uvrDetect.ts` scans the platform-specific UVR install paths, materialises a flat shadow folder of weight files via symlinks under `userData/separator-models/uvr-link/`, and (when the user hasn't picked their own folder) sets `separatorModelDir` to that shadow folder on app boot. A "Re-detect UVR" button + an "Auto-linked from UVR" badge ship in Settings.
  3. **Smart model picker**. `pickPreferredSeparatorModel(dir)` in the same file scans the dir for the highest-quality model that's actually present (audio-separator's default `model_bs_roformer_ep_317_sdr_12.9755.ckpt` first, then `UVR-MDX-NET-Voc_FT.onnx`, `UVR-MDX-NET-Inst_HQ_3.onnx`, etc.). The desktop passes the picked model as `--separator-model <name>` so audio-separator never falls through to its built-in default and tries to download the BS-Roformer from HF Hub when the local pool doesn't contain it.
  Bonus fix in the CLI: `stem_score()` now matches the parenthetical group `(Vocals)` / `(Instrumental)` with decisive weight before scanning for substrings, so model names containing `Inst` (e.g. `UVR-MDX-NET-Inst_HQ_3`) no longer poison the vocal-stem heuristic.
- HuggingFace Hub access for users in restricted networks. `UserSettings` gained `hfEndpoint` (Settings → "HuggingFace mirror"); the main process injects it as `HF_ENDPOINT` into every CLI subprocess so all `huggingface_hub` clients route through the chosen host. A "Use China mirror" preset fills `https://hf-mirror.com`. `withHuggingFaceEnv()` (renamed from `withHuggingFaceToken()`) injects both `HF_TOKEN` and `HF_ENDPOINT` together.
- HF rate limits. `errorReason.classify()` recognises `"unauthenticated requests to the HF Hub"` and `huggingface_hub … rate limit / 429` patterns as the `hf_rate_limited` reason with action `openHfTokenSettings`; audio-separator runtime download/timeout failures map to `separator_missing` with action `openSeparatorModelDirSettings`. Both actions scroll Settings to the right input field via `openSettingsToField()`.
- Corrupt model files left behind by killed audio-separator runs caused `PytorchStreamReader failed reading zip archive` on every subsequent run, even when a perfectly-good UVR symlink for a different model was sitting in the same folder. `pickPreferredSeparatorModel` now ranks symlinks (UVR-managed, integrity guaranteed by UVR's own download) above plain files, and skips plain files smaller than 5 MB outright (almost certainly partial downloads). `cleanupCorruptDownloads` runs at boot and on every "Re-detect UVR" click to prune those stubs. `errorReason.ts` recognises `pytorchstreamreader … failed reading zip archive` / `checkpoint file is corrupted` / `failed to load roformer model` so the user gets a "Use local models" toast that scrolls Settings to the separator-dir field.
- Malformed HF tokens. Settings → HuggingFace token uses `type="password"`, so a user pasting the wrong clipboard value (e.g. the "Copy setup command" toast text) had no visual feedback — the bogus value got injected as `HF_TOKEN` and broke every subsequent download. `mergeUserSettings` now validates `^hf_[A-Za-z0-9_]{20,}$` and silently drops malformed input. `loadUserSettings` re-runs the validation against the on-disk file at boot and writes a cleaned version back when anything was rejected, so users with already-corrupted settings auto-heal on next launch.
- Activity column duplicated retries. Each `runJob()` appended a new `JobRecord` to `jobs`, so a flaky bilibili import that took 4 retries to succeed produced 4 stacked cards with the same title. `runJob` now filters out any prior `jobs[]` entry whose `input` matches the new run, so the activity column shows one card per distinct input regardless of how many times it was attempted. (History-side dedup via `historyPackageKey` was already in place and is untouched.)
- Old preview videos could be mixed with new song audio when several jobs shared one output directory.
- Backing/Vocal switching could surface stems from another song.
- Duplicate history entries appeared after running vocal split.
- The start screen was simplified so the first action is URL/file input.
- Karaoke Room now supports microphone input selection and monitor output.
- CLI progress was opaque: yt-dlp `\r`-rewriting bars never reached the renderer, ffmpeg printed once at the end, and stderr from a few `subprocess.PIPE` callsites was swallowed entirely. The Python CLI now flushes line-terminated progress for every external tool and the main process parses those into canonical `JobStage` events on the `job:event` channel.
- Job failures used to surface only as a generic Error in the renderer log. They now flow through `classifyError()` → `JobFailedEvent` → localized toast with recovery actions (open cookies pane, enable local fallback, copy install command, retry, copy log).
- Capture form felt blank for 2-4 s after pasting a URL. A debounced `metadata:prefetch` IPC handler now hits yt-dlp `--dump-single-json --skip-download` and shows the title / duration / uploader inline before the user clicks Run.
- Default whisper model flipped from `medium` → `large-v3-turbo` (~2× faster transcribe with comparable WER on most songs). One-time ~1.5 GB model download on first run; the live status surface narrates the download.
- Per-package `manifest.json` is now written atomically next to every successful job's outputs, with stable `packageId` + `sourceKey` + role-tagged assets. The reader (`loadSavedHistory()`) now prefers the manifest when it exists and back-fills missing manifests on first load, so older `history.json` rows converge on manifest-canonicality without a separate migration step.
- The brand header now shows a compact `HeaderJobStatusPill` (stage label + percent + colored dot) so the user knows a job is alive even when scrolled away from the capture form. Clicking it scrolls the inline `<LiveJobStatus>` back into view. Terminal pills auto-fade (success 6 s, failure 12 s) and the `useActiveJobStream` hook now keeps the snapshot active through the eviction window so the tail state never flashes off.
- Whisper model load now overlaps with download + separation + convert via a daemon thread spawned in `generate_subtitles.py` when transcription is "almost certain" (local files, `--separate`, `--force-local`, `--local-fallback`, `--subtitle-source local`). Wall-clock saving is 5–20 s per typical job. Add `--no-preload-whisper` to opt out on low-RAM systems.
- Out-of-box experience for end users. `apps/desktop/src/main/lib/bundledModels.ts` resolves two opt-in bundle folders shipped via `extraResources`: `vendor/separator-models/` (flat `.onnx` / `.pth` / `.ckpt` files) and `vendor/whisper-models/` (direct faster-whisper model directories). On boot, `detectAndLinkUvr()` symlinks the bundled separator weights into the same shadow folder UVR uses, while every CLI subprocess receives `VOCALFLOW_WHISPER_MODEL_DIR` and reads the default Whisper model directly without duplicating a Hugging Face blob cache. `HF_HOME` remains a writable app-managed cache for optional model downloads. Maintainers run `apps/desktop/scripts/fetch-bundled-models.sh` once before `pnpm dist:mac` / `dist:win` to populate the `vendor/` folders (default budget ~530 MB: `UVR-MDX-NET-Inst_HQ_3.onnx` + `Systran/faster-whisper-small`). When the script hasn't run (typical for `pnpm dev`), every helper returns `null` and the existing UVR-or-HF download flow is preserved unchanged.

## Development Plan

### Phase 1: Package Data Model

- Durable package identity is shipped: `PackageManifest` in `apps/desktop/src/shared/package-manifest.ts`, written atomically by `apps/desktop/src/main/lib/packageManifest.ts` after every successful job. Identity fields (`packageId`, `packageType`, `sourceKey`, `sourceUrl`, `title`, timestamps, `outputDir`, `assets`, `playbackBundle`) are all populated.
- Reader migration is shipped: `loadSavedHistory()` calls `migrateHistoryWithManifests()` on first read. Each entry that has a matching `manifest.json` (`packageId === entry.id`) is hydrated via `hydrateHistoryFromManifest()`; entries lacking a manifest get one back-written for the most-recent `outputDir`-sharing entry. Bundled `samples/` packages (no `version: 1`) are kept on the legacy `readSamplePackage` path so the schema collision is invisible.
- Recordings + exports children are still implicit on disk; add `recordings` to the manifest when the recording feature lands.
- Consider SQLite later if search/filtering/history grows beyond simple package metadata.

### Phase 2: Asset Role Reliability

- Make asset roles explicit at creation time:
  - `original`
  - `backing`
  - `vocal`
  - `preview`
  - `subtitle`
  - `transcribe`
- Keep filename heuristics only as fallback for old history.
- Store stem relationships in the package manifest so Backing/Vocal always attach to one package.

### Phase 3: Playback Controller Cleanup

- Keep a single playback clock across Original / Backing / Vocal.
- Separate the concepts:
  - `timelineTime`
  - `selectedTrackRole`
  - `selectedTrackPath`
  - `previewVideoPath`
- Add focused tests around:
  - switching stems while playing
  - dragging seek bar after switching stems
  - missing preview video
  - old history entries

### Phase 4: UI/UX Polish

- Keep the start screen minimal: URL/file input first.
- Keep low-frequency controls in Desktop options.
- Make Karaoke Room the main playback experience.
- Avoid showing raw URLs in history; prefer package title.
- Keep expert controls available but not front-and-center.

### Phase 5: Split Workflow

- “Split vocals” should update the existing package, not create a separate user-facing result.
- UI should show split status on the current package.
- If split fails, preserve the original package and show an actionable error.

### Phase 6: Verification

- Continue using type-check only by default.
- Manual scenarios for user verification:
  - YouTube link with platform captions.
  - YouTube link requiring cookies/fallback.
  - Local audio.
  - Local video.
  - Existing package without preview video.
  - Split vocals after initial package creation.
  - Switching Original / Backing / Vocal while playing and after seeking.
  - Old duplicate history entries.

## Suggested Next Step

1. **Race captions vs audio download for URL inputs**. The whisper preload landed, but caption-fetch and audio-download still run sequentially. When `subtitle_source` is `auto`/`local-fallback`, kicking off both subprocesses concurrently and letting the first usable result win would shave another 5–15 s on the captions-fail path. This requires careful subprocess lifecycle management (cancel/cleanup the loser, dedupe `yt-dlp` output dirs) — left for a later round to keep the recent ship safe.
2. **Persist user model preference** in `UserSettings` so power users don't have to re-pick from Advanced every session.
3. **Surface preload state in the live status panel.** Today the user sees a `Loading model` flash only at the start of the transcribe stage; with preload, that flash is gone and the model just appears "ready". Adding a low-priority `Preloading model` line that fades when the load finishes would make the new behavior legible.
4. **Manifest-backed dedup for shared `outputDir`s.** When two jobs land in the same user-chosen output folder (the default `~/Downloads/VocalFlow Studio`), only one `manifest.json` survives — the latest job's. The hydration path already handles this safely (it skips lifting when `packageId` mismatches), but a long-term fix is per-job sub-folders or a `manifests/` index file.
