"""Six audience edits: real app pixels, editorial motion, optional replacement score."""
import os,sys,json,subprocess,functools
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
BASE=Path(__file__).resolve().parent.parent
PLAN=json.loads((BASE/'plans.json').read_text())
WORK=Path(os.environ['MODRIFF_AUDIENCE_WORK'])/'editable'
OUT=Path(os.environ.get('MODRIFF_AUDIENCE_OUT',str(BASE)));OUT.mkdir(parents=True,exist_ok=True)
(OUT/'silent').mkdir(exist_ok=True)
W,H,FPS=1080,1920,30;BAR=60/124*4;PHASE=BAR*2
WHITE=(244,243,234);INK=(12,15,24)
PARTS=['#b46bff','#ff5a5f','#ffd23f','#5fdc6a','#2ad4c8','#3a9bff']
def rgb(s):return tuple(bytes.fromhex(s.lstrip('#')))
def mix(a,b,v):return tuple(round(x+(y-x)*v) for x,y in zip(a,b))
def clamp(x):return max(0,min(1,x))
def ease(x):return 1-(1-clamp(x))**3
@functools.lru_cache(maxsize=250)
def font(size,tech=False):return ImageFont.truetype(str(WORK/'fonts'/('tech.ttf' if tech else 'display.ttf')),round(size))
def text(im,s,x,y,size=36,col=WHITE,anchor='lt',tech=False):
 ImageDraw.Draw(im).text((x,y),s,font=font(size,tech),fill=col,anchor=anchor)
def wrap(s,size,width):
 words=s.split();lines=[];line=''
 for w in words:
  candidate=(line+' '+w).strip()
  if font(size).getlength(candidate)>width and line:lines.append(line);line=w
  else:line=candidate
 if line:lines.append(line)
 return lines
def headline(im,lines,x,y,size,col,u,width=844,leading=1.02):
 size=min(size,min(int(size*width/max(1,font(size).getlength(s))) for s in lines))
 for i,s in enumerate(lines):
  v=ease((u-i*.065)/.48)
  text(im,s,x+round(70*(1-v)),y+i*size*leading,size,mix(BG,col,v))
 return size*leading*len(lines)
def sub(im,s,x,y,col=WHITE,width=840,size=32):
 for i,line in enumerate(wrap(s,size,width)):text(im,line,x,y+i*(size+9),size,col)
