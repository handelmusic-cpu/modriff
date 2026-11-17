"""Measure delivered encodes; fail on decode errors, missing frames, or audio clipping."""
import json,os,subprocess,hashlib,re
from pathlib import Path
import numpy as np
BASE=Path(__file__).resolve().parent.parent
OUT=Path(os.environ.get('MODRIFF_AUDIENCE_OUT',str(BASE)))
PLAN=json.loads((BASE/'plans.json').read_text());results=[]
for film in PLAN['films']:
 name=film['id'];main=OUT/(name+'.mp4');silent=OUT/'silent'/(name+'-silent.mp4')
 for p in [main,silent]:
  info=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(p)]))
  v=next(s for s in info['streams'] if s['codec_type']=='video')
  assert (v['width'],v['height'],int(v['nb_read_frames']),v['avg_frame_rate'])==(1080,1920,720,'30/1'),p
  assert v['codec_name']=='h264' and v['pix_fmt']=='yuv420p' and abs(float(info['format']['duration'])-24)<.05,p
  dec=subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(p),'-f','null','-'],capture_output=True,text=True)
  assert dec.returncode==0 and not dec.stderr,(p,dec.stderr)
  # Packet hashes must match: the music version retains the clean master's pixels.
  packets=subprocess.check_output(['ffmpeg','-v','error','-i',str(p),'-map','0:v','-c','copy','-f','hash','-hash','sha256','-'],text=True).strip()
  r=dict(file=str(p.relative_to(OUT)),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size,frames=720,width=1080,height=1920,fps=30,duration=float(info['format']['duration']),videoPacketHash=packets,fullDecode=True)
  audio=[s for s in info['streams'] if s['codec_type']=='audio']
  if p==silent:
   assert not audio
   r['audio']='none (replacement master)'
  else:
   assert len(audio)==1 and audio[0]['sample_rate']=='48000' and audio[0]['channels']==2
   a=np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(p),'-vn','-acodec','pcm_f32le','-f','f32le','-']),dtype='<f4')
   assert np.isfinite(a).all() and abs(a).max()<1
   r.update(audio='AAC stereo 48 kHz',samplePeakDbFS=round(float(20*np.log10(abs(a).max())),3),clippedSamples=int(np.sum(abs(a)>=1)))
   measurement=subprocess.run(['ffmpeg','-v','info','-i',str(p),'-af','loudnorm=I=-18:TP=-2:LRA=9:print_format=json','-f','null','-'],capture_output=True,text=True)
   block=re.findall(r'\{\s*"input_i".*?\}',measurement.stderr,re.S)[-1]
   loud=json.loads(block);r['integratedLUFS']=float(loud['input_i']);r['truePeakDbTP']=float(loud['input_tp'])
   assert r['truePeakDbTP']<=-1.0
  results.append(r)
 assert results[-1]['videoPacketHash']==results[-2]['videoPacketHash'],name
 print('VERIFIED',name,flush=True)
(OUT/'verification.json').write_text(json.dumps(dict(files=results,notes=['All 8640 encoded frames decoded successfully.','Music is the original temporary app-engine score, not sound from the UI gestures.','No physical-phone listening or social-platform processing claimed.']),indent=2)+'\n')
