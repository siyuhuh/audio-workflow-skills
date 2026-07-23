# VocalFlow for macOS

Native SwiftUI karaoke, package creation, recording, and private Mac mini processing for Apple Silicon. See the [root README](../../../README.md) for downloads and the complete product family.

## Room

- Songbook and queue remain visible together in the adaptive workspace.
- MV uses aspect-fit sizing; audio-only songs use the branded stage.
- Previous/current/next lyric lines and word-level sweep timing.
- Original, backing, or blended audio with a native mixer.
- Full-screen immersive stage with queue/source/style controls.
- Performance recording with a count-in, raw vocal WAV, M4A mix, and package-linked metadata.

Recordings are written to `~/Music/VocalFlow/Recordings`.

## Studio and media

- YouTube and Bilibili search, URL metadata, and video preview.
- Local audio/video import.
- Package output under `~/Movies/VocalFlow` by default.
- Default `small` Whisper model and fast MDX-Net separator.
- Both `vocalflow-package.json` and Electron `manifest.json` folders are discoverable.

## Mac mini Agent

Open **Remote** and click **Install Agent**. The bundled installer creates a user LaunchAgent on port `8766`, advertises `_vocalflow._tcp` over Bonjour, and prints a six-digit iPhone pairing code.

The Agent:

- Runs one heavy job at a time.
- Persists jobs across restarts.
- Stores results under `~/Movies/VocalFlow/Remote`.
- Uses token authentication and supports private Tailscale HTTPS.
- Reuses the app's bundled Python runtime and models.

## Run locally

```bash
swift build
swift run VocalFlow
```

Build an ad-hoc local app/DMG:

```bash
./scripts/build-app.sh
./scripts/build-dmg.sh release
open dist/VocalFlow.app
```

Release CI first prepares `apps/desktop/vendor/python-runtime`, `separator-models`, and `whisper-cache`; `build-app.sh` copies them into the native bundle. A source checkout without those release assets can still use an installed CLI/runtime for development.

Public DMG distribution requires Developer ID signing and notarization. See [RELEASING.md](../../../RELEASING.md).
