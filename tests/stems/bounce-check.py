#!/usr/bin/env python3
"""Does a bounce put every part where it was played?

Usage:  python3 -I tests/stems/bounce-check.py "modo-session 7.zip" [--by-time]   (or a folder of the unzipped files)
        --by-time adds each part's median per 20 s, to tell a stretch (backgrounding, a stall) from the whole take.

A bounce carries two records of the same take: the stems (what was heard) and
the .mid (when each part was triggered). For every part that has both, this
finds where the stem's sound starts around each logged note and reports the
median offset in ms. Web parts sit within a few ms of their log (a soft attack
reads later). The native chord should sit with them; if it is off by a constant
with a tight spread, the capture's clock alignment is off, not the playing.
A stem with a ringing tail (an arp, a pad) used to read early or pinned at
-80.0 ms, because the finder took the first sample over the threshold and that is
the window's edge when the last note has not died; it now takes the rising
crossing nearest the log and skips a stem that never dips (offsets.test.py holds
that). Every "native chord is 31/46/48/25 ms early" before 4.9.9.9.9.8.9w was
that artifact, and the chord reads within a millisecond in all five bounces.

Needs numpy. Only looks at notes after the first 'Chords' sound, so parts that
had not started yet are not counted as missing.
"""
import glob, os, struct, sys, tempfile, wave, zipfile
import numpy as np

SR = 48000
NAMES = {'Chords': 'Chords', 'Bassline': 'Bass', 'Arpeggio': 'Arp', 'Melody Seq': 'Melody Seq', 'Percussion': 'Drums'}

def load(f):
    w = wave.open(f)
    return np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').reshape(-1, 2).astype(np.float64) / 32768

def midi_notes(path):
    d = open(path, 'rb').read()
    _, ntr, div = struct.unpack('>HHH', d[8:14]); pos = 14; tempo = 500000; out = {}
    def vlq(b, p):
        v = 0
        while True:
            c = b[p]; p += 1; v = (v << 7) | (c & 0x7f)
            if not c & 0x80: return v, p
    for _ in range(ntr):
        ln = struct.unpack('>I', d[pos + 4:pos + 8])[0]; b = d[pos + 8:pos + 8 + ln]; pos += 8 + ln
        p = 0; tick = 0; run = 0; ev = []; name = ''
        while p < len(b):
            dt, p = vlq(b, p); tick += dt; s = b[p]
            if s == 0xff:
                ty = b[p + 1]; l, p2 = vlq(b, p + 2); data = b[p2:p2 + l]; p = p2 + l
                if ty == 3: name = data.decode('latin1')
                if ty == 0x51: tempo = int.from_bytes(data, 'big')
            elif s in (0xf0, 0xf7):
                l, p = vlq(b, p + 1); p += l
            else:
                if s & 0x80: run = s; p += 1
                n = 1 if (run >> 4) in (0xc, 0xd) else 2
                dat = b[p:p + n]; p += n
                if (run >> 4) == 9 and dat[1] > 0: ev.append((tick * tempo / 1e6 / div, dat[0]))
        out[name] = ev
    return out

def envelope(stem):
    return np.convolve(np.abs(stem.mean(1)), np.ones(48) / 48, 'same')      # 1 ms

def offsets(stem, times, lo=-0.08, hi=0.12, env=None, with_times=False):
    """ms from each logged time to where the stem's sound starts around it.
    Pass env=envelope(stem) when calling repeatedly on one stem."""
    if env is None: env = envelope(stem)
    res = []
    for t in times:
        a, b = int((t + lo) * SR), int((t + hi) * SR)
        if a < 0 or b > len(env): continue
        seg = env[a:b]; pre = np.median(env[max(0, a - 2400):a]) if a > 2400 else 0
        mx = seg.max()
        if mx < 0.004 or mx < 3 * pre + 0.002: continue
        # The rising crossing nearest the logged time. The first sample above the
        # threshold is not it: when the previous note is still ringing at the
        # window's start that is sample 0, every note reads exactly -lo, and a
        # 92% pile-up at -80.0 ms was once taken for a constant offset. A stem
        # that never dips below the threshold has no onset to find: skipped.
        up = seg > 0.25 * mx
        rises = np.where(up[1:] & ~up[:-1])[0] + 1
        if not up[0]: rises = np.concatenate(([int(np.argmax(up))], rises[rises > np.argmax(up)]))
        if len(rises) == 0: continue
        k = rises[np.argmin(np.abs(rises - (t - (t + lo)) * SR))]
        res.append((t, ((a + int(k)) / SR - t) * 1000))
    return res if with_times else np.array([o for _, o in res])

def main(src):
    if os.path.isfile(src):
        tmp = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(tmp); src = tmp
    mid = glob.glob(os.path.join(src, '**', '*.mid'), recursive=True)
    if not mid: sys.exit('no .mid in the bounce')
    notes = midi_notes(mid[0])
    chords = [t for t, _ in notes.get('Chords', [])]
    stem = lambda n: glob.glob(os.path.join(src, '**', '* - %s.wav' % n), recursive=True)
    t0 = 0.0
    if stem('Chords') and chords:
        c = np.abs(load(stem('Chords')[0])).max(1); on = np.where(c > 0.0005)[0]
        t0 = (on[0] / SR - 0.1) if len(on) else 0.0
    print('%-16s %5s  %9s  %s' % ('part', 'notes', 'median ms', 'middle half (ms)'))
    for track, label in NAMES.items():
        f = stem(label)
        if not f or track not in notes: continue
        times = sorted(set(round(t, 3) for t, n in notes[track] if t > t0 and (track != 'Percussion' or n == 36)))
        st = load(f[0]); env = envelope(st)
        ot = offsets(st, times, env=env, with_times=True); o = np.array([x for _, x in ot])
        if len(o) < 3: print('%-16s %5d  (too few clear onsets)' % (label, len(o))); continue
        print('%-16s %5d  %+9.1f  %+.1f .. %+.1f' % (label + (' (kick)' if track == 'Percussion' else ''), len(o), np.median(o), np.percentile(o, 25), np.percentile(o, 75)))
        if '--by-time' in sys.argv:
            for a in range(0, int(len(st) / SR) + 1, 20):
                b = [x for t, x in ot if a <= t < a + 20]
                if len(b) >= 3: print('      %3d-%3d s  n=%3d  median %+6.1f ms' % (a, a + 20, len(b), np.median(b)))

if __name__ == '__main__':
    main([a for a in sys.argv[1:] if not a.startswith('--')][0] if [a for a in sys.argv[1:] if not a.startswith('--')] else '.')
