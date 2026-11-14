"""Branded motion edits and full-screen store selections from verified native footage."""
import os,sys,json,math,functools,subprocess,wave
from pathlib import Path
sys.path.insert(0,os.environ.get('PREVIEW_PYTHON_TOOLS','/private/tmp/modriff-preview-tools'))
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter
import imageio_ffmpeg
WORK=Path(os.environ.get('MODRIFF_SERIES_WORK','/private/tmp/modriff-series'));OUT=WORK/'rendered';OUT.mkdir(exist_ok=True)
FF=imageio_ffmpeg.get_ffmpeg_exe();FPS=30;FRAMES=813;DUR=27.1;BEAT=60/124
BRAND=json.loads((WORK/'brand.json').read_text());COL={k:tuple(bytes.fromhex(v[1:]))for k,v in BRAND['parts'].items()};BG=(5,6,12);SUR=(9,11,23);TXT=(238,240,255);MUT=(154,164,204)
PLANS=json.loads((WORK/'plans.json').read_text());MIDI=json.loads((WORK/'midi-proof.json').read_text())
FONTDIR=Path(os.environ.get('MODRIFF_FONT_DIR','/private/tmp/modriff-high-impact'))
@functools.lru_cache(maxsize=120)
def font(n,tech=False):return ImageFont.truetype(str(FONTDIR/('tech.ttf'if tech else'display.ttf')),int(n))
def clamp(t):return max(0,min(1,t))
def ease(t):return 1-(1-clamp(t))**3
def drawtext(im,s,x,y,size=32,col=TXT,anchor='lt',tech=False):ImageDraw.Draw(im).text((x,y),s,font=font(size,tech),fill=col,anchor=anchor)
def fitfont(words,maxsize,width):return min(maxsize,int(maxsize*width/max(font(maxsize).getlength(s)for s in words)))
class Reader:
 def __init__(self,src,start,duration,n,size):
  self.size=size;self.n=n;self.last=None
  stretch=n/FPS/duration
  cmd=[FF,'-v','error','-ss',str(start),'-i',str(WORK/(src+'-cfr.mp4')),'-t',str(duration*stretch),'-vf',f'trim=duration={duration},setpts=(PTS-STARTPTS)*{stretch},fps=30,scale={size[0]}:{size[1]},tpad=stop_mode=clone:stop_duration=2','-frames:v',str(n),'-an','-f','rawvideo','-pix_fmt','rgb24','-']
  self.p=subprocess.Popen(cmd,stdout=subprocess.PIPE)
 def frame(self):
  b=self.p.stdout.read(self.size[0]*self.size[1]*3)
  if len(b)==self.size[0]*self.size[1]*3:self.last=Image.frombytes('RGB',self.size,b)
  if self.last is None:raise RuntimeError('Empty capture')
  return self.last
 def close(self):self.p.stdout.close();self.p.terminate();self.p.wait()

def background(size,t,col):
 W,H=size;im=Image.new('RGB',size,BG);d=ImageDraw.Draw(im)
 # The arrangement's own note bars become an animated, branded surround.
 for i in range(38):
  xx=(i*97+t*37)% (W+250)-125;yy=(i*173)%H
  length=35+110*((i*.618)%1);d.rounded_rectangle((xx,yy,xx+length,yy+3),radius=1,fill=tuple(int(v*.15)for v in col))
 for k in range(3):
  pts=[]
  for x in range(-20,W+21,8):
   y=H*.63+math.sin(x/W*7+t*.5+k*.13)*H*.17+math.sin(x/W*13-t+k)*H*.04
   pts.append((x,y+k*14))
  d.line(pts,fill=tuple(int(v*(.15 if k else .32))for v in col),width=2)
 return im

