#!/bin/bash
# Xcode Cloud runs this after cloning and before it resolves packages (Apple looks for ci_scripts/ beside the .xcodeproj).
#
# Why it exists: every cloud build of main failed. Most of what the project links is generated or fetched, never
# committed, so a fresh clone has none of it: node_modules (CapApp-SPM names @capacitor/haptics by path, which is the
# error Xcode stopped on), the Capacitor and Cordova xcframeworks, Ableton's LinkKit (its licence forbids committing
# it, docs/link.md) and the built page in ios/App/App/public. `npm run ios` makes them on a Mac; this is the same
# for the cloud.
set -euo pipefail
ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$ROOT"

# The cloud image has Homebrew and no Node.
if ! command -v node >/dev/null 2>&1; then
  HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install node
fi
npm ci

bash ios/link/fetch-linkkit.sh

PKG="$ROOT/ios/App/capacitor-swift-pm"
if [ "${CI_PRODUCT_PLATFORM:-iOS}" = macOS ]; then
  # Mac Catalyst needs the slice built here. It signs with a keychain identity, which the cloud may not offer.
  bash ios/mac-catalyst/build-capacitor-xcframeworks.sh
else
  # The iPhone build takes the makers' own signed frameworks, as ios/archive-ios-store.sh does: a locally rebuilt one
  # has no vendor signature and Apple rejects the upload (ITMS-91065). It also saves building a Catalyst slice.
  TMP="$(mktemp -d)"
  python3 ios/sdk-signatures.py prepare "$TMP/official"
  for name in Capacitor Cordova; do
    rm -rf "$PKG/$name.xcframework"
    cp -R "$TMP/official/$name.xcframework" "$PKG/"
  done
  rm -rf "$TMP"
fi

npm run build
npx cap sync ios
