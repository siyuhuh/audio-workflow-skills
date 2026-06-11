# VocalFlow Mini

VocalFlow Mini is the native Swift macOS spike for a simpler VocalFlow experience. The first version is intentionally narrow: one click starts a low-latency microphone monitor for singing practice, and the same control stops it.

## Run Locally

From this directory:

```bash
swift build
swift run VocalFlowMini
```

`swift run` keeps the terminal busy while the macOS window is open. That is expected for this SwiftPM app. Quit VocalFlow Mini from the app menu, Dock, or `Command-Q` to return to the shell prompt.

If the app is already running from an earlier attempt, stop it first:

```bash
pkill -f VocalFlowMini
```

Metal cache messages such as `flock failed`, `fopen failed`, or `Invalidating cache` can appear on launch. They come from Apple's local SwiftUI/Metal cache and usually do not mean the app failed. If the build says `Build of product 'VocalFlowMini' complete!`, check the Dock or use `Command-Tab` to bring VocalFlow Mini forward.

The executable embeds `VocalFlowMini/Info.plist` so macOS can show the microphone permission prompt. If permission was denied earlier, open System Settings → Privacy & Security → Microphone and enable VocalFlow Mini.

## MVP Scope

- SwiftUI window with a single primary listening control.
- `AVAudioEngine` microphone input routed through gain and output mixers.
- User-selectable microphone input device, with a System Default fallback.
- Microphone permission request and clear denied/error states.
- Input level meter, input gain, monitor volume, and a headphone feedback warning.
- Light voice cleanup toggle for singing monitor mode.
- Local karaoke package folder picker that scans audio/video media into a playlist.
- MV playback for native AVPlayer formats such as `.mp4`, `.mov`, and `.m4v`.
- Synced lyric display from same-name `.lrc`, `.srt`, or `audio-subtitles` `.json` files.
- Playback volume and speed controls for the selected karaoke track or MV.
- Package creation from a media URL or local audio/video file through the existing `audio-subtitles` pipeline.
- Optional vocal separation, MV preview saving, local fallback, language, and Whisper model controls.

This version reuses the existing Python `audio-subtitles` CLI for model-backed transcription, URL download, audio extraction, optional separation, and subtitle generation. It does not reimplement Whisper or UVR natively yet.

## Create Packages

Use the `Create Package` card to paste a media URL or choose a local audio/video file. The Swift app creates a dedicated output folder under `~/Movies/VocalFlow Mini` by default, then calls `audio-subtitles` with:

- `--output-dir`
- `--formats lrc,json,srt,ass`
- `--save-audio`
- `--save-video-preview`
- `--local-fallback`
- optional `--separate --separator-format MP3`

When the job succeeds, VocalFlow Mini scans the output folder, writes `vocalflow-package.json`, and loads the package into the karaoke player.

For URL sources the MV is not downloaded. Instead the player resolves a direct stream URL with `yt-dlp -g` at playback time and streams the online MV in AVPlayer, with lyrics synced to the same timeline. If resolution fails (offline, region lock), playback falls back to the generated backing/vocal stems.

## Karaoke Package Folders

Click `Choose Folder` and select a folder that contains a karaoke package. VocalFlow Mini scans the folder recursively for:

- Media: `.mp3`, `.m4a`, `.wav`, `.flac`, `.aac`, `.mp4`, `.mov`, `.m4v`
- Lyrics: `.lrc`, `.srt`, `.json`

Lyrics are matched by filename stem. For example, `song.mp4` pairs with `song.lrc`, `song.srt`, or `song.json`. `.lrc` is preferred, then `.json`, then `.srt`.

## Phase Two Bridge

Once the monitor mode feels right, the next step is recording a take and handing that file to the existing `audio-subtitles` pipeline:

1. Record mic input to WAV or M4A in Swift.
2. Call the installed `audio-subtitles` command, or invoke `skills/audio-subtitles/scripts/generate_subtitles.py` through `Process`.
3. Read generated `.json`, `.lrc`, or `.srt` outputs back into a native review/practice view.

Keep the current repository boundary intact: Swift owns the native interaction, while `audio-subtitles` remains the source of truth for model-backed transcription and subtitle generation.
