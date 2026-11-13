#!/bin/bash
# Builds ios/App/capacitor-swift-pm/{Capacitor,Cordova}.xcframework: Capacitor's
# official iOS and iOS Simulator slices plus a Mac Catalyst slice built from the
# sources in node_modules/@capacitor/ios (the same version, so only the platform
# differs). The local package next to them takes over the name capacitor-swift-pm
# from the remote one, which has no Catalyst slice and stopped the Mac link
# ("building for 'macCatalyst', but linking ... built for 'iOS'").
#
# Run after `npm install` or a Capacitor upgrade; the output is git-ignored.
# Takes about two minutes. Needs only Xcode and Ruby's xcodeproj gem (ships with
# CocoaPods; `gem install xcodeproj` otherwise).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CAP="$ROOT/node_modules/@capacitor/ios"
PKG="$ROOT/ios/App/capacitor-swift-pm"
WORK="${TMPDIR:-/tmp}/modriff-capacitor-catalyst"

VER="$(node -p "require('$CAP/package.json').version")"
STAMP="$PKG/.built-for"

# Apple rejects an upload whose Capacitor or Cordova framework has no signature
# (ITMS-91065, "Missing signature"). The official xcframeworks are signed by their
# makers, but `-create-xcframework` below writes new ones with no signature, and the
# Catalyst slice cannot be added to a signed one. So the rebuilt ones are signed here
# with this team's own development certificate, which Xcode then records in the
# archive's Signatures/ folder. Idempotent: a signed one is left alone. The iPhone
# archive does not use these at all (ios/archive-ios-store.sh swaps the official ones in).
sign_xcframeworks() {
  local id="${MODRIFF_SIGN_IDENTITY:-}"
  if [ -z "$id" ]; then
    id="$(security find-identity -v -p codesigning | grep -m1 -E '"Apple (Development|Distribution)' | awk '{print $2}')"
  fi
  [ -n "$id" ] || { echo "no Apple Development/Distribution identity in the keychain to sign the xcframeworks"; exit 1; }
  for name in Capacitor Cordova; do
    if codesign --verify "$PKG/$name.xcframework" 2>/dev/null; then continue; fi
    codesign --timestamp --sign "$id" "$PKG/$name.xcframework"
  done
}

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$VER" ] && [ "${1:-}" != "--force" ]; then
  sign_xcframeworks
  echo "Capacitor $VER xcframeworks already built (--force to rebuild)"; exit 0
fi

rm -rf "$WORK"; mkdir -p "$WORK/official"

# The official slices. Reuse what SwiftPM already downloaded for this version if
# it is there; otherwise fetch the release zip, which is the same file SwiftPM
# fetches for the pinned version in CapApp-SPM/Package.swift.
for name in Capacitor Cordova; do
  found="$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/*/SourcePackages/artifacts/capacitor-swift-pm/$name/$name.xcframework 2>/dev/null | head -1 || true)"
  if [ -n "$found" ] && [ ! -d "$found/ios-arm64_x86_64-maccatalyst" ]; then
    cp -R "$found" "$WORK/official/"
  else
    curl -fsSL -o "$WORK/$name.zip" \
      "https://github.com/ionic-team/capacitor-swift-pm/releases/download/$VER/$name.xcframework.zip"
    unzip -q "$WORK/$name.zip" -d "$WORK/official"
  fi
done

ruby "$HERE/gen-capacitor-project.rb" "$CAP" "$WORK/gen" >/dev/null
xcodebuild -project "$WORK/gen/CapMac.xcodeproj" -scheme Capacitor -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' -derivedDataPath "$WORK/dd" \
  ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO build >"$WORK/build.log" 2>&1 \
  || { tail -30 "$WORK/build.log"; exit 1; }

OUT="$WORK/Release-maccatalyst"
rm -rf "$PKG/Capacitor.xcframework" "$PKG/Cordova.xcframework"
for name in Capacitor Cordova; do
  # Slices go in by their frameworks, not by copying folders, so the xcframework
  # Info.plist is written by Apple's own tool.
  xcodebuild -create-xcframework \
    -framework "$WORK/official/$name.xcframework/ios-arm64/$name.framework" \
    -framework "$WORK/official/$name.xcframework/ios-arm64_x86_64-simulator/$name.framework" \
    -framework "$WORK/dd/Build/Products/Release-maccatalyst/$name.framework" \
    -output "$PKG/$name.xcframework"
done
sign_xcframeworks
echo "$VER" >"$STAMP"
echo "built $PKG/{Capacitor,Cordova}.xcframework for Capacitor $VER"
