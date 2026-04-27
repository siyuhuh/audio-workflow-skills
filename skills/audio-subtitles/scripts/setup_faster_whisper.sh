#!/usr/bin/env bash
set -euo pipefail

venv_dir="${AUDIO_SUBTITLES_VENV:-$HOME/.local/share/audio-subtitles-venv}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: setup-audio-subtitles

Install faster-whisper and whisper-timestamped into an isolated local virtual environment used by audio-subtitles.

Environment:
  AUDIO_SUBTITLES_VENV  Override the virtual environment directory.
USAGE
  exit 0
fi

python3 -m venv "$venv_dir"
"$venv_dir/bin/python" -m pip install --upgrade pip
"$venv_dir/bin/python" -m pip install --upgrade faster-whisper whisper-timestamped

echo "Installed faster-whisper and whisper-timestamped in: $venv_dir"
echo "Run: audio-subtitles \"/path/to/audio-or-video\""
