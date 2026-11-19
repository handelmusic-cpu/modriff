#!/bin/bash
# Builds the iPhone/iPad App Store (TestFlight) package: a Release archive exported as a
# signed App.ipa, ready for Transporter (drag it in) or `upload`.
#
#   ios/archive-ios-store.sh            archives and exports App.ipa
#   ios/archive-ios-store.sh upload     also sends it to App Store Connect from Xcode's
#                                       signed-in account (needs that session to be fresh;
#                                       if it says "Credentials Error", use Transporter)
#   MODRIFF_TESTERS=1 ios/archive-ios-store.sh
#                                       the TESTER build: Settings > About gets a "Test as"
#                                       row (Free / Everything / each pack) that works only
#                                       under TestFlight. Upload it for testers and NEVER
#                                       submit it for App Review: run this script again
#                                       without the variable for the build you submit.
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
# Ableton LinkKit is fetched, never committed (docs/link.md); no build links without it.
bash "$(cd "$(dirname "$0")" && pwd)/link/fetch-linkkit.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$HOME/Desktop/modRiff-ios-testflight}"
DD="${MODRIFF_DERIVED_DATA:-${TMPDIR:-/tmp}/modriff-dd-ios-rel}"
TEAM="${MODRIFF_TEAM:-6985K934BS}"
MODE="${1:-export}"
BUILD="${MODRIFF_BUILD:-$(date +%y%m%d.%H%M)}"
# -D, not SWIFT_ACTIVE_COMPILATION_CONDITIONS: the project sets that for Release
# (MODRIFF_CLOUDKIT) and a command-line value would replace it.
EXTRA_FLAGS=()
if [ "${MODRIFF_TESTERS:-}" = 1 ]; then EXTRA_FLAGS=('OTHER_SWIFT_FLAGS=$(inherited) -DTESTERS'); fi
PKG="$ROOT/ios/App/capacitor-swift-pm"
export PATH="/opt/homebrew/bin:$HOME/.local/node/bin:$PATH"

cd "$ROOT"
case "$MODE" in export|upload) ;; *) echo "usage: $0 [export|upload]" >&2; exit 1 ;; esac
# Two archives must not swap each other's SDKs or overwrite their backups.
LOCK="$PKG/.ios-archive-lock"
mkdir -p "$PKG"
mkdir "$LOCK" 2>/dev/null || { echo "iOS archive already running ($LOCK); do not build Mac Catalyst concurrently" >&2; exit 1; }
WORK="$(mktemp -d "${TMPDIR:-/tmp}/modriff-ios-sdk.XXXXXX")" || { rmdir "$LOCK"; exit 1; }
SAVED="$WORK/catalyst-backup"
mkdir "$SAVED"
restore() {
  # Only restore entries actually moved: an early failure must not delete the
  # untouched half of a framework pair, or lose the original .built-for stamp.
  for name in Capacitor Cordova; do
    if [ -f "$SAVED/$name.moved" ]; then
      rm -rf "$PKG/$name.xcframework"
      if [ -d "$SAVED/$name.xcframework" ]; then mv "$SAVED/$name.xcframework" "$PKG/"; fi
      rm "$SAVED/$name.moved"
    fi
  done
}
cleanup() {
  restore
  rm -rf "$WORK"
  rmdir "$LOCK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Refuses a checkout that is off main or behind (MODRIFF_IOS_ANY=1 to archive a branch on purpose).
node build/ios-check.mjs --pre
npm run build >/dev/null
npx cap sync ios >/dev/null
node build/ios-check.mjs

python3 ios/sdk-signatures.py prepare "$WORK/official"
for name in Capacitor Cordova; do
  if [ -d "$PKG/$name.xcframework" ]; then mv "$PKG/$name.xcframework" "$SAVED/"; fi
  touch "$SAVED/$name.moved"
  cp -R "$WORK/official/$name.xcframework" "$PKG/"
done

mkdir -p "$OUT"
rm -rf "$OUT/modRiff.xcarchive" "$OUT/export"
xcodebuild archive -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/modRiff.xcarchive" -derivedDataPath "$DD" \
  CURRENT_PROJECT_VERSION="$BUILD" ${EXTRA_FLAGS[@]+"${EXTRA_FLAGS[@]}"} -allowProvisioningUpdates >"$OUT/archive.log" 2>&1 \
  || { grep error: "$OUT/archive.log" | head; exit 1; }
# Xcode also writes a .signature file for unsigned SDKs, with signed=false.
# Check its contents and code hashes rather than treating existence as proof.
python3 ios/sdk-signatures.py archive "$OUT/modRiff.xcarchive" --sdk "$WORK/official" \
  | tee "$OUT/archive-signature-verification.log"
restore

cat >"$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>method</key><string>app-store-connect</string>
 <key>destination</key><string>export</string>
 <key>signingStyle</key><string>automatic</string>
 <key>teamID</key><string>$TEAM</string>
 <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$OUT/modRiff.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates >"$OUT/export.log" 2>&1 \
  || { grep -E "error:|Error" "$OUT/export.log" | head; exit 1; }
python3 ios/sdk-signatures.py ipa "$OUT/export/App.ipa" --sdk "$WORK/official" --team "$TEAM" \
  | tee "$OUT/signature-verification.log"
# Export locally first so `upload` cannot bypass verification of the IPA.
if [ "$MODE" = upload ]; then
  /usr/libexec/PlistBuddy -c 'Set :destination upload' "$OUT/ExportOptions.plist"
  xcodebuild -exportArchive -archivePath "$OUT/modRiff.xcarchive" -exportPath "$OUT/upload" \
    -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates >"$OUT/upload.log" 2>&1 \
    || { grep -E "error:|Error" "$OUT/upload.log" | head; exit 1; }
fi
echo "done: $OUT/export ($MODE), version 1.0 build $BUILD"
if [ "${MODRIFF_TESTERS:-}" = 1 ]; then echo "TESTER BUILD (has the Test as row): for TestFlight testers only, never submit it for review."; fi
ls -la "$OUT/export"
