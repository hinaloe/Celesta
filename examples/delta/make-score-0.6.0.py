"""Original 120 BPM score for DELTA 0.6.0. Python standard library; no samples.

Bars follow film-0.6.0.tsx: one bar = 2 s = 60 frames.
  bars 0-1   the PR log ticks by, a riser pulls into the Δ
  bar  2     impact on the orange DELTA card
  bars 3-26  twelve chapters of two bars: four-on-the-floor, bass and arp
             over D minor, a whoosh into every cut
  bars 27-30 outro: the last chord rings out under bells
Writes score-0.6.0.wav next to this script (48 kHz, 16-bit stereo, 62 s).
"""
from array import array
import math
from pathlib import Path
import random
import wave

RATE = 48000
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
OPEN_BARS = 3
CHAPTERS = 12
CHAPTER_BARS = 2
OUTRO_BARS = 4
SECONDS = (OPEN_BARS + CHAPTERS * CHAPTER_BARS + OUTRO_BARS) * BAR
SAMPLES = round(SECONDS * RATE)
TAU = math.tau
rng = random.Random(60)
left = array('d', [0]) * SAMPLES
right = array('d', [0]) * SAMPLES

GROOVE_START = OPEN_BARS * BAR
OUTRO_START = GROOVE_START + CHAPTERS * CHAPTER_BARS * BAR


def add(start, duration, voice, gain, pan=0.0):
    """Mixes voice(t) in from `start` seconds for `duration` seconds."""
    offset = round(start * RATE)
    count = min(round(duration * RATE), SAMPLES - offset)
    l_gain = gain * math.sqrt((1 - pan) / 2)
    r_gain = gain * math.sqrt((1 + pan) / 2)
    tail = RATE * 0.01
    for i in range(max(0, count)):
        t = i / RATE
        fade = min(1.0, (count - 1 - i) / tail)
        s = voice(t) * fade
        left[offset + i] += s * l_gain
        right[offset + i] += s * r_gain


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


# --- voices -----------------------------------------------------------------

def kick(t):
    phase = TAU * (46 * t + 7 * (1 - math.exp(-28 * t)))
    return math.sin(phase) * math.exp(-9 * t) * (1 - math.exp(-900 * t))


def noise_voice(decay, attack=3000.0, color=0.0):
    state = [0.0]

    def voice(t):
        x = rng.uniform(-1, 1)
        # color > 0 darkens (one-pole low-pass), color < 0 brightens (difference)
        if color > 0:
            state[0] += color * (x - state[0])
            x = state[0] * 2.2
        elif color < 0:
            x, state[0] = x - state[0], x
        return x * math.exp(-decay * t) * (1 - math.exp(-attack * t))
    return voice


hat = noise_voice(70, color=-1)
open_hat = noise_voice(14, color=-1)
clap = noise_voice(22, attack=1800, color=0.35)
crash = noise_voice(2.2, color=-1)


def tick(t):
    return math.sin(TAU * 1760 * t) * math.exp(-60 * t)


def bass(freq):
    def voice(t):
        env = (1 - math.exp(-400 * t)) * math.exp(-2.2 * t)
        x = TAU * freq * t
        return env * (math.sin(x) + 0.35 * math.sin(2 * x) + 0.12 * math.sin(3 * x))
    return voice


def pluck(freq):
    def voice(t):
        env = (1 - math.exp(-500 * t)) * math.exp(-9 * t)
        x = TAU * freq * t
        return env * (math.sin(x) + 0.5 * math.exp(-14 * t) * math.sin(2 * x) + 0.2 * math.exp(-20 * t) * math.sin(3 * x))
    return voice


def bell(freq):
    def voice(t):
        env = (1 - math.exp(-200 * t)) * math.exp(-2.6 * t)
        return env * (math.sin(TAU * freq * t) + 0.3 * math.sin(TAU * freq * 2.76 * t) * math.exp(-4 * t)
                      + 0.12 * math.sin(TAU * freq * 5.4 * t) * math.exp(-7 * t))
    return voice


def pad(freqs, length, attack=0.6, release=1.2):
    def voice(t):
        env = min(1.0, t / attack) * min(1.0, max(0.0, (length - t) / release))
        s = 0.0
        for k, f in enumerate(freqs):
            detune = 1 + 0.003 * (k % 2 * 2 - 1)
            x = TAU * f * detune * t
            s += math.sin(x) + 0.25 * math.sin(2 * x) + 0.08 * math.sin(3 * x)
        return env * s / len(freqs)
    return voice


def boom(t):
    return math.sin(TAU * (38 * t + 30 * (1 - math.exp(-14 * t)) / 14)) * math.exp(-1.8 * t) * (1 - math.exp(-400 * t))


def riser(length):
    state = [0.0]

    def voice(t):
        p = t / length
        state[0] += (0.02 + 0.5 * p * p) * (rng.uniform(-1, 1) - state[0])
        tone = math.sin(TAU * (110 * t + 330 * t * p)) * 0.25
        return (state[0] * 2 + tone) * p ** 2.2
    return voice


def whoosh(length):
    state = [0.0]

    def voice(t):
        p = t / length
        state[0] += (0.05 + 0.4 * p) * (rng.uniform(-1, 1) - state[0])
        return state[0] * 2.5 * p ** 3
    return voice


