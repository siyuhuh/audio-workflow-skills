#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$app_root/../../.." && pwd)"
configuration="${1:-release}"

cd "$app_root"
swift build -c "$configuration" --product VocalFlow
bin_dir="$(swift build -c "$configuration" --show-bin-path)"

dist_dir="$app_root/dist"
app_bundle="$dist_dir/VocalFlow.app"
contents="$app_bundle/Contents"
resources="$contents/Resources"
entitlements="$app_root/VocalFlowMini.entitlements"

rm -rf "$app_bundle"
mkdir -p "$contents/MacOS" "$resources/audio-subtitles" "$resources/bin"

cp "$bin_dir/VocalFlow" "$contents/MacOS/VocalFlow"
cp "$app_root/VocalFlowMini/Info.plist" "$contents/Info.plist"
cp -R "$repo_root/skills/audio-subtitles/scripts" "$resources/audio-subtitles/"

icon_source="$repo_root/apps/desktop/build/icon.icns"
if [[ -f "$icon_source" ]]; then
  cp "$icon_source" "$resources/VocalFlow.icns"
fi

logo_source="$repo_root/apps/desktop/src/renderer/assets/logo.svg"
mark_source="$repo_root/apps/desktop/src/renderer/assets/logo-bg.svg"
if [[ -f "$logo_source" ]]; then
  cp "$logo_source" "$resources/VocalFlow.svg"
fi
if [[ -f "$mark_source" ]]; then
  cp "$mark_source" "$resources/VocalFlowMark.svg"
fi

ffmpeg_source=""
if [[ -d "$repo_root/node_modules/.pnpm" ]]; then
  ffmpeg_source="$(find "$repo_root/node_modules/.pnpm" -path '*/node_modules/ffmpeg-static/ffmpeg' -type f -print -quit)"
fi
if [[ -n "$ffmpeg_source" ]]; then
  cp "$ffmpeg_source" "$resources/bin/ffmpeg"
  chmod +x "$resources/bin/ffmpeg"
fi

runtime_source="$repo_root/apps/desktop/vendor/python-runtime"
if [[ -x "$runtime_source/python/bin/python3" || -f "$runtime_source/python/python.exe" ]]; then
  cp -R "$runtime_source" "$resources/python-runtime"
elif [[ "${REQUIRE_BUNDLED_RUNTIME:-0}" == "1" ]]; then
  echo "[fatal] Bundled Python runtime is missing. Run prepare-bundled-runtime.sh first." >&2
  exit 1
fi

separator_source="$repo_root/apps/desktop/vendor/separator-models"
whisper_source="$repo_root/apps/desktop/vendor/whisper-cache"
if [[ -d "$separator_source" ]]; then
  cp -R "$separator_source" "$resources/separator-models"
elif [[ "${REQUIRE_BUNDLED_RUNTIME:-0}" == "1" ]]; then
  echo "[fatal] Bundled separator model is missing." >&2
  exit 1
fi
if [[ -d "$whisper_source" ]]; then
  cp -R "$whisper_source" "$resources/whisper-cache"
elif [[ "${REQUIRE_BUNDLED_RUNTIME:-0}" == "1" ]]; then
  echo "[fatal] Bundled Whisper model is missing." >&2
  exit 1
fi

agent_source="$repo_root/apps/mac/VocalFlowAgent"
if [[ -d "$agent_source" ]]; then
  mkdir -p "$resources/agent"
  cp "$agent_source/vocalflow_agent.py" "$resources/agent/"
  cp "$agent_source/install-agent.sh" "$resources/agent/"
  cp "$agent_source/README.md" "$resources/agent/"
  chmod +x "$resources/agent/vocalflow_agent.py" "$resources/agent/install-agent.sh"
fi

chmod +x "$contents/MacOS/VocalFlow"
signing_identity="${MACOS_SIGNING_IDENTITY:--}"
codesign_args=(--force --deep --sign "$signing_identity" --entitlements "$entitlements")
if [[ "$signing_identity" != "-" ]]; then
  codesign_args+=(--options runtime --timestamp)
fi
codesign "${codesign_args[@]}" "$app_bundle"
codesign --verify --deep --strict --verbose=2 "$app_bundle"

echo "$app_bundle"
