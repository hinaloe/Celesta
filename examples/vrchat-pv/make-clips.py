"""Cut the trailer shots this film uses into short 30 fps clips.

Run from the repository root after downloading the two Steam trailers into
examples/vrchat-pv/assets/src/ (see README.md). Needs ffmpeg on PATH.
"""
import pathlib, subprocess

ROOT = pathlib.Path(__file__).parent / 'assets'
SRC = {'c': ROOT / 'src/trailer-create.mp4', 'a': ROOT / 'src/trailer-animated.mp4'}

# name, source, start (s), length (s), grade
CLIPS = [
    # cold open: the everyday commute, drained of colour
    ('commute',  'a', 0.10, 1.90, 'cold'),
    ('phone',    'a', 25.00, 2.00, 'cold'),
    ('flash',    'a', 2.10, 2.65, 'none'),
    # log in
    ('portal',   'c', 3.90, 2.05, 'none'),
    ('warp',     'c', 7.15, 1.08, 'none'),
    # manifesto: one shot per two beats
    ('bridge',   'c', 2.92, 0.94, 'none'),
    ('geese',    'c', 6.00, 1.10, 'none'),
    ('bar',      'c', 8.27, 1.15, 'none'),
    ('dancer',   'c', 11.30, 1.65, 'none'),
    ('street',   'c', 16.60, 1.30, 'none'),
    ('kitchen',  'c', 18.97, 0.98, 'none'),
    ('pool',     'c', 21.65, 2.10, 'none'),
    ('jet',      'c', 24.96, 1.07, 'none'),
    ('saloon',   'c', 26.07, 1.38, 'none'),
    ('burst',    'c', 29.27, 1.30, 'none'),
    ('club',     'c', 30.60, 1.72, 'none'),
    ('island',   'c', 34.58, 1.12, 'none'),
    ('hamsters', 'c', 37.00, 2.40, 'none'),
    ('horse',    'c', 41.38, 0.96, 'none'),
    ('grid',     'c', 46.05, 2.25, 'none'),
    ('stars',    'c', 49.76, 1.36, 'none'),
    ('dance',    'c', 52.03, 1.72, 'none'),
    ('piano',    'c', 51.15, 0.85, 'none'),
    ('painter',  'c', 19.98, 1.60, 'none'),
    ('golf',     'c', 42.38, 1.85, 'none'),
    # the closing flicker of worlds, and the pier as everyone logs off
    ('spirit',   'c', 53.80, 0.42, 'none'),
    ('forest',   'c', 54.27, 0.42, 'none'),
    ('snow',     'c', 54.77, 0.42, 'none'),
    ('road',     'c', 55.24, 0.42, 'none'),
    ('door',     'c', 55.73, 0.42, 'none'),
    ('hall',     'c', 56.20, 0.42, 'none'),
    ('tree',     'c', 56.70, 0.42, 'none'),
    ('pier',     'c', 57.20, 2.20, 'none'),
    # animated trailer, for the friends section
    ('aurora',   'a', 19.20, 1.88, 'none'),
    ('party',    'a', 14.66, 2.65, 'none'),
    ('runway',   'a', 22.49, 1.18, 'none'),
]

GRADES = {
    'none': '',
    'cold': ',hue=s=0.18,eq=contrast=1.08:brightness=-0.04:gamma_b=1.12',
}

out = ROOT / 'clips'
out.mkdir(exist_ok=True)
for name, src, start, length, grade in CLIPS:
    for suffix, size in (('', '1920:1080'), ('-small', '640:360')):
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-ss', f'{start}', '-i', str(SRC[src]),
            '-t', f'{length}', '-an',
            '-vf', f'fps=30,scale={size}:flags=lanczos,setsar=1{GRADES[grade]}',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-g', '15',
            '-pix_fmt', 'yuv420p', str(out / f'{name}{suffix}.mp4'),
        ], check=True)
    print(name)

# stills of moving views, for the polaroids in the camera scene
STILLS = [('golf', 0.9), ('piano', 0.4), ('aurora', 0.9), ('party', 1.2)]
for name, t in STILLS:
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t}', '-i', str(out / f'{name}.mp4'),
                    '-frames:v', '1', '-vf', 'scale=640:360', '-q:v', '3',
                    str(out / f'{name}-still.jpg')], check=True)
