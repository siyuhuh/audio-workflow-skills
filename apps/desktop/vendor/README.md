# vendor/

Build-time assets bundled into the packaged Electron app via
`extraResources` in `apps/desktop/electron-builder.yml` and
`apps/desktop/electron-builder.offline.yml`. Everything in this
folder is **opt-in** — model folders are included only by the explicit
Offline packaging targets. When they're empty (typical for `pnpm dev`),
`apps/desktop/src/main/lib/bundledModels.ts` no-ops and the desktop
falls back to the regular UVR-detect / HuggingFace download flow.

## Contents

```
vendor/
├── python-runtime/        # Relocatable standalone Python + production packages
├── separator-models/      # Bundled vocal-separator weights
└── whisper-models/        # Direct faster-whisper model directories
    └── small/
        ├── config.json
        ├── model.bin
        ├── tokenizer.json
        └── vocabulary.txt
```

## Populating the bundles

After extracting python-build-standalone into `python-runtime/`, run:

```bash
./scripts/prepare-bundled-runtime.sh
./scripts/fetch-bundled-models.sh
```

Defaults (~530 MB):

* `vendor/separator-models/UVR-MDX-NET-Inst_HQ_3.onnx` (~64 MB)
* `vendor/whisper-models/small/...` (~465 MB)

Override via env vars:

```bash
SEPARATOR_MODEL=UVR-MDX-NET-Voc_FT.onnx WHISPER_MODEL=tiny ./scripts/fetch-bundled-models.sh
```

## How the boot path uses them

* On launch, `detectAndLinkUvr()` symlinks every bundled separator
  weight into the user-data shadow folder it shares with system UVR.
  `audio-separator` finds them via `--model_file_dir <shadow>`.
* The default faster-whisper model is read directly from
  `vendor/whisper-models/small` through
  `VOCALFLOW_WHISPER_MODEL_DIR`; no first-run copy and no duplicate
  Hugging Face blob cache are required. `HF_HOME` remains a writable
  app-managed folder for optional model downloads.

The git-ignore at the repo root keeps the heavy binaries out of
version control:

```
apps/desktop/vendor/separator-models/
apps/desktop/vendor/whisper-models/
apps/desktop/vendor/python-runtime/*
```
