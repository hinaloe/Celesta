"""Original 90 BPM lo-fi score for DELTA 0.8.0. Python standard library; no samples.

Bars follow film-0.8.0.tsx: one bar = 8/3 s = 80 frames, one beat = 20 frames.
  bars 0-1   the cover page: tape hiss and crackle, a filtered electric piano;
             on bar 1 the 0.8.0 stamp lands on a boom and a snare crack
  bars 2-3   the camera sweeps the sheet: a half-time kick, a reverse swell
  bars 4-27  twelve features of two bars: swung boom-bap drums, electric piano
             and sub bass over D minor (Dm9 - Bbmaj7 - Gm9 - A7), a tape whoosh
             under every hop of the camera. METRICS and PITCH are lighter; in
             PITCH the chords move every two beats under the riff (below).
             From FALLBACK on, a vibraphone line on top
  bars 28-31 MORE: a card every two beats, each on a stab; a snare build at the end
  bars 32-35 outro: half time, then the last chord and the bells ring out,
             and the tape stops
Writes score-0.8.0.wav next to this script (48 kHz, 16-bit stereo, 96 s), and
pitch-0.8.0.wav: two beats of a riff on D that the PITCH chapter plays
through <Audio pitch>, a step every two beats to follow the chords.
"""
from array import array
import math
from pathlib import Path
import random
import wave

RATE = 48000
BPM = 90
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4
SWING = 0.18 * STEP  # the second sixteenth of every eighth comes late
OPEN_BARS = 4
CHAPTERS = 12
CHAPTER_BARS = 2
MORE_BARS = 4
OUTRO_BARS = 4
TOTAL_BARS = OPEN_BARS + CHAPTERS * CHAPTER_BARS + MORE_BARS + OUTRO_BARS
SECONDS = TOTAL_BARS * BAR
SAMPLES = round(SECONDS * RATE)
TAU = math.tau
rng = random.Random(808)

drums_l = array('d', [0]) * SAMPLES
drums_r = array('d', [0]) * SAMPLES
music_l = array('d', [0]) * SAMPLES
music_r = array('d', [0]) * SAMPLES
duck = array('d', [1]) * SAMPLES

CHAPTER_START = OPEN_BARS * BAR
MORE_START = CHAPTER_START + CHAPTERS * CHAPTER_BARS * BAR
OUTRO_START = MORE_START + MORE_BARS * BAR
LIGHT = (6, 7)  # zero-based: METRICS and PITCH
PITCH = 7
LIFT = 8        # FALLBACK on: the vibraphone comes in


def add(start, duration, voice, gain, pan=0.0, bus='music'):
    """Mixes voice(t) in from `start` seconds for `duration` seconds."""
    left, right = (drums_l, drums_r) if bus == 'drums' else (music_l, music_r)
    offset = round(start * RATE)
    count = min(round(duration * RATE), SAMPLES - offset)
    l_gain = gain * math.sqrt((1 - pan) / 2)
    r_gain = gain * math.sqrt((1 + pan) / 2)
    tail = RATE * 0.01
    for i in range(max(0, count)):
        t = i / RATE
        s = voice(t) * min(1.0, (count - 1 - i) / tail)
        left[offset + i] += s * l_gain
        right[offset + i] += s * r_gain


def sidechain(start, depth=0.3, release=0.22):
    offset = round(start * RATE)
    count = min(round(release * 1.6 * RATE), SAMPLES - offset)
    for i in range(max(0, count)):
        g = 1 - depth * math.exp(-(i / RATE) / (release / 3))
        if g < duck[offset + i]:
            duck[offset + i] = g


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def lp_coef(cutoff):
    return 1 - math.exp(-TAU * min(cutoff, RATE * 0.45) / RATE)


# --- drums: soft, dusty --------------------------------------------------------

def kick(t):
    phase = TAU * (46 * t + 70 * (1 - math.exp(-30 * t)) / 30)
    return math.tanh(1.6 * math.sin(phase) * math.exp(-7 * t)) * (1 - math.exp(-1500 * t))


def snare(t, state=[0.0, 0.0]):
    x = rng.uniform(-1, 1)
    state[0] += 0.35 * (x - state[0])        # dull the noise
    state[1] += 0.02 * (state[0] - state[1])  # and take its rumble out
    body = math.sin(TAU * 190 * t) * math.exp(-24 * t)
    room = (state[0] - state[1]) * (math.exp(-18 * t) + 0.25 * math.exp(-4 * t))
    return (0.6 * body + 1.3 * room) * (1 - math.exp(-2500 * t))


def hat(t, state=[0.0]):
    x = rng.uniform(-1, 1)
    x, state[0] = x - state[0], x
    return x * math.exp(-60 * t) * 0.8


