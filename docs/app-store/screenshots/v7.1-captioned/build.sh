#!/bin/bash
# Regenerates the captioned store set from raw/ (plain Simulator captures, status bar pinned).
# Needs Google Chrome (headless) and sips. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
render() { # name w h caption raw
  local out="$1.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$2,$3" --virtual-time-budget=4000 --screenshot="$PWD/$out" \
    "file://$PWD/template.html?w=$2&h=$3&cap=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$4")&img=raw/$5" >/dev/null 2>&1
  # App Store rejects alpha: a JPEG round-trip drops the channel.
  sips -s format jpeg -s formatOptions 100 "$out" --out "$out.jpg" >/dev/null
  sips -s format png "$out.jpg" --out "$out" >/dev/null; rm "$out.jpg"
  sips -g pixelWidth -g pixelHeight -g hasAlpha "$out" | tail -3 | tr '\n' ' '; echo
}
n=1
while IFS='|' read -r tag cap; do
  render "iphone-6.9in-0$n-$tag" 1320 2868 "$cap" "iphone-0$n-$tag.png"
  render "ipad-13in-0$n-$tag"   2064 2752 "$cap" "ipad-0$n-$tag.png"
  n=$((n+1))
done <<'LIST'
live|Every part, always in key
studio|A whole band that follows your chords
sound|A real synth and sampler inside
song|Chain sections into a song
stage|Practise, perform, export
LIST
