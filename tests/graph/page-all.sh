#!/bin/sh
# Every part through the page's graph path, one after another (see page.test.js).
# Run: make -C native/modsynth graphmix && sh tests/graph/page-all.sh
cd "$(dirname "$0")/../.." || exit 1
fail=0
for spec in drum auxperc bass melgen arp mel chord click rhythm sampler glide \
            chord:pianoreal2 mel:violin arp:flute bass:upright_real drumjazz; do
  out=$(node tests/graph/page.test.js "$spec" 2>&1)
  line=$(printf '%s\n' "$out" | grep -E '^[a-z]+: [0-9]+ voices' | head -1)
  if printf '%s\n' "$out" | grep -q '^ok$'; then echo "ok   $spec  ${line#*: }"; else echo "FAIL $spec"; printf '%s\n' "$out" | tail -6; fail=1; fi
done
exit $fail