class Reader:
 def __init__(self,name):
  p=WORK/'clips'/(name+'.mp4');info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=width,height','-of','json',str(p)]))['streams'][0]
  self.w,self.h=info['width'],info['height'];self.last=None
  self.p=subprocess.Popen(['ffmpeg','-v','error','-i',str(p),'-threads','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 def get(self):
  data=self.p.stdout.read(self.w*self.h*3)
  if len(data)==self.w*self.h*3:self.last=Image.frombytes('RGB',(self.w,self.h),data)
  if self.last is None:raise RuntimeError('Empty video')
  return self.last
 def close(self):self.p.stdout.close();self.p.terminate();self.p.wait()
@functools.lru_cache(maxsize=60)
def still(name):
 p=WORK/'clips'/(name+'.mp4')
 data=subprocess.check_output(['ffmpeg','-v','error','-ss','1.4','-i',str(p),'-frames:v','1','-f','image2pipe','-vcodec','png','-'])
 import io
 return Image.open(io.BytesIO(data)).convert('RGB')
def card(im, frame, box, u, col):
 x,y,w,h=box
 scale=min(w/frame.width,h/frame.height)*(.98+.02*ease(u/.55))
 fw,fh=round(frame.width*scale),round(frame.height*scale)
 pic=frame.resize((fw,fh),Image.Resampling.BICUBIC)
 px=x+(w-fw)//2;py=y+(h-fh)//2+round(24*(1-ease(u/.55)))
 d=ImageDraw.Draw(im)
 d.rounded_rectangle((px-2,py-2,px+fw+2,py+fh+2),radius=20,fill=mix(BG,col,.7))
 mask=Image.new('L',pic.size);ImageDraw.Draw(mask).rounded_rectangle((0,0,fw,fh),radius=18,fill=255)
 im.paste(pic,(px,py),mask)
 return px,py,fw,fh

@functools.lru_cache(maxsize=12)
def backdrop(bg, col, paper):
 # A tinted surface frames the clean Simulator crop without adding UI.
 base=Image.new('RGB',(1,H))
 top=mix(bg,col,.12 if paper else .20)
 bottom=mix(bg,col,.04)
 base.putdata([mix(top,bottom,y/(H-1)) for y in range(H)])
 return base.resize((W,H))

def header(im, film, col):
 d=ImageDraw.Draw(im)
 text(im,'mõdRïff',82,171,42,FG)
 text(im,film['audience'].upper(),920,187,22,mix(BG,FG,.80),anchor='rt')
 d.line((82,239,920,239),fill=mix(BG,FG,.24),width=2)
 d.line((82,239,170,239),fill=col,width=4)
 text(im,'Some features require in-app purchase.',82,1661,25,mix(BG,FG,.86))

BG=INK;FG=WHITE

def scene(film,t,frame=None):
 global BG,FG
 paper=film.get('paper',False)
 BG=WHITE if paper else INK;FG=INK if paper else WHITE
 col=rgb(film['color'])
 im=backdrop(BG,col,paper).copy()
 d=ImageDraw.Draw(im)
 phase=min(5,int((t+1e-7)/PHASE));u=t-phase*PHASE
 if phase==0:
  headline(im,film['hook'],82,295,108,FG,u,width=838)
  sub(im,film['promise'],85,530,FG,width=835,size=37)
  name=film['hookAsset']
  card(im,frame if frame is not None else still(name),(82,625,838,925),u,col)
 elif phase in [1,2,3]:
  shot=film['shots'][phase-1]
  ink=mix(INK,col,.63) if paper else col
  text(im,shot['label'].upper(),82,294,27,ink)
  lines=wrap(shot['title'],86,838)
  lh=headline(im,lines,82,354,86,FG,u,width=838)
  copy_top=round(354+lh+27)
  sub(im,shot['sub'],84,copy_top,FG,width=831,size=35)
  card_top=max(620,copy_top+112)
  card(im,frame if frame is not None else still(shot['asset']),(82,card_top,838,1560-card_top),u,col)
 elif phase==4:
  headline(im,film['benefit'],82,292,89,FG,u,width=838)
  for i,shot in enumerate(film['shots']):
   y=566+i*337
   v=ease((u-i*.12)/.55)
   x=82+round(26*(1-v))
   d.rounded_rectangle((x,y,920,y+310),radius=22,fill=mix(BG,FG,.075),outline=mix(BG,col,.45),width=2)
   card(im,still(shot['asset']),(x+23,y+17,405,276),max(0,u-i*.12),col)
   sub(im,film['tags'][i],x+454,y+108,FG,width=335,size=37)
 else:
  text(im,'mõdRïff',500,476,144,FG,anchor='mt')
  for i,c in enumerate(PARTS):
   x=82+i*142
   v=ease((u-i*.06)/.62)
   d.rounded_rectangle((x,705,x+int(128*v),713),radius=4,fill=rgb(c))
  headline(im,film['cta'],82,814,85,FG,u,width=838)
  d.rounded_rectangle((82,1158,920,1282),radius=22,fill=col)
  text(im,'modriff.com',501,1190,57,INK,anchor='mt')
  sub(im,'Free to start. Optional one-time packs.',82,1350,FG,width=838,size=34)
 header(im,film,col)
 return im

def render(film,stills_only=False):
 name=film['id'];global BG,FG
 if stills_only:
  times=[1.9,5.2,9.2,13.2,17.1,21.6]
  sheet=Image.new('RGB',(324*6,576))
  for i,t in enumerate(times):
   im=scene(film,t)
   sheet.paste(im.resize((324,576),Image.Resampling.LANCZOS),(i*324,0))
   if i==0:im.save(OUT/(name+'-poster.jpg'),quality=94)
  sheet.save(OUT/(name+'-storyboard.jpg'),quality=92);return
 silent=OUT/'silent'/(name+'-silent.mp4')
 cmd=['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r','30','-i','pipe:0','-an','-c:v','libx264','-threads','3','-preset','veryfast','-crf','19','-profile:v','high','-level:v','4.0','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+faststart',str(silent)]
 enc=subprocess.Popen(cmd,stdin=subprocess.PIPE);reader=None;lastphase=None
 try:
  for n in range(720):
   t=n/FPS;phase=min(5,int((t+1e-7)/PHASE))
   if phase!=lastphase:
    if reader:reader.close();reader=None
    if phase == 0:
     reader = Reader(film['hookAsset'])
    elif phase <= 3:
     reader = Reader(film['shots'][phase-1]['asset'])
    lastphase=phase;print(name,'scene',phase,flush=True)
   fr=reader.get() if reader else None
   enc.stdin.write(scene(film,t,fr).tobytes())
 finally:
  if reader:reader.close()
  enc.stdin.close()
 if enc.wait():raise RuntimeError('Encoding failed')
 subprocess.run(['ffmpeg','-v','error','-y','-i',str(silent),'-i',str(WORK/(name+'-temp-score.wav')),'-map','0:v','-map','1:a','-c:v','copy','-af','volume=-1dB','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-t','24','-movflags','+faststart',str(OUT/(name+'.mp4'))],check=True)
 print('DONE',name,flush=True)
if __name__=='__main__':
 keys=[x for x in sys.argv[1:] if not x.startswith('--')]
 for f in PLAN['films']:
  if not keys or f['id'] in keys:render(f,'--stills' in sys.argv)
