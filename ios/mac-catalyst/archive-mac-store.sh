#!/bin/bash
# Builds the Mac App Store package: a Release archive of the Mac Catalyst build, exported
# as a signed .pkg (Apple Distribution app + 3rd Party Mac Developer Installer), ready for
# Transporter or `upload`. Nothing here is committed: the archive and package go to
# $OUT (default ~/Desktop/modRiff-mac-store), and the certificates are Xcode's
# "cloud managed" ones, made on first run with -allowProvisioningUpdates by the team's
# signed-in Apple ID. No distribution certificate has to exist in the keychain first.
#
#   ios/mac-catalyst/archive-mac-store.sh            builds and exports App.pkg
#   ios/mac-catalyst/archive-mac-store.sh upload     also uploads it to App Store Connect
#
# The version is the build's MARKETING_VERSION / CURRENT_PROJECT_VERSION (project.pbxproj),
# which App Store Connect wants to go up for every upload of the same version.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$HOME/Desktop/modRiff-mac-store}"
DD="${TMPDIR:-/tmp}/modriff-dd-mac-rel"
TEAM="${MODRIFF_TEAM:-6985K934BS}"
MODE="${1:-export}"

cd "$ROOT"
# The page the app ships: build and sync first, or the archive carries whatever
# dist/ and ios/App/App/public held last.
npm run build >/dev/null
npx cap sync ios >/dev/null
ios/mac-catalyst/build-capacitor-xcframeworks.sh

mkdir -p "$OUT"
rm -rf "$OUT/modRiff-mac.xcarchive" "$OUT/export"
xcodebuild archive -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' \
  -archivePath "$OUT/modRiff-mac.xcarchive" -derivedDataPath "$DD" \
  -allowProvisioningUpdates >"$OUT/archive.log" 2>&1 || { grep error: "$OUT/archive.log" | head; exit 1; }

cat >"$OUT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>method</key><string>app-store-connect</string>
 <key>destination</key><string>$([ "$MODE" = upload ] && echo upload || echo export)</string>
 <key>signingStyle</key><string>automatic</string>
 <key>teamID</key><string>$TEAM</string>
 <key>uploadSymbols</key><true/>
</dict></plist>
EOF
xcodebuild -exportArchive -archivePath "$OUT/modRiff-mac.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates >"$OUT/export.log" 2>&1 \
  || { grep -E "error:|Error" "$OUT/export.log" | head; exit 1; }
echo "done: $OUT/export ($MODE)"
ls -la "$OUT/export"
