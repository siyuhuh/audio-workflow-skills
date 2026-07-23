#!/bin/zsh
set -euo pipefail

agent_source_dir="${0:A:h}"
resources_dir="${agent_source_dir:h}"
label="com.gottaegbert.vocalflow.agent"
install_dir="$HOME/Library/Application Support/VocalFlow/Agent"
target="$HOME/Library/LaunchAgents/$label.plist"
logs_dir="$HOME/Library/Logs/VocalFlow"

python=""
for candidate in \
  "${VOCALFLOW_PYTHON:-}" \
  "$resources_dir/python-runtime/python/bin/python3" \
  "$resources_dir/python-runtime/python/bin/python" \
  "$HOME/.local/share/audio-subtitles-venv/bin/python"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    python="$candidate"
    break
  fi
done

if [[ -z "$python" ]]; then
  print -u2 "VocalFlow Python runtime was not found. Reinstall VocalFlow and try again."
  exit 1
fi

cli_source="$resources_dir/audio-subtitles/scripts/generate_subtitles.py"
if [[ ! -f "$cli_source" ]]; then
  cli_source="$agent_source_dir/../../../skills/audio-subtitles/scripts/generate_subtitles.py"
fi
if [[ ! -f "$cli_source" ]]; then
  print -u2 "The audio-subtitles pipeline is missing. Reinstall VocalFlow and try again."
  exit 1
fi

mkdir -p "$install_dir" "$HOME/Library/LaunchAgents" "$logs_dir"
cp "$agent_source_dir/vocalflow_agent.py" "$install_dir/vocalflow_agent.py"
cp "$cli_source" "$install_dir/generate_subtitles.py"
chmod +x "$install_dir/vocalflow_agent.py" "$install_dir/generate_subtitles.py"

separator_source="$resources_dir/separator-models"
separator_target="$HOME/Library/Application Support/VocalFlow/separator-models"
if [[ -d "$separator_source" ]]; then
  mkdir -p "$separator_target"
  cp -Rn "$separator_source/" "$separator_target/"
fi

whisper_source="$resources_dir/whisper-models"
whisper_target="$HOME/Library/Application Support/VocalFlow/whisper-models"
if [[ -d "$whisper_source" && ! -f "$whisper_target/small/model.bin" ]]; then
  mkdir -p "$whisper_target"
  cp -Rn "$whisper_source/" "$whisper_target/"
fi

"$python" - "$target" "$label" "$python" "$install_dir" "$logs_dir" "$resources_dir" <<'PY'
import plistlib
import sys
from pathlib import Path

target, label, python, install_dir, logs_dir, resources_dir = sys.argv[1:]
python_bin = str(Path(python).parent)
payload = {
    "Label": label,
    "ProgramArguments": [
        python,
        str(Path(install_dir) / "vocalflow_agent.py"),
        "--bind",
        "0.0.0.0",
        "--port",
        "8766",
    ],
    "RunAtLoad": True,
    "KeepAlive": True,
    "ProcessType": "Background",
    "EnvironmentVariables": {
        "PATH": ":".join([
            python_bin,
            str(Path(resources_dir) / "bin"),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
        ]),
        "VOCALFLOW_AUDIO_SUBTITLES": str(Path(install_dir) / "generate_subtitles.py"),
        "VOCALFLOW_WHISPER_MODEL_DIR": str(
            Path.home() / "Library/Application Support/VocalFlow/whisper-models"
        ),
        "HF_HOME": str(Path.home() / "Library/Application Support/VocalFlow/hf-cache"),
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    },
    "StandardOutPath": str(Path(logs_dir) / "agent.log"),
    "StandardErrorPath": str(Path(logs_dir) / "agent-error.log"),
    "ThrottleInterval": 5,
}
with open(target, "wb") as handle:
    plistlib.dump(payload, handle, sort_keys=True)
PY

chmod 600 "$target"
launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
if ! launchctl bootstrap "gui/$(id -u)" "$target" >/dev/null 2>&1; then
  # Some macOS upgrades leave a legacy per-user launchd registration that
  # `bootout gui/...` cannot see. The compatibility loader adopts the same
  # plist into the current GUI domain.
  launchctl unload "$target" >/dev/null 2>&1 || true
  launchctl load -w "$target"
fi

loaded=0
for _ in {1..20}; do
  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    loaded=1
    break
  fi
  sleep 0.1
done
if [[ "$loaded" != "1" ]]; then
  print -u2 "VocalFlow Agent could not be registered with launchd."
  exit 1
fi

launchctl enable "gui/$(id -u)/$label"
launchctl kickstart -k "gui/$(id -u)/$label"

sleep 1
"$python" "$install_dir/vocalflow_agent.py" --print-pairing
