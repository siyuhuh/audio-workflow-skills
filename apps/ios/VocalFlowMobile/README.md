# VocalFlow for iPhone

Native SwiftUI karaoke playback with local package import and private Mac mini processing.

## What works

- Import a VocalFlow folder from Files/AirDrop/iCloud Drive and keep it in the app's Documents directory.
- Download a completed package from the paired Mac mini Agent.
- Offline MV or audio playback after import/download.
- Word-synced JSON lyrics with LRC/SRT fallback.
- Original/backing switching and a native mixer.
- In-room queue and low-latency microphone monitor (use headphones).
- Bonjour pairing on local Wi-Fi or private Tailscale access away from home.
- YouTube, Bilibili, BV/av, and direct media jobs submitted to the Mac.

The iPhone does not bundle Whisper, PyTorch, or separation models. The Mac prepares packages; playback, lyrics, mixing, queueing, and monitoring stay on-device. A public cloud service is not required.

## Run

```bash
cd apps/ios/VocalFlowMobile
xcodegen generate
open VocalFlowMobile.xcodeproj
```

Select an iPhone or simulator. A physical device and TestFlight archive require an Apple signing team. The manual GitHub `iOS TestFlight` workflow uses the secrets listed in [RELEASING.md](../../../RELEASING.md).

## Driving safety

Prepare the song queue before driving or let a passenger operate the app. The driver should not search, import, mix, or change queue items while the vehicle is moving.
