"""Synthesize the original 16-second electronic score with the standard library."""
from array import array
import math
from pathlib import Path
import random
import sys
import wave

RATE, SECONDS = 48000, 16
N = RATE * SECONDS
TAU = math.tau
rng = random.Random(3107)
left = array("f", [0]) * N
right = array("f", [0]) * N


def add(at, duration, voice, gain=1, pan=0):
    start = round(at * RATE)
    a = gain * math.sqrt((1 - pan) / 2)
    b = gain * math.sqrt((1 + pan) / 2)
    for j in range(min(round(duration * RATE), N - start)):
        t = j / RATE
        sample = voice(t)
        left[start + j] += sample * a
        right[start + j] += sample * b


def kick(t):
    phase = TAU * (52 * t + 7 * (1 - math.exp(-38 * t)))
    return math.sin(phase) * math.exp(-12 * t)


def tick(t):
    return rng.uniform(-1, 1) * math.exp(-135 * t)


def bass(hz):
    return lambda t: math.tanh(1.4 * (
        math.sin(TAU * hz * t) + 0.27 * math.sin(TAU * hz * 2 * t)
    )) * (1 - math.exp(-95 * t)) * math.exp(-4.3 * t)


def glass(hz, decay):
    return lambda t: (math.sin(TAU * hz * t)
        + 0.36 * math.sin(TAU * hz * 2.008 * t)
        + 0.14 * math.sin(TAU * hz * 3.98 * t)
    ) * (1 - math.exp(-190 * t)) * math.exp(-decay * t)


# Eight bars at 120 BPM. Every hard picture cut lands on a beat.
for beat in range(32):
    at = beat * 0.5
    if beat < 30:
        add(at, 0.38, kick, 0.38 if beat % 4 == 0 else 0.24)
        add(at, 0.065, tick, 0.11, -0.34 if beat % 2 else 0.34)
        if 4 <= beat < 24:
            add(at + 0.25, 0.07, tick, 0.075, 0.42)
        if beat % 2 == 1:
            add(at, 0.24, lambda t: rng.uniform(-1, 1) * math.exp(-27 * t),
                0.10, -0.2)
        add(at, 0.48, bass((55, 55, 65.406, 73.416)[(beat // 4) % 4]), 0.20)

# Tonal punctuation, with deliberate space in the rendered-form chapter.
for at, hz in ((0, 440), (2, 587.33), (3.5, 659.255), (5, 440),
               (7, 523.251), (8.5, 783.991), (10, 659.255), (13, 587.33)):
    add(at, 2.1, glass(hz, 2.25 if at < 13 else 0.72), 0.11, -0.3)
    add(at + 0.125, 1.4, glass(hz / 2, 2.5), 0.045, 0.36)

for at in (2, 5, 7, 8.5, 10, 13):
    add(at - 0.18, 0.18,
        lambda t: rng.uniform(-1, 1) * (t / 0.18) ** 3,
        0.10, -0.12)
    add(at, 0.11,
        lambda t: rng.uniform(-1, 1) * math.exp(-55 * t),
        0.18, 0.12)

# A quiet electrical bed; leave the first and last moments clean.
add(0, SECONDS, lambda t: (
    math.sin(TAU * 55.1 * t) + 0.3 * math.sin(TAU * 110.8 * t)
) * min(1, t / 1.1) * min(1, (SECONDS - t) / 1.3), 0.025)

peak = max(max(abs(v) for v in left), max(abs(v) for v in right))
assert N == 768000 and peak > 0
gain = 0.78 / peak
pcm = array("h")
for i, (l, r) in enumerate(zip(left, right)):
    fade = min(1, (N - 1 - i) / (RATE * 0.45))
    pcm.extend((round(l * gain * fade * 32767), round(r * gain * fade * 32767)))
if sys.byteorder != "little":
    pcm.byteswap()
out = Path(__file__).parent / "assets" / "score.wav"
out.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out), "wb") as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes(pcm.tobytes())
print(f"Wrote {out}: 16 seconds, 48 kHz stereo")
