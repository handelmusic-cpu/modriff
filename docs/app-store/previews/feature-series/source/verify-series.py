import os,sys,json,re,subprocess,hashlib
from pathlib import Path
sys.path.insert(0,'/private/tmp/modriff-preview-tools')
import imageio_ffmpeg,numpy as np
W=Path(os.environ.get('MODRIFF_SERIES_WORK','/private/tmp/modriff-series'));O=W/'rendered';FF=imageio_ffmpeg.get_ffmpeg_exe();result=[]
for p in sorted(O.glob('*.mp4')):
 r=subprocess.run([FF,'-hide_banner','-i',str(p),'-af','loudnorm=I=-17:TP=-2.3:LRA=9:print_format=json','-f','null','-'],capture_output=True,text=True)
 assert r.returncode==0,(p,r.stderr[-1000:]);s=r.stderr;ld=json.loads(s[s.rfind('{'):s.rfind('}')+1]);wide=any(x in p.name for x in ['landscape','sampler','modsynth']);width,height=(1920,886)if wide else(886,1920)
 assert f'{width}x{height}' in s and '30 fps' in s and '48000 Hz, stereo' in s,(p,s[:1500])
 assert 'Duration: 00:00:27.10' in s and 'frame=  813' in s,p
 assert float(ld['input_tp'])<-1.5 and -21<float(ld['input_i'])<-14,(p,ld)
 a=np.frombuffer(subprocess.check_output([FF,'-v','error','-i',str(p),'-vn','-f','f32le','-acodec','pcm_f32le','-']),'<f4').reshape(-1,2)
 assert np.isfinite(a).all() and abs(a).max()<1,p
 b=subprocess.check_output([FF,'-v','error','-i',str(p),'-vf','fps=3,scale=48:48,format=gray','-an','-f','rawvideo','-pix_fmt','gray','-']);fs=np.frombuffer(b,np.uint8).reshape(-1,48,48);distinct=len({hashlib.sha256(f.tobytes()).digest()for f in fs});assert distinct>55,(p,distinct);assert all(f.max()>80 for f in fs),p
 info=subprocess.run([FF,'-hide_banner','-i',str(p),'-map','0:v','-c:v','copy','-bsf:v','trace_headers','-frames:v','1','-f','null','-'],capture_output=True,text=True);level=int(re.search(r'level_idc\s+[^=]+\s*=\s*(\d+)',info.stderr).group(1));assert level<=40
 item={'file':p.name,'width':width,'height':height,'duration':27.1,'frames':813,'fps':30,'codec':'H264 High, level 4.0','audio':'AAC stereo 48 kHz, 256 kbps target','lufs':float(ld['input_i']),'truePeakDBTP':float(ld['input_tp']),'clippedSamples':int(np.count_nonzero(abs(a)>=1)),'distinctSampledFrames':distinct,'fullDecode':'passed','bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()};result.append(item);print(json.dumps(item),flush=True)
 for ts,label in [(5,'poster'),(13,'detail')]:subprocess.run([FF,'-v','error','-y','-ss',str(ts),'-i',str(p),'-frames:v','1',str(O/(p.stem+'-'+label+'.jpg'))],check=True)
(O/'verification.json').write_text(json.dumps(result,indent=2))
# Single-sample impulse signatures are measured on melodic source stems separately from intended percussion.
clicks={}
for p in (W/'exports').glob('*.wav'):
 if 'Drums' in p.name or p.name=='In Motion - Live.wav':continue
 a=np.frombuffer(subprocess.check_output([FF,'-v','error','-i',str(p),'-f','f32le','-acodec','pcm_f32le','-']),'<f4').reshape(-1,2);peak=abs(a).max();l=a[:-2];c=a[1:-1];r=a[2:];j=abs(c-(l+r)/2);hits=(j>peak*.28)&(abs(l-r)<j*.10)&(abs(c-l)>peak*.28)&(abs(c-r)>peak*.28);cnt=int(hits.sum());assert cnt==0,(p,cnt);clicks[p.name]={'isolatedSingleSampleImpulseSignatures':cnt,'frames':len(a),'finite':bool(np.isfinite(a).all())}
(O/'source-click-analysis.json').write_text(json.dumps(clicks,indent=2));print('Native melodic stems: zero isolated single-sample impulse signatures.',flush=True)
