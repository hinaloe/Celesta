"""Synthesize the 44-second, 120 BPM score for "36 Days" with the standard library.

Keep the section boundaries in sync with SCENES in film.tsx: one bar is
two seconds, and every scene starts on a downbeat.
"""
from array import array
import math
from pathlib import Path
import random
import sys
import wave

RATE, BARS = 48000, 22
BEAT = 0.5
SECONDS = BARS * 4 * BEAT
N = int(RATE * SECONDS)
TAU = math.tau
rng = random.Random(3636)
left = array("f", [0]) * N
right = array("f", [0]) * N


def add(at, duration, voice, gain=1, pan=0):
    start = round(at * RATE)
    a = gain * math.sqrt((1 - pan) / 2)
    b = gain * math.sqrt((1 + pan) / 2)
    for j in range(min(round(duration * RATE), N - start)):
        sample = voice(j / RATE)
        left[start + j] += sample * a
        right[start + j] += sample * b


def kick(t):
    return math.sin(TAU * (48 * t + 8 * (1 - math.exp(-40 * t)))) * math.exp(-11 * t)


def tick(t):
    return rng.uniform(-1, 1) * math.exp(-150 * t)


def key(t):
    # A typewriter key: a click and a short body.
    return (rng.uniform(-1, 1) * math.exp(-260 * t)
            + 0.4 * math.sin(TAU * 1800 * t) * math.exp(-90 * t))


def bass(hz):
    return lambda t: math.tanh(1.6 * (
        math.sin(TAU * hz * t) + 0.3 * math.sin(TAU * hz * 2 * t)
    )) * (1 - math.exp(-90 * t)) * math.exp(-3.2 * t)


def bell(hz, decay):
    return lambda t: (math.sin(TAU * hz * t)
        + 0.32 * math.sin(TAU * hz * 2.01 * t)
        + 0.12 * math.sin(TAU * hz * 4.02 * t)
    ) * (1 - math.exp(-200 * t)) * math.exp(-decay * t)


def pad(hzs, length):
    return lambda t: sum(math.sin(TAU * hz * t + i) for i, hz in enumerate(hzs)) / len(hzs) \
        * min(1, t / 0.6) * min(1, (length - t) / 0.8)


def swell(length):
    return lambda t: rng.uniform(-1, 1) * (t / length) ** 3


# Am  F  C  G, one chord per bar.
ROOTS = (55.0, 43.654, 65.406, 48.999)
CHORDS = ((220.0, 261.63, 329.63), (174.61, 220.0, 261.63),
          (261.63, 329.63, 392.0), (196.0, 246.94, 293.66))

# Bars 0–1, the cold open: one key click per typed character (PROMPT in
# film.tsx, 43 characters from frame 6, one per frame) and a tick on each beat.
for frame in range(6, 6 + 43):
    add(frame / 30, 0.05, key, 0.08, rng.uniform(-0.3, 0.3))
for beat in range(8):
    add(beat * BEAT, 0.05, tick, 0.06)
add(4 - 0.6, 0.6, swell(0.6), 0.16)

# Bars 2–18: the groove.
for beat in range(8, 76):
    at = beat * BEAT
    bar = beat // 4
    add(at, 0.4, kick, 0.42 if beat % 4 == 0 else 0.28)
    add(at + BEAT / 2, 0.06, tick, 0.09, 0.35)
    if beat % 2 == 1:
        add(at, 0.22, lambda t: rng.uniform(-1, 1) * math.exp(-26 * t), 0.11, -0.2)
    add(at, 0.46, bass(ROOTS[bar % 4]), 0.22)
    if beat % 4 == 0:
        add(at, 4 * BEAT, pad(CHORDS[bar % 4], 4 * BEAT), 0.05, 0.1)

# Scene downbeats get a bell.
for bar, hz in ((2, 880.0), (4, 659.26), (7, 783.99), (11, 659.26), (16, 587.33), (19, 880.0)):
    add(bar * 2, 2.2, bell(hz, 1.8), 0.1, -0.25)
    add(bar * 2 - 0.4, 0.4, swell(0.4), 0.08)

# Bars 19–21, the outro: pads and bells only, then silence.
for bar in range(19, 21):
    add(bar * 2, 2 * 2 if bar == 20 else 2, pad(CHORDS[bar % 4], 4 if bar == 20 else 2), 0.08)
for i, hz in enumerate((440.0, 523.25, 659.26, 880.0)):
    add(38 + i * 0.5, 3, bell(hz, 1.2), 0.06, -0.3 + 0.2 * i)

peak = max(max(abs(v) for v in left), max(abs(v) for v in right))
assert peak > 0
gain = 0.8 / peak
pcm = array("h")
for i, (l, r) in enumerate(zip(left, right)):
    fade = min(1, (N - 1 - i) / (RATE * 0.6))
    pcm.extend((round(l * gain * fade * 32767), round(r * gain * fade * 32767)))
if sys.byteorder != "little":
    pcm.byteswap()
out = Path(__file__).parent / "score.wav"
with wave.open(str(out), "wb") as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes(pcm.tobytes())
print(f"Wrote {out}: {SECONDS:g} seconds, 48 kHz stereo")
