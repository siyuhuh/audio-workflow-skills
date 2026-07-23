#!/bin/zsh
set -euo pipefail

python="$HOME/.local/share/audio-subtitles-venv/bin/python"

if [[ ! -x "$python" ]]; then
  print -u2 "VocalFlow Python runtime not found at $python"
  exit 1
fi

"$python" -m pip install --upgrade 'yt-dlp[default,curl-cffi]'
"$python" -m yt_dlp --version
