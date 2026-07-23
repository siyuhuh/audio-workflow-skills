#!/usr/bin/env bash
#
# Install VocalFlow's default processing stack directly into the relocatable
# Python runtime that ships in the Electron and native macOS installers.
# A release built after this step can search/download media, separate vocals,
# and transcribe with the bundled small model without pip or Homebrew.

set -euo pipefail
export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1
export PIP_DISABLE_PIP_VERSION_CHECK=1

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
desktop_dir="$(cd -- "$script_dir/.." &>/dev/null && pwd)"
runtime_root="${RUNTIME_ROOT:-$desktop_dir/vendor/python-runtime}"

python_bin="${PYTHON_BIN:-}"
if [[ -z "$python_bin" ]]; then
  for candidate in \
    "$runtime_root/python/bin/python3" \
    "$runtime_root/python/bin/python" \
    "$runtime_root/python/python.exe"; do
    if [[ -x "$candidate" || -f "$candidate" ]]; then
      python_bin="$candidate"
      break
    fi
  done
fi

if [[ -z "$python_bin" ]]; then
  echo "[fatal] No standalone Python executable was found under $runtime_root." >&2
  exit 1
fi

echo "[runtime] Python: $python_bin"
"$python_bin" -m ensurepip --upgrade
"$python_bin" -m pip install --upgrade pip wheel setuptools
"$python_bin" -m pip install --upgrade \
  "yt-dlp" \
  "faster-whisper" \
  "audio-separator[cpu]" \
  "zhconv"

# Wheels include development headers and bytecode caches that are not used by
# VocalFlow at runtime. Removing them keeps the installer smaller and avoids
# macOS code-signing exhausting its per-process file descriptor budget.
site_packages="$("$python_bin" - <<'PY'
import site

print(site.getsitepackages()[0])
PY
)"
rm -rf \
  "$site_packages/torch/include" \
  "$site_packages/torch/share/cmake" \
  "$site_packages/torchvision/include"
find "$site_packages" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$site_packages" -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete

"$python_bin" - <<'PY'
import importlib.util
import sys

required = ("yt_dlp", "faster_whisper", "audio_separator", "zhconv")
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
    raise SystemExit(f"Bundled runtime verification failed: {', '.join(missing)}")
print(f"[runtime] Verified Python {sys.version.split()[0]} with {len(required)} required packages.")
PY

echo "[runtime] Packaged size: $(du -sh "$runtime_root" | cut -f1)"
