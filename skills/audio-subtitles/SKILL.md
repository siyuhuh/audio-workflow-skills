---
name: audio-subtitles
description: Generate timestamped lyrics and subtitles from audio, video, media URLs such as YouTube/Bilibili, or vocal stems. Use when Codex needs to turn WAV/MP3/M4A/FLAC audio, MP4/MOV/MKV video, media links, Ultimate Vocal Remover vocal/acapella outputs, or UVR-style separated stems into SRT, VTT, LRC, plain text, or JSON timing files for singing practice, karaoke, lyric display, subtitle editing, or DAW/video workflows.
---

# VocalFlow Subtitles

## Default Workflow

Use the bundled command:

```bash
audio-subtitles "/path/to/audio-or-video"
```

Default behavior:

- Accept audio files such as `.wav`, `.mp3`, `.m4a`, `.flac`, `.aac`, `.ogg`, `.opus`, `.aiff`.
- Accept video files such as `.mp4`, `.mov`, `.mkv`, `.webm`, `.avi`, `.m4v`; extract audio with `ffmpeg`.
- Accept media URLs such as YouTube or Bilibili; use platform subtitles first with `yt-dlp` before local model work when available.
- Accept an Ultimate Vocal Remover output folder; prefer files named like `vocals`, `vocal`, `voice`, or `acapella`.
- Optionally run UVR-style source separation first via `audio-separator`.
- Output `.srt`, `.vtt`, `.lrc`, `.txt`, `.json`, and `.ass` next to the input unless `--output-dir` is set.
- Use `whisper-timestamped` first for local word alignment, with `faster-whisper` as fallback for local media, `--subtitle-source local`, or URL `--local-fallback`.
- Keep generated subtitle files separate from audio files; do not overwrite source media.

Install the local transcription dependency when missing:

```bash
setup-audio-subtitles
```

Install optional UVR-style separation support when the user wants an end-to-end vocals/instrumental split:

```bash
setup-audio-separator
```

## Commands

Generate subtitles from a normal audio file:

```bash
audio-subtitles "/path/to/song.mp3"
```

Generate subtitles from a video file:

```bash
audio-subtitles "/path/to/video.mp4"
```

Generate subtitles directly from a media URL:

```bash
audio-subtitles "https://www.youtube.com/watch?v=..."
audio-subtitles "https://www.bilibili.com/video/BV..."
```

For URL inputs, default behavior is to download available platform subtitles or auto-subtitles and convert them to `.srt`, `.vtt`, `.lrc`, `.txt`, `.json`, and `.ass`. This avoids running Whisper when platform captions already exist. Bilibili URLs fall back to local Whisper by default when no platform subtitles are available.

Select subtitle languages:

```bash
audio-subtitles --sub-langs "zh.*,en.*" "https://www.youtube.com/watch?v=..."
audio-subtitles --language zh "https://www.youtube.com/watch?v=..."
```

Use browser cookies if a site asks for sign-in:

```bash
audio-subtitles --browser chrome "https://www.youtube.com/watch?v=..."
audio-subtitles --browser chrome "https://www.bilibili.com/video/BV..."
```

Use local Whisper only when explicitly requested:

```bash
audio-subtitles --subtitle-source local "https://www.youtube.com/watch?v=..."
audio-subtitles --force-local "https://www.youtube.com/watch?v=..."
```

Try platform subtitles first, then use local Whisper if none exist:

```bash
audio-subtitles --local-fallback "https://www.youtube.com/watch?v=..."
```

Keep raw platform subtitle files:

```bash
audio-subtitles --keep-platform-subs "https://www.youtube.com/watch?v=..."
```

Generate subtitles from a UVR output folder:

```bash
audio-subtitles "/path/to/uvr-output-folder"
```

Separate vocals/instrumental first, then transcribe the vocal stem:

```bash
audio-subtitles --separate "/path/to/song.mp3"
audio-subtitles --separate "/path/to/video.mp4"
audio-subtitles --separate "https://www.youtube.com/watch?v=..."
```

Use a specific UVR/audio-separator model or ensemble preset:

```bash
audio-subtitles --separate --separator-preset vocal_balanced "/path/to/song.wav"
audio-subtitles --separate --separator-model model_bs_roformer_ep_317_sdr_12.9755.ckpt "/path/to/song.wav"
```

