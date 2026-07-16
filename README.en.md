# VocalFlow Studio

English | [中文](README.zh-CN.md)

VocalFlow Studio is a desktop and CLI toolkit for singing practice, video subtitles, and vocal separation. It accepts YouTube, Bilibili, and other `yt-dlp` supported media URLs, plus local audio files, video files, and UVR vocal stems.

## Download

Latest release: [v0.1.8](https://github.com/gottaegbert/audio-workflow-skills/releases/tag/v0.1.8)

- [Download for macOS Apple Silicon (.dmg)](https://github.com/gottaegbert/audio-workflow-skills/releases/download/v0.1.8/VocalFlow-0.1.8-mac-arm64.dmg)
- [Download for Windows x64 (.exe)](https://github.com/gottaegbert/audio-workflow-skills/releases/download/v0.1.8/VocalFlow-0.1.8-win-x64.exe)

The desktop app includes the `audio-subtitles` script, a bundled Python runtime, and bundled ffmpeg. On first use, it creates a local runtime in the user's app data directory and installs the Python packages needed for URL downloads, local transcription, and optional vocal separation. The first run needs internet access.

## What's New in v0.1.8

- New project logo / app icon from the Foundations brand mark (olive canvas + sage monogram), used for macOS/Windows installers and in-app header + intro splash.
- Room setlist / Library resource cards and denser list chrome continue the sage industrial instrument language.

## Use Cases

### 1. Karaoke / Singing Practice Package

Use this when you want to paste a YouTube, Bilibili, or other media URL and generate practice-ready assets.

```bash
audio-subtitles --separate --separator-format MP3 "https://www.bilibili.com/video/BV..."
audio-subtitles --separate --separator-format MP3 "https://www.youtube.com/watch?v=..."
```

Typical outputs:

- Vocal stem under `stems/`.
- Instrumental / no-vocals stem under `stems/`.
- `.lrc` synced lyrics.
- `.srt` / `.vtt` subtitles.
- `.txt` / `.json` for review and downstream processing.

Notes:

- `--separate` separates vocals and instrumental first, then transcribes the vocal stem.
- `--separator-format MP3` writes separated stems as MP3; the default is WAV.
- YouTube usually uses platform subtitles or auto-subtitles first.
- Bilibili falls back to local Whisper by default in `auto` mode when no platform subtitles are available.

### 2. Video Subtitle Extraction

Use this when you need subtitle files for CapCut, Premiere, DaVinci Resolve, Final Cut, subtitle tools, or web playback.

Local video:

```bash
audio-subtitles "/path/to/video.mp4"
```

Media URL:

```bash
audio-subtitles "https://www.bilibili.com/video/BV..."
audio-subtitles "https://www.youtube.com/watch?v=..."
```

Default behavior:

- If `yt-dlp` exposes platform subtitles, VocalFlow downloads and converts them first.
- If the URL is Bilibili and no platform subtitles are available, it falls back to local Whisper by default.
- For other sites without platform subtitles, add `--local-fallback`.

```bash
audio-subtitles --local-fallback "https://example.com/video"
```

### 3. Existing Vocal Stems / UVR Output

Use this when you already separated vocals with Ultimate Vocal Remover GUI or another tool.

```bash
audio-subtitles "/path/to/uvr-output-folder"
audio-subtitles "/path/to/vocals.wav"
```

The tool prefers files named with markers such as `vocals`, `vocal`, `voice`, or `acapella`.

### 4. MP3 Download Only

`media-mp3` downloads audio from `yt-dlp` supported sites, including YouTube and Bilibili.

```bash
media-mp3 "https://www.bilibili.com/video/BV..."
media-mp3 "https://www.youtube.com/watch?v=..."
```

The old `youtube-mp3` command remains available as a compatibility alias.

## CLI Install

```bash
git clone https://github.com/gottaegbert/audio-workflow-skills.git
cd audio-workflow-skills
./install.sh
```

Install runtime dependencies:

```bash
# macOS
HOMEBREW_NO_AUTO_UPDATE=1 brew install ffmpeg yt-dlp

# local lyrics/subtitle recognition
setup-audio-subtitles

# optional vocals/instrumental separation
setup-audio-separator
```

`setup-audio-separator` installs PyTorch and separation dependencies, so it is much larger than the transcription-only setup. Install it only when you need `audio-subtitles --separate`.

## Desktop App

From the repository root (pnpm workspace):

```bash
./install.sh
pnpm install
pnpm dev
```

The same scripts work from `apps/desktop` if you prefer `cd apps/desktop` first.

The desktop app includes the `audio-subtitles` script, bundled Python, and bundled ffmpeg. It auto-installs Python packages on first use instead of requiring users to run CLI setup commands. It supports:

- Pasting YouTube / Bilibili URLs.
- Selecting local audio, video, or UVR output folders.
- Platform subtitles first, local Whisper, and default Bilibili local fallback.
- Optional vocals / instrumental separation.
- Output directory, model, language, cookies, and output format settings.
- Command preview, logs, and opening generated files.

## Common Options

Choose subtitle language:

```bash
audio-subtitles --sub-langs "zh.*,en.*" "https://www.bilibili.com/video/BV..."
audio-subtitles --language zh "/path/to/video.mp4"
```

Force local recognition:

```bash
audio-subtitles --subtitle-source local "https://www.bilibili.com/video/BV..."
audio-subtitles --force-local "https://www.youtube.com/watch?v=..."
```

Use platform subtitles only:

```bash
audio-subtitles --subtitle-source platform "https://www.youtube.com/watch?v=..."
```

Save files elsewhere:

```bash
audio-subtitles --output-dir "/path/to/output" "/path/to/video.mp4"
```

Use browser cookies when a site requires sign-in:

```bash
audio-subtitles --browser chrome "https://www.bilibili.com/video/BV..."
media-mp3 --browser chrome "https://www.bilibili.com/video/BV..."
```

## Release DMG / EXE

Maintainers can push a version tag to let GitHub Actions build desktop installers and upload them to a GitHub Release:

```bash
git tag v0.1.8
git push origin v0.1.8
```

Release assets:

- macOS: `.dmg`
- Windows: `.exe`

Note: the desktop app includes the `audio-subtitles` script, a bundled Python runtime, and bundled ffmpeg. It installs `yt-dlp`, `faster-whisper`, and optional `audio-separator[cpu]` into a local app runtime on first use.

## Outputs

- `.lrc`: synced lyrics.
- `.srt`: video editors and subtitle tools.
- `.vtt`: web playback.
- `.txt`: timestamped text review.
- `.json`: machine-readable cue data.
- `stems/`: vocals and instrumental files when `--separate` is enabled.

## Notes

- Song transcription is harder than speech transcription; choruses, harmonies, reverb, and overlapping vocals often need manual cleanup.
- A clean vocal stem usually improves lyric accuracy more than simply choosing a larger model.
- Only download or process media you have the right to use.
- Browser cookies are login credentials; do not commit or share them.

## License

Code is licensed under `AGPL-3.0-or-later` from this version forward. Versions already released under MIT remain available under the MIT terms that applied to those releases.

The names `VocalFlow` and `VocalFlow Studio`, plus logos, icons, product marks, and release artwork, are not licensed as part of the source code license. Commercial licensing, proprietary distribution, white-label builds, and enterprise use are available separately from the project owner.

## More

- Workflow notes: [docs/flow.md](docs/flow.md)
- Desktop app product notes: [docs/desktop-app-prd.md](docs/desktop-app-prd.md)
- Upstream tools: [yt-dlp](https://github.com/yt-dlp/yt-dlp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [audio-separator](https://pypi.org/project/audio-separator/), [Ultimate Vocal Remover GUI](https://github.com/Anjok07/ultimatevocalremovergui)

