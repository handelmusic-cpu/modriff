import sys,os,math,json,subprocess,functools
from pathlib import Path
if os.environ.get('PREVIEW_PYTHON_TOOLS'): sys.path.insert(0,os.environ['PREVIEW_PYTHON_TOOLS'])
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter,ImageChops
from fontTools.ttLib import TTFont
import imageio_ffmpeg

ROOT=Path(__file__).resolve().parents[5];WORK=Path(os.environ.get('MODRIFF_PROMO_WORK','/private/tmp/modriff-high-impact'));WORK.mkdir(exist_ok=True)
OUT=Path(__file__).resolve().parent.parent;OUT.mkdir(parents=True,exist_ok=True)
SOURCE=WORK/'store-capture-final.mov'
FF=imageio_ffmpeg.get_ffmpeg_exe();W,H=1080,1920;FPS=30;BPM=124;BEAT=60/BPM;BAR=4*BEAT;DURATION=14*BAR
INK=(10,10,17);WHITE=(245,244,238);ACID=(226,243,63);CYAN=(65,224,221);PINK=(252,93,155);PURPLE=(161,118,255);GOLD=(246,189,71)
for source,target in [('outfit-latin-700-normal.woff2','display.ttf'),('orbitron-latin-900-normal.woff2','tech.ttf')]:
 p=WORK/target
 if not p.exists():f=TTFont(ROOT/'fonts'/source);f.flavor=None;f.save(p)
@functools.lru_cache(maxsize=150)
def font(size,tech=False):return ImageFont.truetype(str(WORK/('tech.ttf'if tech else'display.ttf')),round(size))
def clamp(x):return max(0,min(1,x))
def ease(x):return 1-(1-clamp(x))**3
def smooth(x):x=clamp(x);return x*x*(3-2*x)
def pulse(t,decay=11):return math.exp(-((t/BEAT)%1)*decay)
def lerp(a,b,t):return a+(b-a)*t
def text(im,words,xy,size,color=WHITE,anchor='lt',stroke=0,alpha=255,tech=False):
 layer=Image.new('RGBA',im.size);d=ImageDraw.Draw(layer)
 d.text(xy,words,font=font(size,tech),fill=(*color,alpha),anchor=anchor,stroke_width=stroke,stroke_fill=(*color,alpha))
 im.alpha_composite(layer)
def lines(im,words,x,y,size,color=WHITE,delay=0,t=1,leading=.92):
 size=min(size,int((W-x-64)/max(font(size).getlength(w) for w in words)*size))
 for i,word in enumerate(words):
  v=ease((t-delay-i*.075)/.42);yy=y+i*size*leading
  # Rise through a hard baseline mask, as a typeset word rather than a fade.
  layer=Image.new('RGBA',(W,H));d=ImageDraw.Draw(layer)
  d.text((x,yy+(1-v)*size*.95),word,font=font(size),fill=(*color,255),anchor='lt')
  mask=Image.new('L',(W,H));ImageDraw.Draw(mask).rectangle((0,yy-8,W,yy+size*1.04),fill=255)
  layer.putalpha(ImageChops.multiply(layer.getchannel('A'),mask));im.alpha_composite(layer)

rng=np.random.default_rng(21)
noise=rng.integers(-2,3,(H,W,1),dtype=np.int16)
BACKGROUNDS={}
for name,color in [('ink',INK),('paper',WHITE),('acid',ACID)]:
 a=np.broadcast_to(np.array(color,dtype=np.int16),(H,W,3))+noise
 BACKGROUNDS[name]=Image.fromarray(np.uint8(np.clip(a,0,255))).convert('RGBA')

score=json.loads((WORK/'score.json').read_text());chords=score['chords']
def header(im,t,dark=False):
 col=INK if dark else WHITE
 text(im,'mõdRïff',(64,44),36,col)
 text(im,'EVERY PART. ALWAYS IN KEY.',(1016,52),19,col,anchor='rt')
 d=ImageDraw.Draw(im);d.line((64,104,1016,104),fill=(*col,50),width=1)
 # An editorial time rail follows the musical phrase, not a fake app meter.
 d.line((64,1857,1016,1857),fill=(*col,35),width=2)
 d.line((64,1857,64+952*clamp(t/DURATION),1857),fill=(*col,210),width=3)
 text(im,'PICK A KEY. MAKE IT YOURS.',(64,1880),19,col)
 text(im,f'{int(t/BEAT)%4+1:02d} / {min(14,int(t/BAR)+1):02d}',(1016,1880),19,col,anchor='rt')

