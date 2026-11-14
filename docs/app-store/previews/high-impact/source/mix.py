import os
import sys,json,subprocess,wave
from pathlib import Path
if os.environ.get('PREVIEW_PYTHON_TOOLS'): sys.path.insert(0,os.environ['PREVIEW_PYTHON_TOOLS'])
import numpy as np
import imageio_ffmpeg
root=Path(os.environ.get('MODRIFF_PROMO_WORK','/private/tmp/modriff-high-impact'));score=json.loads((root/'score.json').read_text());sr=48000
targets={'keys':.060,'bass':.105,'lead':.063,'arp':.033,'pad':.027,'kick':.100,'snare':.061,'hat':.022,'clap':.026}
mix=None;stats={};t=np.arange(int(np.ceil(score['duration']*sr)))/sr
for key,target in targets.items():
 a=np.fromfile(root/(key+'.f32'),dtype='<f4').reshape(-1,2).astype(np.float64)
 rms=np.sqrt(np.mean(a*a));assert rms>1e-7,(key,rms)
 a*=target/rms
 if key in ['keys','arp','pad']:
  duck=np.ones(len(a))
  for n in score['channels']['kick']['notes']:
   st=int(max(0,n['t']-.005)*sr);en=min(len(a),st+int(.19*sr));x=np.arange(en-st)/sr
   env=1-.25*np.sin(np.minimum(1,x/.012)*np.pi/2)*np.exp(-x/.060)
   duck[st:en]=np.minimum(duck[st:en],env)
  a*=duck[:,None]
 pan={'keys':-.1,'lead':.08,'arp':-.25,'pad':.23,'hat':.12,'clap':-.1}.get(key,0)
 a[:,0]*=(1-max(0,pan)*.4);a[:,1]*=(1+min(0,pan)*.4)
 # All changes are envelopes, never hard edits or sample-loop splices.
 a[:240]*=np.linspace(0,1,240)[:,None]
 stats[key]={'patch':score['channels'][key]['patch'],'notes':len(score['channels'][key]['notes']),'rms':float(np.sqrt(np.mean(a*a))),'peak':float(np.max(np.abs(a))),'maxAdjacentSampleDifference':float(np.max(np.abs(np.diff(a,axis=0))))}
 mix=a if mix is None else mix+a
mix*=.55
# The final tonic rings through a genuine two-second FX tail.
tail=int(.70*sr);mix[-tail:]*=(np.cos(np.linspace(0,np.pi/2,tail))**2)[:,None]
mix.astype('<f4').tofile(root/'mix.f32')
ff=imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([ff,'-v','error','-y','-f','f32le','-ar','48000','-ac','2','-i',str(root/'mix.f32'),'-af','highpass=f=28,lowpass=f=17500,acompressor=threshold=0.32:ratio=2:attack=18:release=100:makeup=1,alimiter=limit=0.84:attack=5:release=65:level=false','-c:a','pcm_s24le',str(root/'in-motion-premaster.wav')],check=True)
(root/'stem-analysis.json').write_text(json.dumps(stats,indent=2)+'\n')
print(json.dumps(stats,indent=2))

subprocess.run([ff,'-v','error','-y','-i',str(root/'in-motion-premaster.wav'),'-af','loudnorm=I=-16:TP=-2.2:LRA=9','-ar','48000','-c:a','pcm_s24le',str(root/'in-motion.wav')],check=True)
