#!/usr/bin/env python3
"""Build the CC0 recorded keys added in 1.9.5.

Usage: python3 build/recorded-keys.py SOURCE_ROOT OUTPUT_ROOT [pianos|ukulele|ep]
Needs numpy and ffmpeg. Sources are the owner's original archives, extracted
under grand/, UprightPianoKW/, PianoFB/, ukulele/, and vcsl/. The manifest
retains the exact source member and tuning correction for each shipped file.
No SFZ player is embedded: these are single recorded articulations using the
app's existing sample player, with its velocity envelope and natural tails.
"""
import csv
import hashlib
import io
import json
import pathlib
import re
import subprocess
import sys
import tempfile

import numpy as np

SR = 44100
NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']
PC = dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)
CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/'
SETS = {
 'grand': ('Grand', 'piano-grand', 'Osiris Piano / Versilian Studios and Karoryfer Samples', 'https://shop.karoryfer.com/pages/free-osiris-piano', 'pianos'),
 'upright': ('Upright', 'piano-upright', 'Gonzalo, Roberto / FreePats', 'https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html', 'pianos'),
 'old': ('Old', 'piano-old', 'Piotr Barcz, Roberto / FreePats', 'https://freepats.zenvoid.org/Piano/honky-tonk-piano.html', 'pianos'),
 'ukulele': ('Ukulele', 'ukulele-freepats', 'Mateusz Dąbrowski / FreePats', 'https://freepats.zenvoid.org/GuitarFamily/ukulele.html', 'ukulele'),
 'epfm': ('FM EP', 'ep-fm-vcsl', 'Versilian Studios / Sam Gossner', 'https://github.com/sgossner/VCSL', 'ep'),
 'epbright': ('Digital EP', 'ep-bright-vcsl', 'Versilian Studios / Sam Gossner', 'https://github.com/sgossner/VCSL', 'ep'),
}

