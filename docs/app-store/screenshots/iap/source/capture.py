"""Capture the eleven current review sheets on the dedicated iPhone Simulator."""
from pathlib import Path
import subprocess as sp,sys,time,json,shutil,os,plistlib
ROOT=Path(__file__).resolve().parents[5]
DEVICE='BB3C29B2-6103-41D5-9324-0EC2850340C6'
WORK=Path(os.environ.get('MODRIFF_CAPTURE_WORK','/private/tmp/modriff-layout-assets'));APP=WORK/'App.app'
WORK.mkdir(exist_ok=True)
def sim(*args):return sp.check_output(['xcrun','simctl',*args],text=True).strip()
if not APP.exists():shutil.copytree(os.environ['MODRIFF_SIM_APP'],APP)
for p in (ROOT/'ios/App/App/public').iterdir():
 dest=APP/'public'/p.name
 if p.is_dir():shutil.copytree(p,dest,dirs_exist_ok=True)
 else:shutil.copy2(p,dest)
with (APP/'public/index.html').open('a') as f:f.write('\n<script>\n'+Path(__file__).with_name('capture.js').read_text()+'\n</script>')
sim('status_bar',DEVICE,'override','--time','9:41','--batteryState','charged','--batteryLevel','100')
info=plistlib.loads((APP/'Info.plist').read_bytes())
for key in ['UISupportedInterfaceOrientations','UISupportedInterfaceOrientations~ipad']:info[key]=['UIInterfaceOrientationPortrait']
info['UIInterfaceOrientation']='UIInterfaceOrientationPortrait';(APP/'Info.plist').write_bytes(plistlib.dumps(info,fmt=plistlib.FMT_BINARY))
sim('install',DEVICE,str(APP));data=Path(sim('get_app_container',DEVICE,'Handel.modRiff','data'));log=data/'Documents/LayoutCapture/iap.jsonl'
if log.exists():log.unlink()
sim('launch','--terminate-running-process',DEVICE,'Handel.modRiff')
seen=set();proof=[];deadline=time.time()+150
while time.time()<deadline:
 rows=[]
 if log.exists():
  for l in log.read_text().splitlines():
   try:rows.append(json.loads(l))
   except json.JSONDecodeError:pass
 for row in rows:
  if row['event']=='error':raise RuntimeError(row)
  if row['event']=='ready' and row['file'] not in seen:
   out=ROOT/'docs/app-store/screenshots/iap'/row['file'];sim('io',DEVICE,'screenshot',str(out));seen.add(row['file']);proof.append(row);print('Captured',row['file'],flush=True)
  if row['event']=='done':
   assert len(seen)==11,len(seen)
   (WORK/'iap-proof.json').write_text(json.dumps(proof,indent=2,ensure_ascii=False));print('All eleven review sheets captured.',flush=True);sys.exit(0)
 time.sleep(.25)
raise TimeoutError('Capture did not finish')
