# VocalFlow reliability and lyrics roadmap

Product scope remains universal karaoke. Browser inference is an additional delivery option, not a reason to remove the desktop product.

## P0: Download-and-use release gate

- Verify installer checksum on both source and destination. Distinguish a damaged disk image from Gatekeeper rejecting an application.
- Developer ID sign and notarize the macOS distribution; staple and assess the final artifact. A development/ad-hoc signature is not a substitute.
- Exercise the relocated packaged runtime with user packages disabled, empty model caches, restricted PATH and network denied. Require actual stems and transcription, not file existence alone.
- Test first launch, local import, separation, playback and recording on a clean target Mac. Keep installer status experimental until this passes.
- Verify public online media separately. Explicit authentication requests, generic 403, rate limits, missing runtime and model failures must not share a misleading cookies prompt.
- Ship application-managed downloader dependencies. Audit JavaScript challenge runtime/EJS availability before claiming supported YouTube imports. Do not tell packaged users to fix internal dependencies with Homebrew.
- Default models must be present and validated. Optional models need explicit size/download consent and recoverable progress.

## P1: Reliable lyrics

### Implemented for beta.8 (2026-10-27)

- Karaoke separation no longer bypasses platform captions. Successful captions do not skip stem generation.
- Karaoke auto mode selects human-uploaded captions matching the requested language or the source metadata language. Unknown language, automatic-only tracks and translated tracks fall back to local recognition when enabled. Subtitle selectors further restrict eligible tracks.
- Caption metadata failures also participate in auto fallback; explicit platform-only mode remains strict.
- Caption outputs retain source URL, manual/automatic provenance, line-level timing precision and a review flag. Local recognition is marked as a draft. These fields are output metadata, not yet UI badges.
- No new models, accounts or runtime dependencies are required by this change.
- Karaoke auto mode now runs independent local ASR against the vocal audio to assess caption agreement. The bounded heuristic measures bidirectional normalized-text coverage and coarse temporal overlap without rewriting lyrics or generating word times. It retains repetitions. Thresholds are provisional, not calibrated accuracy scores.
- A text mismatch uses the local recognition draft only when fallback is enabled. Timing-only disagreement retains the caption text with a timing-review status. Sparse evidence is inconclusive; failed checks retain captions with an explicit unavailable status. Platform-only mode does not invoke ASR. All results still need review.
- Offline mocked regression coverage (14 tests): caption success with separation and ASR checking, absent captions, metadata failures, strict mode, language selection, malformed cue times, wrong text, missing repeats, shifted timestamps, sparse evidence and optional-check failure.

This is an incremental integration, not parity with the reference project. Human captions are not guaranteed official lyrics; agreement with imperfect ASR is only supporting evidence. Existing caption line times are retained, not acoustically aligned word times. Full-song accuracy, traditional/simplified Chinese matching, external subtitle availability and the rebuilt installer still require testing. Auto mode now incurs a local recognition pass even when captions are available.

### Next steps

- Separate canonical text, provenance, timing and human edits in a versioned schema.
- Preserve platform subtitles and user LRC/SRT/text import; mark ASR output as draft.
- Add text correction and line timing adjustment before introducing heavier automatic alignment.
- Align confirmed text against vocals, preserving repetitions, instrumental gaps and unresolved regions. Never label interpolated timing as acoustic evidence.
- Evaluate singing-specific alignment on a fixed authorized multilingual corpus; benchmark browser feasibility independently of Python implementations.
- Keep audio playback available when lyrics fail. Preserve user edits across retries.

## P2: Recoverable processing

### Queue persistence implemented in source (2026-10-27; after beta.8)

- Room queue order and item status are stored in a versioned `room-queue.json` under application user data, using a temporary file and atomic rename.
- Queue mutations are persisted before being acknowledged; failed writes do not replace in-memory state.
- On restart, interrupted running items become failed and require deliberate retry. Playback is not automatically resumed. Completed history references and waiting items are retained.
- Unreadable or unsupported saved state is preserved, and queue mutations are blocked rather than silently overwriting it. Recovery currently requires inspecting the saved file; no recovery UI has been added.
- Tests cover round trips, order, interrupted items, malformed input, duplicate IDs, invalid versions, replacement and write-failure preservation. Main-process TypeScript compilation passes.

### Retry binding and separation recovery (2026-10-28; not packaged)

- A versioned retry journal binds identical input/options to the previous unfinished output directory, across app restarts. Success clears the binding. Credentials are not stored in plain text in this journal. Changed settings create a separate identity; old outputs are not deleted.
- Main-process admission allows only one workflow at a time, including runtime preparation, to avoid concurrent writes to a recovered directory.
- Separation checkpoints record hashes of input audio, explicit model, implementation, output tracks, output format and the installed separator version. Reuse requires all checks to pass and outputs to remain inside the stem directory. Unknown preset dependencies disable reuse.
- Removed the fallback that could select unrelated old stem files when a new separation produced no outputs.
- This recovers the separation stage only. URL metadata/download and transcription can still run again. A changed downloaded audio hash invalidates separation reuse. There is no cross-song cache, download checkpoint, general stage-retry UI or automatic playback on partial failure yet.
- Backend tests cover restart binding, successful cleanup, damaged journals, checkpoint corruption, model/input changes and actual second-call subprocess avoidance with fixtures.

### Partial backing playback (2026-10-28; not packaged)

- A failed karaoke job can retain an audio-only library entry when separation reported completion and a nonempty backing file exists. Cancellation and failed separation do not qualify.
- Only vocal/backing audio is retained in a partial entry; potentially truncated subtitles are excluded. The task remains failed and its retry binding remains intact. Partial entries do not receive a successful manifest during history migration.
- Existing complete songs are not downgraded by a failed reprocessing attempt. Karaoke entry controls no longer require a subtitle file; existing no-lyrics display is retained.
- Selection-policy tests and main-process compilation pass. Frontend interaction and real end-to-end failure recovery remain unverified; no new DMG has been built for this change.

- Content-addressed stage signatures: input hash, model identity, parameters and implementation version.
- Atomically commit completed-stage manifests; never reuse partial output.
- Retry failed stages without repeating valid separation/download work.
- Storage budget, cache eviction and explicit cancellation; preserve exported user recordings.

## Acceptance evidence

Maintain independent functional and perceptual checks: installation, offline processing, music leakage/artifacts, chunk boundaries, timing error, recording synchronization, long-song memory and interrupted jobs. Synthetic smoke tests cannot establish music quality.

## References

- https://github.com/Trinkle23897/karaoke/blob/main/karaoke/stage_cache.py
- https://github.com/Trinkle23897/karaoke/blob/main/karaoke/pipeline.py
- https://github.com/Trinkle23897/karaoke/blob/main/karaoke/docs/automatic-quality.md
- https://github.com/Trinkle23897/karaoke/blob/main/THIRD_PARTY.md

Learn the design; audit licenses of any copied source, model and transitive dependency separately before distribution.
