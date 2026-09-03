#!/bin/bash
# Extract each top-level <script> whose first statement is 'use strict' and syntax-check it.
python3 - <<'PY'
import io,re,subprocess,os,sys
s=io.open('index.html',encoding='utf-8').read()
ok=True
n=0
for m in re.finditer(r"<script[^>]*>", s):
    start=m.end()
    end=s.find('</script>', start)
    if end<0: continue
    body=s[start:end]
    if "'use strict'" not in body[:200]: continue
    n+=1
    f='/tmp/claude-0/-home-user-modriff/fe7bb559-df58-5729-bb2b-55c6985f1777/scratchpad/chunk%d.js'%n
    io.open(f,'w',encoding='utf-8').write(body)
    r=subprocess.run(['node','--check',f],capture_output=True,text=True)
    if r.returncode!=0:
        ok=False
        print('FAIL chunk %d (html offset %d)'%(n,start))
        print(r.stderr[:3000])
print(('OK' if ok else 'ERRORS')+' — %d script blocks checked'%n)
sys.exit(0 if ok else 1)
PY
