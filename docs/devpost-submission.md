# VocalFlow Devpost Submission

## Elevator pitch

Turn any song or video into synced lyrics, edit-ready subtitles, and sing-along stems—all on your desktop.

## Inspiration

Creating a usable karaoke or subtitle package is still surprisingly fragmented. A singer might use one tool to download media, another to separate vocals, a transcription model to recover lyrics, and several converters to produce files that work in a player or video editor. We wanted to turn that chain of specialist tools into one clear workflow that works for musicians, creators, editors, and language learners.

VocalFlow started from a simple idea: paste a link or choose a local file, then let the software find the fastest reliable path from media to something you can actually sing with, edit, or publish.

## What it does

VocalFlow is a local-first desktop app and CLI toolkit for turning YouTube, Bilibili, other supported media URLs, and local audio or video files into practical creative assets.

It checks for platform captions first and converts the best available track when possible. If captions are missing, it can download or extract the audio, separate vocals from the instrumental, and transcribe the vocal stem locally with Whisper-based models. A single job can produce synced LRC lyrics, SRT/VTT/ASS subtitles, reviewable text, machine-readable JSON timing data, and optional vocal and backing stems.

The desktop experience also includes a Library for completed packages and a karaoke Room for practicing with synchronized lyrics and backing tracks. Advanced users can run the same processing pipeline from the CLI.

## How we built it

We designed VocalFlow around a reusable CLI core and kept the desktop app as an orchestration layer. The app uses Electron, React, TypeScript, Vite, and Tailwind CSS. Electron IPC connects the interface to the same `audio-subtitles` pipeline used by command-line users.

Under the hood, `yt-dlp` handles media metadata, captions, and downloads; `ffmpeg` prepares audio; `audio-separator` creates vocal and instrumental stems; and Whisper-based local models generate timed transcription. The pipeline normalizes these different sources into a shared cue model and exports LRC, SRT, VTT, ASS, TXT, and JSON files.

The packaged desktop releases bundle Python and ffmpeg, then prepare the remaining local dependencies on first run. This lets us distribute the same workflow on macOS and Windows without requiring users to assemble a Python audio stack themselves.

## Challenges we ran into

Music transcription is fundamentally harder than speech transcription. Repeated choruses, harmonies, reverb, ad-libs, and overlapping vocals can confuse both the words and their timing. We had to design the workflow around clean vocal stems and graceful review instead of pretending every song would be perfectly transcribed on the first pass.

Media platforms were another challenge. Caption availability, language identifiers, authentication, and rate limits vary by site. Downloading every possible subtitle track was slow and unreliable, so VocalFlow resolves one best language and uses a platform-first, local-fallback strategy.

Packaging was also non-trivial. The product crosses Electron, Node, Python, ffmpeg, transcription models, and source-separation models. Making that stack understandable and installable on both macOS and Windows required a clear runtime boundary, actionable errors, and careful dependency setup.

## Accomplishments that we're proud of

We are proud that VocalFlow turns a multi-tool technical process into one approachable action while keeping the underlying workflow transparent and reproducible.

The same core supports URLs, local media, and existing UVR stems; produces assets for karaoke, web, video-editing, and automation workflows; and runs transcription locally without requiring an account or sending private media to a hosted transcription service. We also shipped installable macOS and Windows builds, a full CLI path for power users, automatic caption fallback, and a karaoke Room that takes the output beyond file generation into actual practice.

## What we learned

The biggest lesson was that better input usually matters more than a bigger model. A clean vocal stem can improve lyric accuracy more than simply moving to a slower transcription model.

We also learned that smart fallback behavior is part of the product, not just error handling. Users should not need to understand why a platform caption is unavailable before the app can continue with local transcription. Finally, keeping the CLI as the source of truth made the desktop app easier to debug, automate, and evolve without duplicating the media pipeline.

## What's next for VocalFlow

Next, we want to make the generated package easier to refine and reuse. Planned work includes a visual timeline lyric editor, faster cue splitting and merging, batch queues, watch folders, reusable export presets, model-cache management, and automatic app updates.

We also want to deepen the karaoke Room with better timing correction, playlist continuity, and remote controls, while continuing to improve multilingual lyrics and word-level alignment. The long-term goal is for VocalFlow to become the local creative workspace between any piece of media and the moment someone is ready to sing, edit, learn, or publish it.
