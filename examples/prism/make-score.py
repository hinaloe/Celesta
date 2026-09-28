"""PRISM: original 120 BPM electronic score; standard-library synthesis only.

Run from any directory to generate a deterministic 48-second stereo WAV.
"""
from array import array
import math
from pathlib import Path
import random
import sys
import wave

RATE, SECONDS = 48000, 48
TAU = math.tau
rng = random.Random(290926)
left = array('f', [0]) * (RATE * SECONDS)
right = array('f', [0]) * (RATE * SECONDS)


def add(at, duration, voice, gain=1, pan=0):
    offset = round(at * RATE)
    gl, gr = math.sqrt((1 - pan) / 2) * gain, math.sqrt((1 + pan) / 2) * gain
    for i in range(min(round(duration * RATE), len(left) - offset)):
        value = voice(i / RATE)
        left[offset + i] += value * gl
        right[offset + i] += value * gr


def note(hz, decay=5):
    return lambda t: (1 - math.exp(-300 * t)) * math.exp(-decay * t) * (
        math.sin(TAU * hz * t) + 0.23 * math.sin(TAU * hz * 2.002 * t)
        + 0.08 * math.sin(TAU * hz * 4 * t))


def kick(t):
    return math.sin(TAU * (47 * t + 5 * (1 - math.exp(-45 * t)))) * math.exp(-10 * t)


def hat(t):
    return rng.uniform(-1, 1) * math.exp(-95 * t) * (1 - math.exp(-3000 * t))


def clap(t):
    return (rng.uniform(-1, 1) * 0.8 + math.sin(TAU * 187 * t) * 0.2) * math.exp(-26 * t)


# D minor: a quiet suspended opening, then a tight, syncopated pulse.
for hz in [146.832, 220, 329.628]:
    add(0, 3, note(hz, 1.6), 0.13, -0.3 if hz < 200 else 0.3)
for beat in range(4, 89):
    at = beat / 2
    drop = 37 <= at < 40
    if not drop or beat % 2 == 0:
        add(at, 0.65, kick, 0.78 if at >= 11 else 0.60)
    if beat % 2 and not drop:
        add(at, 0.25, clap, 0.25, -0.08)
    if at >= 6 and not drop:
        add(at + 0.25, 0.11, hat, 0.14, 0.45 if beat % 2 else -0.45)
        if 16 <= at < 21:
            add(at + 0.375, 0.07, hat, 0.055, -0.35)
    root = [73.416, 65.406, 58.270, 65.406][((beat - 4) // 8) % 4]
    add(at, 0.44, note(root, 9), 0.30)
    if not drop and beat % 4 != 3:
        add(at + 0.375, 0.2, note(root * 2, 15), 0.10, 0.1)

# Glass-like arpeggios and dotted-eighth stereo repeats.
for step in range(8, 176):
    at = step / 4
    if 37 <= at < 40 or (at < 6 and step % 4):
        continue
    hz = [293.665, 440, 587.33, 659.255, 523.251, 440, 349.228, 440][step % 8]
    gain = 0.075 if at < 11 else 0.10
    for echo in range(3):
        add(at + echo * 0.375, 1.2, note(hz, 6), gain * 0.4 ** echo,
            (0.45 if (step + echo) % 2 else -0.45))

# Short air sweeps lead into the scene cuts; impact lands on the exact frame.
for at in [2, 6, 11, 16, 21, 26, 32, 37, 38, 39, 40, 44]:
    add(at - 0.25, 0.25, lambda t: rng.uniform(-1, 1) * (t / 0.25) ** 3, 0.19, -0.2)
    add(at, 0.20, lambda t: rng.uniform(-1, 1) * math.exp(-45 * t), 0.22, 0.2)
for hz in [73.416, 146.832, 220, 293.665, 440]:
    add(44, 4, note(hz, 1.05), 0.14, -0.4 if hz < 200 else 0.4)

peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
gain = 0.88 / peak
pcm = array('h')
for i, (l, r) in enumerate(zip(left, right)):
    fade = min(1, i / (RATE * 0.008), (len(left) - 1 - i) / (RATE * 0.8))
    # Leave room for the real spoken dialogue from 27 to 30.46 seconds.
    seconds = i / RATE
    duck = 1 - 0.82 * min(1, max(0, (seconds - 26.5) / 0.5)) * min(1, max(0, (31.0 - seconds) / 0.5))
    pcm.extend((round(l * gain * fade * duck * 32767), round(r * gain * fade * duck * 32767)))
if sys.byteorder != 'little':
    pcm.byteswap()
output = Path(__file__).resolve().parent / 'assets' / 'score.wav'
output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(output), 'wb') as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes(pcm.tobytes())
print(f'Created {output}: {SECONDS} s, {RATE} Hz, stereo')
