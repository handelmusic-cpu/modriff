#!/bin/bash
# Builds the Mac Catalyst app signed with the developer team and opens it, from
# ~/Applications/modRiff-dev.app. Optimised like `npm run ios:device`: the C++
# engine at -O0 (a plain Debug build) misses its audio deadline and sounds
# distorted. MODRIFF_OPT=0 turns the optimisation off, for stepping through C++.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DD="${TMPDIR:-/tmp}/modriff-dd-mac"
"$ROOT/ios/mac-catalyst/build-capacitor-xcframeworks.sh"
OPT=(GCC_OPTIMIZATION_LEVEL=s SWIFT_OPTIMIZATION_LEVEL=-O)
[ "${MODRIFF_OPT:-}" = "0" ] && OPT=()
xcodebuild -project "$ROOT/ios/App/App.xcodeproj" -scheme App -configuration Debug \
  -destination 'platform=macOS,variant=Mac Catalyst' -derivedDataPath "$DD" \
  -allowProvisioningUpdates "${OPT[@]}" build >"$DD.log" 2>&1 || { grep error: "$DD.log" | head; exit 1; }
pkill -f modRiff-dev.app 2>/dev/null || true
mkdir -p ~/Applications && rm -rf ~/Applications/modRiff-dev.app
cp -R "$DD/Build/Products/Debug-maccatalyst/App.app" ~/Applications/modRiff-dev.app
open ~/Applications/modRiff-dev.app
