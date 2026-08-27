# VocalFlow

[中文](README.md) | English

VocalFlow turns YouTube, Bilibili, local media, or existing vocal stems into a portable karaoke package: MV, original audio, backing track, vocal stem, and word-synced lyrics. Finished packages can be played in the native Mac client or the cross-platform VocalFlow Studio.

## Download

Current beta: [VocalFlow v0.8.0-beta.4](https://github.com/siyuhuh/audio-workflow-skills/releases/tag/v0.8.0-beta.4)

| Download | Platform | Use it for | Size |
| --- | --- | --- | ---: |
| `VocalFlow-0.8.0-beta.4-mac-arm64.dmg` | Apple Silicon Mac (M1/M2/M3/M4, etc.) | Recommended native Mac karaoke client with Room, recording, and Mac mini Agent | About 997 MB |
| `VocalFlow.Studio-0.8.0-beta.4-mac-arm64.dmg` | Apple Silicon Mac (M1/M2/M3/M4, etc.) | Cross-platform creation, review, and playback studio | About 411 MB |
| `VocalFlow.Studio-0.8.0-beta.4-win-x64.exe` | 64-bit Windows | Cross-platform creation, review, and playback studio | About 377 MB |

There is no Intel Mac installer yet. The iPhone client is still distributed through the TestFlight/Xcode beta workflow and is not included in this GitHub Release.

## Can I use it immediately after downloading?

Yes. Desktop installers contain the Python runtime, processing dependencies, `ffmpeg`, `yt-dlp`, the default Whisper model, and the default UVR separator model. You do not need to install Python, Homebrew, or a model separately.

1. Download the installer that matches your device.
2. On macOS, open the DMG and drag the app to Applications. On Windows, run the EXE.
3. Open the app, import a local file, or paste a media URL.

This is an unsigned and unnotarized prerelease, so the operating system may block the first launch:

- macOS: right-click the app in Finder and choose **Open**, or use **System Settings → Privacy & Security → Open Anyway**. If macOS says the app is damaged, first verify that it came from this repository's Release, then run:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/VocalFlow.app"
  # For VocalFlow Studio:
  xattr -dr com.apple.quarantine "/Applications/VocalFlow Studio.app"
  ```

- Windows: when SmartScreen appears, choose **More info → Run anyway**.

## Models, network access, and disk space

The default desktop workflow does not download another model. Installers include:

| Bundled item | Purpose | Approximate size |
| --- | --- | ---: |
| `faster-whisper-small` | Local lyric transcription and timing | 464–486 MB |
| `UVR-MDX-NET-Inst_HQ_3.onnx` | Default vocal/backing separation | 64 MB |
| Model total | Already included in the installer | About 527 MB |

If you select a larger Whisper model in Studio's Advanced settings, the first use downloads it from Hugging Face and caches it locally:

| Optional Whisper model | First download | Notes |
| --- | ---: | --- |
| `small` | Bundled | Default balance of speed and quality |
| `medium` | About 1.53 GB | Slower; may improve some difficult lyrics |
| `large-v3-turbo` | About 1.62 GB | Larger, faster model |
| `large-v3` | About 3.09 GB | Highest storage and resource usage |

Sizes may change slightly when upstream model files are updated. Custom separator models are user-provided and are commonly tens to hundreds of megabytes. Singing differs from ordinary speech; a clean vocal stem often improves lyrics more than blindly choosing the largest Whisper model.

- Local-file processing, playback of imported packages, and recording can work offline.
- YouTube/Bilibili downloads, online search, and the first optional-model download require a network connection.
- Keep at least 5 GB free. Allow 10 GB or more if you use `large-v3` or retain many MVs and intermediate files.
- A finished song normally uses tens to hundreds of megabytes; HD video can use more.

## Language

- The repository home page defaults to Chinese. This file is the complete English version. Release notes also present Chinese first, followed by English.
- VocalFlow Studio follows the system language on first launch: Chinese systems default to Chinese and other systems default to English. You can switch between 中文 and English in Settings at any time.
- The native Mac client currently remains primarily English; more Chinese localization is planned.

## Karaoke Room and recording

Both desktop Rooms support MV playback, adaptive aspect ratio, previous/current/next lyrics, word-level lyric sweep, queue controls, original/backing selection, and an immersive stage.

Native Mac and Studio both support performance recording:

- Three-second count-in.
- Raw microphone take saved as WAV.
- A share-ready music + vocal mix (M4A in native Mac; M4A, MP3, or WAV in Studio).
- Recording metadata linked back to the song package.
- Output under `~/Music/VocalFlow/Recordings`.

Recording locks seeking, source switching, and queue navigation until the take stops so the exported mix stays aligned. Headphones are recommended to avoid feedback and backing-track bleed.

## Private Mac mini + iPhone flow

1. Install VocalFlow on the Mac mini and open **Remote**.
2. Click **Install Agent**.
3. Pair the iPhone with the six-digit code over Bonjour on the same Wi-Fi, or use a private Tailscale URL.
4. Submit a YouTube/Bilibili link from the iPhone.
5. The Mac prepares the package while the phone can be locked or disconnected.
6. Download the finished package to the iPhone and play it offline.

Agent jobs run one at a time and persist across restarts. Packages are stored under `~/Movies/VocalFlow/Remote`. The iPhone app does not contain Whisper, PyTorch, or separator models and does not require a public cloud server.

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

See [RELEASING.md](RELEASING.md) for release and signing details.

## Notes

- Only download or process media you have the right to use.
- Browser cookies are login credentials and must not be committed or shared.
- Do not operate the app while driving. Prepare the queue before departure or let a passenger control playback.

## License

Code is licensed under `AGPL-3.0-or-later`. The VocalFlow names, logos, icons, and product marks are not included in the code license.

More: [native Mac](apps/mac/VocalFlowMini/README.md) · [iPhone](apps/ios/VocalFlowMobile/README.md) · [Electron](apps/desktop/README.md) · [Agent](apps/mac/VocalFlowAgent/README.md)