def brand(im,t,wide,store=False):
 W,H=im.size;d=ImageDraw.Draw(im)
 if store:
  # A narrow lower label keeps actual app controls in the frame.
  yy=H-61 if wide else H-73
  d.rectangle((0,yy,W,H),fill=BG)
  drawtext(im,'mõdRïff',40 if wide else 28,yy+12,25 if wide else 30)
  drawtext(im,'Some features require in-app purchase.',W-36,yy+18,17 if wide else 19,MUT,anchor='rt')
 else:
  drawtext(im,'mõdRïff',42,32,34 if wide else 40)
  drawtext(im,'EVERY PART. ALWAYS IN KEY.',W-42,42,18 if wide else 18,MUT,anchor='rt')
  drawtext(im,'Some features require in-app purchase.',W-42,H-39,17 if wide else 19,MUT,anchor='rt')
  drawtext(im,'CHROMATIC MODAL GROOVEBOX',42,H-39,16 if wide else 17,MUT)
 y=H-80 if wide else H-90;avail=W-84
 for i,c in enumerate(COL.values()):
  x=42+i*avail/8;d.line((x,y,x+avail/8-5,y),fill=c,width=3)
 d.line((42,y-10,42+avail*min(1,t/DUR),y-10),fill=TXT,width=2)

def appcard(im,frame,t,u,col,wide):
 W,H=im.size
 if wide:x,y=390,120;ww,hh=1492,687
 else:x,y=94,359;ww,hh=698,1516
 # An elastic entry settles to a readable native app view.
 entry=ease(u/.48);dx=int((1-entry)*(140 if wide else 90));dy=int((1-entry)*45)
 z=1+.009*math.sin(t*.5);fw=int(ww*z);fh=int(hh*z)
 fr=frame.resize((fw,fh),Image.Resampling.BICUBIC);x+=dx-(fw-ww)//2;y+=dy-(fh-hh)//2
 d=ImageDraw.Draw(im);d.rounded_rectangle((x-3,y-3,x+fw+3,y+fh+3),radius=18,outline=col,width=2)
 im.paste(fr,(x,y));return (x,y,fw,fh)

WAVES={}
for name in ['Chords','Melody','Bass','Drums']:
 p=WORK/'exports'/('In Motion - Live - '+name+'.wav')
 with wave.open(str(p))as f:
  n=f.getnframes();b=f.readframes(n);width=f.getsampwidth();channels=f.getnchannels()
 if width==2:a=np.frombuffer(b,'<i2').reshape(-1,channels)/32768
 elif width==4:a=np.frombuffer(b,'<i4').reshape(-1,channels)/2147483648
 else:
  b=np.frombuffer(b,np.uint8).reshape(-1,3);v=b[:,0].astype(np.int32)|(b[:,1].astype(np.int32)<<8)|(b[:,2].astype(np.int32)<<16);v=(v^8388608)-8388608;a=v.reshape(-1,channels)/8388608
 a=a.max(axis=1);a=a[145000:145000+48*48000];stride=len(a)//600;a=a[:stride*600].reshape(600,stride);WAVES[name]=np.max(abs(a),axis=1)

