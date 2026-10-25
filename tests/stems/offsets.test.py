#!/usr/bin/env python3
"""The onset finder in bounce-check.py, on stems built to the sample.

Run: python3 -I tests/stems/offsets.test.py   (needs numpy)

The case it exists for: a note that starts while the previous one is still
ringing. The finder used to take the first sample above 25% of the window's
peak, which is sample 0 when the tail is loud enough, so a chord exactly on the
grid read as 25-48 ms early (and an arp as exactly -lo, 92% of its notes). Five
real bounces carried the artifact before it was found.
"""
import importlib.util, sys
import numpy as np
spec = importlib.util.spec_from_file_location('bc', __file__.rsplit('/', 1)[0] + '/bounce-check.py')
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)
SR = bc.SR
fails = 0
def check(name, got, want, tol=1.5):
    global fails
    ok = got is not None and abs(got - want) <= tol
    fails += not ok
    print('%-52s %s  (got %s, want %+.1f)' % (name, 'ok  ' if ok else 'FAIL', 'none' if got is None else '%+.1f' % got, want))

def stem(onsets, dur, shift_ms=0.0, tail=0.0, decay=0.25):
    """Stereo noise bursts: each starts at an onset (+shift), decays with `decay` s.
    tail>0 keeps a ringing floor of that fraction of the peak between notes."""
    n = int(dur * SR); y = np.zeros(n); rng = np.random.default_rng(1)
    for t in onsets:
        a = int((t + shift_ms / 1000) * SR); m = min(n - a, int(1.5 * SR))
        y[a:a + m] += rng.standard_normal(m) * 0.3 * np.exp(-np.arange(m) / (decay * SR))
    y += tail * rng.standard_normal(n) * 0.3
    return np.stack([y, y], 1)

def median_off(st, times):
    o = bc.offsets(st, times)
    return float(np.median(o)) if len(o) else None

times = [1.0 + 0.5 * i for i in range(12)]
check('clean notes on the grid', median_off(stem(times, 8), times), 0)
check('clean notes 20 ms late', median_off(stem(times, 8, 20), times), 20)
check('clean notes 20 ms early', median_off(stem(times, 8, -20), times), -20)
# Notes every 120 ms with a 0.25 s decay: the last note is still 80% there when
# the next begins, the arp case. On the grid must read ~0, never -80.
dense = [1.0 + 0.12 * i for i in range(30)]
check('dense, ringing tail, on the grid', median_off(stem(dense, 6, 0, decay=0.4), dense), 0, 3)
check('dense, ringing tail, 15 ms late', median_off(stem(dense, 6, 15, decay=0.4), dense), 15, 3)
# Never-silent stem with no clear attack: nothing to measure, so nothing reported.
flat = np.stack([0.2 * np.random.default_rng(2).standard_normal(6 * SR)] * 2, 1)
check('a stem that never dips reports nothing', 0.0 if len(bc.offsets(flat, dense[:10])) == 0 else None, 0)
sys.exit(1 if fails else 0)
