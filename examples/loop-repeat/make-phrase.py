"""A two-second, 120 BPM phrase for <Loop>. Python standard library; no samples.

Four beats: a kick on each, and a bell figure over them. Every note ends
before the phrase does, so the repeats join without a click.
"""
from array import array
import math
from pathlib import Path
import sys
import wave

RATE = 48000
SECONDS = 2
SAMPLES = RATE * SECONDS
TAU = math.tau
mono = array('d', [0]) * SAMPLES


def add(start, duration, voice, gain):
    offset = round(start * RATE)
    count = min(round(duration * RATE), SAMPLES - offset)
    for i in range(count):
        # A short raised-cosine release avoids a click where the note ends.
        release = min(1, (count - 1 - i) / (RATE * 0.015))
        mono[offset + i] += voice(i / RATE) * gain * (0.5 - 0.5 * math.cos(math.pi * release))


def kick(t):
    phase = TAU * (48 * t + 5 * (1 - math.exp(-32 * t)))
    return math.sin(phase) * math.exp(-12 * t) * (1 - math.exp(-1000 * t))


def bell(hz):
    def voice(t):
        envelope = (1 - math.exp(-170 * t)) * math.exp(-5 * t)
        return envelope * (math.sin(TAU * hz * t) + 0.22 * math.sin(TAU * hz * 2 * t))
    return voice


for beat, hz in enumerate([440, 587.330, 523.251, 349.228]):
    add(beat * 0.5, 0.45, kick, 0.5)
    add(beat * 0.5, 0.48, bell(hz), 0.18)

peak = max(abs(x) for x in mono)
pcm = array('h', (round(x * 0.79 / peak * 32767) for x in mono))
if sys.byteorder != 'little':
    pcm.byteswap()
output = Path(__file__).resolve().parent / 'assets/phrase.wav'
output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(output), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes(pcm.tobytes())
print(f'Wrote {output}: {SECONDS} s, 48 kHz mono')
