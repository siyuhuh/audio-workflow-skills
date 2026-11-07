#!/bin/bash
set -euo pipefail

# Complete an already submitted DMG. Credentials stay in the login Keychain.
if [[ $# -ne 4 ]]; then
  echo "Usage: bash $0 <submission-id> <dmg> <keychain-profile> <destination>" >&2
  exit 2
fi
submission_id="$1"
dmg_path="$2"
profile_name="$3"
destination_path="$4"
[[ -f "$dmg_path" ]] || { echo "DMG not found" >&2; exit 2; }
[[ ! -e "$destination_path" ]] || { echo "Destination already exists" >&2; exit 2; }

xcrun notarytool wait "$submission_id" --keychain-profile "$profile_name" --timeout 2h
# notarytool wait can exit zero for Invalid, so independently require Accepted.
xcrun notarytool info "$submission_id" --keychain-profile "$profile_name" --output-format json |
  node -e 'let text=""; process.stdin.on("data", d => text += d); process.stdin.on("end", () => { const result = JSON.parse(text); console.log("Notarization status:", result.status); if (result.status !== "Accepted") process.exit(1); });'
xcrun stapler staple "$dmg_path"
xcrun stapler validate "$dmg_path"
codesign --verify --strict --verbose=2 "$dmg_path"
hdiutil verify "$dmg_path"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg_path"
cp -n "$dmg_path" "$destination_path"
cmp "$dmg_path" "$destination_path"
shasum -a 256 "$destination_path"
echo "Verified notarized DMG: $destination_path"
