"""Original 120 BPM score. Deterministic synthesis, no samples or dependencies.

Run with Python 3 to regenerate assets/score.wav (48 kHz stereo, 24 s).
"""
from array import array
import math
from pathlib import Path
import random
import sys
import wave

RATE = 48000
DURATION = 24
TAU = math.tau
rng = random.Random(928)
left = array('f', [0]) * (RATE * DURATION)
right = array('f', [0]) * (RATE * DURATION)


def add(start, duration, voice, gain=1, pan=0):
    offset = round(start * RATE)
    l_gain = math.sqrt((1 - pan) / 2) * gain
    r_gain = math.sqrt((1 + pan) / 2) * gain
    for j in range(min(round(duration * RATE), len(left) - offset)):
        t = j / RATE
        s = voice(t)
        left[offset + j] += s * l_gain
        right[offset + j] += s * r_gain


def kick(t):
    # Integrated falling pitch, plus a short soft beater.
    phase = TAU * (44 * t + 7 * (1 - math.exp(-35 * t)))
    return math.sin(phase) * math.exp(-8 * t) + rng.uniform(-1, 1) * math.exp(-180 * t) * 0.16


def hat(t):
    return rng.uniform(-1, 1) * math.exp(-90 * t) * (1 - math.exp(-2000 * t))


def snare(t):
    return (rng.uniform(-1, 1) * 0.7 + math.sin(TAU * 173 * t) * 0.3) * math.exp(-23 * t)


def tone(hz, decay):
    def voice(t):
        attack = 1 - math.exp(-240 * t)
        return attack * math.exp(-decay * t) * (
            math.sin(TAU * hz * t) + 0.24 * math.sin(TAU * hz * 2.005 * t)
            + 0.10 * math.sin(TAU * hz * 3 * t))
    return voice


# Low, slowly moving room tone; leave air before the first downbeat.
add(0, 24, lambda t: (math.sin(TAU * 55 * t) * 0.7 + math.sin(TAU * 82.41 * t) * 0.3)
    * min(1, t / 1.4) * min(1, max(0, (24 - t) / 3)) * (0.75 + 0.25 * math.sin(t * 0.7)), 0.07)

for beat in range(4, 40):
    at = beat * 0.5
    if 14 <= at < 16:
        continue
    add(at, 0.7, kick, 0.70 if at >= 10 else 0.56)
    if beat % 2:
        add(at, 0.3, snare, 0.24, -0.10)
    if 6 <= at < 19:
        add(at + 0.25, 0.1, hat, 0.12, 0.4 if beat % 2 else -0.4)
        if 10 <= at < 14:
            add(at + 0.375, 0.07, hat, 0.06, -0.5)
    hz = [55, 55, 65.406, 48.999][(beat // 4) % 4]
    add(at, 0.42, tone(hz, 9), 0.20)

# A sparse, unresolved figure, with deliberately audible stereo echoes.
notes = [(0, 440), (1.5, 659.255), (4, 523.251), (5.5, 440),
         (8, 391.995), (9.5, 329.628), (14, 659.255), (15.5, 523.251),
         (16, 440), (17.5, 391.995), (19, 440), (20.5, 659.255)]
for i, (at, hz) in enumerate(notes):
    for echo in range(5):
        add(at + echo * 0.375, 2.0, tone(hz, 3.6), 0.105 * 0.48 ** echo,
            (-1 if (echo + i) % 2 else 1) * 0.48)

# Cut accents: reversed air into the typography hits and the closing chord.
for at in [2, 6, 10, 11, 12, 14, 19]:
    add(at - 0.22, 0.22, lambda t: rng.uniform(-1, 1) * (t / 0.22) ** 3, 0.14, -0.2)
    add(at, 0.16, lambda t: rng.uniform(-1, 1) * math.exp(-55 * t), 0.22, 0.15)
for hz in [110, 164.814, 220, 329.628]:
    add(19, 5, tone(hz, 0.85), 0.085, -0.3 if hz < 200 else 0.3)

peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
gain = 0.86 / peak
pcm = array('h')
for i, (l, r) in enumerate(zip(left, right)):
    fade = min(1, (len(left) - 1 - i) / (RATE * 0.6))
    pcm.extend((round(l * gain * fade * 32767), round(r * gain * fade * 32767)))
if sys.byteorder != 'little':
    pcm.byteswap()
output = Path(__file__).parent / 'assets' / 'score.wav'
output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(output), 'wb') as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes(pcm.tobytes())
print(f'Wrote {output}: 24 s, 48 kHz stereo, peak -1.31 dBFS')
