"""A gentle ambient loop for the slideshow's sample music. Deterministic
synthesis with the Python standard library only, no samples.

Run with Python 3 to write ../assets/music.wav (48 kHz 16-bit mono, 30 s).
Every note's tail wraps around to the start, so the file loops seamlessly
when a slideshow runs longer than it.
"""
from array import array
import math
from pathlib import Path
import sys
import wave

RATE = 48000
DURATION = 30
LENGTH = RATE * DURATION
TAU = math.tau
samples = array('f', [0]) * LENGTH


def add(start, duration, voice, gain):
    # Adds `voice(t)` from `start` seconds, wrapping past the end of the loop.
    offset = round(start * RATE)
    for j in range(round(duration * RATE)):
        samples[(offset + j) % LENGTH] += voice(j / RATE) * gain


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def pad(freq, duration):
    # Two slightly detuned sines with a slow swell and release.
    def voice(t):
        envelope = min(1, t / 2.5) * min(1, max(0, (duration - t) / 2.5))
        return envelope * (math.sin(TAU * freq * t) + 0.6 * math.sin(TAU * freq * 1.003 * t)
                           + 0.15 * math.sin(TAU * freq * 2 * t))
    return voice


def bell(freq):
    # A soft plucked tone that rings out over a couple of seconds.
    def voice(t):
        attack = 1 - math.exp(-400 * t)
        return attack * (math.exp(-2.2 * t) * math.sin(TAU * freq * t)
                         + 0.3 * math.exp(-4 * t) * math.sin(TAU * freq * 2.01 * t))
    return voice


# Four chords of 7.5 s each (Cmaj7, Am7, Fmaj7, G6), overlapping by their
# release so the pad never drops out.
CHORD_SECONDS = 7.5
chords = [[48, 55, 64, 71], [45, 52, 60, 67], [41, 48, 57, 64], [43, 50, 59, 64]]
for i, chord in enumerate(chords):
    for note in chord:
        add(i * CHORD_SECONDS, CHORD_SECONDS + 2.5, pad(hz(note), CHORD_SECONDS + 2.5), 0.05)

# A slow arpeggio over each chord, an octave up, one note every 0.625 s.
STEP = 0.625
pattern = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 3, 2]
for i, chord in enumerate(chords):
    for k, index in enumerate(pattern):
        add(i * CHORD_SECONDS + k * STEP, 3, bell(hz(chord[index] + 12)), 0.09 if k % 4 == 0 else 0.06)

peak = max(abs(x) for x in samples)
gain = 0.7 / peak
pcm = array('h', (round(x * gain * 32767) for x in samples))
if sys.byteorder != 'little':
    pcm.byteswap()
output = Path(__file__).resolve().parent.parent / 'assets' / 'music.wav'
output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(output), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes(pcm.tobytes())
print(f'Wrote {output}: {DURATION} s, {RATE // 1000} kHz mono')
