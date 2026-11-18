"""Additional decoded-sample and motion checks for the rendered preview files."""
from pathlib import Path
import subprocess as sp,json,array,math,hashlib
OUT=Path(__file__).resolve().parents[1]
records=json.loads((OUT/'verification.json').read_text())
for row in records:
 p=OUT/row['file'];assert hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256']
 pcm=array.array('f');pcm.frombytes(sp.check_output(['ffmpeg','-v','error','-i',str(p),'-vn','-f','f32le','-acodec','pcm_f32le','-']))
 finite=all(math.isfinite(v) for v in pcm);clips=sum(abs(v)>=1 for v in pcm);peak=max(abs(v) for v in pcm)
 frames=sp.check_output(['ffmpeg','-v','error','-i',str(p),'-vf','fps=2,scale=48:48,format=gray','-an','-f','rawvideo','-pix_fmt','gray','-']);n=len(frames)//2304
 tiles=[frames[i*2304:(i+1)*2304] for i in range(n)];distinct=len(set(tiles))
 assert finite and clips==0 and distinct>=12 and all(max(t)>80 for t in tiles),(row['file'],finite,clips,distinct)
 row.update({'decodedAudioFinite':finite,'clippedSamples':clips,'decodedSamplePeak':round(peak,6),'distinctSampledFrames':distinct,'sampledFrames':n,'blackFrames':0})
 print(row['file'],':',distinct,'distinct frames,',clips,'clipped samples, finite audio, no black sampled frames',flush=True)
(OUT/'verification.json').write_text(json.dumps(records,indent=2,ensure_ascii=False)+'\n')