def graphic(im,kind,t,u,col):
 W,H=im.size;d=ImageDraw.Draw(im)
 if kind=='pdf':
  # The source page is original material; the app result remains alongside it.
  page=Image.open(WORK/'in-motion-chord-sheet.png').convert('RGB');page.thumbnail((270,350));x=44+int(38*ease(u/.4));y=H-560;im.paste(page,(x,y));d.rectangle((x-2,y-2,x+page.width+2,y+page.height+2),outline=COL['sampler'],width=2)
  return
 if kind=='stems':
  for i,(name,a)in enumerate(WAVES.items()):
   yy=500+i*260;c=COL[{'Chords':'chord','Melody':'mel','Bass':'bass','Drums':'drum'}[name]]
   shift=int((1-ease((u-i*.1)/.7))*W);d.rounded_rectangle((64+shift,yy,822+shift,yy+225),radius=16,fill=SUR,outline=c,width=2);drawtext(im,name.upper(),88+shift,yy+24,27,c)
   for k,v in enumerate(a):
    xx=90+shift+k*1.16;hh=float(v)*200
    d.line((xx,yy+132-hh,xx,yy+132+hh),fill=c,width=1)
   q=90+((u*.18)%1)*696;d.line((q+shift,yy+73,q+shift,yy+197),fill=TXT,width=2)
  drawtext(im,'REAL 48 kHz STEREO STEMS',64,1607,22,MUT)
 elif kind=='midi':
  x,y,ww,hh=64,500,758,1020
  d.rounded_rectangle((x,y,x+ww,y+hh),radius=16,fill=SUR,outline=COL['melgen'],width=2)
  for k in range(33):
   yy=y+k*hh/32;d.line((x,yy,x+ww,yy),fill=(25,29,48),width=1)
  for k in range(17):
   xx=x+k*ww/16;d.line((xx,y,xx,y+hh),fill=(40,43,68),width=1)
  cursor=3.019+(u*1.9);window=12.4;left=max(0,cursor-3)
  for note in MIDI['notes']:
   a=(note['start']-left)/window;b=(note['end']-left)/window
   if b<0 or a>1:continue
   nx=x+clamp(a)*ww;ex=x+clamp(b)*ww;ny=y+hh-(note['pitch']-25)/68*hh
   if ny<y or ny>y+hh:continue
   c=COL[{1:'mel',2:'chord',3:'bass',4:'drum'}.get(note['track'],'arp')]
   d.rounded_rectangle((nx,ny,max(nx+3,ex),ny+10),radius=3,fill=c)
  d.line((x+(cursor-left)/window*ww,y,x+(cursor-left)/window*ww,y+hh),fill=TXT,width=3)
  drawtext(im,'803 NOTES',64,1580,56,COL['melgen']);drawtext(im,'4 instrument tracks + tempo',64,1655,28,MUT);drawtext(im,'Complete take: over 51 seconds of MIDI',64,1710,23,MUT)
 elif kind=='files':
  labels=[('FULL MIX','Stereo WAV','chord'),('CHORDS','Separate WAV','chord'),('MELODY','Separate WAV','mel'),('BASS','Separate WAV','bass'),('DRUMS','Separate WAV','drum'),('FULL PERFORMANCE','Multi-track MIDI','melgen')]
  for i,(a,b,cid)in enumerate(labels):
   yy=470+i*197;c=COL[cid];xx=64+int((1-ease((u-i*.09)/.6))*600)
   d.rounded_rectangle((xx,yy,xx+758,yy+165),radius=14,fill=SUR,outline=c,width=2);drawtext(im,a,xx+25,yy+25,32,c);drawtext(im,b,xx+25,yy+88,25,MUT)
  drawtext(im,'ONE PERFORMANCE. ALL THE PARTS.',64,1735,24,TXT)

def scene(plan,s,frame,t,u,still=False):
 wide=plan['wide'];store=plan.get('store',False);size=(1920,886)if wide else(886,1920);W,H=size;col=COL[s['color']]
 if store:
  im=frame.resize(size,Image.Resampling.LANCZOS);d=ImageDraw.Draw(im)
  # Keep the native UI full-screen, with short captions over a translucent banner.
  overlay=Image.new('RGBA',size);od=ImageDraw.Draw(overlay)
  top=0 if wide else 60;bottom=115 if wide else 255;od.rectangle((0,top,W,bottom),fill=(*BG,224));im=im.convert('RGBA');im.alpha_composite(overlay);im=im.convert('RGB')
  fs=fitfont(s['lines'],46 if wide else 49,W-90)
  drawtext(im,s['lines'][0],48,24 if wide else 89,fs,col)
  drawtext(im,s['sub'],48,82 if wide else 173,24 if wide else 27,TXT)
  brand(im,t,wide,True);return im
 if s['name']=='live':
  phases=[(0,['PLAY IT','ALL TOGETHER.'],'Chords + melody + mõdFX. In real time.','chord'),(3.871,['CHORDS','THAT MOVE.'],'The whole band follows your harmony.','chord'),(7.742,['MELODY','IN THE MOMENT.'],'Play a line over the chords.','mel'),(11.613,['mõdFX','UNDER YOUR HAND.'],'Sculpt the live sound on two axes.','arp'),(19.355,['THREE SURFACES.','ONE PERFORMANCE.'],'Chords. Melody. Effects. Together.','chord'),(23.226,['PLAY','YOUR WAY.'],'Every part. Always in key.','melgen')]
  for at,ls,sub,cid in reversed(phases):
   if t>=at:
    s=dict(s,lines=ls,sub=sub,color=cid);col=COL[cid];u=t-at;break
 im=background(size,t,col)
 if s.get('graphic') in ['stems','midi','files']:graphic(im,s['graphic'],t,u,col)
 else:
  appcard(im,frame,t,u,col,wide)
  if s.get('graphic')=='pdf':graphic(im,'pdf',t,u,col)
 d=ImageDraw.Draw(im)
 if wide:
  fs=fitfont(s['lines'],64,322);x,y=42,245;leading=1.03
 else:fs=fitfont(s['lines'],91,795);x,y=44,132;leading=.95
 # Headlines enter on staggered beats and settle; the UI then has room to read.
 for i,line in enumerate(s['lines']):
  v=ease((u-i*.065)/.32);drawtext(im,line,x+int((1-v)*-65),y+i*fs*leading,fs,col)
 if wide:
  words=s['sub'].split();ls=[];cur=''
  for word in words:
   test=(cur+' '+word).strip()
   if font(27).getlength(test)>315 and cur:ls.append(cur);cur=word
   else:cur=test
  ls.append(cur)
  for i,line in enumerate(ls):drawtext(im,line,44,y+len(s['lines'])*fs*leading+35+i*35,27,TXT)
  # Three drum/bass/melody-colored markers stay musical rather than decorative stock glows.
  for i,c in enumerate([COL['drum'],COL['bass'],COL['melgen']]):
   hh=18+int(58*(.5+.5*math.sin(t*2*math.pi/BEAT+i))**2);d.rounded_rectangle((45+i*28,730-hh,60+i*28,730),radius=5,fill=c)
 else:
  # Subline wraps deliberately at the output width.
  words=s['sub'].split();ls=[];cur=''
  for word in words:
   test=(cur+' '+word).strip()
   if font(27).getlength(test)>790 and cur:ls.append(cur);cur=word
   else:cur=test
  ls.append(cur)
  for i,line in enumerate(ls):drawtext(im,line,46,315+i*33,27,TXT)
 # A brief branded edge wipe punctuates each musical cut, without obscuring the controls.
 if u<.16:
  q=1-u/.16;d.rectangle((0,0,int(W*q*.06),H),fill=col)
 brand(im,t,wide)
 return im