Use a specific model:

```bash
audio-subtitles --model medium "/path/to/vocals.wav"
audio-subtitles --model large-v3-turbo "/path/to/vocals.wav"
```

Force a language when auto-detection is wrong:

```bash
audio-subtitles --language zh "/path/to/vocals.wav"
audio-subtitles --language en "/path/to/vocals.wav"
```

Save files elsewhere:

```bash
audio-subtitles --output-dir "/path/to/subtitles" "/path/to/song.wav"
```

Keep extracted audio from a video:

```bash
audio-subtitles --save-audio "/path/to/video.mov"
```

## Input Choice

For lyrics/subtitles, transcribe vocals, not accompaniment. Instrumental/accompaniment stems usually contain little or no lyric information, so Whisper-like ASR cannot reliably recover words from them.

For UVR workflows:

- Use the `vocals` or `acapella` stem to generate subtitles.
- Use the `instrumental` or `no_vocals` stem as the backing track in GarageBand or other music software.
- Keep both files with the same song name so the generated `.lrc`/`.srt` can be matched manually.

If only the mixed song is available, transcribe the mixed song. Separation first usually improves lyric accuracy for dense arrangements.

The official Ultimate Vocal Remover GUI is best treated as a manual stem producer. For command-line automation, use `audio-subtitles --separate`, which calls `audio-separator`: a CLI/Python package using MDX-Net, VR Arch, Demucs, and MDXC models available in the UVR ecosystem. This avoids depending on UVR GUI internals that may change.

## Output Formats

- `.lrc`: best first output for music-player style synchronized lyrics.
- `.srt`: best for video editors and subtitle tools.
- `.vtt`: best for web playback.
- `.txt`: quick review transcript with timestamps.
- `.json`: machine-readable segment timing for later conversion or cleanup.
- `.ass`: karaoke subtitle output using ASS `\kf` timing tags.

GarageBand may import audio/MIDI cleanly, but it is not a reliable native subtitle/lyrics-file viewer. Treat the generated `.lrc`/`.srt` as a companion file for a lyrics viewer, video editor, or another music app/plugin that explicitly supports timed lyrics/subtitles.

## Platform Subtitle Policy

For URL inputs, prefer platform subtitles because they are faster, cheaper, and often good enough:

- `--subtitle-source auto` is the default: try platform subtitles first.
- `--subtitle-source platform` only uses platform subtitles and fails if none are available.
- `--subtitle-source youtube` is kept as a compatibility alias for `platform`.
- Bilibili URLs default to local Whisper fallback when no platform subtitles are available.
- `--local-fallback` allows auto mode to run local Whisper when other sites have no matching subtitles.
- `--subtitle-source local` or `--force-local` skips platform subtitles and runs local Whisper.
- `--sub-langs` accepts `yt-dlp`-style language selectors such as `zh.*,en.*`, but the script resolves them to one best language before downloading to avoid bulk subtitle downloads and rate limits.

## Model Guidance

Default to `medium` for a balance of quality and speed on a Mac CPU.

Use:

- `small`: fast drafts, short practice files, lower accuracy.
- `medium`: recommended default for singing lyrics.
- `large-v3-turbo`: better quality when speed is acceptable and memory is enough.
- `large-v3`: best local Whisper-family accuracy, slower and heavier.

For this skill, prefer `whisper-timestamped` first for karaoke word alignment. Keep `faster-whisper` available as a faster/lower-memory fallback for the same Whisper model family.

Use `whisper.cpp` when the user wants a native C/C++ route, especially on Apple Silicon with Core ML/Metal-oriented setup. It requires converting input to 16-bit mono WAV for the CLI.

Use WhisperX only when the user specifically needs more accurate word-level alignment or speaker diarization. It is heavier, especially without a CUDA GPU.

## Quality Notes

- Song transcription is harder than speech transcription; expect manual cleanup for repeated choruses, ad-libs, harmonies, and heavy effects.
- A clean vocal stem usually improves results more than choosing a larger model.
- If timestamps drift, rerun from the vocal stem, force `--language`, or try a larger model.
- If the generated subtitles are too dense, rerun with a lower `--max-line-chars`.
- If separation is slow or fails on long files, pass a shorter clip first, use a lower-resource separator model, or run UVR GUI manually and then pass the exported `vocals` file/folder to this skill.
