# VocalFlow

English | [中文](README.zh-CN.md)

VocalFlow turns YouTube, Bilibili, local media, and existing vocal stems into a portable karaoke package: MV, original audio, backing track, vocal stem, and word-synced lyrics. The same package can be played in the native Mac Room, VocalFlow Studio, or the iPhone client.

## Download

Current beta: [v0.8.0-beta.2 releases](https://github.com/siyuhuh/audio-workflow-skills/releases/tag/v0.8.0-beta.2)

| App | Use it for | Distribution |
| --- | --- | --- |
| **VocalFlow for Mac** | Recommended Apple Silicon karaoke client: native Room, full-screen stage, recording, Mac mini Agent | One `.dmg` |
| **VocalFlow Studio** | Cross-platform creation/review workflow with the Electron Room | macOS `.dmg`, Windows `.exe` |
| **VocalFlow for iPhone** | Offline playback in the car or away from the Mac; local import and private Agent downloads | TestFlight workflow / Xcode beta |
| **VocalFlow Agent** | Private processing on a Mac mini for the iPhone client | Included in the native Mac app |

The beta release workflow builds ad-hoc/unsigned test installers when Apple distribution credentials are unavailable. A public macOS release without Gatekeeper warnings requires a Developer ID Application certificate and notarization. TestFlight requires an Apple Distribution/App Store Connect setup.

## Does the user need to download models?

For the default desktop workflow, no separate setup is required. Release installers contain:

- Standalone Python 3.12 and the required Python packages.
- `ffmpeg` and `yt-dlp`.
- `faster-whisper-small` for local lyric timing.
- `UVR-MDX-NET-Inst_HQ_3.onnx` for vocal/backing separation.
- The `audio-subtitles` processing scripts.

The desktop apps read the default Whisper model directly from the installer and seed the small separator weight locally when needed; they do not download either default model again. The Mac mini Agent copies the bundled defaults into its application-data folder when installed. Larger Whisper or separator models remain optional downloads. Media URLs still require network access to fetch the source video/audio.

The iPhone app deliberately does not contain Whisper, PyTorch, or separator models. It can:

- Play an imported/downloaded package fully offline.
- Import packages from Files, AirDrop, iCloud Drive, or Finder.
- Ask a private Mac mini Agent to process a URL and download the result.

No public cloud server is required.

## Karaoke Room

Both desktop Rooms support MV playback, adaptive aspect ratio, previous/current/next lyrics, word-level lyric sweep, queue controls, original/backing selection, and an immersive stage.

Performance recording is available in both native Mac and Electron:

- Three-second count-in.
- Microphone take saved as WAV.
- Share-ready music + vocal mix (`M4A` in native Mac; `M4A`, `MP3`, or `WAV` in Studio).
- Recording metadata linked back to the song package.
- Output under `~/Music/VocalFlow/Recordings`.

Recording locks seeking, source switching, and queue navigation until the take stops so the exported mix stays aligned.

## Private Mac mini + iPhone flow

1. Install VocalFlow on the Mac mini and open **Remote**.
2. Click **Install Agent**.
3. Pair the iPhone with the six-digit code over Bonjour (same Wi-Fi) or a private Tailscale URL.
4. Submit a YouTube/Bilibili link from the iPhone.
5. The Mac prepares the package while the phone can be locked or disconnected.
6. Download the finished package to the iPhone and sing offline.

Agent jobs run one at a time and persist across restarts. Packages are stored under `~/Movies/VocalFlow/Remote`.

## CLI

The CLI remains available for automation and custom model setups:

```bash
git clone https://github.com/siyuhuh/audio-workflow-skills.git
cd audio-workflow-skills
./install.sh
```

Examples:

```bash
audio-subtitles --separate --separator-format MP3 "https://www.bilibili.com/video/BV..."
audio-subtitles --separate --separator-format MP3 "https://www.youtube.com/watch?v=..."
audio-subtitles --subtitle-source local "/path/to/video.mp4"
media-mp3 "https://www.youtube.com/watch?v=..."
```

Typical outputs include `stems/`, `.lrc`, `.json`, `.srt`, `.vtt`, and `.ass`.

## Development

Electron:

```bash
pnpm install
pnpm dev
```

Native macOS:

```bash
cd apps/mac/VocalFlowMini
swift run VocalFlow
```

iPhone:

```bash
cd apps/ios/VocalFlowMobile
xcodegen generate
open VocalFlowMobile.xcodeproj
```

Build a local native Mac DMG:

```bash
apps/mac/VocalFlowMini/scripts/build-dmg.sh release
```

Release maintainers populate the standalone runtime and model bundle before packaging:

```bash
cd apps/desktop
./scripts/prepare-bundled-runtime.sh
./scripts/fetch-bundled-models.sh
```

Pushing a `v*` tag builds the native Mac DMG plus Electron macOS/Windows installers. The manual `iOS TestFlight` workflow requires the Apple signing secrets documented in [RELEASING.md](RELEASING.md).

## Package compatibility

- Electron writes `manifest.json`.
- Native Mac writes `vocalflow-package.json`.
- Native Mac and iPhone discover either manifest and fall back to a safe media scan for older/loose folders.
- Recording packages use the shared `recording.json` shape.

## Next release priorities

1. Add Developer ID signing, notarization, and a first-launch installation guide so the public DMG opens without Gatekeeper workarounds.
2. Configure the App Store Connect secrets and run the existing TestFlight workflow on physical iPhones.
3. Add signed auto-update plus resumable optional-model downloads with visible disk-space estimates.
4. Run a passenger-operated in-car usability test: offline package download, queue preparation, audio routing, interruption recovery, and large touch targets.

## Notes

- Song transcription is harder than speech transcription; clean vocal stems often improve lyrics more than a larger model.
- Use headphones for microphone monitoring to avoid feedback.
- Only download or process media you have the right to use.
- Browser cookies are login credentials and must not be committed or shared.
- Do not operate the app while driving. Prepare the queue before departure or let a passenger control playback.

## License

Code is licensed under `AGPL-3.0-or-later`. The VocalFlow names, logos, icons, and product marks are not included in the code license.

More: [native Mac](apps/mac/VocalFlowMini/README.md) · [iPhone](apps/ios/VocalFlowMobile/README.md) · [Electron](apps/desktop/README.md) · [Agent](apps/mac/VocalFlowAgent/README.md)