def rim(t):
    return (math.sin(TAU * 1700 * t) * 0.6 + math.sin(TAU * 820 * t)) * math.exp(-60 * t)


def boom(t):
    phase = TAU * (34 * t + 40 * (1 - math.exp(-8 * t)) / 8)
    return math.sin(phase) * math.exp(-1.6 * t) * (1 - math.exp(-500 * t))


def whoosh(length):
    """A tape whoosh: filtered noise rising to the hop's middle and falling away."""
    s = [0.0]

    def voice(t):
        p = t / length
        s[0] += (0.02 + 0.25 * math.sin(math.pi * p)) * (rng.uniform(-1, 1) - s[0])
        return s[0] * 2.4 * math.sin(math.pi * p) ** 2
    return voice


def reverse_swell(length):
    s = [0.0]

    def voice(t):
        p = t / length
        x = rng.uniform(-1, 1)
        s[0] += 0.3 * (x - s[0])
        return s[0] * p ** 3
    return voice


def at_step(bar_start, step):
    """The time of a sixteenth in a bar, swung."""
    return bar_start + step * STEP + (SWING if step % 2 else 0)


def groove(start, gain=1.0, hats=8, light=False, fill=False):
    """One bar of boom-bap: kick on 1 and the 'a' of 2, snare on 2 and 4, swung hats."""
    kicks = (0, 7, 10) if not light else (0, 10)
    for step in kicks:
        add(at_step(start, step), 0.5, kick, 0.8 * gain, bus='drums')
        sidechain(at_step(start, step))
    for step in (4, 12):
        if light:
            add(at_step(start, step), 0.1, rim, 0.18 * gain, 0.1, bus='drums')
        else:
            add(at_step(start, step), 0.6, snare, 0.5 * gain, -0.05, bus='drums')
    if not light:
        for step in (6, 15):
            add(at_step(start, step), 0.15, snare, 0.07 * gain, 0.2, bus='drums')
    every = 16 // hats
    for step in range(0, 16, every):
        accent = 1.0 if step % 4 == 0 else 0.65
        add(at_step(start, step), 0.08, hat, 0.09 * gain * accent, 0.35, bus='drums')
    if fill:
        for i in range(6):
            add(start + 3 * BEAT + i * BEAT / 6, 0.12, snare, 0.08 + 0.04 * i, -0.2 + 0.08 * i, bus='drums')


# --- tonal voices ------------------------------------------------------------

def rhodes(freqs, length, bright=1.0):
    """An electric piano: a sine with a decaying FM tine per note, low-passed warm."""
    s = [0.0]

    def voice(t):
        env = min(1.0, t / 0.004) * min(1.0, max(0.0, (length - t) / 0.12))
        x = 0.0
        for k, f in enumerate(freqs):
            tine = 0.9 * bright * math.exp(-7 * t)
            x += math.sin(TAU * f * t + tine * math.sin(TAU * 2 * f * t) + k) * math.exp(-1.1 * t)
            x += 0.18 * math.sin(TAU * 3 * f * t) * math.exp(-5 * t)
        x /= len(freqs)
        s[0] += lp_coef(2600 * bright) * (x - s[0])
        return env * s[0]
    return voice


def sub(freq, length):
    def voice(t):
        env = min(1.0, t / 0.01) * min(1.0, max(0.0, (length - t) / 0.06))
        return env * (math.sin(TAU * freq * t) + 0.15 * math.sin(TAU * 2 * freq * t))
    return voice


def vibes(freq):
    def voice(t):
        env = (1 - math.exp(-400 * t)) * math.exp(-2.6 * t)
        trem = 1 + 0.25 * math.sin(TAU * 5.2 * t)
        return env * trem * (math.sin(TAU * freq * t) + 0.25 * math.sin(TAU * 4 * freq * t) * math.exp(-8 * t))
    return voice


def bell(freq):
    def voice(t):
        env = (1 - math.exp(-200 * t)) * math.exp(-1.8 * t)
        return env * (math.sin(TAU * freq * t) + 0.3 * math.sin(TAU * freq * 2.76 * t) * math.exp(-4 * t))
    return voice


def crackle(length):
    """Vinyl: a little hiss and sparse dust."""
    s = [0.0]

    def voice(t):
        s[0] += 0.05 * (rng.uniform(-1, 1) - s[0])
        pop = rng.uniform(-1, 1) * 6 if rng.random() < 0.0006 else 0.0
        return s[0] * 0.6 + pop
    return voice


# --- harmony -----------------------------------------------------------------

