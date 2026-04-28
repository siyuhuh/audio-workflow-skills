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
- Type-check is allowed:
  - `pnpm -C apps/desktop exec tsc --noEmit`
  - `pnpm -C apps/desktop exec tsc -p tsconfig.electron.json --noEmit`
- Treat existing uncommitted work as the current baseline. Do not revert unrelated changes.

## Current Architecture

- `apps/desktop/src/main/main.ts`
  - Electron main process.
  - Runs the audio-subtitles CLI.
  - Builds `SavedJobHistory` and `PlaybackBundle`.
  - Serves local media through `vocalflow-media://` and a local HTTP fallback.
  - Handles history, asset discovery, media access, and microphone permission.

- `apps/desktop/src/renderer/App.tsx`
  - Main React UI.
  - Contains guided input flow, review views, Karaoke Room, playback controller, and microphone monitor.
  - `usePlaybackController()` is the single owner of play/pause/seek/currentTime/duration and preview sync.
  - `useMicrophoneMonitor()` lists audio input devices and routes mic input to local output in monitor mode.

- `apps/desktop/src/shared/types.ts`
  - Shared Electron/preload/renderer types.
  - Important types: `SavedJobHistory`, `PlaybackBundle`, `GeneratedAsset`, `GeneratedAssetRole`.

- `skills/audio-subtitles/scripts/generate_subtitles.py`
  - CLI source for subtitle generation, download, local package creation, and optional separation.

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

- Keep `apps/desktop/src/renderer/App.tsx` as the current component source of truth until the renderer is split into smaller modules.
- Keep global styles in `apps/desktop/src/renderer/styles.css`; introduce reusable CSS variables before adding one-off colors, shadows, easing, or spacing.
- Use React + TypeScript, plain CSS, and `motion/react`; do not add a UI framework unless the user explicitly asks.
- Prefer package-level UI concepts: home resource cards, package detail/review, and Karaoke Room. Avoid exposing loose media/subtitle selectors as primary IA.
- Default UI should be sparse and task-first. Advanced controls, logs, raw formats, command preview, model settings, and low-frequency options should be hidden behind drawers or popovers.
- Buttons, inputs, selects, details summaries, and cue items need visible `:focus-visible` states. Do not use `outline: none` without a replacement.
- Animations must use explicit `transform`/`opacity`/size transitions only. Never use `transition: all`.
- Respect `prefers-reduced-motion`; reduce transform distance and duration or disable decorative motion.
- Dense grouped controls should use one shared HoverFill surface per group. Do not create isolated hover backgrounds on every sibling item.
- Keep text resilient: use `min-width: 0`, truncation, or wrapping on long song titles and filenames.
- Use responsive layout rules even for the desktop app because the web fallback at `127.0.0.1:5174` can run in browser windows.

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

- Old preview videos could be mixed with new song audio when several jobs shared one output directory.
- Backing/Vocal switching could surface stems from another song.
- Duplicate history entries appeared after running vocal split.
- The start screen was simplified so the first action is URL/file input.
- Karaoke Room now supports microphone input selection and monitor output.

## Development Plan

### Phase 1: Package Data Model

- Introduce a durable package identity:
  - `packageId`
  - `packageType`
  - `sourceKey`
  - `sourceUrl`
  - `title`
  - `createdAt`
  - `updatedAt`
  - `outputDir`
  - `assets`
  - `playbackBundle`
- Model package children explicitly:
  - `lyrics`
  - `media`
  - `preview`
  - `stems`
  - `recordings`
  - `exports`
- Prefer a per-job `manifest.json` in each output package first.
- Consider SQLite later if search/filtering/history grows beyond simple package metadata.
- Stop relying on broad directory scans as the primary source of truth.

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

Implement a manifest-backed package index. This is the cleanest way to stop cross-song asset mixing permanently and will make future database migration straightforward.
