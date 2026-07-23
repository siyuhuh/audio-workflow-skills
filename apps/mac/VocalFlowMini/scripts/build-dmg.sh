#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_root="$(cd "$script_dir/.." && pwd)"
version="${VOCALFLOW_VERSION:-0.8.0}"
arch="${VOCALFLOW_ARCH:-$(uname -m)}"
configuration="${1:-release}"

app_bundle="$("$script_dir/build-app.sh" "$configuration" | tail -n 1)"
dist_dir="$app_root/dist"
staging_dir="$dist_dir/dmg-root"
dmg_path="$dist_dir/VocalFlow-${version}-mac-${arch}.dmg"

rm -rf "$staging_dir" "$dmg_path"
mkdir -p "$staging_dir"
cp -R "$app_bundle" "$staging_dir/VocalFlow.app"
ln -s /Applications "$staging_dir/Applications"

hdiutil create \
  -volname "VocalFlow" \
  -srcfolder "$staging_dir" \
  -ov \
  -format UDZO \
  "$dmg_path"

if [[ -n "${MACOS_SIGNING_IDENTITY:-}" && "$MACOS_SIGNING_IDENTITY" != "-" ]]; then
  codesign --force --sign "$MACOS_SIGNING_IDENTITY" --timestamp "$dmg_path"
fi

if [[ -n "${APPLE_NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
  xcrun notarytool submit "$dmg_path" \
    --keychain-profile "$APPLE_NOTARY_KEYCHAIN_PROFILE" \
    --wait
  xcrun stapler staple "$dmg_path"
fi

rm -rf "$staging_dir"
echo "$dmg_path"