def render(key,stills=False):
 plan=PLANS[key];wide=plan['wide'];store=plan.get('store',False);size=(1920,886)if wide else(886,1920)
 if store:card=size
 else:card=(1492,687)if wide else(698,1516)
 audio=WORK/('audio-'+plan['music']+'.wav');dest=OUT/(key+'.mp4')
 cmd=[FF,'-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{size[0]}x{size[1]}','-r','30','-i','pipe:0','-i',str(audio),'-map','0:v','-map','1:a','-t','27.1','-c:v','libx264','-preset','fast','-crf','18','-profile:v','high','-level:v','4.0','-maxrate','12M','-bufsize','24M','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-af','volume=-1dB','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-movflags','+faststart',str(dest)]
 if store:
  ci=cmd.index('-crf');cmd[ci:ci+2]=['-b:v','11M','-minrate','11M','-x264-params','nal-hrd=cbr:filler=1'];cmd[cmd.index('-maxrate')+1]='11M';cmd[cmd.index('-bufsize')+1]='22M'
 encoder=None if stills else subprocess.Popen(cmd,stdin=subprocess.PIPE)
 n=0;elapsed=0
 try:
  for i,s in enumerate(plan['shots']):
   count=round((elapsed+s['duration'])*FPS)-n;src,start=s['source'];srcdur=s.get('sourceDuration',s['duration'] if src=='live' else min(s['duration'],2.8));reader=Reader(src,start,srcdur,count,card)
   try:
    for k in range(count):
     f=reader.frame();t=n/FPS;u=k/FPS
     if not stills or k==min(30,count-1):
      im=scene(plan,s,f,t,u)
      if stills:im.save(OUT/(key+f'-style-{i}.jpg'),quality=90)
      else:encoder.stdin.write(im.tobytes())
     n+=1
   finally:reader.close()
   elapsed+=s['duration'];print(key,i+1,'/',len(plan['shots']),flush=True)
 finally:
  if encoder:encoder.stdin.close()
 if encoder and encoder.wait():raise RuntimeError('Encoding failed')
 if not stills:print('DONE',dest,flush=True)
if __name__=='__main__':
 for key in sys.argv[1:]:
  if key=='--stills':continue
  render(key,'--stills' in sys.argv)
