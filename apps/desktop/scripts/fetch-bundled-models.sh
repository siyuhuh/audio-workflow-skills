#!/usr/bin/env bash
#
# fetch-bundled-models.sh — populate `apps/desktop/vendor/` with the model
# weights that ship inside the .dmg / .nsis installer.
#
# Run this ONCE before `pnpm dist:mac` / `pnpm dist:win`. The destination
# folders are listed under `extraResources` in `apps/desktop/package.json`
# and end up at `process.resourcesPath` inside the packaged app, where
# `apps/desktop/src/main/lib/bundledModels.ts` finds them on launch and
# seeds them into the user-data shadow folders so the desktop runs
# offline-by-default.
#
# Disk + bandwidth budget at the chosen defaults (~310 MB):
#   * Vocal separator (UVR-MDX-NET-Inst_HQ_3.onnx)        ~ 50 MB
#   * Whisper transcribe (Systran/faster-whisper-small)   ~ 250 MB
#
# Override via env vars:
#   SEPARATOR_MODEL=UVR-MDX-NET-Voc_FT.onnx ./fetch-bundled-models.sh
#   WHISPER_MODEL=tiny ./fetch-bundled-models.sh
#   PYTHON=python ./fetch-bundled-models.sh        # Windows / GH Actions
#
# Requirements: a python interpreter (3.10+) reachable as `$PYTHON`
# (default `python3`) with the `huggingface_hub` package + bash. No curl.

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
DESKTOP_DIR=$(cd -- "$SCRIPT_DIR/.." &>/dev/null && pwd)
VENDOR_DIR="$DESKTOP_DIR/vendor"

# Pick the right python invocation: macOS / Linux usually have `python3`,
# Windows GitHub runners only register `python`. The CI workflow exports
# `PYTHON=python` explicitly; locally we fall back to `python3`.
PYTHON_BIN="${PYTHON:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "[fatal] '$PYTHON_BIN' not found in PATH. Export PYTHON=<your-python> and retry." >&2
  exit 1
fi

SEPARATOR_MODEL="${SEPARATOR_MODEL:-UVR-MDX-NET-Inst_HQ_3.onnx}"
WHISPER_MODEL="${WHISPER_MODEL:-small}"
WHISPER_REPO="Systran/faster-whisper-${WHISPER_MODEL}"

SEP_DIR="$VENDOR_DIR/separator-models"
WHISPER_DIR="$VENDOR_DIR/whisper-cache"
WHISPER_HUB_DIR="$WHISPER_DIR/hub"

mkdir -p "$SEP_DIR" "$WHISPER_HUB_DIR"

# ----- 1. Vocal separator (audio-separator picks it up via --model_file_dir) -----
SEP_TARGET="$SEP_DIR/$SEPARATOR_MODEL"
if [[ -f "$SEP_TARGET" ]]; then
  echo "[separator] $SEPARATOR_MODEL already present in $SEP_DIR — skipping"
else
  echo "[separator] Fetching $SEPARATOR_MODEL from HuggingFace…"
  # The separator weights are hosted under github + a HF mirror; pull
  # from HF Hub via huggingface_hub so the script Just Works for users
  # who already have a token set in their shell.
  SEP_DIR="$SEP_DIR" SEPARATOR_MODEL="$SEPARATOR_MODEL" "$PYTHON_BIN" - <<'PY'
from huggingface_hub import hf_hub_download
import os
import shutil

dst_dir = os.environ["SEP_DIR"]
filename = os.environ["SEPARATOR_MODEL"]
# These models live under `seanghay/uvr_models` (a community mirror that
# tracks the upstream UVR catalogue).
local_path = hf_hub_download(
    repo_id="seanghay/uvr_models",
    filename=filename,
    cache_dir=os.path.join(dst_dir, ".hf-tmp"),
)
final = os.path.join(dst_dir, filename)
shutil.copy2(local_path, final)
shutil.rmtree(os.path.join(dst_dir, ".hf-tmp"), ignore_errors=True)
print(f"[separator] Wrote {final}")
PY
fi

# ----- 2. Whisper snapshot (faster-whisper picks it up via HF_HOME) -----
WHISPER_SLUG="${WHISPER_REPO//\//--}"
WHISPER_LOCAL="$WHISPER_HUB_DIR/models--$WHISPER_SLUG"
if [[ -d "$WHISPER_LOCAL" ]]; then
  echo "[whisper] $WHISPER_REPO snapshot already present — skipping"
else
  echo "[whisper] Fetching $WHISPER_REPO snapshot from HuggingFace…"
  WHISPER_REPO="$WHISPER_REPO" WHISPER_DIR="$WHISPER_DIR" "$PYTHON_BIN" - <<'PY'
from huggingface_hub import snapshot_download
import os
import shutil

repo = os.environ["WHISPER_REPO"]
target = os.environ["WHISPER_DIR"]
# `snapshot_download` materialises the HF Hub layout (refs/, snapshots/,
# blobs/) inside `cache_dir`, which is exactly what faster-whisper looks
# for when `HF_HOME` is set to the parent folder.
snapshot_download(repo_id=repo, cache_dir=os.path.join(target, "hub"))

# Electron-builder's Windows 7zip step chokes on symlink entries from the
# HF snapshot cache (it reports "The directory name is invalid"). Materialise
# those links as regular files so packaging works on both macOS and Windows.
hub_root = os.path.join(target, "hub")
for root, _dirs, files in os.walk(hub_root):
    for name in files:
        full = os.path.join(root, name)
        if not os.path.islink(full):
            continue
        resolved = os.path.realpath(full)
        os.remove(full)
        shutil.copy2(resolved, full)

print(f"[whisper] Wrote snapshot under {target}/hub/")
PY
fi

# ----- Summary -----
echo ""
echo "Bundled model summary:"
du -sh "$SEP_DIR" "$WHISPER_DIR" 2>/dev/null || true
echo ""
echo "Now run:"
echo "  pnpm --filter @vocalflow/desktop dist:mac"
echo "  pnpm --filter @vocalflow/desktop dist:win"
