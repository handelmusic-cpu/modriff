"""Check raw render continuity and a narrowly defined isolated-click signature."""
import os,sys,json,subprocess
from pathlib import Path
if os.environ.get('PREVIEW_PYTHON_TOOLS'):sys.path.insert(0,os.environ['PREVIEW_PYTHON_TOOLS'])
import numpy as np
import imageio_ffmpeg
work=Path(os.environ.get('MODRIFF_PROMO_WORK','/private/tmp/modriff-high-impact'))
out=Path(__file__).resolve().parent.parent
score=json.loads((work/'score.json').read_text());expected=int(np.ceil(score['duration']*48000))
result={'sampleRate':48000,'expectedFramesPerStem':expected,'stems':{}}
for key,channel in score['channels'].items():
 a=np.fromfile(work/(key+'.f32'),dtype='<f4').reshape(-1,2)
 assert len(a)==expected and np.isfinite(a).all()
 peak=np.max(abs(a));center=a[1:-1];left=a[:-2];right=a[2:]
 jump=abs(center-(left+right)/2)
 # A single-sample spike is far from BOTH neighbours, which agree with
 # each other. This avoids counting an ordinary steep waveform slope.
 hits=(jump>peak*.28)&(abs(left-right)<jump*.10)&(abs(center-left)>peak*.28)&(abs(center-right)>peak*.28)
 clicks=int(np.count_nonzero(hits))if key not in ['kick','hat','clap','snare']else None
 assert clicks in [None,0],(key,clicks)
 result['stems'][key]={'frames':len(a),'finiteSamples':True,'isolatedImpulseSignatures':clicks,'patch':channel['patch'],'notes':len(channel['notes'])}
raw=subprocess.check_output([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-i',str(work/'in-motion.wav'),'-f','f32le','-acodec','pcm_f32le','pipe:1'])
a=np.frombuffer(raw,dtype='<f4').reshape(-1,2)
result['master']={'frames':len(a),'peak':float(np.max(abs(a))),'fullScaleSamples':int(np.count_nonzero(abs(a)>=1)),'dcMean':np.mean(a,axis=0).tolist(),'firstSample':a[0].tolist(),'lastSample':a[-1].tolist()}
assert np.isfinite(a).all()and result['master']['fullScaleSamples']==0
(out/'audio-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print('All nine stems have complete finite renders; no isolated melodic click signatures; no master clipping.')
