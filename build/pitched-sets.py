#!/usr/bin/env python3
# Builds the sampled melodic sets added in 4.9.9.3 — samples/kalimba and
# samples/xylo — and the picked electric bass added in 4.9.9.4, samples/ebass,
# from their Freesound packs (all CC0; see samples/CREDITS.md).
#
#   python3 -I build/pitched-sets.py index.txt samples
#
# index.txt lists source files one per line, matched by basename (the same
# index build/drum-kits.py takes). Needs ffmpeg and numpy.
#
# Neither pack's names can be trusted for pitch: the kalimba's are an octave
# low ("c3" sounds middle C), and the xylophone's give the written note, an
# octave under the sounding one, with the G files labelled "f". So every file
# was placed by measured pitch (a four-partial harmonic comb, below), and each
# is resampled to exactly its note — they were up to 24 cents off — before it
# is trimmed to the attack, faded, peak-matched to -1.5 dBFS and encoded mono,
# mp3 VBR q6, the marimba's settings. Files are named by note (C4.mp3), which
# is what SAMPLE_SETS and the sampler's note libraries read.
import sys, os, subprocess, tempfile, numpy as np
IDX = [l.strip() for l in open(sys.argv[1])]
OUT = sys.argv[2]
SR = 44100
NAMES = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B']

def find(name):
    m = [p for p in IDX if os.path.basename(p) == name]
    if not m: raise SystemExit('missing ' + name)
    return m[0]

def decode(path, filt=None):
    cmd = ['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(SR)]
    if filt: cmd += ['-af', filt]
    cmd += ['-f','f32le','-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32).copy()

def measure(x, lo=36, hi=None):
    """MIDI note (fractional) by a harmonic comb over the ringing part."""
    pk = int(np.argmax(np.abs(x)))
    seg = x[pk + int(.05*SR): pk + int(.05*SR) + 16384]
    seg = np.pad(seg, (0, 16384 - len(seg)))
    sp = np.abs(np.fft.rfft(seg*np.hanning(len(seg)), n=1<<18)); bin_hz = SR/(1<<18)
    best = None
    for m in np.arange(lo, hi if hi is not None else lo + 76, 0.02):
        f0 = 440*2**((m-69)/12); s = 0
        for h in range(1, 5):
            i = int(round(f0*h/bin_hz))
            if i < len(sp): s += sp[i-3:i+4].max()/h
        if best is None or s > best[0]: best = (s, m)
    return best[1]

def named_midi(name):
    """'826034__ixwolf__e1_rr1.wav' -> 28: the note in the file's own name."""
    tag = name.split('__')[2].split('_')[0].capitalize()
    return NAMES.index(tag[:-1]) + 12*(int(tag[-1]) + 1)

def build(dst_dir, files, maxlen, fade, hp, lo=36, named=False):
    os.makedirs(os.path.join(OUT, dst_dir), exist_ok=True)
    for name in files:
        src = find(name)
        if named:                                     # trust the name to the semitone
            e = named_midi(name); m = measure(decode(src), e - 1, e + 1)
        else: m = measure(decode(src), lo)
        n = int(round(m))
        ratio = 2**((n - m)/12)                       # to exactly note n
        x = decode(src, 'asetrate=%d,aresample=%d,highpass=f=%d' % (round(SR*ratio), SR, hp))
        pk = np.max(np.abs(x))
        on = max(0, int(np.argmax(np.abs(x) > pk*0.1)) - int(.002*SR))
        x = x[on:on + int(maxlen*SR)].copy()
        f = min(int(fade*SR), len(x)//2); x[-f:] *= np.linspace(1, 0, f)**2
        x = x/(np.max(np.abs(x)) + 1e-9) * 10**(-1.5/20)
        note = NAMES[n % 12] + str(n//12 - 1)
        dst = os.path.join(OUT, dst_dir, note + '.mp3')
        with tempfile.NamedTemporaryFile(suffix='.f32', delete=False) as t:
            t.write(x.astype(np.float32).tobytes()); tn = t.name
        subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','1','-i',tn,
                        '-codec:a','libmp3lame','-q:a','6',dst], check=True)
        os.unlink(tn)
        print('%-60s -> %s/%s.mp3  (%+.0f cents)' % (name, dst_dir, note, (n - m)*100))

# Kalimba: the pack's hard strikes — a clear tine attack and 2.5 s of ring
# (the soft set's top note is cut at 1.75 s). C4–E6, diatonic.
build('kalimba', ['691780__hollandm__c3-hard-kalimba.wav','691786__hollandm__d3-hard-kalimba.wav',
  '691792__hollandm__e3-hard-kalimba.wav','691798__hollandm__f3-hard-kalimba.wav','691802__hollandm__g3-hard-kalimba.wav',
  '691772__hollandm__a3-hard-kalimba.wav','691776__hollandm__b3-hard-kalimba.wav','691782__hollandm__c4-hard-kalimba.wav',
  '691788__hollandm__d4-hard-kalimba.wav','691794__hollandm__e4-hard-kalimba.wav','691800__hollandm__f4-hard-kalimba.wav',
  '691804__hollandm__g4-hard-kalimba.wav','691774__hollandm__a4-hard-kalimba.wav','691778__hollandm__b4-hard-kalimba.wav',
  '691784__hollandm__c5-hard-kalimba.wav','691790__hollandm__d5-hard-kalimba.wav','691796__hollandm__e5-hard-kalimba.wav'],
  2.5, .6, 60)
# Xylophone (VSCO-2 CE, medium mallets, ff): G4–C8 on a C/G grid.
build('xylo', ['374703__sgossner__xylophone-f3-xylo_medium_g3_ff_01_far.wav','374699__sgossner__xylophone-c4-xylo_medium_c4_ff_01_far.wav',
  '374704__sgossner__xylophone-f4-xylo_medium_g4_ff_01_far.wav','374700__sgossner__xylophone-c5-xylo_medium_c5_ff_01_far.wav',
  '374705__sgossner__xylophone-f5-xylo_medium_g5_ff_01_far.wav','374701__sgossner__xylophone-c6-xylo_medium_c6_ff_01_far.wav',
  '374706__sgossner__xylophone-f6-xylo_medium_g6_ff_01_far.wav','374702__sgossner__xylophone-c7-xylo_medium_c7_ff_01_far.wav'],
  1.8, .4, 150)
# Electric bass, picked (Ixwolf's "Picked Riff on Real Bass Guitar"): E1–E2,
# chromatic, one take each — the open E string to the twelfth fret. Its names
# are right (checked by ear-free measurement: every one within 18 cents of its
# label), but a low E's fundamental is weak enough that the comb heard E1 as
# E2 and overwrote the real one. So here the name fixes the semitone and the
# comb only measures the cents, a semitone either side.
# The files ring for 5.4 s; three is longer than any bass step, and keeps the
# set the size of the uprights'. Tuned: the low notes were 12-18 cents sharp.
build('ebass', ['826034__ixwolf__e1_rr1.wav','826036__ixwolf__f1_rr1.wav','826037__ixwolf__fs1_rr1.wav',
  '826038__ixwolf__g1_rr1.wav','826039__ixwolf__gs1_rr1.wav','826027__ixwolf__a1_rr1.wav',
  '826028__ixwolf__as1_rr1.wav','826029__ixwolf__b1_rr1.wav','826030__ixwolf__c2_rr1.wav',
  '826031__ixwolf__cs2_rr1.wav','826032__ixwolf__d2_rr1.wav','826033__ixwolf__ds2_rr1.wav',
  '826035__ixwolf__e2_rr1.wav'],
  3.0, .8, 30, named=True)
