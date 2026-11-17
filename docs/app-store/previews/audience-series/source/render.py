"""Six audience edits: real app pixels, editorial motion, optional replacement score."""
import os,sys,json,math,subprocess,functools
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageOps
BASE=Path(__file__).resolve().parent.parent
PLAN=json.loads((BASE/'plans.json').read_text())
WORK=Path(os.environ['MODRIFF_AUDIENCE_WORK'])/'editable'
OUT=Path(os.environ.get('MODRIFF_AUDIENCE_OUT',str(BASE)));OUT.mkdir(parents=True,exist_ok=True)
(OUT/'silent').mkdir(exist_ok=True)
W,H,FPS=1080,1920,30;BAR=60/124*4;PHASE=BAR*2
WHITE=(244,243,234);INK=(12,15,24);MUT=(164,173,191)
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
def card(im,frame,box,u,col,label,zoom=1):
 x,y,w,h=box;scale=min(w/frame.width,h/frame.height)*zoom
 fw,fh=round(frame.width*scale),round(frame.height*scale)
 pic=frame.resize((fw,fh),Image.Resampling.BICUBIC)
 px=x+(w-fw)//2;py=y+(h-fh)//2+round(55*(1-ease(u/.55)))
 d=ImageDraw.Draw(im);d.rounded_rectangle((px-3,py-3,px+fw+3,py+fh+3),radius=20,fill=mix(BG,col,.55))
 mask=Image.new('L',pic.size);ImageDraw.Draw(mask).rounded_rectangle((0,0,fw,fh),radius=18,fill=255)
 im.paste(pic,(px,py),mask)
 text(im,label.upper(),px,py-44,22,FG)
 return px,py,fw,fh

