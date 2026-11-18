"""Capture fresh native portrait/landscape previews on the dedicated iPhone Simulator."""
from pathlib import Path
import subprocess as sp,sys,time,json,shutil,plistlib,signal,os
ROOT=Path(__file__).resolve().parents[5]
DEVICE='BB3C29B2-6103-41D5-9324-0EC2850340C6';WORK=Path(os.environ.get('MODRIFF_CAPTURE_WORK','/private/tmp/modriff-layout-assets'));APP=WORK/'App.app'
def sim(*args):return sp.check_output(['xcrun','simctl',*args],text=True).strip()
WORK.mkdir(exist_ok=True)
if not APP.exists():shutil.copytree(os.environ['MODRIFF_SIM_APP'],APP)
shutil.copytree(ROOT/'ios/App/App/public',APP/'public',dirs_exist_ok=True)
for kind in sys.argv[1:] or ['live','instruments','songs']:
 orientation='LandscapeRight' if kind=='instruments' else 'Portrait'
 info=plistlib.loads((APP/'Info.plist').read_bytes())
 for k in ['UISupportedInterfaceOrientations','UISupportedInterfaceOrientations~ipad']:info[k]=['UIInterfaceOrientation'+orientation]
 info['UIInterfaceOrientation']='UIInterfaceOrientation'+orientation;(APP/'Info.plist').write_bytes(plistlib.dumps(info,fmt=plistlib.FMT_BINARY))
 (APP/'public/index.html').write_text((ROOT/'ios/App/App/public/index.html').read_text()+'\n<script>window.LAYOUT_PREVIEW='+json.dumps(kind)+';\n'+Path(__file__).with_name('capture.js').read_text()+'\n</script>')
 sp.run(['xcrun','simctl','terminate',DEVICE,'Handel.modRiff'],stdout=sp.DEVNULL,stderr=sp.DEVNULL)
 sim('install',DEVICE,str(APP));data=Path(sim('get_app_container',DEVICE,'Handel.modRiff','data'));log=data/'Documents/LayoutCapture'/(kind+'.jsonl')
 if log.exists():log.unlink()
 sim('launch','--terminate-running-process',DEVICE,'Handel.modRiff');video=WORK/(kind+'-raw.mov')
 rec=sp.Popen(['xcrun','simctl','io',DEVICE,'recordVideo','--codec=h264','--force',str(video)],stdout=sp.DEVNULL,stderr=(WORK/(kind+'-video.log')).open('w'))
 try:
  deadline=time.time()+140;seen=set()
  while time.time()<deadline:
   rows=[]
   if log.exists():
    for l in log.read_text().splitlines():
     try:rows.append(json.loads(l))
     except json.JSONDecodeError:pass
   for row in rows:
    if row['event']=='error':raise RuntimeError(row)
    key=(row['event'],row.get('name'))
    if key not in seen:print(kind,row,flush=True);seen.add(key)
   if any(r['event']=='done' for r in rows):break
   time.sleep(.25)
  else:raise TimeoutError(kind)
 finally:rec.send_signal(signal.SIGINT);rec.wait(timeout=20)
 shutil.copy2(log,WORK/(kind+'.jsonl'))
 for name in ['Bounces','LayoutCapture/'+kind]:
  src=data/'Documents'/name
  if src.exists():shutil.copytree(src,WORK/'audio'/kind,dirs_exist_ok=True)
 print('CAPTURE COMPLETE',kind,video,flush=True)
