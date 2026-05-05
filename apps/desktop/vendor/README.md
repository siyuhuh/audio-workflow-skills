# vendor/

Build-time assets bundled into the packaged Electron app via
`extraResources` in `apps/desktop/package.json`. Everything in this
folder is **opt-in** — when it's empty (typical for `pnpm dev`),
`apps/desktop/src/main/lib/bundledModels.ts` no-ops and the desktop
falls back to the regular UVR-detect / HuggingFace download flow.

## Contents

```
vendor/
├── python-runtime/        # Pre-built Python venv (long-standing)
├── separator-models/      # NEW — bundled vocal-separator weights
└── whisper-cache/         # NEW — bundled HF Hub cache for faster-whisper
    └── hub/models--<org>--<repo>/...
```

## Populating the bundles

Run once before `pnpm dist:mac` / `pnpm dist:win`:

```bash
./scripts/fetch-bundled-models.sh
```

Defaults (~310 MB):

* `vendor/separator-models/UVR-MDX-NET-Inst_HQ_3.onnx` (~50 MB)
* `vendor/whisper-cache/hub/models--Systran--faster-whisper-small/...` (~250 MB)

Override via env vars:

```bash
SEPARATOR_MODEL=UVR-MDX-NET-Voc_FT.onnx WHISPER_MODEL=tiny ./scripts/fetch-bundled-models.sh
```

## How the boot path uses them

* On launch, `detectAndLinkUvr()` symlinks every bundled separator
  weight into the user-data shadow folder it shares with system UVR.
  `audio-separator` finds them via `--model_file_dir <shadow>`.
* On first call, `ensureHfHomeDir()` copies `vendor/whisper-cache/hub/...`
  into a writable user-data folder and pins `HF_HOME` there. Every CLI
  subprocess inherits it via `withHuggingFaceEnv()`, so
  `WhisperModel(<repo>)` resolves the bundled snapshot without hitting
  HuggingFace.

The git-ignore at the repo root keeps the heavy binaries out of
version control:

```
apps/desktop/vendor/separator-models/
apps/desktop/vendor/whisper-cache/
```
