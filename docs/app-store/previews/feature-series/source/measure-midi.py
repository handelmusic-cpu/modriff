from pathlib import Path
import struct,json
p=next(Path('/private/tmp/modriff-series/exports').glob('*.mid'));data=p.read_bytes();fmt,n,tpq=struct.unpack('>HHH',data[8:14]);pos=14;tracks=[];notes=[];tempos=[(0,500000)]
def vlq(d,p):
 v=0
 while True:
  b=d[p];p+=1;v=(v<<7)|(b&127)
  if b<128:return v,p
for ti in range(n):
 assert data[pos:pos+4]==b'MTrk';ln=int.from_bytes(data[pos+4:pos+8],'big');d=data[pos+8:pos+8+ln];pos+=8+ln;i=tick=0;status=None;name='';count=0;active={};chans=set()
 while i<len(d):
  delta,i=vlq(d,i);tick+=delta;b=d[i]
  if b>=128:status=b;i+=1
  if status==255:
   typ=d[i];i+=1;ln,i=vlq(d,i);v=d[i:i+ln];i+=ln
   if typ==3:name=v.decode(errors='replace')
   if typ==81:tempos.append((tick,int.from_bytes(v,'big')))
  elif status in [240,247]:ln,i=vlq(d,i);i+=ln
  else:
   typ=status&240;ch=status&15;a=d[i];i+=1;b=0
   if typ not in [192,208]:b=d[i];i+=1
   if typ==144 and b:
    active[(ch,a)]=(tick,b);count+=1;chans.add(ch)
   elif typ==128 or (typ==144 and b==0):
    st=active.pop((ch,a),None)
    if st:notes.append({'track':ti,'channel':ch,'pitch':a,'startTick':st[0],'endTick':tick,'velocity':st[1]})
 tracks.append({'track':ti,'name':name,'notes':count,'endTick':tick,'channels':sorted(chans),'unreleased':len(active)})
tempos=sorted(dict(tempos).items())
def seconds(tick):
 total=0
 for k,(t,tempo) in enumerate(tempos):
  end=min(tick,tempos[k+1][0] if k+1<len(tempos) else tick)
  if end>t:total+=(end-t)*tempo/tpq/1e6
 return total
for no in notes:no['start']=seconds(no.pop('startTick'));no['end']=seconds(no.pop('endTick'))
out={'file':p.name,'type':fmt,'tracks':tracks,'ticksPerQuarter':tpq,'noteCount':len(notes),'lastNoteSeconds':max(x['end'] for x in notes),'notes':notes}
Path('/private/tmp/modriff-series/midi-proof.json').write_text(json.dumps(out,indent=2));print({k:v for k,v in out.items() if k!='notes'})
