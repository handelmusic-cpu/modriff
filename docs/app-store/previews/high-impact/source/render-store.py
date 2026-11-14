import os
import sys,math,json,subprocess,importlib.util
from pathlib import Path
if os.environ.get('PREVIEW_PYTHON_TOOLS'): sys.path.insert(0,os.environ['PREVIEW_PYTHON_TOOLS'])
import numpy as np
from PIL import Image,ImageDraw
spec=importlib.util.spec_from_file_location('motion',Path(__file__).with_name('render-motion.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
W,H=886,1920;FPS=30;DURATION=m.DURATION;FF=m.FF;WORK=m.WORK;OUT=m.OUT
source=WORK/'store-capture-final.mov'
def content_start():
 raw=subprocess.check_output([FF,'-v','error','-i',str(source),'-vf','fps=30,scale=8:8,format=gray','-frames:v','900','-f','rawvideo','pipe:1'])
 white=[i//64 for i in range(0,len(raw),64)if min(raw[i+y*8+x]for y in range(2,6)for x in range(2,6))>235]
 if not white:raise RuntimeError('Missing sync slate')
 return(max(white)+1)/30

def frame(im,t):
 im=im.convert('RGBA');q=min(6,int(t/(2*m.BAR)));u=t-q*2*m.BAR;v=m.ease(u/.55)
 titles=['PLAY.','FEEL IT.','GO LOW.','FIND A HOOK.','SHAPE IT.','MAKE A SONG.','MAKE IT YOURS.']
 colors=[m.PURPLE,m.PINK,m.GOLD,m.CYAN,m.ACID,m.PURPLE,m.CYAN]
 d=ImageDraw.Draw(im)
 d.rectangle((0,0,W,144),fill=(*m.INK,255))
 m.text(im,'mõdRïff',(28,16),25,m.WHITE)
 m.text(im,'IN MOTION',(858,21),17,colors[q],anchor='rt')
 size=round(m.lerp(107,61,v));word=titles[q];size=min(size,int(830/m.font(size).getlength(word)*size))
 x=28+(1-v)*(-W*.8);y=m.lerp(210,61,v)
 # Oversize type launches on the musical change, then clears the interface.
 m.text(im,word,(x,y),size,m.WHITE)
 d=ImageDraw.Draw(im);width=100+160*m.pulse(t)
 d.rectangle((28,131,28+width,134),fill=colors[q])
 # A narrow moving accent identifies the active layer without replacing UI.
 d.line((3,150,3,150+1690*m.clamp((u+.15)/(2*m.BAR))),fill=(*colors[q],180),width=4)
 d.rectangle((0,1880,W,H),fill=(*m.INK,255))
 m.text(im,'Some features require in-app purchase.',(443,1892),20,m.WHITE,anchor='mt')
 return im.convert('RGB')

if __name__=='__main__':
 start=content_start();print('Content start',start,flush=True)
 reader=subprocess.Popen([FF,'-v','error','-ss',str(start),'-i',str(source),'-vf','fps=30,scale=884:1920,pad=886:1920:1:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 path=OUT/'modriff-in-motion-app-store.mp4'
 encoder=subprocess.Popen([FF,'-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','886x1920','-r','30','-i','pipe:0','-i',str(WORK/'in-motion.wav'),'-map','0:v','-map','1:a','-af','volume=-0.8dB','-t',str(DURATION),'-c:v','libx264','-preset','medium','-profile:v','high','-level:v','4.0','-pix_fmt','yuv420p','-b:v','10M','-minrate','10M','-maxrate','10M','-bufsize','20M','-x264-params','nal-hrd=cbr:force-cfr=1','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-movflags','+faststart',str(path)],stdin=subprocess.PIPE)
 for n in range(math.ceil(DURATION*FPS)):
  raw=reader.stdout.read(W*H*3)
  if len(raw)!=W*H*3:raise RuntimeError('Capture ended early')
  im=frame(Image.frombytes('RGB',(W,H),raw),n/FPS);encoder.stdin.write(im.tobytes())
  if n%120==0:print('Store frame',n,flush=True)
 encoder.stdin.close();assert encoder.wait()==0
 reader.stdout.close();reader.terminate();reader.wait()
 (WORK/'store-alignment.json').write_text(json.dumps({'contentStartSeconds':start,'bpm':124,'duration':DURATION},indent=2)+'\n')
 print(path,flush=True)
