"""Decode the delivered films and measure the audio that viewers actually hear."""
import os,sys,json,subprocess,hashlib,re
from pathlib import Path
if os.environ.get('PREVIEW_PYTHON_TOOLS'):sys.path.insert(0,os.environ['PREVIEW_PYTHON_TOOLS'])
import numpy as np
import imageio_ffmpeg
root=Path(__file__).resolve().parent.parent
ff=imageio_ffmpeg.get_ffmpeg_exe()
results=[]
for p in sorted(root.glob('*.mp4')):
 run=subprocess.run([ff,'-hide_banner','-i',str(p),'-af','loudnorm=I=-16:TP=-2:LRA=9:print_format=json','-f','null','-'],capture_output=True,text=True)
 assert run.returncode==0,run.stderr
 log=run.stderr;loud=json.loads(log[log.rfind('{'):log.rfind('}')+1])
 width=886 if 'app-store' in p.name else 1080
 assert f'{width}x1920' in log and '30 fps' in log and '48000 Hz, stereo' in log
 assert 'Duration: 00:00:27.10' in log and 'frame=  813' in log
 assert float(loud['input_tp'])<-1.5 and -21<float(loud['input_i'])<-14
 audio=subprocess.check_output([ff,'-v','error','-i',str(p),'-vn','-f','f32le','-acodec','pcm_f32le','pipe:1'])
 a=np.frombuffer(audio,dtype='<f4').reshape(-1,2)
 assert np.isfinite(a).all() and not np.any(abs(a)>=1)
 # A small sample of the finished encode catches blank/still exports and
 # tests the actual output, rather than the motion renderer's intentions.
 raw=subprocess.check_output([ff,'-v','error','-i',str(p),'-vf','fps=3,scale=44:80,format=gray','-an','-f','rawvideo','pipe:1'])
 frames=[raw[i:i+3520]for i in range(0,len(raw),3520)]
 unique=len({hashlib.sha256(f).digest()for f in frames});assert unique>70
 assert all(max(f)>80 for f in frames)
 info=subprocess.run([ff,'-hide_banner','-i',str(p),'-map','0:v','-c:v','copy','-bsf:v','trace_headers','-frames:v','1','-f','null','-'],capture_output=True,text=True)
 level=int(re.search(r'level_idc\s+[^=]+\s*=\s*(\d+)',info.stderr).group(1));assert level<=40
 item={'file':p.name,'durationSeconds':27.1,'frames':813,'fps':30,'width':width,'height':1920,'video':'H.264 High','h264Level':level/10,'audio':'AAC stereo, 48 kHz, 256 kbps target','integratedLoudnessLUFS':float(loud['input_i']),'truePeakDBTP':float(loud['input_tp']),'fullScaleSamples':int(np.count_nonzero(abs(a)>=1)),'finiteSamples':True,'distinctSampledFrames':unique,'sampledFrames':len(frames),'fullDecode':'passed','bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
 results.append(item);print(json.dumps(item),flush=True)
(root/'verification.json').write_text(json.dumps(results,indent=2)+'\n')
