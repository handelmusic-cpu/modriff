#!/usr/bin/env python3
# Builds the four sampled melodic sets that replaced the MusyngKite renders
# (6.9.9.9.9.9.9.9.9a, see samples/CREDITS.md): samples/vibes-vcsl,
# samples/tenorsax-vcsl, samples/mutetpt-vsco and samples/nylongtr-freepats.
# Every source is CC0 and none is a SoundFont render.
#
#   python3 -I build/cc0-sets.py <set> <source dir> <out samples dir> [old dir]
#   <set> is vibes | sax | trumpet | nylon.  Needs ffmpeg (libmp3lame) and numpy.
#
# Same treatment as the violin/clarinet/flute: mono, trimmed to the attack,
# 3.2 s with a 300 ms fade, 45 Hz high-pass, LAME VBR q4. Two things differ
# because of what the sources are:
#   * Names cannot be trusted for pitch. VCSL and VSCO-2 CE name their notes an
#     octave under what sounds (the tenor sax's lowest file, "G#1", sounds the
#     instrument's real lowest note, G#2), so each file is placed by a
#     harmonic comb around the octave-corrected name and resampled to exactly
#     that pitch (never more than a few tens of cents).
#   * The old sets' level trims (WAVE_GAIN, BASS_LEVEL_TRIM, MEL_SAMPLE_TRIM)
#     were calibrated against the files they replace, so every new file is
#     scaled by one gain per set that puts its mean RMS (first 1.5 s from the
#     onset, register C3-E5) on the old set's. The trim tables then stay true.
import sys, os, re, glob, subprocess, tempfile, numpy as np
SR = 44100
NAMES = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B']
PC = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}

