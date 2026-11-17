"""Preserve selected native footage and high-resolution app panels for portable rebuilds."""
import os,json,subprocess,shutil
from pathlib import Path
BASE=Path(__file__).resolve().parent.parent
PLAN=json.loads((BASE/'plans.json').read_text())
WORK=Path(os.environ['MODRIFF_AUDIENCE_WORK'])
LIB=Path(os.environ['MODRIFF_SERIES_WORK'])
DEST=WORK/'editable';CLIPS=DEST/'clips';CLIPS.mkdir(parents=True,exist_ok=True)
for f in ['display.ttf','tech.ttf']:
 (DEST/'fonts').mkdir(exist_ok=True);shutil.copy2(LIB/'fonts'/f,DEST/'fonts'/f)
for name,a in PLAN['assets'].items():
 target=CLIPS/(name+'.mp4')
 if a.get('sequence') and target.exists() and target.stat().st_size>1000:continue
 if a.get('sequence'):
  # Preserve real app pixels, changing notes only at the captured app states.
  from PIL import Image
  frames=[Image.open(WORK/a['sequence']/f'{i:04d}.png').convert('RGB') for i in a['indices']]
  w,h=frames[0].size;scale=min(900/w,960/h);w=int(w*scale)//2*2;h=int(h*scale)//2*2
  frames=[f.resize((w,h),Image.Resampling.LANCZOS).tobytes() for f in frames]
  p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{w}x{h}','-r','30','-i','pipe:0','-an','-c:v','libx264','-crf','15','-preset','fast','-pix_fmt','yuv420p',str(target)],stdin=subprocess.PIPE)
  for i in range(120):p.stdin.write(frames[min(3,i//30)])
  p.stdin.close()
  if p.wait():raise RuntimeError(name)
 else:
  x,y,right,bottom=a['crop'];duration=a.get('sourceDuration',4);stretch=4/duration
  vf=f'trim=duration={duration},setpts=(PTS-STARTPTS)*{stretch},crop={right-x}:{bottom-y}:{x}:{y},scale=900:1040:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30'
  subprocess.run(['ffmpeg','-v','error','-y','-ss',str(a['start']),'-i',str(LIB/(a['source']+'-cfr.mp4')),'-t','4','-vf',vf,'-an','-c:v','libx264','-crf','17','-preset','fast','-pix_fmt','yuv420p',str(target)],check=True)
 print('PREPARED',name,flush=True)
shutil.copy2(WORK/'capture-proof.json',DEST/'capture-proof.json')
for film in PLAN['films']:
 name=film['id'];target=DEST/(name+'-temp-score.wav')
 if target.exists() and target.stat().st_size>1000:continue
 # Original app-engine music is a temporary score, not audio from these gestures.
 # Remove two middle bars, keeping the original resolution and natural ending.
 cut=60/124*4*8;resume=60/124*4*10
 filt=f'[0:a]asplit[a][b];[a]atrim=0:{cut},asetpts=PTS-STARTPTS[aa];[b]atrim=start={resume},asetpts=PTS-STARTPTS[bb];[aa][bb]acrossfade=d=0.012:c1=tri:c2=tri,apad,atrim=duration=24,afade=t=out:st=22.7:d=1.3,loudnorm=I=-18:TP=-2.5:LRA=9[out]'
 subprocess.run(['ffmpeg','-v','error','-y','-i',str(LIB/('audio-'+film['music']+'.wav')),'-filter_complex',filt,'-map','[out]','-ar','48000','-ac','2','-c:a','pcm_s24le',str(target)],check=True)
 print('SCORED',name,flush=True)