def motif(im,film,t,y=930,strength=1):
 d=ImageDraw.Draw(im);col=rgb(film['color']);soft=mix(BG,col,.18*strength);bright=mix(BG,col,.85*strength);typ=film['motif']
 if typ=='changes':
  for i,(roman,chord) in enumerate([('ii','Dm7'),('V','G7'),('I','Cmaj7')]):
   x=100+i*292;active=int(t/.96)%3==i
   d.line((x,y+205,x+240,y+205),fill=bright if active else soft,width=4)
   text(im,roman,x+120,y,126,bright if active else soft,anchor='mt')
   text(im,chord,x+120,y+145,35,FG if active else soft,anchor='mt')
 elif typ=='steps':
  cell=49;gap=7
  for r in range(4):
   for c in range(16):
    x=84+c*(cell+gap);yy=y+r*67;on=(c+r*3)%([4,7,3,5][r])==0;active=c==int(t/(60/124)/.25)%16
    d.rounded_rectangle((x,yy,x+cell,yy+43),radius=6,fill=bright if on and active else mix(BG,col,.5*strength) if on else soft)
 elif typ=='keys':
  for i in range(14):
   x=86+i*64;on=i%7 in [[0,2,4],[3,5,0],[5,0,2],[4,6,1]][int(t)%4]
   d.rounded_rectangle((x,y,x+58,y+240),radius=7,fill=bright if on else mix(BG,FG,.25*strength))
   if i%7 in [0,1,3,4,5]:d.rounded_rectangle((x+42,y,x+75,y+143),radius=4,fill=BG)
 elif typ=='strings':
  for i in range(6):
   yy=y+i*38;d.line((85,yy,950,yy),fill=mix(BG,col,(.15+i*.035)*strength),width=2+i//3)
  for i in range(8):
   x=116+i*112;d.line((x,y-30,x,y+230),fill=soft,width=2)
  for i in range(4):
   xx=116+((i*2+int(t))%8)*112-55;yy=y+((i+2)%6)*38;d.ellipse((xx-13,yy-13,xx+13,yy+13),fill=bright)
 elif typ=='holes':
  for i in range(6):
   x=290+(i//3)*470;yy=y+(i%3)*85;r=22+4*math.sin(t*2+i)
   d.ellipse((x-r,yy-r,x+r,yy+r),outline=soft,width=3)
   if (i+int(t*2))%3:d.ellipse((x-15,yy-15,x+15,yy+15),fill=bright)
 else:
  for i in range(5):
   yy=y+i*65;d.line((84,yy+51,945,yy+51),fill=soft,width=1)
   for k in range(5):
    xx=86+((k*193-t*60+i*31)%830);d.rounded_rectangle((xx,yy+5,xx+55+(k%3)*34,yy+35),radius=4,fill=mix(BG,rgb(PARTS[i]),.5*strength))

def chrome(im,film,t):
 d=ImageDraw.Draw(im);col=rgb(film['color'])
 text(im,'mõdRïff',84,166,37,FG)
 text(im,f"{film['id'][:2]} / 06",934,174,23,FG,anchor='rt',tech=True)
 d.line((84,231,934,231),fill=mix(BG,FG,.22),width=2)
 text(im,film['audience'].upper(),84,269,23,col if not film.get('paper') else mix(INK,col,.5))
 # Leave the bottom 240 pixels and the right rail clear for social player controls.
 d.line((84,1662,934,1662),fill=mix(BG,FG,.18),width=1)
 d.line((84,1662,84+850*clamp(t/24),1662),fill=col,width=3)
 text(im,'Some features require in-app purchase.',84,1692,23,mix(BG,FG,.75))

BG=INK;FG=WHITE

def scene(film,t,frame=None):
 global BG,FG
 BG=WHITE if film.get('paper') else INK;FG=INK if film.get('paper') else WHITE
 col=rgb(film['color']);im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im)
 # Thin off-axis rules make a continuous camera field without obscuring real UI.
 for i in range(10):
  x=(i*142+t*12)%1500-200;d.line((x,520,x-360,1600),fill=mix(BG,col,.045),width=1)
 phase=min(5,int((t+1e-7)/PHASE));u=t-phase*PHASE
 if phase==0:
  headline(im,film['hook'],84,345,113,FG,u)
  sub(im,film['promise'],87,660,FG,size=34)
  motif(im,film,t,y=810)
  if t>1.1:
   a=film['shots'][0]['asset'];card(im,frame if frame is not None else still(a),(84,1140,850,430),t-1.1,col,'Inside mõdRïff',zoom=.97+.02*ease((t-1.1)/2))
 elif phase in [1,2,3]:
  shot=film['shots'][phase-1];ls=wrap(shot['title'],84,845)
  headline(im,ls,84,342,84,FG,u)
  sub(im,shot['sub'],87,342+len(ls)*88+38,FG,size=33)
  asset=PLAN['assets'][shot['asset']]
  
  if asset['layout']!='tall':motif(im,film,t,y=1295,strength=.4)
  if asset['layout']=='tall':box=(94,690,840,800)
  elif asset['layout']=='wide':box=(84,730,850,560)
  else:box=(84,750,850,620)
  card(im,frame if frame is not None else still(shot['asset']),box,u,col,shot['label'],zoom=.985+.015*ease(u/PHASE))
  text(im,f'0{phase}',84,1500,64,col,tech=True)
  text(im,film['tags'][phase-1].upper(),200,1524,29,FG)
 elif phase==4:
  headline(im,film['benefit'],84,345,91,FG,u)
  for i,tag in enumerate(film['tags']):
   v=ease((u-i*.16)/.55);xx=84+int((1-v)*200);yy=755+i*190
   d.rounded_rectangle((xx,yy,934,yy+143),radius=18,fill=mix(BG,col,.1),outline=mix(BG,col,.6),width=2)
   text(im,f'0{i+1}',xx+27,yy+52,26,col,tech=True)
   text(im,tag,xx+112,yy+43,44,FG)
  for i,s in enumerate(film['shots']):
   thumb=ImageOps.fit(still(s['asset']),(260,177),method=Image.Resampling.LANCZOS)
   im.paste(thumb,(84+i*294,1385))
 else:
  # Resolve the app's separate colors into a single wordmark and a clear URL.
  text(im,'mõdRïff',510,526,119,FG,anchor='mt')
  for i,c in enumerate(PARTS):
   x=84+i*143;yy=725;v=ease((u-i*.05)/.65)
   d.rounded_rectangle((x,yy,x+int(129*v),yy+8),radius=3,fill=rgb(c))
  headline(im,film['cta'],84,852,81,FG,u)
  d.rounded_rectangle((84,1190,934,1317),radius=22,fill=col)
  text(im,'modriff.com',509,1223,56,INK,anchor='mt')
  sub(im,'Free to start. Optional one-time packs.',84,1385,FG,size=31)
  text(im,'MAKE IT YOURS.',84,1523,27,mix(BG,FG,.7))
 chrome(im,film,t)
 return im

def render(film,stills_only=False):
 name=film['id'];global BG,FG
 if stills_only:
  times=[1.9,5.2,9.2,13.2,17.1,21.6]
  sheet=Image.new('RGB',(324*6,576))
  for i,t in enumerate(times):
   im=scene(film,t);im.resize((324,576),Image.Resampling.LANCZOS).save(OUT/(name+f'-frame-{i+1}.jpg'),quality=90)
   sheet.paste(im.resize((324,576),Image.Resampling.LANCZOS),(i*324,0))
   if i==1:im.save(OUT/(name+'-poster.jpg'),quality=94)
  sheet.save(OUT/(name+'-storyboard.jpg'),quality=92);return
 silent=OUT/'silent'/(name+'-silent.mp4')
 cmd=['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r','30','-i','pipe:0','-an','-c:v','libx264','-threads','3','-preset','veryfast','-crf','19','-profile:v','high','-level:v','4.0','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+faststart',str(silent)]
 enc=subprocess.Popen(cmd,stdin=subprocess.PIPE);reader=None;lastphase=None
 try:
  for n in range(720):
   t=n/FPS;phase=min(5,int((t+1e-7)/PHASE))
   if phase!=lastphase:
    if reader:reader.close();reader=None
    if phase<=3:reader=Reader(film['shots'][max(0,phase-1)]['asset'])
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