def decode(path, filters=None):
    cmd = ['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(SR)]
    if filters: cmd += ['-af', filters]
    return np.frombuffer(subprocess.check_output(cmd + ['-f', 'f32le', '-']), dtype=np.float32).copy()

def midi(name, octave_offset=0):
    m = re.fullmatch(r'([A-G])([#s]?)(-?\d+)', name)
    return PC[m[1]] + bool(m[2]) + 12 * (int(m[3]) + 1 + octave_offset)

def name(n): return NAMES[n % 12] + str(n // 12 - 1)

def pitch(x, expected):
    # Harmonic comb avoids mistaking a piano's strongest overtone for its root.
    start = int(.15 * SR)
    seg = x[start:start + 32768]
    seg = np.pad(seg, (0, max(0, 32768 - len(seg))))
    spec = abs(np.fft.rfft(seg * np.hanning(len(seg)), n=1 << 19))
    best = (-1, expected)
    for n in np.arange(expected - .65, expected + .65, .01):
        f = 440 * 2 ** ((n - 69) / 12)
        score = 0
        for h in range(1, 5):
            b = round(f * h * (1 << 19) / SR)
            if b + 2 < len(spec): score += spec[max(0, b-2):b+3].max() / h
        if score > best[0]: best = (score, float(n))
    return best[1]

def sources(root, key):
    if key == 'grand':
        for p in sorted((root / 'grand/Osiris Piano/UC/B').glob('*_vl2.flac')):
            yield p, midi(re.search(r'_([A-G]#?-?\d+)_vl', p.name)[1], 1)
    elif key in ('upright', 'old'):
        folder = root / ('UprightPianoKW' if key == 'upright' else 'PianoFB')
        for p in sorted(folder.rglob('*.flac')):
            m = re.fullmatch(r'([A-G]#?\d+)(v[HL])?\.flac', p.name)
            if not m or (key == 'upright' and m[2] != 'vH'): continue
            yield p, midi(m[1])
    elif key == 'ukulele':
        for p in sorted((root / 'ukulele/samples').glob('*.flac')):
            yield p, midi(p.stem)
    else:
        folder = root / 'vcsl' / ('FM Piano' if key == 'epfm' else 'Piano 1')
        for p in sorted(folder.glob('*_vl2.wav')):
            yield p, midi(re.search(r'_([A-G]#?\d+)_vl', p.name)[1], 1)

def build(root, outroot, key):
    label, directory, author, url, _ = SETS[key]
    out = outroot / 'samples' / directory
    out.mkdir(parents=True, exist_ok=True)
    built = []
    for path, n in sources(root, key):
        if not 21 <= n <= 108: continue
        # Old has many chromatic takes; retain a whole-tone grid and both ends.
        if key == 'old' and n % 2 and n not in (21, 107): continue
        x = decode(path)
        measured = pitch(x, n)
        ratio = 2 ** ((n - measured) / 12)
        # Sources mix 44.1 and 48 kHz. Resample before changing the rate;
        # applying a 44.1 kHz correction directly to 48 kHz audio detunes it.
        x = decode(path, 'aresample=%d,asetrate=%d,aresample=%d,highpass=f=35' % (SR, round(SR * ratio), SR))
        pk = abs(x).max()
        onset = max(0, int(np.argmax(abs(x) > pk * .03)) - round(.003 * SR))
        x = x[onset:onset + round((3.2 if key == 'ukulele' else 6) * SR)].copy()
        tail = min(len(x), round(.35 * SR))
        x[-tail:] *= np.linspace(1, 0, tail) ** 2
        x[:min(len(x), 45)] *= np.linspace(0, 1, min(len(x), 45))
        rms = np.sqrt(np.mean(x[:round(1.5 * SR)] ** 2))
        # Keep headroom for chords. Per-note scaling avoids a quiet register
        # disappearing when a caller selects the nearest recording.
        x *= min(.08 / max(rms, 1e-9), .79 / max(abs(x).max(), 1e-9))
        dest = out / (name(n) + '.mp3')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                        '-codec:a', 'libmp3lame', '-q:a', '2', str(dest)], input=x.astype(np.float32).tobytes(), check=True)
        y = decode(dest)
        after = pitch(y, n)
        built.append(dict(note=name(n), midi=n, source=str(path.relative_to(root)),
                          correction_cents=round((n-measured)*100, 2),
                          measured_cents=round((after-n)*100, 2),
                          duration=round(len(y)/SR, 3), peak=round(float(abs(y).max()), 5),
                          rms=round(float(np.sqrt(np.mean(y[:round(1.5*SR)]**2))), 5),
                          sha256=hashlib.sha256(dest.read_bytes()).hexdigest()))
    if not built: raise RuntimeError('No samples found for ' + key)
    built.sort(key=lambda v: v['midi'])
    report = dict(key=key, label=label, directory=directory, author=author, source=url, license='CC0 1.0', samples=built)
    (outroot / 'build' / ('recorded-' + key + '.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(key, len(built), 'notes; worst measured tuning', max(abs(r['measured_cents']) for r in built),
          'cents; peak', max(r['peak'] for r in built), flush=True)
    return report

def main():
    root, outroot = map(pathlib.Path, sys.argv[1:3])
    group = sys.argv[3] if len(sys.argv) > 3 else None
    (outroot / 'build').mkdir(parents=True, exist_ok=True)
    reports = [build(root, outroot, k) for k, cfg in SETS.items() if not group or group == cfg[4]]
    provenance = outroot / 'samples/SOURCES.csv'
    original = provenance.read_text()
    with provenance.open(newline='') as f:
        reader = csv.DictReader(f); fields = reader.fieldnames; rows = list(reader)
    dirs = ['samples/' + r['directory'] + '/' for r in reports]
    # Keep existing records byte-for-byte; rewriting the CSV changes quoting
    # on unrelated provenance rows and hides the actual additions in review.
    lines = original.splitlines(keepends=True)
    reader = csv.reader(io.StringIO(original)); next(reader)
    kept = lines[:reader.line_num]
    start = reader.line_num
    for row in reader:
        end = reader.line_num
        if not any(row[0].startswith(d) for d in dirs): kept.extend(lines[start:end])
        start = end
    rows = []
    for r in reports:
        for s in r['samples']:
            rows.append(dict(path='samples/' + r['directory'] + '/' + s['note'] + '.mp3', pack=r['label'],
                source_url=r['source'], author=r['author'], license='CC0 1.0', license_url=CC0,
                attribution_required='no', changes='Recorded articulation; mono, tuned, trimmed with a fade, level-matched, MP3 VBR q2. See build/recorded-' + r['key'] + '.json.',
                retrieved_date='2026-11-18', sha256=s['sha256'], status='VERIFIED', credit_group='recorded-' + r['key'], notes='Source member: ' + s['source']))
    output = io.StringIO(newline='')
    csv.DictWriter(output, fieldnames=fields, lineterminator='\n').writerows(rows)
    provenance.write_text(''.join(kept) + output.getvalue())

if __name__ == '__main__': main()
