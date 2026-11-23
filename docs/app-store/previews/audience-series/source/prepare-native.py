"""Cut the native Simulator footage at the per-scene recording markers."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

BASE = Path(__file__).resolve().parent.parent
PLAN = json.loads((BASE / 'plans.json').read_text())
WORK = Path(os.environ['MODRIFF_AUDIENCE_WORK'])
SCORE = Path(os.environ['MODRIFF_AUDIENCE_SCORE'])
OUT = Path(os.environ.get('MODRIFF_AUDIENCE_OUT', BASE))
EDITABLE = WORK / 'editable'
RAW = WORK / 'social-raw.mov'
FPS = 30


def video_info(path, fields):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=' + fields, '-of', 'json', str(path),
    ]))['streams'][0]


def find_scene_ranges():
    # Sampling the center 80% keeps the Simulator's status and home regions
    # out of the marker measurement. CSS colors below come from the recorder.
    pixels = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(RAW), '-vf',
        'fps=30,crop=iw*0.8:ih*0.8:iw*0.1:ih*0.1,scale=1:1',
        '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ])
    transitions = []
    last = None
    for i in range(0, len(pixels), 3):
        r, g, b = pixels[i:i+3]
        marker = None
        if min(r, g, b) > 244:
            marker = 'white'
        elif g > 240 and r < 30 and b < 30:
            marker = 'green'
        if marker != last:
            transitions.append((i // 3, marker))
            last = marker

    ranges = []
    start = None
    for i, (frame, marker) in enumerate(transitions[:-1]):
        next_frame = transitions[i+1][0]
        if next_frame - frame < 5:
            continue
        if marker == 'white':
            assert start is None, transitions
            start = (next_frame + 1) / FPS
        elif marker == 'green' and start is not None:
            end = (frame - 1) / FPS
            assert end - start > 1, (start, end)
            ranges.append((start, end))
            start = None
    assert start is None, transitions
    return ranges


def prepare_clip(shot, scale, source_range):
    name = shot['name']
    config = PLAN['assets'][name]
    view_width, view_height = shot['viewport']
    panel_x, panel_y, panel_width, panel_height = shot['rect']
    if config.get('tightWidth'):
        left = max(2, panel_x - 12)
        right = min(view_width - 2, panel_x + panel_width + 12)
    else:
        left, right = 2, view_width - 2
    if 'vertical' in config:
        top, bottom = config['vertical']
    else:
        # Keep enough room for the app panel to expand when the player
        # switches notes, chords or practice controls.
        middle = panel_y + min(panel_height, view_height - panel_y) / 2
        span = config['height']
        top = max(56, min(round(middle - span / 2), view_height - 70 - span))
        bottom = top + span

    def even(value):
        return round(value * scale / 2) * 2

    x, y, width, height = even(left), even(top), even(right - left), even(bottom - top)
    clip = EDITABLE / 'clips' / (name + '.mp4')
    start, end = source_range
    duration = end - start
    stretch = 4.01 / duration
    transform = (f'trim=duration={duration:.5f},setpts=(PTS-STARTPTS)*{stretch:.8f},'
                 f'crop={width}:{height}:{x}:{y},'
                 'scale=900:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,'
                 'fps=30,tpad=stop_mode=clone:stop_duration=0.1,setsar=1')
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.5f}', '-threads', '2', '-i', str(RAW),
        '-vf', transform, '-frames:v', '120', '-an', '-c:v', 'libx264',
        '-threads', '2', '-crf', '16', '-preset', 'fast', '-pix_fmt', 'yuv420p', str(clip),
    ], check=True)
    assert video_info(clip, 'nb_frames')['nb_frames'] == '120', name
    print('Prepared', name, flush=True)
    return dict(shot, cropPixels=[x, y, width, height],
                rawStartSeconds=round(start, 5), rawEndSeconds=round(end, 5),
                sha256=hashlib.sha256(clip.read_bytes()).hexdigest())


def prepare():
    rows = [json.loads(line) for line in (WORK / 'social.jsonl').read_text().splitlines()]
    begin = next(row for row in rows if row['event'] == 'begin')
    done = next(row for row in rows if row['event'] == 'done')
    shots = [row for row in rows if row['event'] == 'shot']
    assert len(shots) == len(PLAN['assets']) and {row['name'] for row in shots} == set(PLAN['assets'])
    assert not done['errors'] and not any(row['event'] == 'error' for row in rows), rows
    assert begin['scaleCount'] == 36, begin

    stamp = json.loads((WORK / 'build-info.json').read_text())
    assert stamp['version'] == begin['version'] and not stamp['dirty'], (stamp, begin)
    video = video_info(RAW, 'width,height')
    scale = video['width'] / begin['viewport'][0]
    assert abs(video['height'] - begin['viewport'][1] * scale) < 2, (video, begin)
    ranges = find_scene_ranges()
    assert len(ranges) == len(shots), ranges

    (EDITABLE / 'clips').mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SCORE / 'fonts', EDITABLE / 'fonts', dirs_exist_ok=True)
    for film in PLAN['films']:
        score_name = film['id'] + '-temp-score.wav'
        shutil.copy2(SCORE / score_name, EDITABLE / score_name)

    with ThreadPoolExecutor(max_workers=4) as executor:
        jobs = {shot['name']: executor.submit(prepare_clip, shot, scale, interval)
                for shot, interval in zip(shots, ranges)}
        clips = {name: job.result() for name, job in jobs.items()}

    proof = dict(build=stamp, capture='Native iPhone 18 Pro Max Simulator, portrait',
                 simulatorFrame=[video['width'], video['height']], scaleCount=begin['scaleCount'],
                 rawVideoSHA256=hashlib.sha256(RAW.read_bytes()).hexdigest(), shots=clips,
                 errors=done['errors'],
                 stateChanges={row['name']: row['states'] for row in rows if row['event'] == 'states'})
    for base in (OUT, EDITABLE):
        (base / 'capture-proof.json').write_text(json.dumps(proof, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    prepare()