# --- open: ticks, riser, impact -----------------------------------------------

for step in range(32):  # 16ths over bars 0-1
    at = step * BEAT / 4
    add(at, 0.08, tick, 0.22 if step % 4 else 0.32, 0.5 if step % 2 else -0.5)
    if step % 4 == 0:
        add(at, 0.06, hat, 0.12, -0.2)
add(0, BAR, pad([hz(38), hz(45), hz(50)], BAR + 0.1, attack=0.4, release=0.1), 0.14)
for beat in range(4, 8):  # bar 1: pulse under the gathering particles
    add(beat * BEAT, 0.5, kick, 0.5)
add(BAR, BAR, riser(BAR), 0.22)
add(BAR, BAR, pad([hz(50), hz(57), hz(62)], BAR + 0.2, attack=1.4, release=0.2), 0.12)

impact = 2 * BAR
add(impact, 2.5, boom, 0.9)
add(impact, 2.0, crash, 0.22, 0.2)
add(impact, 2.0, crash, 0.22, -0.2)
add(impact, BAR, pad([hz(50), hz(57), hz(62), hz(65), hz(69)], BAR, attack=0.05, release=1.0), 0.16)
add(impact + BAR - 0.5, 0.5, whoosh(0.5), 0.2)

# --- chapters: the groove ----------------------------------------------------

# D minor: i - VI - III - VII, one chord per chapter.
CHORDS = [
    (38, [62, 65, 69, 72]),  # Dm7
    (34, [62, 65, 70, 74]),  # Bb
    (41, [60, 65, 69, 72]),  # F
    (36, [60, 64, 67, 72]),  # C
]
for chapter in range(CHAPTERS):
    start = GROOVE_START + chapter * CHAPTER_BARS * BAR
    root, chord = CHORDS[chapter % len(CHORDS)]
    length = CHAPTER_BARS * BAR
    add(start, length, pad([hz(n) for n in chord], length + 0.05, attack=0.08, release=0.4), 0.075)
    add(start, 1.6, crash, 0.10 if chapter % 2 else 0.14, 0.3 if chapter % 2 else -0.3)
    for beat in range(CHAPTER_BARS * 4):
        at = start + beat * BEAT
        add(at, 0.5, kick, 0.62)
        add(at + BEAT / 2, 0.12, hat, 0.07, 0.35)
        add(at + BEAT / 4 * 3, 0.06, hat, 0.03, -0.35)
        if beat % 2 == 1:
            add(at, 0.3, clap, 0.16)
        # Bass on the offbeat 8ths, octave hop on the last one.
        add(at + BEAT / 2, BEAT / 2, bass(hz(root + (12 if beat % 4 == 3 else 0))), 0.26)
    arp = chord + [chord[1] + 12, chord[2] + 12]
    for step in range(CHAPTER_BARS * 16):
        if step % 16 in (6, 14):
            continue
        note = arp[(step * 3) % len(arp)] + (12 if step % 8 == 7 else 0)
        add(start + step * BEAT / 4, 0.32, pluck(hz(note)), 0.05, 0.45 if step % 2 else -0.45)
    if chapter < CHAPTERS - 1:
        # The wipe into the next chapter (8 frames) rides a short whoosh.
        add(start + length - 0.45, 0.45, whoosh(0.45), 0.16)
    else:
        add(start + length - BAR, BAR, riser(BAR), 0.12)

# --- outro: one more bar of groove, then the chord rings out -----------------

add(OUTRO_START, 3.0, boom, 0.75)
add(OUTRO_START, 2.4, crash, 0.2, 0.25)
add(OUTRO_START, 2.4, crash, 0.2, -0.25)
add(OUTRO_START, OUTRO_BARS * BAR, pad([hz(n) for n in (50, 57, 62, 65, 69, 76)], OUTRO_BARS * BAR, attack=0.05, release=3.5), 0.15)
for beat in range(4):
    at = OUTRO_START + beat * BEAT
    add(at, 0.5, kick, 0.55)
    add(at + BEAT / 2, 0.12, hat, 0.06, 0.35)
    add(at + BEAT / 2, BEAT / 2, bass(hz(38)), 0.22)
for i, note in enumerate([74, 77, 81, 86, 81, 77, 74, 69, 74, 81]):
    add(OUTRO_START + BAR + i * BEAT * (0.5 + i * 0.06), 2.6, bell(hz(note)), 0.07, -0.5 + i * 0.1)
add(OUTRO_START + BAR, 5.0, bell(hz(50)), 0.08)

# --- master: soft clip, normalize, fade the last half second ---------------

peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
gain = 1.25 / peak
pcm = array('h')
for i in range(SAMPLES):
    end = min(1.0, (SAMPLES - 1 - i) / (RATE * 0.5))
    for channel in (left, right):
        x = math.tanh(channel[i] * gain) * 0.89 * end
        pcm.append(round(x * 32767))

out = Path(__file__).with_name('score-0.6.0.wav')
with wave.open(str(out), 'wb') as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(RATE)
    f.writeframes(pcm.tobytes())
print(f'wrote {out} ({SECONDS:.0f} s)')