def decode(path, filt=None):
    cmd = ['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(SR)]
    if filt: cmd += ['-af', filt]
    cmd += ['-f','f32le','-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32).copy()

def measure(x, lo, hi):
    """MIDI note (fractional) by a harmonic comb over the ringing part."""
    pk = int(np.argmax(np.abs(x)))
    seg = x[pk + int(.15*SR): pk + int(.15*SR) + 16384]
    if len(seg) < 8192: seg = x[pk: pk + 16384]
    seg = np.pad(seg, (0, 16384 - len(seg)))
    sp = np.abs(np.fft.rfft(seg*np.hanning(len(seg)), n=1<<18)); bin_hz = SR/(1<<18)
    best = None
    for m in np.arange(lo, hi, 0.02):
        f0 = 440*2**((m-69)/12); s = 0
        for h in range(1, 5):
            i = int(round(f0*h/bin_hz))
            if i < len(sp): s += sp[i-3:i+4].max()/h
        if best is None or s > best[0]: best = (s, m)
    return best[1]

def limit(x, ceil, look=0.004):
    """Look-ahead peak limiter: gain is the running minimum of ceil/|x| over +-look s,
    smoothed by a Hann window as wide, so it never overshoots and acts on a
    transient rather than distorting the waveform."""
    W = int(look*SR)
    need = np.minimum(1.0, ceil/np.maximum(np.abs(x), 1e-9))
    pad = np.pad(need, (W, W), constant_values=1.0)
    mn = np.min(np.lib.stride_tricks.sliding_window_view(pad, 2*W + 1), axis=1)
    k = np.hanning(2*W + 1); k /= k.sum()
    g = np.convolve(np.pad(mn, (W, W), mode='edge'), k, mode='valid')
    return x*g[:len(x)]

def note_name(n): return NAMES[n % 12] + str(n//12 - 1)

def onset(x):
    pk = np.max(np.abs(x))
    return max(0, int(np.argmax(np.abs(x) > pk*0.1)) - int(.003*SR))

def rms_from_onset(x, secs=1.5):
    x = x[onset(x):onset(x) + int(secs*SR)]
    return float(np.sqrt(np.mean(x**2)))

# set -> (glob, file -> expected sounding midi, midi notes to keep)
def vcsl_name(p):                       # Vibes_soft_C3_v2..., BrettTenor_NV_Main_A#1_vl3...
    m = re.search(r'_([A-G]#?)(\d)_(?:v|vl)\d', os.path.basename(p))
    return PC[m.group(1)] + 12*(int(m.group(2)) + 1)
def vsco_name(p):                       # Sum_SHTrumpet_straightM-sus_A#2_v3_rr1.wav
    m = re.search(r'_([A-G]#?)(\d)_v\d', os.path.basename(p))
    return PC[m.group(1)] + 12*(int(m.group(2)) + 1)
def freepats_name(p):                   # E2.flac, F#3.flac
    m = re.match(r'([A-G]#?)(\d)\.', os.path.basename(p))
    return PC[m.group(1)] + 12*(int(m.group(2)) + 1)

SETS = {
 # VCSL vibraphone, soft mallets, velocity layer 2; names are an octave low.
 'vibes':   dict(glob='*.wav',  name=vcsl_name,     shift=12, keep=None, out='vibes-vcsl', crest=17.5, level_db=6.8),
 # VCSL tenor sax, non-vibrato, loud layer; whole-tone grid G#2-C6 (altissimo dropped).
 'sax':     dict(glob='*.wav',  name=vcsl_name,     shift=12, keep=range(44, 85), out='tenorsax-vcsl', crest=13.5, level_db=2.0),
 # VSCO-2 CE trumpet, straight mute, sustain, loud layer; names an octave low.
 'trumpet': dict(glob='*.wav',  name=vsco_name,     shift=12, keep=None, out='mutetpt-vsco', crest=13.5,
                 # C5 for the sampler's "Muted Trumpet · C5" pad: A#4 raised two semitones, as the app would
                 derive=[(72, 70)]),
 # FreePats Spanish classical guitar; its names are right.
 'nylon':   dict(glob='*.flac', name=freepats_name, shift=0,
                 keep=[36,40,43,45,47,48,50,52,54,56,58,60,62,64,67,69,71,72,74,76,81], out='nylongtr-freepats', crest=17.5, level_db=1.5),
}

def main():
    which, src, outroot = sys.argv[1:4]
    old = sys.argv[4] if len(sys.argv) > 4 else None
    cfg = SETS[which]; out = os.path.join(outroot, cfg['out']); os.makedirs(out, exist_ok=True)
    built = []
    for path in sorted(glob.glob(os.path.join(src, cfg['glob']))):
        exp = cfg['name'](path) + cfg['shift']
        if cfg['keep'] is not None and exp not in cfg['keep']: continue
        x = decode(path)
        m = measure(x, exp - 0.7, exp + 0.7)
        n = int(round(m)); ratio = 2**((n - m)/12)
        y = decode(path, 'asetrate=%d,aresample=%d,highpass=f=45' % (round(SR*ratio), SR))
        y = y[onset(y): onset(y) + int(3.2*SR)].copy()
        f = int(.3*SR); y[-f:] *= np.linspace(1, 0, f)**2
        built.append((n, os.path.basename(path), (n - m)*100, y))
        for tgt, srcn in cfg.get('derive', []):
            if n == srcn:
                r2 = ratio*2**((tgt - srcn)/12)
                z = decode(path, 'asetrate=%d,aresample=%d,highpass=f=45' % (round(SR*r2), SR))
                z = z[onset(z): onset(z) + int(3.2*SR)].copy(); z[-f:] *= np.linspace(1, 0, f)**2
                built.append((tgt, os.path.basename(path) + ' (+%d st)' % (tgt - srcn), (n - m)*100, z))
    # level: every file to the old set's mean RMS over C3-E5, so the trim tables
    # (calibrated against the files being replaced) stay true, and so a note
    # does not jump in level when the sampler shifts one anchor to the next.
    # A file whose transient would pass -1 dBFS at that level is held there.
    target = None
    if old:
        oldr = []
        for p in glob.glob(os.path.join(old, '*.mp3')):
            mm = re.match(r'([A-G])(s?)(\d)\.mp3', os.path.basename(p))
            n = PC[mm.group(1)] + (1 if mm.group(2) else 0) + 12*(int(mm.group(3)) + 1)
            if 48 <= n <= 76: oldr.append(rms_from_onset(decode(p)))
        target = float(np.mean(oldr))
    else:
        target = float(np.mean([rms_from_onset(y) for _, _, _, y in built]))
    # Then the one correction an offline RMS cannot see: how the set sounds through
    # the app's chord path (tests/levels/measure.js, chord part, against the synth
    # voices). A struck vibes bar or a plucked string loses or keeps more of its
    # energy than a sustained note does between the onset and the chord's release.
    target *= 10**(cfg.get('level_db', 0)/20)
    ceiling = 10**(-1.0/20)
    scaled = []
    for n, name, cents, y in built:
        # Real recordings are peakier than the SoundFont renders the trims were
        # calibrated on (the trumpet's mute and the sax's tongue by 4-6 dB), and a
        # sampled part that crosses 1.0 at the master is hard-clipped, not limited.
        # So the transient is limited to the old set's crest factor plus a little.
        for _ in range(2):
            y = limit(y*(target/rms_from_onset(y)), target*10**(cfg['crest']/20))
        g = target/rms_from_onset(y); held = ''
        if np.max(np.abs(y))*g > ceiling:
            g = ceiling/np.max(np.abs(y)); held = '  HELD at -1 dBFS (%.1f dB under target)' % (20*np.log10(g*rms_from_onset(y)/target))
        scaled.append((n, name, cents, y*g, held))
    built = scaled
    gain = target
    for n, name, cents, y, held in built:
        dst = os.path.join(out, note_name(n) + '.mp3')
        with tempfile.NamedTemporaryFile(suffix='.f32', delete=False) as t:
            t.write(y.astype(np.float32).tobytes()); tn = t.name
        subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','1','-i',tn,
                        '-codec:a','libmp3lame','-q:a','4',dst], check=True)
        os.unlink(tn)
        print('%-52s -> %s/%s  (%+.0f cents)%s' % (name, cfg['out'], note_name(n) + '.mp3', cents, held))
    print('%s: %d files, target RMS %.4f' % (which, len(built), target))

if __name__ == '__main__':
    main()
