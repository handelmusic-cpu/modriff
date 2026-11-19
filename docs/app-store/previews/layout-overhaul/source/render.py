from pathlib import Path
import subprocess as sp,json,sys,hashlib,os
ROOT=Path(__file__).resolve().parents[5];WORK=Path(os.environ.get('MODRIFF_CAPTURE_WORK','/private/tmp/modriff-layout-assets'));OUT=ROOT/'docs/app-store/previews/layout-overhaul'
OUT.mkdir(exist_ok=True);proof=[]
for no,kind in enumerate(['live','instruments','songs'],1):
 raw=WORK/(kind+'-raw.mov');events=[json.loads(l) for l in (WORK/(kind+'.jsonl')).read_text().splitlines()]
 assert not any(e['event']=='error' for e in events)
 begin=next(e for e in events if e['event']=='begin');assert any(e['event']=='files' for e in events)
 samples=sp.check_output(['ffmpeg','-v','error','-i',str(raw),'-vf','fps=30,crop=iw*0.8:ih*0.8:iw*0.1:ih*0.1,scale=1:1','-an','-f','rawvideo','-pix_fmt','rgb24','-'])
 white=[i for i in range(len(samples)//3) if min(samples[i*3:i*3+3])>246]
 assert len(white)>12,(kind,len(white));start=(max(white)+1)/30
 wav=max((p for p in (WORK/'audio'/kind).rglob('*.wav') if p.name=='In Motion - '+kind+'.wav'),key=lambda p:p.stat().st_mtime_ns)
 wide=kind=='instruments';w,h=(1920,886) if wide else(886,1920);label=WORK/('landscape-label.png' if wide else 'portrait-label.png');bar=61 if wide else 73
 out=OUT/f'store-0{no}-{kind}.mp4'
 graph=f'[0:v]setpts=PTS-STARTPTS,fps=30,scale={w}:{h-bar}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:0:color=0x05060c[app];[app][2:v]overlay=0:H-h,setsar=1[v];[1:a]atrim=duration=27.1,asetpts=PTS-STARTPTS,loudnorm=I=-18:TP=-2.5:LRA=9,aresample=48000,afade=t=in:d=0.03,afade=t=out:st=26.9:d=0.2[a]'
 cmd=['ffmpeg','-v','error','-y','-ss',str(start),'-i',str(raw),'-ss',str(begin['audioOffset']),'-i',str(wav),'-loop','1','-i',str(label),'-filter_complex',graph,'-map','[v]','-map','[a]','-t','27.1','-frames:v','813','-c:v','libx264','-preset','medium','-crf','18','-maxrate','11M','-bufsize','22M','-profile:v','high','-level:v','4.0','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-movflags','+faststart',str(out)]
 print('Rendering',kind,'slate boundary',start,'audio offset',begin['audioOffset'],flush=True);sp.run(cmd,check=True)
 sp.run(['ffmpeg','-v','error','-y','-ss','5','-i',str(out),'-frames:v','1',str(out.with_suffix('.jpg'))],check=True)
 info=json.loads(sp.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(out)]))
 v=next(s for s in info['streams'] if s['codec_type']=='video');a=next(s for s in info['streams'] if s['codec_type']=='audio')
 assert (v['width'],v['height'],int(v['nb_read_frames']))==(w,h,813);assert v['avg_frame_rate']=='30/1' and v['pix_fmt']=='yuv420p' and v['level']<=40
 assert a['sample_rate']=='48000' and a['channels']==2 and abs(float(info['format']['duration'])-27.1)<.05
 measure=sp.run(['ffmpeg','-hide_banner','-i',str(out),'-af','loudnorm=I=-18:TP=-2.5:LRA=9:print_format=json','-f','null','-'],text=True,capture_output=True,check=True).stderr
 ld=json.loads(measure[measure.rfind('{'):measure.rfind('}')+1]);assert -21<float(ld['input_i'])<-15 and float(ld['input_tp'])<-1.5,ld
 proof.append({'file':out.name,'version':begin['version'],'viewport':begin['viewport'],'width':w,'height':h,'duration':27.1,'frames':813,'fps':30,'codec':v['codec_name'],'profile':v['profile'],'level':v['level'],'audioCodec':a['codec_name'],'audioRate':48000,'audioChannels':2,'lufs':float(ld['input_i']),'truePeakDBTP':float(ld['input_tp']),'fullDecode':'passed','videoSlateEndSeconds':start,'audioOffsetSeconds':begin['audioOffset'],'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'sourceVideoSHA256':hashlib.sha256(raw.read_bytes()).hexdigest(),'sourceAudioSHA256':hashlib.sha256(wav.read_bytes()).hexdigest(),'shots':[e for e in events if e['event']=='shot']})
 (OUT/'verification.json').write_text(json.dumps(proof,indent=2,ensure_ascii=False)+'\n');print('Verified',out.name,ld,flush=True)
