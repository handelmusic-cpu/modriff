from pathlib import Path
import subprocess as sp,json,time,plistlib,os,shutil
ROOT=Path(__file__).resolve().parents[5];WORK=Path(os.environ.get('MODRIFF_CAPTURE_WORK','/private/tmp/modriff-layout-assets'));APP=WORK/'App.app'
def sim(*args):return sp.check_output(['xcrun','simctl',*args],text=True).strip()
WORK.mkdir(exist_ok=True)
if not APP.exists():shutil.copytree(os.environ['MODRIFF_SIM_APP'],APP)
shutil.copytree(ROOT/'ios/App/App/public',APP/'public',dirs_exist_ok=True)
info=plistlib.loads((APP/'Info.plist').read_bytes())
for k in ['UISupportedInterfaceOrientations','UISupportedInterfaceOrientations~ipad']:info[k]=['UIInterfaceOrientationPortrait']
info['UIInterfaceOrientation']='UIInterfaceOrientationPortrait';(APP/'Info.plist').write_bytes(plistlib.dumps(info,fmt=plistlib.FMT_BINARY))
(APP/'public/index.html').write_text((ROOT/'ios/App/App/public/index.html').read_text()+'\n<script>\n'+Path(__file__).with_name('stills.js').read_text()+'\n</script>')
proof=[]
for tag,device in [('iphone','BB3C29B2-6103-41D5-9324-0EC2850340C6'),('ipad','1D4D47F6-84EE-414B-854E-E4A58A221289')]:
 sim('status_bar',device,'override','--time','9:41','--batteryState','charged','--batteryLevel','100');sim('install',device,str(APP));data=Path(sim('get_app_container',device,'Handel.modRiff','data'));log=data/'Documents/LayoutCapture/studio-still.jsonl'
 if log.exists():log.unlink()
 sim('launch','--terminate-running-process',device,'Handel.modRiff');deadline=time.time()+60
 while time.time()<deadline:
  rows=[]
  if log.exists():
   for l in log.read_text().splitlines():
    try:rows.append(json.loads(l))
    except json.JSONDecodeError:pass
  if any(r['event']=='error' for r in rows):raise RuntimeError(rows)
  ready=next((r for r in rows if r['event']=='ready'),None)
  if ready:
   sim('io',device,'screenshot',str(ROOT/'docs/app-store/screenshots/v7.1-captioned/raw'/(tag+'-02-studio.png')));proof.append({'device':tag,**ready});print('Captured',tag,ready,flush=True);break
  time.sleep(.25)
 else:raise TimeoutError(tag)
(WORK/'studio-stills-proof.json').write_text(json.dumps(proof,indent=2,ensure_ascii=False)+'\n')
