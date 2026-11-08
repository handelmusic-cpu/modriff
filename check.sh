#!/bin/bash
# Extract each top-level <script> whose first statement is 'use strict' and syntax-check it.
python3 - <<'PY'
import io,re,subprocess,os,sys,tempfile
tmp=tempfile.mkdtemp(prefix='modriff-check-')
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
    f=os.path.join(tmp,'chunk%d.js'%n)
    io.open(f,'w',encoding='utf-8').write(body)
    r=subprocess.run(['node','--check',f],capture_output=True,text=True)
    if r.returncode!=0:
        ok=False
        print('FAIL chunk %d (html offset %d)'%(n,start))
        print(r.stderr[:3000])

# ── Element nesting ──────────────────────────────────────────────────────
# A stray or missing </div> does not stop the page loading and does not reach
# the console: the browser silently closes the enclosing element early and
# everything after it is reparented. That is how one extra </div> in the Touch
# Mod bar moved #pf-fx-panel out of the perform page and onto <body>, where it
# rendered on top of the chord grid and the melody strip. The JS check above
# cannot see it, so the markup is walked here.
#
# Only the elements that carry layout are tracked, and only outside <script>
# and comments — this file's scripts are full of strings containing '</div>'.
body_html = s
# <style> is masked as well as <script>: CSS comments in this file mention
# things like <length> and selectors like a<b, and every one of those matches
# a tag regex.
# A flat mask rather than a list of ranges: the ranges overlap (a comment
# inside a script block), and overlapping ranges cannot be binary-searched.
mask = bytearray(len(body_html))
for pat in (r"<script[^>]*>.*?</script>", r"<style[^>]*>.*?</style>", r"<!--.*?-->"):
    for m in re.finditer(pat, body_html, re.S):
        mask[m.start():m.end()] = b'\x01' * (m.end() - m.start())
def masked(i):
    return mask[i] == 1

VOID = {'area','base','br','col','embed','hr','img','input','link','meta',
        'param','source','track','wbr'}
stack = []
depth_ok = True
for m in re.finditer(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(/?)>", body_html):
    if masked(m.start()):
        continue
    closing, tag, attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
    if tag in VOID or selfclose:
        continue
    if tag in ('script','style'):
        continue
    line = body_html.count('\n', 0, m.start()) + 1
    if not closing:
        stack.append((tag, line))
    else:
        if not stack:
            print('NESTING: line %d — </%s> with nothing open' % (line, tag))
            depth_ok = False
            continue
        otag, oline = stack[-1]
        if otag == tag:
            stack.pop()
        else:
            # Tolerate the handful of tags browsers close implicitly.
            if otag in ('li','p','option','tr','td','th','tbody','thead'):
                stack.pop()
                if stack and stack[-1][0] == tag:
                    stack.pop()
                    continue
            print('NESTING: line %d — </%s> closes <%s> opened at line %d'
                  % (line, tag, otag, oline))
            depth_ok = False
            stack.pop()
if stack:
    depth_ok = False
    for tag, line in stack[-5:]:
        print('NESTING: <%s> opened at line %d is never closed' % (tag, line))
ok = ok and depth_ok

# ── Sample provenance ────────────────────────────────────────────────────
# samples/SOURCES.csv is the record of where every shipped sound, font and icon
# came from. It only stays true if a new file cannot arrive without a row, a
# changed file cannot keep its old hash, a file with no recorded source cannot
# ship, and a licence that asks for credit cannot be missing from the
# Settings > About > Credits table (CREDITS_TABLE in index.html).
import csv, hashlib
prov_ok = True
with io.open('samples/SOURCES.csv', encoding='utf-8', newline='') as fh:
    prov_rows = list(csv.DictReader(fh))
prov_by_path = {r['path']: r for r in prov_rows}
DOC_FILES = {'samples/CREDITS.md', 'samples/SOURCES.csv', 'samples/README.md'}
for root in ('samples', 'fonts'):
    for d, _, fs_ in os.walk(root):
        for f in sorted(fs_):
            pth = os.path.join(d, f)
            if f.startswith('.') or pth in DOC_FILES: continue
            if pth not in prov_by_path:
                print('PROVENANCE: %s is not in samples/SOURCES.csv' % pth)
                prov_ok = False
credit_ids = set(re.findall(r"\{id:'([\w-]+)', *kind:", s))
unknown = {}
for r in prov_rows:
    pth = r['path']
    if not os.path.isfile(pth):
        print('PROVENANCE: %s is in SOURCES.csv but not on disk' % pth); prov_ok = False
        continue
    if hashlib.sha256(open(pth, 'rb').read()).hexdigest() != r['sha256']:
        print('PROVENANCE: %s changed since its row was written (sha256 differs)' % pth); prov_ok = False
    if r['status'] not in ('VERIFIED', 'NEEDS-CONFIRM', 'UNKNOWN'):
        print('PROVENANCE: %s has status %r' % (pth, r['status'])); prov_ok = False
    if r['status'] == 'UNKNOWN':
        unknown[r['pack']] = unknown.get(r['pack'], 0) + 1
    if r['attribution_required'] == 'yes' and r['credit_group'] not in credit_ids:
        print('PROVENANCE: %s needs attribution but credit_group %r has no entry in CREDITS_TABLE' % (pth, r['credit_group']))
        prov_ok = False
for pk, cnt in sorted(unknown.items()):
    print('PROVENANCE: %d file(s) of "%s" have no recorded source or licence (UNKNOWN)' % (cnt, pk))
    prov_ok = False
ok = ok and prov_ok

print(('OK' if ok else 'ERRORS')+' — %d script blocks checked, markup nesting %s'
      % (n, 'balanced' if depth_ok else 'BROKEN') + ('' if prov_ok else '; sample provenance FAILED'))
sys.exit(0 if ok else 1)
PY
