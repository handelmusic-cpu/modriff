#!/usr/bin/env python3
# Builds samples/analog1 (the "Real Analog 1" kit, the phrase sampler's Analog 1 and
# Sub Bass) and samples/sfx/tapestop2.mp3 from "Filthy Drums 808 Analog Drum Hits"
# by Uberproduktion (Freesound pack 25700, CC0; its _readme_and_license.txt is
# samples/licenses/freesound-uberproduktion-25700.txt). They replaced the 1994 set
# of an analog drum machine whose "free to use" note was never a licence
# (6.9.9.9.9.9.9.9.9.5). The old tape stop was a bar of that set slowed to a stop;
# this one is a bar of the new files.
#
#   python3 -I build/analog-cc0.py <pack dir> samples [old tapestop.mp3]
# Needs ffmpeg and numpy. Same treatment as the kits in build/drum-kits.py: mono,
# trimmed to the attack and to a 60 dB tail fall, peak-normalised -1 dBFS, mp3 VBR q5.
import sys, os, glob, subprocess, tempfile, numpy as np
SR = 44100
SRC, OUT = sys.argv[1], sys.argv[2]
OLD_STOP = sys.argv[3] if len(sys.argv) > 3 else None

def decode(path, filt=None):
    cmd = ['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(SR)]
    if filt: cmd += ['-af', filt]
    cmd += ['-f','f32le','-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32).copy()
def shape(x, maxlen):
    pk = np.max(np.abs(x))
    on = int(np.argmax(np.abs(x) > pk*10**(-40/20))); on = max(0, on - int(.001*SR))
    x = x[on:]
    above = np.where(np.abs(x) > pk*10**(-60/20))[0]
    end = min(len(x), (above[-1] if len(above) else len(x)) + int(.02*SR), int(maxlen*SR))
    x = x[:end].copy()
    fo = min(int(.03*SR) if end < int(maxlen*SR) else int(.08*SR), len(x)//2)
    if fo > 0: x[-fo:] *= np.linspace(1, 0, fo)**2
    fi = int(.001*SR); x[:fi] *= np.linspace(0, 1, fi)
    return x/(np.max(np.abs(x)) + 1e-9)*10**(-1/20)
def encode(x, dst, q='5', br=None):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix='.f32', delete=False) as t:
        t.write(x.astype(np.float32).tobytes()); tn = t.name
    cmd = ['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','1','-i',tn,'-codec:a','libmp3lame']
    cmd += ['-b:a', br] if br else ['-q:a', q]
    subprocess.run(cmd + [dst], check=True); os.unlink(tn)
def find(tag):
    m = [p for p in glob.glob(os.path.join(SRC, '*.wav')) if p.endswith('fd808a-%s.wav' % tag)]
    assert len(m) == 1, tag
    return m[0]

# lane file <- source, longest tail kept (s). conga is the hi conga (lane 'Hi Conga').
LANES = {'kick':('bass-drum', 2.0), 'snare':('snare', .6), 'clap':('clap', 1.3), 'rim':('rimshot', .12),
         'hat':('hihat-closed', .3), 'open':('hihat-open', 1.1), 'lotom':('tom-low', 2.1), 'tom':('tom-mid', 1.0),
         'hitom':('tom-hi', 1.0), 'cowbell':('cowbell', .8), 'clave':('claves', .15), 'conga':('conga-hi', .6),
         'maracas':('marcaras', .15), 'crash':('cymbal', 2.5)}
made = {}
for lane, (tag, maxlen) in LANES.items():
    x = shape(decode(find(tag), 'highpass=f=30'), maxlen)
    encode(x, os.path.join(OUT, 'analog1', lane + '.mp3')); made[lane] = x
    print('%-8s <- %-14s %.2f s' % (lane, tag, len(x)/SR))

# Sub Bass: the kick, retuned so its body sits on G1 (49.0 Hz, MIDI 31, where the
# sampler's Sub Bass pad roots it). The body's pitch is the strongest low partial.
k = decode(find('bass-drum'), 'highpass=f=25')
seg = k[int(.08*SR): int(.6*SR)]*np.hanning(len(k[int(.08*SR): int(.6*SR)]))
sp = np.abs(np.fft.rfft(seg, n=1 << 18)); f = np.fft.rfftfreq(1 << 18, 1/SR)
band = (f > 28) & (f < 120); i = np.argmax(np.where(band, sp, 0)); f0 = f[i]
ratio = 48.9995/f0
y = decode(find('bass-drum'), 'highpass=f=25,asetrate=%d,aresample=%d' % (round(SR*ratio), SR))
encode(shape(y, 3.0), os.path.join(OUT, 'analog1', 'bass.mp3'))
print('bass     body %.1f Hz -> 49.0 Hz (x%.3f)' % (f0, ratio))

# Tape stop: a one-bar pattern at 120 bpm of the new files, playing at speed for a
# beat, then the platter slowing to a halt.
def at(buf, x, t, g=1.0):
    n = int(t*SR); buf[n:n + len(x)] += x[:len(buf) - n]*g
bar = np.zeros(int(2.0*SR))
for t in (0, .75, 1.0): at(bar, made['kick'], t, .9)
for t in (.5, 1.5): at(bar, made['snare'], t, .8)
for t in np.arange(0, 2.0, .25): at(bar, made['hat'], t, .35)
at(bar, made['open'], .875, .3)
T = 2.3; t = np.arange(int(T*SR))/SR
rate = np.where(t < .35, 1.0, np.maximum(0.0, 1 - (t - .35)/(T - .35))**1.6)
pos = np.cumsum(rate)/SR*SR
stop = np.interp(pos, np.arange(len(bar)), bar)
stop *= np.minimum(1.0, (T - t)/0.05)
stop *= 10**(-1/20)/np.max(np.abs(stop))
if OLD_STOP:
    # the old one's RMS, unless that would pass -1 dBFS (a bar of drums is peakier)
    o = decode(OLD_STOP); g = np.sqrt(np.mean(o**2))/np.sqrt(np.mean(stop**2))
    stop *= min(g, 1.0)
    print('tape stop level: wanted x%.2f of peak-normalised' % g)
encode(stop, os.path.join(OUT, 'sfx', 'tapestop2.mp3'), br='128k')
print('tapestop2 %.2f s' % (len(stop)/SR))
