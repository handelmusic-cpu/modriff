import os,sys,json,subprocess
from pathlib import Path
sys.path.insert(0,'/private/tmp/modriff-preview-tools')
import numpy as np,imageio_ffmpeg
W=Path(os.environ.get('MODRIFF_SERIES_WORK','/private/tmp/modriff-series'));M=Path(os.environ.get('MODRIFF_PROMO_WORK','/private/tmp/modriff-high-impact'));FF=imageio_ffmpeg.get_ffmpeg_exe();SR=48000;N=round(27.1*SR)
targets={'keys':.060,'bass':.105,'lead':.063,'arp':.033,'pad':.027,'kick':.100,'snare':.061,'hat':.022,'clap':.026}
variants={'rolls':{'kick':1.1,'snare':1.1,'hat':1.05,'lead':.8},'theory':{'keys':1.2,'lead':.7,'arp':.7,'pad':1.15},'song':{'keys':1.05},'sampler':{'kick':1.2,'snare':1.1,'clap':1.1,'keys':.85,'lead':.65},'synth':{'arp':1.4,'pad':1.2,'lead':1.05,'keys':.85},'export':{'keys':1.1,'lead':.85}}
proof={}
def finish(a,name):
 a=np.pad(a,((0,max(0,N-len(a))),(0,0)))[:N].astype(np.float64)
 # Every boundary has a sample ramp. The end is an equal-power release, never a hard splice.
 a[:720]*=np.linspace(0,1,720)[:,None];tail=round(.8*SR);a[-tail:]*=(np.cos(np.linspace(0,np.pi/2,tail))**2)[:,None]
 raw=W/('audio-'+name+'.f32');a.astype('<f4').tofile(raw)
 subprocess.run([FF,'-v','error','-y','-f','f32le','-ar','48000','-ac','2','-i',str(raw),'-af','highpass=f=28,lowpass=f=17500,acompressor=threshold=0.35:ratio=1.6:attack=18:release=100,loudnorm=I=-17:TP=-2.3:LRA=9','-ar','48000','-c:a','pcm_s24le',str(W/('audio-'+name+'.wav'))],check=True)
 proof[name]={'samples':len(a),'finite':bool(np.isfinite(a).all()),'sourcePeak':float(abs(a).max()),'zeroStartEnd':bool(np.max(abs(a[[0,-1]]))<1e-8)}
for name,mults in variants.items():
 mix=np.zeros((N,2))
 for key,target in targets.items():
  a=np.fromfile(M/(key+'.f32'),'<f4').reshape(-1,2).astype(np.float64);a*=target/np.sqrt(np.mean(a*a))*mults.get(key,1);a=np.pad(a,((0,max(0,N-len(a))),(0,0)))[:N];mix+=a
 finish(mix*.5,name)
def decode(p):
 b=subprocess.check_output([FF,'-v','error','-i',str(p),'-f','f32le','-ac','2','-ar','48000','-']);return np.frombuffer(b,'<f4').reshape(-1,2).copy()
live=decode(W/'exports/In Motion - Live.wav');offset=round(3.019*SR);finish(live[offset:offset+N],'live')
base=decode(W/'audio-song.wav');n=round(9.677*SR);start=offset+round(7.741935*SR);base[:n]=live[start:start+n];fade=720;base[n-fade:n]*=np.linspace(1,0,fade)[:,None];base[n:n+fade]*=np.linspace(0,1,fade)[:,None];finish(base,'storelive')
(W/'audio-render-proof.json').write_text(json.dumps(proof,indent=2))