def ribbon(im,t,color=CYAN,cy=1150,scale=1):
 layer=Image.new('RGBA',(540,960));d=ImageDraw.Draw(layer)
 pts=[]
 for i in range(220):
  x=-180+i*4.2;y=cy/2+scale*(95*math.sin(x*.007-t*.8)+32*math.sin(x*.018+t*1.2))
  pts.append((x,y))
 d.line(pts,fill=(*color,95),width=22,joint='curve');layer=layer.filter(ImageFilter.GaussianBlur(12));im.alpha_composite(layer.resize((W,H)))
 d=ImageDraw.Draw(im)
 for off,col,width in [(12,(*color,35),14),(0,(*color,210),3),(-8,(*WHITE,170),1)]:
  d.line([(x*2,y*2+off)for x,y in pts],fill=col,width=width,joint='curve')
 # A bright travelling accent moves along the music ribbon.
 q=pts[int((t*.19%1)*(len(pts)-1))];x,y=q[0]*2,q[1]*2
 d.ellipse((x-7,y-7,x+7,y+7),fill=WHITE)

def note_field(im,t,center=(540,1090),amount=22,radius=460,color=CYAN):
 d=ImageDraw.Draw(im)
 for i in range(amount):
  a=i*2.399+t*.16;r=radius*(.35+.65*((i*.618)%1));x=center[0]+math.cos(a)*r;y=center[1]+math.sin(a)*r*.85
  ww=28+80*((i*.37)%1);hh=10+12*((i*.29)%1);fade=int(60+80*(.5+.5*math.sin(a+t)))
  d.rounded_rectangle((x,y,x+ww,y+hh),radius=5,fill=(*color,fade))

def wave(im,t,y,color=GOLD,amp=120):
 d=ImageDraw.Draw(im);pts=[]
 for x in range(40,1040,3):
  env=math.sin((x-40)/1000*math.pi)**.6
  val=math.sin(x*.026+t*3)+.35*math.sin(x*.059-t*4)
  pts.append((x,y+amp*env*val*(.7+.3*pulse(t))))
 for width,alpha in [(22,13),(10,32),(3,255)]:d.line(pts,fill=(*color,alpha),width=width,joint='curve')

def project_card(im,frame,t,cx=540,cy=1120,width=640,yaw=0,pitch=0,roll=0,opacity=1):
 src=frame.convert('RGBA');sw,sh=src.size
 mask=Image.new('L',src.size);ImageDraw.Draw(mask).rounded_rectangle((1,1,sw-2,sh-2),radius=24,fill=255);src.putalpha(mask)
 hh=width*sh/sw
 pts=np.array([[-width/2,-hh/2,0],[width/2,-hh/2,0],[width/2,hh/2,0],[-width/2,hh/2,0]],float)
 ya,pi,ro=map(math.radians,[yaw,pitch,roll])
 RY=np.array([[math.cos(ya),0,math.sin(ya)],[0,1,0],[-math.sin(ya),0,math.cos(ya)]])
 RX=np.array([[1,0,0],[0,math.cos(pi),-math.sin(pi)],[0,math.sin(pi),math.cos(pi)]])
 RZ=np.array([[math.cos(ro),-math.sin(ro),0],[math.sin(ro),math.cos(ro),0],[0,0,1]])
 pts=pts@(RZ@RX@RY).T;fac=1800/(1800+pts[:,2]);quad=np.column_stack([cx+pts[:,0]*fac,cy+pts[:,1]*fac])
 A=[];b=[]
 for (x,y),(u,v) in zip(quad,[(0,0),(sw,0),(sw,sh),(0,sh)]):
  A.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);b.extend([u,v])
 coeff=np.linalg.solve(A,b)
 warped=src.transform((W,H),Image.Transform.PERSPECTIVE,coeff,Image.Resampling.BICUBIC)
 if opacity<1:warped.putalpha(warped.getchannel('A').point(lambda x:int(x*opacity)))
 alpha=warped.getchannel('A');shadow=Image.new('RGBA',(W,H),(0,0,0,0));shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(24)).point(lambda x:int(x*.62)))
 im.alpha_composite(shadow,(12,26));im.alpha_composite(warped)
 d=ImageDraw.Draw(im);d.line([tuple(q)for q in quad]+[tuple(quad[0])],fill=(*WHITE,int(75*opacity)),width=2)

