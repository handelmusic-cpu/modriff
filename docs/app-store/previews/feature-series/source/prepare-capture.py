from pathlib import Path
import json,base64,plistlib,sys
w=Path('/private/tmp/modriff-series');app=Path('/private/tmp/modriff-capture/App.app');orig=Path('/private/tmp/modriff-preview-build/Build/Products/Debug-iphonesimulator/App.app')
kind=sys.argv[1];orientation='LandscapeRight' if kind.startswith('landscape') else 'Portrait'
p=app/'Info.plist';info=plistlib.loads(p.read_bytes());info['UISupportedInterfaceOrientations']=['UIInterfaceOrientation'+orientation];info['UISupportedInterfaceOrientations~ipad']=['UIInterfaceOrientation'+orientation];info['UIInterfaceOrientation']='UIInterfaceOrientation'+orientation;p.write_bytes(plistlib.dumps(info,fmt=plistlib.FMT_BINARY))
fixtures={'PROMO_SCORE':json.loads(Path('/private/tmp/modriff-high-impact/score.json').read_text()),'PROMO_PDF':base64.b64encode((w/'in-motion-chord-sheet.pdf').read_bytes()).decode(),'PROMO_SAMPLE':base64.b64encode((w/'in-motion-loop.wav').read_bytes()).decode(),'PROMO_PLAYLIST':(w/'studio-set.html').read_text()}
script='\n<script>\n'+''.join('window.'+k+'='+json.dumps(v)+';\n' for k,v in fixtures.items())+(w/('capture-'+kind+'.js')).read_text()+'\n</script>'
(app/'public/index.html').write_text((orig/'public/index.html').read_text()+script)