# Dm9 - Bbmaj7 - Gm9 - A7(b9): root for the bass, voicing for the piano.
CHORDS = [
    (38, [53, 57, 60, 64]),   # Dm9:    F A C E   over D
    (34, [53, 57, 58, 62]),   # Bbmaj7: F A Bb D  over Bb
    (31, [53, 57, 58, 62]),   # Gm9:    F A Bb D  over G
    (33, [55, 58, 61, 64]),   # A7b9:   G Bb C# E over A
]
# PITCH: a chord every two beats, matching the riff's 0, -4, +5, +7.
PITCH_CHORDS = [CHORDS[0], CHORDS[1], CHORDS[2], CHORDS[3]]
# From FALLBACK on, a vibraphone phrase a bar: (beat, note).
MELODY = [
    [(0, 74), (1.5, 72), (2, 69), (3, 72)],
    [(0, 70), (1.5, 69), (2, 65), (3.5, 67)],
    [(0, 70), (1, 69), (1.5, 67), (3, 65)],
    [(0, 69), (1.5, 67), (2, 64), (3, 61)],
]


def comp(start, chord, root, length=BAR, gain=1.0, bright=1.0):
    """The piano on 1 and the and of 2, the bass under it."""
    add(start, length, sub(hz(root), length), 0.34 * gain)
    add(start, 1.6 * BEAT, rhodes([hz(n) for n in chord], 1.6 * BEAT, bright), 0.26 * gain, -0.15)
    add(start + 1.5 * BEAT + SWING, length - 1.5 * BEAT, rhodes([hz(n) for n in chord], length - 1.5 * BEAT, bright * 0.8), 0.18 * gain, 0.15)


# --- open ----------------------------------------------------------------------

add(0, SECONDS, crackle(SECONDS), 0.025, bus='drums')
root, chord = CHORDS[0]
add(0, 2 * BAR, rhodes([hz(n) for n in chord], 2 * BAR, 0.5), 0.22)
add(0, 2 * BAR, sub(hz(root), 2 * BAR), 0.18)
# Bar 1: the stamp.
add(BAR, 3.5, boom, 0.9)
add(BAR, 0.6, snare, 0.7, bus='drums')
add(BAR, 2.0, bell(hz(74)), 0.08, 0.3)
add(BAR, BAR, rhodes([hz(n) for n in CHORDS[1][1]], BAR, 0.7), 0.2)
# Bars 2-3: the sweep, half time.
for b in (2, 3):
    start = b * BAR
    add(start, 0.5, kick, 0.7, bus='drums')
    sidechain(start)
    add(start + 2 * BEAT, 0.6, snare, 0.35, bus='drums')
    for step in range(0, 16, 4):
        add(at_step(start, step), 0.08, hat, 0.05, 0.35, bus='drums')
    root, chord = CHORDS[b]
    comp(start, chord, root, gain=0.8, bright=0.7)
add(2 * BAR, 2 * BAR, reverse_swell(2 * BAR), 0.12, bus='drums')

# --- chapters --------------------------------------------------------------------

for chapter in range(CHAPTERS):
    base = CHAPTER_START + chapter * CHAPTER_BARS * BAR
    light = chapter in LIGHT
    for b in range(CHAPTER_BARS):
        start = base + b * BAR
        bar_index = chapter * CHAPTER_BARS + b
        root, chord = CHORDS[bar_index % 4]
        last = b == CHAPTER_BARS - 1
        groove(start, gain=0.7 if light else 1.0, hats=8 if chapter < LIFT else 16, light=light,
               fill=last and chapter in (5, 11))
        if chapter == PITCH:
            # Two chords a bar, held, under the riff.
            for half in range(2):
                r, c = PITCH_CHORDS[b * 2 + half]
                add(start + half * 2 * BEAT, 2 * BEAT, sub(hz(r), 2 * BEAT), 0.3)
                add(start + half * 2 * BEAT, 2 * BEAT, rhodes([hz(n) for n in c], 2 * BEAT, 0.5), 0.16)
        else:
            comp(start, chord, root, gain=0.8 if light else 1.0, bright=0.7 if light else 1.0)
        if chapter >= LIFT:
            for beat, note in MELODY[bar_index % 4]:
                add(start + beat * BEAT, 2.4, vibes(hz(note)), 0.05, 0.25)
    # The camera's hop to the next tile: the chapter's last 36 frames.
    hop = 36 / 30
    add(base + CHAPTER_BARS * BAR - hop, hop, whoosh(hop), 0.10, 0.2 if chapter % 2 else -0.2, bus='drums')

# --- MORE: a card every two beats ---------------------------------------------------

for b in range(MORE_BARS):
    start = MORE_START + b * BAR
    groove(start, hats=16, fill=b == MORE_BARS - 1)
    root, chord = CHORDS[b % 4]
    add(start, BAR, sub(hz(root), BAR), 0.32)
    for half in range(2):
        at = start + half * 2 * BEAT
        add(at, 1.2 * BEAT, rhodes([hz(n + 12) for n in chord], 1.2 * BEAT, 1.2), 0.22, -0.2 if half else 0.2)
        add(at, 1.5, bell(hz(chord[-1] + 12)), 0.04, 0.4 if half else -0.4)

