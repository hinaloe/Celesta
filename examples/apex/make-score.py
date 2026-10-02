"""Synthesize the original 60-second, 120 BPM score for APEX with the standard library.

Sections follow the film: 0-4 s intro, 4-12 s drop, 12-20 s words, 20-28 s breakdown,
28-36 s full, 36-44 s build, 44-54 s peak, 54-60 s outro.
"""
from array import array
import math
from pathlib import Path
import random
import sys
import wave

RATE, SECONDS = 48000, 60
N = RATE * SECONDS
TAU = math.tau
rng = random.Random(7)
left = array("f", [0]) * N
right = array("f", [0]) * N


def add(at, duration, voice, gain=1.0, pan=0.0):
    start = round(at * RATE)
    if start >= N:
        return
    a = gain * math.sqrt((1 - pan) / 2)
    b = gain * math.sqrt((1 + pan) / 2)
    for j in range(min(round(duration * RATE), N - start)):
        s = voice(j / RATE)
        left[start + j] += s * a
        right[start + j] += s * b


kick = lambda t: math.sin(TAU * (48 * t + 9 * (1 - math.exp(-45 * t)))) * math.exp(-10 * t)
hat = lambda t: rng.uniform(-1, 1) * math.exp(-140 * t)
clap = lambda t: rng.uniform(-1, 1) * (math.exp(-24 * t) + 0.6 * math.exp(-60 * max(0, t - 0.012)))
bass = lambda hz: (lambda t: math.tanh(2.0 * math.sin(TAU * hz * t) + 0.5 * math.sin(TAU * hz * 2 * t))
                   * (1 - math.exp(-80 * t)) * math.exp(-3.2 * t))
pluck = lambda hz: (lambda t: (math.sin(TAU * hz * t) + 0.5 * math.sin(TAU * hz * 2.003 * t)
                    + 0.25 * math.sin(TAU * hz * 3 * t)) * (1 - math.exp(-300 * t)) * math.exp(-9 * t))
bell = lambda hz, d: (lambda t: (math.sin(TAU * hz * t) + 0.3 * math.sin(TAU * hz * 2.01 * t)
                      + 0.12 * math.sin(TAU * hz * 4.02 * t)) * (1 - math.exp(-200 * t)) * math.exp(-d * t))
pad = lambda hz: (lambda t: (math.sin(TAU * hz * t) + 0.5 * math.sin(TAU * hz * 1.004 * t)
                  + 0.3 * math.sin(TAU * hz * 2 * t)) * min(1, t / 0.6) * min(1, (2.0 - t) / 0.6))
hz = lambda semis: 55.0 * 2 ** (semis / 12)

# A minor, i-VI-III-VII; roots in semitones above A1.
ROOTS = [0, 8, 3, 10]
ARP = [0, 7, 12, 15, 19, 15, 12, 7]
section = lambda s: ("intro" if s < 4 else "drop" if s < 12 else "words" if s < 20 else "break" if s < 28
                     else "full" if s < 36 else "build" if s < 44 else "peak" if s < 54 else "outro")

for beat in range(120):
    t0 = beat * 0.5
    sec = section(t0)
    bar = beat // 4
    root = ROOTS[bar % 4]
    if sec == "intro":
        if beat % 4 == 0:
            add(t0, 2.0, pad(hz(root + 12)), 0.05)
        if beat >= 4:
            add(t0 + 0.25, 0.05, hat, 0.05, 0.4)
        continue
    if sec in ("drop", "words", "full", "peak", "build"):
        add(t0, 0.35, kick, 0.40 if beat % 4 == 0 else 0.30)
        add(t0 + 0.25, 0.06, hat, 0.08 if sec != "peak" else 0.11, 0.35)
        if beat % 2 == 1:
            add(t0, 0.18, clap, 0.12, -0.1)
        for sub in (0, 1):  # offbeat bass
            add(t0 + sub * 0.25 + 0.125 * sub, 0.22, bass(hz(root)), 0.17)
    if sec in ("break", "outro"):
        if beat % 2 == 0:
            add(t0, 0.3, kick, 0.20)
        add(t0 + 0.25, 0.05, hat, 0.05, -0.3)
        if beat % 4 == 0:
            add(t0, 2.0, pad(hz(root + 12)), 0.06)
    if sec in ("words", "full", "peak", "break", "build"):
        for k in range(2):  # eighth-note arpeggio
            semis = root + 12 + ARP[(beat * 2 + k) % 8]
            add(t0 + k * 0.25, 0.3, pluck(hz(semis)), 0.07 if sec != "peak" else 0.10, -0.3 + 0.6 * k)
    if sec in ("peak", "full") and beat % 4 == 0:
        add(t0, 1.9, bell(hz(root + 36), 2.4), 0.07, 0.25)
    if sec == "build":  # rising noise swell and snare roll
        prog = (t0 - 36) / 8
        add(t0, 0.5, lambda t: rng.uniform(-1, 1) * 0.5 * t, 0.10 + 0.12 * prog)
        if prog > 0.5:
            for r in range(4):
                add(t0 + r * 0.125, 0.08, hat, 0.12, 0.2)

# Impacts at the film's hard cuts.
for at in (4, 12, 20, 28, 36, 44, 54):
    add(at - 0.3, 0.3, lambda t: rng.uniform(-1, 1) * (t / 0.3) ** 3, 0.12)
    add(at, 0.15, lambda t: rng.uniform(-1, 1) * math.exp(-45 * t), 0.20)
    add(at, 1.2, bell(hz(12), 3.0), 0.08, -0.2)
add(0, 4.0, lambda t: math.sin(TAU * hz(0) * t) * min(1, t / 2.5) * 0.9, 0.06)
add(54, 6.0, bell(hz(12), 0.8), 0.12)
add(54, 6.0, bell(hz(24), 0.9), 0.07, 0.3)

peak = max(max(abs(v) for v in left), max(abs(v) for v in right))
gain = 0.8 / peak
pcm = array("h")
for i, (l, r) in enumerate(zip(left, right)):
    fade = min(1, (N - 1 - i) / (RATE * 1.0), i / (RATE * 0.05))
    pcm.extend((round(max(-1, min(1, l * gain * fade)) * 32767), round(max(-1, min(1, r * gain * fade)) * 32767)))
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
