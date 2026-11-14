from pathlib import Path
import json, subprocess, sys, os
if os.environ.get('PREVIEW_PYTHON_TOOLS'): sys.path.insert(0,os.environ['PREVIEW_PYTHON_TOOLS'])
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

FFMPEG=imageio_ffmpeg.get_ffmpeg_exe()
OUT=Path(os.environ.get('PREVIEW_OUTPUT',Path(__file__).parent)).resolve()
WORK=Path(os.environ.get('PREVIEW_WORK','/private/tmp/modriff-video-edit'))
OUT.mkdir(parents=True,exist_ok=True);WORK.mkdir(exist_ok=True)
FONT='/System/Library/Fonts/Avenir Next.ttc'
def font(size):return ImageFont.truetype(FONT,size,index=0)
def overlay(name,headline,color,chapter):
 im=Image.new('RGBA',(886,1920));d=ImageDraw.Draw(im)
 # Copy sits in the status-bar safe area; no app controls are covered.
 d.rectangle((0,0,885,143),fill=(7,8,15,255))
 d.text((27,17),'mõdRïff',font=font(23),fill=(239,241,255))
 label=chapter.upper();d.text((859,21),label,font=font(17),fill=color,anchor='rt')
 size=48
 while d.textbbox((0,0),headline,font=font(size))[2]>830:size-=1
 d.text((27,59),headline,font=font(size),fill=(247,247,255))
 d.rectangle((27,130,121,133),fill=color)
 d.rectangle((0,1881,885,1919),fill=(7,8,15,248))
 d.text((443,1890),'Some features require in-app purchase.',font=font(20),fill=(199,201,219),anchor='mt')
 p=WORK/(name+'.png');im.save(p);return p

CLIPS=[
 ('01-play-in-key',0,[(0,4.8,'Pick a chord.'),(4.8,9.6,'Give it a beat.'),(9.6,14.4,'Let the bass follow.'),(14.4,19.2,'Add an arpeggio.'),(19.2,24,'Play a melody. Stay in key.')],(163,119,255),'01 / PLAY'),
 ('02-build-a-groove',24.2,[(0,6,'Make the beat yours.'),(6,12,'Write your bass line.'),(12,18,'Add a melody.'),(18,24,'Find your movement.')],(72,222,229),'02 / BUILD'),
 ('03-shape-a-song',48.2,[(0,6,'Turn chords into a song.'),(6,12,'Keep every part together.'),(12,18,'Give every part its space.'),(18,24,'Find your balance.')],(234,227,76),'03 / SHAPE')]

def run(args,**kw):return subprocess.run([FFMPEG,'-hide_banner','-loglevel','error',*map(str,args)],check=True,**kw)

def slate_end(video):
 data=subprocess.check_output([FFMPEG,'-v','error','-i',str(video),'-vf','fps=30,scale=8:8,format=gray','-frames:v','900','-f','rawvideo','pipe:1'])
 white=[i//64 for i in range(0,len(data),64) if min(data[i+y*8+x] for y in range(2,6) for x in range(2,6))>235]
 if not white:raise RuntimeError('No white sync slate in capture')
 return (max(white)+1)/30

if __name__=='__main__':
 video=Path(sys.argv[1]);audio=Path(sys.argv[2]);audio_offset=float(sys.argv[3])
 start=slate_end(video)
 print('Video content begins',start,'Audio begins',audio_offset,flush=True)
 for name,offset,captions,color,chapter in CLIPS:
  args=['-y','-ss',start+offset,'-i',video,'-ss',audio_offset+offset,'-i',audio]
  filters=['[0:v]scale=886:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=886:1920:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[v0]']
  for i,(a,b,txt) in enumerate(captions):
   p=overlay(name+f'-{i}',txt,color,chapter);args+=['-loop','1','-i',p]
   filters.append(f'[v{i}][{i+2}:v]overlay=0:0:enable=\'gte(t,{a})*lt(t,{b})\':shortest=1[v{i+1}]')
  # A small tail fade gives each cut a clean end without changing the performance.
  filters.append(f'[v{len(captions)}]fade=t=out:st=23.6:d=0.4[final]')
  filters.append('[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=2dB,afade=t=in:st=0:d=0.02,afade=t=out:st=23.25:d=0.75[a]')
  dest=OUT/(name+'.mp4')
  args+=['-filter_complex',';'.join(filters),'-map','[final]','-map','[a]','-t','24','-c:v','libx264','-preset','medium','-profile:v','high','-level:v','4.0','-pix_fmt','yuv420p','-b:v','10M','-minrate','10M','-maxrate','10M','-bufsize','20M','-x264-params','nal-hrd=cbr:force-cfr=1','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-movflags','+faststart',dest]
  run(args)
  run(['-y','-ss','5','-i',dest,'-frames:v','1',OUT/(name+'-poster.png')])
  print('Rendered',dest,flush=True)
 (OUT/'edit.json').write_text(json.dumps({'sourceCommit':'6f12359','capture':'Native iPhone 18 Pro Max simulator, optimized Debug build','videoContentStart':start,'audioContentStart':audio_offset,'clips':CLIPS},ensure_ascii=False,indent=2)+'\n')
