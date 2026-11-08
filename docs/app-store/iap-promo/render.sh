#!/bin/bash
# Renders promo.html to one 1024x1024 PNG per In-App Purchase, named by product id.
cd "$(dirname "$0")"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for pair in sampler:sampler synth:synth groove:groove theory:theory practice:practice studio:studio sounds:sounds fullstudio:fullstudio complete:fullstudio.from1; do
  k=${pair%%:*}; pid="Handel.modRiff.${pair#*:}"
  "$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 \
    --allow-file-access-from-files --virtual-time-budget=3000 --screenshot="$PWD/$pid.png" "file://$PWD/promo.html#$k" >/dev/null 2>&1
done
# Complete Your Studio is one picture for all three upgrade products.
cp Handel.modRiff.fullstudio.from1.png Handel.modRiff.fullstudio.from2.png
cp Handel.modRiff.fullstudio.from1.png Handel.modRiff.fullstudio.from3plus.png
