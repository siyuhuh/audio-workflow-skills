# VocalFlow Studio Desktop

Prototype Electron app for the `audio-subtitles` CLI.

For bilingual, scenario-based usage docs, see the root [README](../../README.md).

The app is intentionally a thin shell:

- UI handles input, settings, queue, logs, and output discovery.
- Processing stays in `audio-subtitles`.
- Platform captions are still the first path for supported media URLs.
- Bilibili falls back to local Whisper by default when platform subtitles are unavailable.
- Local Whisper and source separation are configurable from the UI.

## Run Locally

Install the root CLI first (optional for dev; the packaged app bundles its own script):

```bash
cd ../..
./install.sh
```

From the **repository root**, install dependencies and start the desktop app:

```bash
cd ../..
pnpm install
pnpm dev
```

If you are already in `apps/desktop`, run `pnpm install` and `pnpm dev` there instead; the workspace resolves to the same install.

The packaged app includes the `audio-subtitles` script, a bundled Python runtime, and bundled ffmpeg. During local development, the main process also prefers a user-installed CLI at:

```text
~/.local/bin/audio-subtitles
```

For packaged users, Python packages are installed automatically into the user's app data directory on first use. First-run setup needs internet access because `yt-dlp`, `faster-whisper`, `whisper-timestamped`, optional `audio-separator[cpu]`, and Whisper models are downloaded on demand. `whisper-timestamped` is used as the preferred word-alignment engine for karaoke JSON/ASS output and is distributed through the runtime environment under its upstream license.

## Current Scope

- Browse processed songs in the album-style home screen.
- Paste YouTube/Bilibili URL or select a local file/folder.
- Search media from a separate add-flow card.
- Choose subtitle source: Auto, Platform, or Local Whisper.
- Optional local fallback.
- Vocal/instrumental source separation, enabled by default for new karaoke jobs.
- Configure model, language, subtitle language selector, browser cookies, output folder, and output formats.
- Run one job at a time with live logs.
- Open output folder or generated files.
- Practice in the room with playlist continuation, previous/next playback, mobile QR access, and lyrics timing edits.

## Release Installers

This project uses GitHub Actions to build release installers from version tags:

```bash
git tag v0.1.4
git push origin v0.1.4
```

The workflow uploads:

- macOS `.dmg`
- Windows `.exe`

The packaged app includes the `audio-subtitles` script, bundled Python, and bundled ffmpeg. Runtime Python packages are prepared automatically on first use.

## Not Included Yet

- Batch queue execution.
- Auto-update.
