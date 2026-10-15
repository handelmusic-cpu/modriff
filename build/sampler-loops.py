#!/usr/bin/env python3
# Builds the sampler's recorded loops (4.9.9.3) — samples/loops/samba and
# samples/loops/world — and prints each one's tempo for PS_FACTORY_KIT.
#
#   python3 -I build/sampler-loops.py index.txt samples
#
# index.txt lists source files one per line, matched by basename (the same
# index build/drum-kits.py takes). Needs ffmpeg and numpy.
#
# A loop's tempo is what the sampler warps it by, so it is computed, not
# guessed: beats × 60 / exact length. The samba pack (plotzki, Freesound,
# CC0) is cut to the sample — 418,912 samples at 48 kHz is sixteen beats at
# 110.00 — so its files are used whole. Three of the owner's files were
# performances rather than loops; for those the beat grid was fitted to the
# onsets (least squares, 1.4–9 ms RMS error) and whole bars cut from the
# first hit: the numbers in START below. 5 ms fades at both ends, so the
# seam cannot click. Samba mono (as recorded), the owner's stereo; mp3 VBR q5.
import sys, os, subprocess, tempfile, numpy as np
IDX = [l.strip() for l in open(sys.argv[1])]
OUT = sys.argv[2]
SR = 44100

def find(name):
    m = [p for p in IDX if os.path.basename(p) == name]
    if not m: raise SystemExit('missing ' + name)
    return m[0]

def frames(path):
    r = subprocess.run(['ffprobe','-v','error','-select_streams','a','-show_entries','stream=duration_ts,sample_rate',
                        '-of','csv=p=0', path], capture_output=True, check=True, text=True).stdout.strip().split(',')
    return int(r[0]), int(r[1])     # sample_rate, frames

# (source, output, beats, start seconds or None for the whole file)
LOOPS = [
 # The 4-bar "f" set: six parts of one samba bateria at 110, made to stack.
 ('36110__plotzki__x-surdo-4bar-f.aiff',       'samba/surdo-f',      16, None),
 ('36111__plotzki__x-caixeta-4bar-f.aiff',     'samba/caixeta-f',    16, None),
 ('36116__plotzki__x-pandeiro-4barf.aiff',     'samba/pandeiro-f',   16, None),
 ('36117__plotzki__x-repinique-4bar-f.aiff',   'samba/repinique-f',  16, None),
 ('36120__plotzki__x-shake-4bar-f.aiff',       'samba/shaker-f',     16, None),
 ('36132__plotzki__x-tamb-4bar-f.aiff',        'samba/tamborim-f',   16, None),
 # Variations at 110.
 ('36108__plotzki__repinique-loop.aiff',       'samba/repinique',    16, None),
 ('36118__plotzki__x-repinique-4bar-a.aiff',   'samba/repinique-a',  16, None),
 ('36119__plotzki__x-repinique-5bar-b.aiff',   'samba/repinique-b',  20, None),
 ('36127__plotzki__x-surdo-4bar-d.aiff',       'samba/surdo-d',      16, None),
 ('36112__plotzki__x-pand-2bar-d.aiff',        'samba/pandeiro-d',    8, None),
 ('36114__plotzki__x-pandeiro-2bar-c2.aiff',   'samba/pandeiro-c2',   8, None),
 ('36129__plotzki__x-tamb-2bar-c.aiff',        'samba/tamborim-c',    8, None),
 ('36133__plotzki__x-tamp-2bar-e.aiff',        'samba/tamborim-e',    8, None),
 ('36122__plotzki__x-shake-1bar-e.aiff',       'samba/shaker-e',      4, None),
 # At ~121.
 ('36113__plotzki__x-pandeiro-2bar-c.aiff',    'samba/pandeiro-c',    8, None),
 ('36134__plotzki__x-pandero-2bar.aiff',       'samba/pandeiro-b',    8, None),
 ('36126__plotzki__x-surdo-2barb.aiff',        'samba/surdo-b',       8, None),
 ('36128__plotzki__x-tamb-2-bar-b.aiff',       'samba/tamborim-b',    8, None),
 ('36121__plotzki__x-shake-1bar-b.aiff',       'samba/shaker-b',      8, None),
 # At ~125.
 ('36115__plotzki__x-pandeiro-2bar.aiff',      'samba/pandeiro',      8, None),
 ('36125__plotzki__x-surd-2bar.aiff',          'samba/surdo',         8, None),
 ('36130__plotzki__x-tamb-2bar.aiff',          'samba/tamborim',      8, None),
 ('36123__plotzki__x-shake-2bar.aiff',         'samba/shaker',        8, None),
 # At ~100.
 ('36131__plotzki__x-tamb-4-bar.aiff',         'samba/tamborim-slow', 8, None),
 ('36124__plotzki__x-shake-4bar.aiff',         'samba/shaker-slow',   8, None),
 # The owner's.
 ('DrumSet_Groove.wav',                        'world/drumset',       8, None),
 ('Electro_Hi_Drums.wav',                      'world/electro',      16, None),
 ('Weirdo_Drums.wav',                          'world/weirdo',       16, (0.6128, 0.59827)),
 ('Woodblock_and_stuff_sfx.wav',               'world/woodblock',    16, (0.7339, 0.59827)),
 ('Udu_Groovoo.wav',                           'world/udu',          12, (2.2747, 0.71444)),
]
# The pack's one-shot pickup ("repinique-loop-intro"): a call, not a loop.
ONESHOT = [('36109__plotzki__repinique-loop-intro.aiff', 'samba/repinique-call')]

def encode(src, dst, start, length, stereo):
    ch = 2 if stereo else 1
    cmd = ['ffmpeg','-v','error','-ss','%.5f' % start,'-t','%.5f' % length,'-i',src,'-ac',str(ch),'-ar',str(SR),'-f','f32le','-']
    x = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32).copy().reshape(-1, ch)
    f = int(.005*SR); x[:f] *= np.linspace(0, 1, f)[:, None]; x[-f:] *= np.linspace(1, 0, f)[:, None]
    x = x/(np.max(np.abs(x)) + 1e-9) * 10**(-1/20)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix='.f32', delete=False) as t:
        t.write(x.astype(np.float32).tobytes()); tn = t.name
    subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac',str(ch),'-i',tn,
                    '-codec:a','libmp3lame','-q:a','5',dst], check=True)
    os.unlink(tn)

for src_name, out, beats, cut in LOOPS:
    src = find(src_name); sr, n = frames(src)
    stereo = out.startswith('world/')
    if cut:
        start, beat = cut; start -= .005; length = beats*beat
    else:
        start, length = 0, n/sr
    bpm = beats*60/length
    encode(src, os.path.join(OUT, 'loops', out + '.mp3'), max(0, start), length, stereo)
    print('%-22s %2d beats  %.4f bpm  %.2fs' % (out, beats, bpm, length))
for src_name, out in ONESHOT:
    src = find(src_name); sr, n = frames(src)
    encode(src, os.path.join(OUT, 'loops', out + '.mp3'), 0, n/sr, False)
    print('%-22s one-shot' % out)
