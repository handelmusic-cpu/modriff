"""Build Garage's eight licensed percussion hits: SOURCE_ROOT SCRATCH_OUTPUT.

Requires numpy and ffmpeg. The source ZIP's included grant enumerates the
eight zero-padded filenames used here; other recordings are excluded.
"""
import pathlib,zipfile,subprocess,hashlib,csv,io,json,sys
import numpy as np
root=pathlib.Path(sys.argv[1])
out=pathlib.Path(sys.argv[2]);(out/'samples/garage').mkdir(parents=True,exist_ok=True)
report=[]
with zipfile.ZipFile(root/'SS_Burial_Lighter_PERC_CC0.zip') as z:
 for i in range(1,9):
  # The grant enumerates these eight zero-padded names. Other members of
  # this ZIP and the teaser/kicks/claps have no matching recorded grant.
  member='SS_Burial_Lighter_PERC_CC0/Lightr_Prc_Burial_Add_On/Lighter_Perc_Burial_%02d.wav'%i
  data=z.read(member)
  x=np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i','pipe:0','-ac','1','-ar','44100','-f','f32le','-'],input=data),dtype=np.float32).copy()
  pk=abs(x).max();a=max(0,int(np.argmax(abs(x)>pk*.01))-100);x=x[a:]
  nz=np.flatnonzero(abs(x)>pk*.002)
  if len(nz):x=x[:min(len(x),int(nz[-1])+442)]
  x=x[:44100*2];fade=min(441,len(x));x[-fade:]*=np.linspace(1,0,fade);x*=.7/max(abs(x).max(),1e-9)
  dest=out/'samples/garage'/('perc'+str(i)+'.mp3')
  subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar','44100','-ac','1','-i','-','-codec:a','libmp3lame','-q:a','2',str(dest)],input=x.astype(np.float32).tobytes(),check=True)
  report.append(dict(path='samples/garage/'+dest.name,source_member=member,source_sha256=hashlib.sha256(data).hexdigest(),sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),duration=round(len(x)/44100,4)))
 grant=next(n for n in z.namelist() if n.endswith('.txt'))
 (out/'license.txt').write_bytes(z.read(grant))
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print([(r['path'],r['duration']) for r in report])