# --- outro -------------------------------------------------------------------------

add(OUTRO_START, 3.5, boom, 0.8)
for b in range(2):
    start = OUTRO_START + b * BAR
    add(start, 0.5, kick, 0.75, bus='drums')
    sidechain(start)
    add(start + 2 * BEAT, 0.6, snare, 0.4, bus='drums')
    for step in range(0, 16, 2):
        add(at_step(start, step), 0.08, hat, 0.05, 0.35, bus='drums')
    root, chord = CHORDS[b]
    comp(start, chord, root, gain=0.9)
end = OUTRO_START + 2 * BAR
add(end, 2 * BAR, rhodes([hz(n) for n in (50, 57, 60, 64, 65)], 2 * BAR, 0.9), 0.3)
add(end, 2 * BAR, sub(hz(38), 2 * BAR), 0.3)
for i, note in enumerate([74, 77, 81, 84, 81, 77, 74, 69]):
    add(OUTRO_START + i * BEAT * 0.75, 3.0, bell(hz(note)), 0.06, -0.4 + i * 0.1)

# --- master: duck, warm it, sum, soft clip, normalize, stop the tape ------------------

left = array('d', (d + m * g for d, m, g in zip(drums_l, music_l, duck)))
right = array('d', (d + m * g for d, m, g in zip(drums_r, music_r, duck)))
for channel in (left, right):  # a gentle low-pass: the tape's top end
    s = 0.0
    k = lp_coef(9000)
    for i in range(SAMPLES):
        s += k * (channel[i] - s)
        channel[i] = s
peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
gain = 1.25 / peak


def tape_stop(channel, length):
    """The last `length` seconds slow to a halt, reading ever more slowly."""
    count = round(length * RATE)
    start = SAMPLES - count
    out = array('d', [0]) * count
    pos = float(start)
    for i in range(count):
        speed = (1 - i / count) ** 1.5
        j = int(pos)
        out[i] = channel[min(j, SAMPLES - 1)]
        pos += speed
    channel[start:] = out


for channel in (left, right):
    tape_stop(channel, 0.9)

pcm = array('h')
for i in range(SAMPLES):
    for channel in (left, right):
        pcm.append(round(math.tanh(channel[i] * gain) * 0.89 * 32767))

out = Path(__file__).with_name('score-0.8.0.wav')
with wave.open(str(out), 'wb') as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(RATE)
    f.writeframes(pcm.tobytes())
print(f'wrote {out} ({SECONDS:.1f} s)')

# --- the PITCH riff ------------------------------------------------------------------

# Two beats on D, roots, fifths and octaves only, so it sits on any of the
# four chords once <Audio pitch> moves it (0, -4, +5, +7 semitones: D, Bb, G, A).
RIFF = [0, 7, 12, None, 7, 0, 19, 12]
riff_samples = round(2 * BEAT * RATE)
riff_l = array('d', [0]) * riff_samples
riff_r = array('d', [0]) * riff_samples
for step, offset in enumerate(RIFF):
    if offset is None:
        continue
    voice = vibes(hz(50 + offset))  # D3
    begin = round(step * STEP * RATE)
    count = min(round(0.5 * RATE), riff_samples - begin)
    pan = -0.3 if step % 2 else 0.3
    for i in range(count):
        x = voice(i / RATE) * min(1.0, (count - 1 - i) / (RATE * 0.004))
        riff_l[begin + i] += x * math.sqrt((1 - pan) / 2)
        riff_r[begin + i] += x * math.sqrt((1 + pan) / 2)

# As loud as the score is over the PITCH chapter, so the two balance at volume 1.
chapter_from = round((CHAPTER_START + PITCH * CHAPTER_BARS * BAR) * 2 * RATE)
chapter_pcm = pcm[chapter_from:chapter_from + round(CHAPTER_BARS * BAR * 2 * RATE)]
score_rms = math.sqrt(sum(x * x for x in chapter_pcm) / len(chapter_pcm)) / 32767
riff_rms = math.sqrt(sum(x * x for x in riff_l + riff_r) / (2 * riff_samples))
riff_gain = score_rms / riff_rms
riff_pcm = array('h')
for i in range(riff_samples):
    for channel in (riff_l, riff_r):
        riff_pcm.append(round(math.tanh(channel[i] * riff_gain) * 32767))

riff_out = Path(__file__).with_name('pitch-0.8.0.wav')
with wave.open(str(riff_out), 'wb') as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(RATE)
    f.writeframes(riff_pcm.tobytes())
print(f'wrote {riff_out} ({2 * BEAT:.2f} s)')
