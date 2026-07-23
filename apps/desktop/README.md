# VocalFlow Studio (Electron)

VocalFlow Studio is the cross-platform Electron creation and karaoke client. For the product overview and downloads, see the [root README](../../README.md).

## Current scope

- YouTube and Bilibili search, URL metadata, and local file/folder import.
- Platform captions with local `faster-whisper` fallback.
- Vocal/backing separation and portable package manifests.
- MV Room with queue, synced lyrics, original/backing mix, and mobile remote page.
- Three-second recording count-in, microphone WAV take, and M4A/MP3/WAV mix export.
- Recordings saved under `~/Music/VocalFlow/Recordings`.

## Run locally

From the repository root:

```bash
pnpm install
pnpm dev
```

Development can reuse a system CLI/runtime. Release installers instead contain standalone Python, ffmpeg, yt-dlp, faster-whisper, audio-separator, zhconv, and the default model weights.

## Build

```bash
pnpm --filter @vocalflow/desktop build
pnpm --filter @vocalflow/desktop dist:mac
pnpm --filter @vocalflow/desktop dist:win
```

To build the complete offline installer, populate the release-only runtime first:

```bash
cd apps/desktop
./scripts/prepare-bundled-runtime.sh
./scripts/fetch-bundled-models.sh
```

The app id is `com.gottaegbert.vocalflow.studio`, so it can coexist with the native `com.gottaegbert.vocalflow` app.

## Known beta gaps

- No auto-update yet.
- One processing job runs at a time.
- Public macOS distribution needs Developer ID signing and notarization.
