# Releasing VocalFlow

The `Desktop Release` workflow builds three offline-by-default artifacts from a `v*` tag:

- Native Apple Silicon `VocalFlow-<version>-mac-arm64.dmg`
- Electron `VocalFlow Studio-<version>-mac-arm64.dmg`
- Electron `VocalFlow Studio-<version>-win-x64.exe`

The native DMG also contains the installable Mac mini Agent. The workflow downloads a standalone Python runtime, installs the production Python packages into it, fetches the default Whisper/separator weights, and only then packages the apps.

## Version checklist

Keep these values aligned before tagging:

- `apps/desktop/package.json`
- `apps/mac/VocalFlowMini/VocalFlowMini/Info.plist`
- `apps/ios/VocalFlowMobile/project.yml`
- `apps/mac/VocalFlowAgent/vocalflow_agent.py`

The suite marketing version for this beta is `0.8.0`; the prerelease tag and Electron semver are `0.8.0-beta.5`.

## Desktop release

```bash
git tag -a v0.8.0-beta.5 -m "VocalFlow 0.8.0 beta 5"
git push siyuhuh v0.8.0-beta.5
```

Without Apple credentials, GitHub Actions can still produce an ad-hoc/unsigned beta for direct testing. For public macOS distribution, import a Developer ID Application certificate into the runner and set the signing identity used by the build. Store a notarization profile as `APPLE_NOTARY_KEYCHAIN_PROFILE` before running `build-dmg.sh`.

Required Apple work outside this repository:

1. Create a Developer ID Application certificate.
2. Install it in the build runner keychain.
3. Create App Store Connect API credentials or an Apple notarytool profile.
4. Sign the `.app` and `.dmg`, submit the DMG to notarization, and staple the ticket.

Local signed/notarized native build:

```bash
export MACOS_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_NOTARY_KEYCHAIN_PROFILE="VocalFlow-Notary"
export REQUIRE_BUNDLED_RUNTIME=1
apps/mac/VocalFlowMini/scripts/build-dmg.sh release
```

## Local signed Electron DMG

Use a local Developer ID Application identity and a validated `notarytool`
Keychain profile. Never commit API keys or signing private keys. Xcode login
alone does not configure notarization.

```bash
pnpm --dir apps/desktop build
CSC_NAME="Your Company (TEAMID)" pnpm --dir apps/desktop exec electron-builder \
  --mac dmg --publish never --config.directories.output=release-signed \
  --config.mac.notarize=false
```

`CSC_NAME` omits the `Developer ID Application:` prefix. The separate output
directory preserves earlier unsigned test artifacts. Before distributing:

1. Verify the app with `codesign --verify --deep --strict --verbose=2` and run
   `node apps/desktop/scripts/verify-bundled-release.mjs apps/desktop/release-signed`.
2. Mount the generated DMG read-only and run the same strict signature check
   against the app **inside the mounted image**. Checking only the staging app
   is insufficient: a beta.9 build lost framework binaries during DMG packaging
   even though its staging app and image checksum passed validation. Do not
   upload an image whose mounted app fails verification. If necessary, recreate
   the image using `hdiutil create -srcfolder <signed-app-directory> -format UDZO
   <new-dmg-path>` and verify its mounted contents again.
3. Sign the DMG with the full Developer ID Application identity and a secure timestamp.
4. Submit the exact DMG with `xcrun notarytool submit <dmg> --keychain-profile
   vocalflow-notary --wait`. Require an `Accepted` result; save the submission ID.
5. Run `xcrun stapler staple <dmg>` and `xcrun stapler validate <dmg>`.
6. Verify the image with `hdiutil verify <dmg>` and assess it with
   `spctl --assess --type open --context context:primary-signature --verbose=2 <dmg>`.
7. Compute the final SHA-256 **after** stapling, and test installation on a clean Mac.

Successful signing is not evidence of successful notarization. Notarization also
does not verify model quality, media-site access, or clean-machine functionality.

## iPhone / TestFlight credentials

The manual `iOS TestFlight` workflow needs these GitHub Actions secrets:

- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY` (the complete `.p8` content)

The workflow regenerates the Xcode project, archives with automatic signing, and exports directly to App Store Connect.

## Expected installer behavior

- A normal desktop user downloads one DMG/EXE.
- Default Python packages and default model weights are already present.
- The desktop apps read the bundled default Whisper model directly and seed the bundled separator weight locally; neither path should invoke pip or download the default weights.
- The native Mac Agent installer copies both bundled defaults into its application-data folder.
- URL imports still need internet access to download media.
- Larger optional models can be added later without replacing the installer.
