"""Record the in-app ad demos in a separate app sandbox on the Simulator."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import time

WORK = Path(os.environ.get('MODRIFF_AUDIENCE_WORK', '/private/tmp/modriff-social-ads'))
DEVICE = os.environ['MODRIFF_SIM_DEVICE']
SOURCE = Path(os.environ['MODRIFF_SIM_APP'])
IDENTIFIER = 'Handel.modRiff.SocialCapture'
APP = WORK / 'SocialCapture.app'


def sim(*args, **kwargs):
    return subprocess.check_output(['xcrun', 'simctl', *args], text=True, **kwargs).strip()


def prepare():
    WORK.mkdir(parents=True, exist_ok=True)
    if APP.exists():
        shutil.rmtree(APP)
    shutil.copytree(SOURCE, APP, symlinks=True)
    info_path = APP / 'Info.plist'
    info = plistlib.loads(info_path.read_bytes())
    info['CFBundleIdentifier'] = IDENTIFIER
    info['UISupportedInterfaceOrientations'] = ['UIInterfaceOrientationPortrait']
    info['UIInterfaceOrientation'] = 'UIInterfaceOrientationPortrait'
    info_path.write_bytes(plistlib.dumps(info, fmt=plistlib.FMT_BINARY))
    # The widget belongs to the real app identifier and is unused in these captures.
    if (APP / 'PlugIns').exists():
        shutil.rmtree(APP / 'PlugIns')
    page = APP / 'public/index.html'
    stamp = json.loads((APP / 'public/build-info.json').read_text())
    assert hashlib.sha1(page.read_bytes()).hexdigest()[:12] == stamp['page'], stamp
    assert not stamp['dirty'], stamp
    (WORK / 'build-info.json').write_text(json.dumps(stamp, indent=2) + '\n')
    with page.open('a') as handle:
        handle.write('\n<script>\n' + Path(__file__).with_suffix('.js').read_text() + '\n</script>\n')
    subprocess.run(['codesign', '--force', '--sign', '-', str(APP)], check=True)


def capture():
    prepare()
    subprocess.run(['xcrun', 'simctl', 'uninstall', DEVICE, IDENTIFIER], capture_output=True)
    sim('install', DEVICE, str(APP))
    data = Path(sim('get_app_container', DEVICE, IDENTIFIER, 'data'))
    log_path = data / 'Documents/SocialCapture/social.jsonl'
    raw = WORK / 'social-raw.mov'
    with (WORK / 'recording.log').open('w') as output:
        video = subprocess.Popen(['xcrun', 'simctl', 'io', DEVICE, 'recordVideo', '--codec=h264',
                                  '--force', str(raw)], stdout=output, stderr=output)
        try:
            time.sleep(1)
            print(sim('launch', DEVICE, IDENTIFIER), flush=True)
            deadline = time.monotonic() + 130
            seen = 0
            while time.monotonic() < deadline:
                if log_path.exists():
                    lines = log_path.read_text().splitlines(keepends=True)
                    for line in lines[seen:]:
                        if not line.endswith('\n'):
                            break
                        row = json.loads(line)
                        seen += 1
                        print(row, flush=True)
                        if row['event'] == 'error':
                            raise RuntimeError(row)
                        if row['event'] == 'done':
                            assert not row['errors'], row
                            return
                time.sleep(.25)
            raise TimeoutError('Timed out waiting for the app capture log')
        finally:
            if log_path.exists():
                shutil.copy2(log_path, WORK / 'social.jsonl')
            video.send_signal(signal.SIGINT)
            video.wait(timeout=20)
            subprocess.run(['xcrun', 'simctl', 'terminate', DEVICE, IDENTIFIER], capture_output=True)


if __name__ == '__main__':
    capture()
