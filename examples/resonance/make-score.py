"""Synthesize RESONANCE's original 16-second score with the standard library.

Eight bars at 120 BPM that move through the whole spectrum: a low pad alone,
then kick, bass, claps, hats, and a high arpeggio, a rising sweep over a
breakdown, and a last hit ringing out to silence.
"""
from array import array
import math
from pathlib import Path
import random
import sys
import wave

RATE, SECONDS = 48000, 16
N = RATE * SECONDS
TAU = math.tau
BEAT = 0.5
rng = random.Random(299)
left = array("f", [0]) * N
right = array("f", [0]) * N


def add(at, duration, voice, gain=1, pan=0):
    start = round(at * RATE)
    a = gain * math.sqrt((1 - pan) / 2)
    b = gain * math.sqrt((1 + pan) / 2)
    count = min(round(duration * RATE), N - start)
    for j in range(count):
        # A short release so no note ends in a click.
        sample = voice(j / RATE) * min(1, (count - 1 - j) / (RATE * 0.01))
        left[start + j] += sample * a
        right[start + j] += sample * b


def kick(t):
    return math.sin(TAU * (48 * t + 9 * (1 - math.exp(-32 * t)))) * math.exp(-9 * t)


def noise(decay):
    return lambda t: rng.uniform(-1, 1) * math.exp(-decay * t)


def clap(t):
    # Three quick bursts, then a tail.
    bursts = sum(math.exp(-260 * (t - 0.011 * k)) for k in range(3) if t >= 0.011 * k)
    return rng.uniform(-1, 1) * (bursts + 0.6 * math.exp(-22 * t))


def bass(hz):
    return lambda t: math.tanh(1.8 * (
        math.sin(TAU * hz * t) + 0.35 * math.sin(TAU * hz * 2 * t)
    )) * (1 - math.exp(-120 * t)) * math.exp(-3.2 * t)


def pluck(hz):
    return lambda t: (math.sin(TAU * hz * t)
        + 0.5 * math.sin(TAU * hz * 2.003 * t)
        + 0.25 * math.sin(TAU * hz * 3.01 * t)
    ) * (1 - math.exp(-300 * t)) * math.exp(-7 * t)


def pad(hzs, length):
    return lambda t: sum(
        math.sin(TAU * hz * t + 0.4 * math.sin(TAU * 0.3 * t + k))
        for k, hz in enumerate(hzs)
    ) / len(hzs) * min(1, t / 0.6) * min(1, (length - t) / 0.8)


CHORDS = ((110, 164.81, 220, 261.63), (87.31, 130.81, 174.61, 220),
          (98, 146.83, 196, 246.94), (82.41, 123.47, 164.81, 207.65))
ROOTS = (55, 43.65, 49, 41.2)
ARP = (880, 1046.5, 1318.5, 1760, 1318.5, 1046.5, 1568, 1174.7)

for bar in range(8):
    at = bar * 4 * BEAT
    chord = CHORDS[bar % 4]
    add(at, 4 * BEAT + 0.4, pad(chord, 4 * BEAT + 0.4), 0.16)
    if bar == 0 or bar == 7:
        continue
    breakdown = bar == 5
    for beat in range(4):
        b = at + beat * BEAT
        if not breakdown:
            add(b, 0.45, kick, 0.55)
            add(b + BEAT / 2, 0.06, noise(90), 0.07, 0.4)
        if beat in (1, 3):
            add(b, 0.3, clap, 0.13 if not breakdown else 0.07, -0.1)
        add(b, 0.035, noise(160), 0.05, -0.4)
        if not breakdown:
            add(b + BEAT / 2, 0.42, bass(ROOTS[bar % 4] * (2 if beat % 2 else 1)), 0.22)
    if bar >= 2:
        for step in range(8):
            add(at + step * BEAT / 2, 0.3, pluck(ARP[(step + bar) % 8]), 0.05, 0.5 if step % 2 else -0.5)

# A sweep rising across the breakdown into the drop.
start, length = 10.0, 2.0
add(start, length, lambda t: math.sin(TAU * (200 * t + 1400 * t * t / length))
    * (t / length) ** 2, 0.09)
# The last hit, ringing out to silence.
add(14, 2, kick, 0.6)
add(14, 2, lambda t: pad(CHORDS[0], 2)(t) * math.exp(-1.8 * t), 0.3)

peak = max(max(abs(v) for v in left), max(abs(v) for v in right))
assert peak > 0
gain = 0.84 / peak
pcm = array("h")
for l, r in zip(left, right):
    pcm.extend((round(l * gain * 32767), round(r * gain * 32767)))
if sys.byteorder != "little":
    pcm.byteswap()
out = Path(__file__).parent / "assets" / "score.wav"
out.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out), "wb") as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes(pcm.tobytes())
print(f"Wrote {out}: {SECONDS} seconds, 48 kHz stereo")
