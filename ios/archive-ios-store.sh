#!/bin/bash
# Builds the iPhone/iPad App Store (TestFlight) package: a Release archive exported as a
# signed App.ipa, ready for Transporter (drag it in) or `upload`.
#
#   ios/archive-ios-store.sh            archives and exports App.ipa
#   ios/archive-ios-store.sh upload     also sends it to App Store Connect from Xcode's
#                                       signed-in account (needs that session to be fresh;
#                                       if it says "Credentials Error", use Transporter)
#
# Output goes to $OUT (default ~/Desktop/modRiff-ios-testflight); nothing is committed.
# The build number is the date and time (YYMMDD.HHMM, or MODRIFF_BUILD), passed on the
# command line so it always goes up and the repo stays clean.
#
# Why the frameworks are swapped: Apple rejects an app whose Capacitor or Cordova framework
# has no signature (ITMS-91065). The local package ios/App/capacitor-swift-pm holds
# xcframeworks we rebuilt with a Mac Catalyst slice, which `-create-xcframework` leaves
# unsigned. The iPhone build needs no Catalyst slice, so for the archive the official,
# maker-signed ones are put in their place, and the Catalyst ones are put back on exit
# (success, failure or Ctrl-C) so the Mac build and Xcode keep working.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$HOME/Desktop/modRiff-ios-testflight}"
DD="${TMPDIR:-/tmp}/modriff-dd-ios-rel"
TEAM="${MODRIFF_TEAM:-6985K934BS}"
MODE="${1:-export}"
BUILD="${MODRIFF_BUILD:-$(date +%y%m%d.%H%M)}"
PKG="$ROOT/ios/App/capacitor-swift-pm"
export PATH="/opt/homebrew/bin:$HOME/.local/node/bin:$PATH"

cd "$ROOT"
# Refuses a checkout that is off main or behind (MODRIFF_IOS_ANY=1 to archive a branch on purpose).
node build/ios-check.mjs --pre
npm run build >/dev/null
npx cap sync ios >/dev/null
node build/ios-check.mjs

VER="$(node -p "require('$ROOT/node_modules/@capacitor/ios/package.json').version")"
WORK="${TMPDIR:-/tmp}/modriff-capacitor-official-$VER"
mkdir -p "$WORK" "$PKG"
for name in Capacitor Cordova; do
  [ -d "$WORK/official/$name.xcframework" ] || {
    curl -fsSL -o "$WORK/$name.zip" "https://github.com/ionic-team/capacitor-swift-pm/releases/download/$VER/$name.xcframework.zip"
    unzip -q -o "$WORK/$name.zip" -d "$WORK/official"
  }
  codesign --verify "$WORK/official/$name.xcframework" || { echo "official $name.xcframework has no valid signature"; exit 1; }
done

SAVED="$WORK/catalyst-backup"
restore() {
  # Put back whatever was in the package before this run (nothing, on a fresh clone).
  for name in Capacitor Cordova; do
    rm -rf "$PKG/$name.xcframework"
    [ -d "$SAVED/$name.xcframework" ] && mv "$SAVED/$name.xcframework" "$PKG/"
  done
  return 0
}
rm -rf "$SAVED"; mkdir -p "$SAVED"
for name in Capacitor Cordova; do
  [ -d "$PKG/$name.xcframework" ] && mv "$PKG/$name.xcframework" "$SAVED/"
done
trap restore EXIT
for name in Capacitor Cordova; do cp -R "$WORK/official/$name.xcframework" "$PKG/"; done

mkdir -p "$OUT"
rm -rf "$OUT/modRiff.xcarchive" "$OUT/export"
xcodebuild archive -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/modRiff.xcarchive" -derivedDataPath "$DD" \
  CURRENT_PROJECT_VERSION="$BUILD" -allowProvisioningUpdates >"$OUT/archive.log" 2>&1 \
  || { grep error: "$OUT/archive.log" | head; exit 1; }
# The archive must carry the SDK signatures Apple checks for; stop here if it does not.
for name in Capacitor Cordova; do
  ls "$OUT/modRiff.xcarchive/Signatures/$name.xcframework-ios.signature" >/dev/null \
    || { echo "archive has no SDK signature for $name: Apple would reject it (ITMS-91065)"; exit 1; }
done
restore; trap - EXIT

cat >"$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>method</key><string>app-store-connect</string>
 <key>destination</key><string>$([ "$MODE" = upload ] && echo upload || echo export)</string>
 <key>signingStyle</key><string>automatic</string>
 <key>teamID</key><string>$TEAM</string>
 <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$OUT/modRiff.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates >"$OUT/export.log" 2>&1 \
  || { grep -E "error:|Error" "$OUT/export.log" | head; exit 1; }
echo "done: $OUT/export ($MODE), version 1.0 build $BUILD"
ls -la "$OUT/export"
