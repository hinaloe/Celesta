"""Original 120 BPM circular score. Python standard library; no samples.

Every note and echo wraps around the buffer, preserving tails at the loop.
The quiet continuous tones use integer cycles across the full 16 seconds.
"""
from array import array
import math
from pathlib import Path
import random
import sys
import wave

RATE = 48000
SECONDS = 16
SAMPLES = RATE * SECONDS
TAU = math.tau
rng = random.Random(716)
left = array('d', [0]) * SAMPLES
right = array('d', [0]) * SAMPLES


def add(start, duration, voice, gain, pan=0):
    offset = round(start * RATE)
    l_gain = gain * math.sqrt((1 - pan) / 2)
    r_gain = gain * math.sqrt((1 + pan) / 2)
    count = round(duration * RATE)
    for i in range(count):
        t = i / RATE
        # A short raised-cosine release eliminates truncation clicks.
        release = min(1, (count - 1 - i) / (RATE * 0.015))
        sample = voice(t) * (0.5 - 0.5 * math.cos(math.pi * release))
        at = (offset + i) % SAMPLES
        left[at] += sample * l_gain
        right[at] += sample * r_gain


def kick(t):
    phase = TAU * (48 * t + 5 * (1 - math.exp(-32 * t)))
    return math.sin(phase) * math.exp(-12 * t) * (1 - math.exp(-1000 * t))


def hat(t):
    return rng.uniform(-1, 1) * math.exp(-95 * t) * (1 - math.exp(-2200 * t))


def bell(hz):
    def voice(t):
        envelope = (1 - math.exp(-170 * t)) * math.exp(-4.5 * t)
        return envelope * (math.sin(TAU * hz * t)
                           + 0.22 * math.sin(TAU * hz * 2 * t)
                           + 0.06 * math.sin(TAU * hz * 4 * t))
    return voice


# D minor pentatonic, a repeating eight-step figure with restrained echoes.
notes = [293.665, 440, 587.330, 523.251, 349.228, 440, 261.626, 349.228]
for beat in range(32):
    at = beat * 0.5
    add(at, 0.55, kick, 0.48 if beat % 4 == 0 else 0.34)
    add(at + 0.25, 0.12, hat, 0.045, 0.42 if beat % 2 else -0.42)
    if beat % 2:
        add(at, 0.14, hat, 0.075, -0.18)
    pitch = notes[beat % len(notes)]
    for echo in range(4):
        add(at + 0.375 * echo, 1.6, bell(pitch), 0.11 * 0.40 ** echo,
            (-1 if (beat + echo) % 2 else 1) * 0.48)
    add(at, 0.45, bell(pitch / 4), 0.12)

for i in range(SAMPLES):
    t = i / RATE
    breathe = 0.72 + 0.28 * math.cos(TAU * t / 8)
    # Quantize pad frequencies to 1/16 Hz so phase also loops exactly.
    a = math.sin(TAU * round(146.832 * SECONDS) * i / SAMPLES)
    b = math.sin(TAU * round(220 * SECONDS) * i / SAMPLES)
    left[i] += breathe * (a + b * 0.42) * 0.025
    right[i] += breathe * (a + b * 0.42) * 0.025

peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
gain = 0.79 / peak
pcm = array('h')
for l, r in zip(left, right):
    pcm.extend((round(l * gain * 32767), round(r * gain * 32767)))
if sys.byteorder != 'little':
    pcm.byteswap()
output = Path(__file__).resolve().parent / 'assets/score.wav'
output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(output), 'wb') as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes(pcm.tobytes())
print(f'Wrote {output}: {SECONDS} s, 48 kHz stereo, peak {20 * math.log10(0.79):.2f} dBFS')