class Footage:
 def __init__(self):self.p=None;self.key=None
 def get(self,shot,u,still=False):
  offsets={0:14.8333333333,1:18.7043010753,2:22.5752688172,3:30.3172043011,4:34.188172043,5:37.9591397849}
  if still:
   raw=subprocess.check_output([FF,'-v','error','-ss',str(offsets[shot]+u),'-i',str(SOURCE),'-vf','scale=540:1174','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
   return Image.frombytes('RGB',(540,1174),raw)
  if self.key!=shot:
   if self.p:self.p.stdout.close();self.p.terminate();self.p.wait()
   self.p=subprocess.Popen([FF,'-v','error','-ss',str(offsets[shot]),'-i',str(SOURCE),'-vf','fps=30,scale=540:1174','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
   self.key=shot
  raw=self.p.stdout.read(540*1174*3)
  if len(raw)!=540*1174*3:raise RuntimeError('Footage ended')
  return Image.frombytes('RGB',(540,1174),raw)
footage=Footage()

def scene(t,still=False):
 beat=t/BEAT;sc=int(t/(BAR*2));u=t-sc*BAR*2
 im=BACKGROUNDS['ink'].copy();d=ImageDraw.Draw(im)
 if sc==0:
  # A punchy typographic opening becomes the app's color-coded ensemble.
  if u<BAR:
   text(im,'ONE',(64,290),252,WHITE)
   lines(im,['GOOD','IDEA.'],64,509,252,t=u,delay=.02,leading=.87)
   ribbon(im,t,CYAN,1450,1.3)
   text(im,'START WITH A TOUCH.',(70,1640),39,CYAN)
   note_field(im,t,center=(760,1320),radius=330,amount=11,color=PURPLE)
  else:
   v=u-BAR;lines(im,['A WHOLE','BAND.'],64,260,210,t=v)
   names=['CHORDS','DRUMS','BASS','MELODY','mõdSYNTH'];colors=[PURPLE,PINK,GOLD,CYAN,ACID]
   for i,(name,c)in enumerate(zip(names,colors)):
    q=ease((v-i*.085)/.5);x=64+(1-q)*1100;y=800+i*150
    d.rounded_rectangle((x,y,x+952,y+119),radius=21,fill=c)
    text(im,name,(x+31,y+22),67,INK)
    text(im,f'0{i+1}',(x+910,y+35),28,INK,anchor='rt')
 elif sc==1:
  text(im,'CHORDS',(W/2,200),166,(*PURPLE,),anchor='mt')
  lines(im,['ONE TOUCH.','SO MANY POSSIBILITIES.'],64,390,55,t=u,leading=1.15)
  note_field(im,t,center=(540,1210),amount=28,radius=540,color=PURPLE)
  ribbon(im,t,PURPLE,1320,.8)
  v=ease(u/.7);frame=footage.get(0,u,still)
  project_card(im,frame,t,cy=1190+(1-v)*400,width=535+8*math.sin(u*.6),yaw=-12+8*math.sin(u*.55),pitch=4,roll=-3+math.sin(u*.8))
  text(im,'PLAY IN KEY. GO BY FEEL.',(540,1760),32,WHITE,anchor='mt')
 elif sc==2:
  im=BACKGROUNDS['paper'].copy();d=ImageDraw.Draw(im)
  lines(im,['FEEL THE','POCKET.'],55,210,197,color=INK,t=u)
  # A score-driven rhythmic grid becomes a camera move into the real sequencer.
  gridY=770;cell=54
  for row in range(5):
   for col in range(16):
    x=56+col*61;y=gridY+row*61
    on=(row==4 and col%4==0)or(row==2 and col%4==2)or(row==0 and col%8==4)or(row==3 and col%8==4)
    ph=int((t/BEAT*4)%16);color=PINK if on else(215,214,208)
    if col==ph:color=INK
    d.rounded_rectangle((x,y,x+cell,y+cell),radius=8,fill=color)
  text(im,'DRUMS / SWING / YOUR GROOVE',(60,1120),28,INK)
  frame=footage.get(1,u,still);project_card(im,frame,t,cx=720,cy=1590,width=690,yaw=12,pitch=-12,roll=6)
  d=ImageDraw.Draw(im);d.ellipse((45,1285,360,1600),fill=INK)
  text(im,'MAKE',(202,1370),62,WHITE,anchor='mt');text(im,'IT HIT.',(202,1440),59,ACID,anchor='mt')
 elif sc==3:
  lines(im,['LOW END.','HIGH','FEELING.'],60,210,135,color=GOLD,t=u,leading=.93)
  wave(im,t,1040,GOLD,130)
  frame=footage.get(2,u,still);project_card(im,frame,t,cx=540+(1-ease(u/.6))*-400,cy=1200,width=535,yaw=-13,pitch=9,roll=-5)
  text(im,'A BASS LINE THAT MOVES WITH YOU.',(64,1730),26,WHITE)
 elif sc==4:
  # The drop: the layers orbit, then lock into a single instrument.
  ribbon(im,t,CYAN,1100,1.7)
  lines(im,['EVERY PART.','ONE GROOVE.'],60,215,130,t=u,leading=1.02)
  frame=footage.get(3,u,still);project_card(im,frame,t,cx=540,cy=1190,width=550,yaw=9*math.sin(u*.8),pitch=-5,roll=2*math.sin(u))
  for i,(label,c)in enumerate([('CHORDS',PURPLE),('DRUMS',PINK),('BASS',GOLD),('MELODY',CYAN)]):
   a=t*.35+i*math.pi/2;x=540+math.cos(a)*390;y=1220+math.sin(a)*450
   d=ImageDraw.Draw(im);d.rounded_rectangle((x-100,y-35,x+100,y+35),radius=34,fill=c)
   text(im,label,(x,y-17),29,INK,anchor='mt')
 elif sc==5:
  im=BACKGROUNDS['acid'].copy();lines(im,['SAVE THE','SPARK.'],60,205,165,INK,t=u)
  text(im,'TURN A MOMENT INTO A SONG.',(65,570),30,INK)
  frame=footage.get(4,u,still);project_card(im,frame,t,cx=540,cy=1225,width=510,yaw=-7+u*2,pitch=5,roll=3)
  # Four harmonic cards carry the original score into the actual song view.
  for i,label in enumerate(['Dm9','G13','Cmaj9','Am9']):
   x=58+i*247;y=665+math.sin(u*1.7+i*.5)*18
   d=ImageDraw.Draw(im);d.rounded_rectangle((x,y,x+224,y+111),radius=16,fill=INK)
   text(im,label,(x+112,y+29),45,WHITE,anchor='mt')
 else:
  # Let the final chord breathe on the wordmark instead of fading to a CTA.
  v=u;note_field(im,t,center=(540,1100),amount=32,radius=650,color=PURPLE)
  ribbon(im,t,CYAN,1190,1.8)
  text(im,'mõdRïff',(540,520),178,WHITE,anchor='mt')
  lines(im,['EVERY PART.','ALWAYS','IN KEY.'],63,825,165,WHITE,t=v,leading=.98)
  d=ImageDraw.Draw(im);q=ease(v/.65);d.rectangle((65,1490,65+q*950,1500),fill=ACID)
  text(im,'YOUR POCKET. YOUR BAND.',(68,1570),37,CYAN)
 header(im,t,dark=sc in [2,5])
 # One-time packs are disclosed on the polished promo too.
 text(im,'Some features require in-app purchase.',(540,1815),20,INK if sc in[2,5]else WHITE,anchor='mt')
 return im.convert('RGB')

def render():
 frames=math.ceil(DURATION*FPS);dest=OUT/'modriff-in-motion-promo.mp4'
 cmd=[FF,'-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-i',str(WORK/'in-motion.wav'),'-map','0:v','-map','1:a','-t',str(DURATION),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-profile:v','high','-af','volume=-0.8dB','-c:a','aac','-b:a','256k','-ar','48000','-movflags','+faststart',str(dest)]
 p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
 try:
  for n in range(frames):
   im=scene(n/FPS);p.stdin.write(im.tobytes())
   if n%90==0:print('Rendered frame',n,'/',frames,flush=True)
 finally:p.stdin.close()
 if p.wait()!=0:raise RuntimeError('Video encoder failed')
 if footage.p:footage.p.terminate()
 print(dest,flush=True)

if __name__=='__main__':
 if '--stills'in sys.argv:
  for i,t in enumerate([.85,2.8,5.1,9.0,12.6,17.1,21.0,25.5]):
   im=scene(t,True);im.save(WORK/f'style-{i}.png')
  sheet=Image.new('RGB',(1080,960),INK)
  for i in range(8):
   im=Image.open(WORK/f'style-{i}.png');im.thumbnail((270,480));sheet.paste(im,((i%4)*270,(i//4)*480))
  sheet.save(WORK/'styleframes.png')
 else:render()
