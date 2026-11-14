#!/usr/bin/env python3
# Renders samples/sfx/scratch2.mp3: the tenor sax C4 (samples/tenorsax-vcsl/C4.mp3,
# VCSL, CC0) moved back and forth under a virtual hand, as a turntable scratch.
# It replaced scratch.mp3, which was cut from a MusyngKite note (6.9.9.9.9.9.9.9.9a);
# a new name because the service worker caches samples by URL for good.
#
#   python3 -I build/scratch-fx.py samples/tenorsax-vcsl/C4.mp3 samples/sfx/scratch2.mp3
# Needs ffmpeg and numpy.
import sys, subprocess, tempfile, os, numpy as np
SR = 44100
src, dst = sys.argv[1:3]
x = np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',src,'-ac','1','-ar',str(SR),'-f','f32le','-'],
                                 capture_output=True, check=True).stdout, dtype=np.float32)
# (time in the result, where the hand has the record, in seconds into the note)
keys = [(0.00, 0.10), (0.11, 0.55), (0.21, 0.16), (0.36, 0.78), (0.44, 0.62),
        (0.60, 0.05), (0.72, 0.40), (0.85, 0.22)]
t = np.arange(int(0.85*SR))/SR
kt, kp = zip(*keys)
# smooth the hand's path so a direction change has an inertia, like a wrist
pos = np.interp(t, kt, kp)
k = np.hanning(int(0.03*SR)); k /= k.sum()
pos = np.convolve(np.pad(pos, (len(k), len(k)), mode='edge'), k, mode='same')[len(k):-len(k)]
y = np.interp(pos*SR, np.arange(len(x)), x)
speed = np.abs(np.gradient(pos))*SR            # 1.0 = the note at its own speed
y *= np.minimum(1.0, speed/0.25)               # a stopped record is silent
y *= np.minimum(1.0, t/0.004)*np.minimum(1.0, (t[-1] - t)/0.03)
# Level: the old scratch's RMS (0.175), not -1 dBFS peak. A sax held under a moving
# hand is a continuous tone, so peak-normalised it came out 6.5 dB hotter than the
# pad's `gain` in PS_FACTORY_KIT was set for.
y *= 0.175/np.sqrt(np.mean(y**2))
assert np.max(np.abs(y)) < 10**(-1.0/20)
with tempfile.NamedTemporaryFile(suffix='.f32', delete=False) as f:
    f.write(y.astype(np.float32).tobytes()); tn = f.name
subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','1','-i',tn,
                '-codec:a','libmp3lame','-b:a','128k',dst], check=True)
os.unlink(tn)
print('%s: %.2f s' % (dst, len(y)/SR))
