"""Original 180 BPM drum & bass score for DELTA 0.7.0. Python standard library; no samples.

Bars follow film-0.7.0.tsx: one bar = 4/3 s = 40 frames.
  bars 0-1   a sub boom and a brass braam under the PR log
  bars 2-3   the drums come in filtered, a snare roll and a riser build
  bar  4     impact on the DELTA card
  bar  5     a last roll, then one beat of silence before the drop
  bars 6-29  drop A: six chapters of four bars, two-step drums and a reese bass
             over F minor (Fm - Db - Bbm - C), a whoosh into every cut
  bars 30-37 two lighter chapters: sub bass, pads and an arpeggio
  bars 38-53 drop B: four chapters, the reese louder and a lead on top
  bars 54-61 MORE: one card a bar, each landing on a stab; a build into the outro
  bars 62-67 outro: the last impact, a half-time bar, then the chord rings out
Writes score-0.7.0.wav next to this script (48 kHz, 16-bit stereo, 90.7 s).
"""
from array import array
import math
from pathlib import Path
import random
import wave

RATE = 48000
BPM = 180
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4
OPEN_BARS = 6
CHAPTERS = 12
CHAPTER_BARS = 4
MORE_BARS = 8
OUTRO_BARS = 6
TOTAL_BARS = OPEN_BARS + CHAPTERS * CHAPTER_BARS + MORE_BARS + OUTRO_BARS
SECONDS = TOTAL_BARS * BAR
SAMPLES = round(SECONDS * RATE)
TAU = math.tau
rng = random.Random(70)

# Two buses: drums, and everything tonal, which ducks under the kick.
drums_l = array('d', [0]) * SAMPLES
drums_r = array('d', [0]) * SAMPLES
music_l = array('d', [0]) * SAMPLES
music_r = array('d', [0]) * SAMPLES
duck = array('d', [1]) * SAMPLES

CHAPTER_START = OPEN_BARS * BAR
MORE_START = CHAPTER_START + CHAPTERS * CHAPTER_BARS * BAR
OUTRO_START = MORE_START + MORE_BARS * BAR


def bar_at(n):
    return n * BAR


def add(start, duration, voice, gain, pan=0.0, bus='music'):
    """Mixes voice(t) in from `start` seconds for `duration` seconds."""
    left, right = (drums_l, drums_r) if bus == 'drums' else (music_l, music_r)
    offset = round(start * RATE)
    count = min(round(duration * RATE), SAMPLES - offset)
    l_gain = gain * math.sqrt((1 - pan) / 2)
    r_gain = gain * math.sqrt((1 + pan) / 2)
    tail = RATE * 0.008
    for i in range(max(0, count)):
        t = i / RATE
        fade = min(1.0, (count - 1 - i) / tail)
        s = voice(t) * fade
        left[offset + i] += s * l_gain
        right[offset + i] += s * r_gain


def sidechain(start, depth=0.55, release=0.16):
    """Ducks the music bus from `start`, recovering over `release` seconds."""
    offset = round(start * RATE)
    count = min(round(release * 1.6 * RATE), SAMPLES - offset)
    for i in range(max(0, count)):
        t = i / RATE
        g = 1 - depth * math.exp(-t / (release / 3))
        if g < duck[offset + i]:
            duck[offset + i] = g


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def lp_coef(cutoff):
    return 1 - math.exp(-TAU * min(cutoff, RATE * 0.45) / RATE)


# --- drums -------------------------------------------------------------------

def kick(t):
    # A short, punchy DnB kick: a fast pitch drop and a click.
    phase = TAU * (50 * t + 130 * (1 - math.exp(-40 * t)) / 40)
    body = math.sin(phase) * math.exp(-11 * t)
    click = math.exp(-900 * t) * 0.6
    return (body + click) * (1 - math.exp(-2000 * t))


def noise(decay, attack=4000.0, color=0.0, hp=False):
    state = [0.0, 0.0]

    def voice(t):
        x = rng.uniform(-1, 1)
        if color > 0:  # one-pole low-pass
            state[0] += color * (x - state[0])
            x = state[0] * 2.0
        if hp:  # difference: a bright, thin noise
            x, state[1] = x - state[1], x
        return x * math.exp(-decay * t) * (1 - math.exp(-attack * t))
    return voice


def snare(t, state=[0.0]):
    tone = math.sin(TAU * 185 * t) * math.exp(-28 * t) + 0.5 * math.sin(TAU * 330 * t) * math.exp(-40 * t)
    x = rng.uniform(-1, 1)
    state[0] += 0.55 * (x - state[0])
    rattle = (x - state[0] * 0.6) * math.exp(-16 * t)
    return (tone * 0.7 + rattle * 0.9) * (1 - math.exp(-3000 * t))


hat = noise(90, hp=True)
open_hat = noise(16, hp=True)
shaker = noise(140, color=0.6, hp=True)
crash = noise(1.8, hp=True)
ride = noise(9, hp=True)


def boom(t):
    """A cinematic sub impact."""
    phase = TAU * (32 * t + 50 * (1 - math.exp(-9 * t)) / 9)
    return math.sin(phase) * math.exp(-1.4 * t) * (1 - math.exp(-600 * t))


def riser(length, top=1.0):
    state = [0.0]

    def voice(t):
        p = t / length
        state[0] += (0.01 + 0.6 * p * p) * (rng.uniform(-1, 1) - state[0])
        tone = math.sin(TAU * (90 * t + 520 * t * p * p)) * 0.22
        return (state[0] * 2.2 + tone) * p ** 2.4 * top
    return voice


def whoosh(length):
    state = [0.0]

    def voice(t):
        p = t / length
        state[0] += (0.04 + 0.5 * p) * (rng.uniform(-1, 1) - state[0])
        return state[0] * 2.6 * p ** 2.5
    return voice


def reverse_swell(length):
    state = [0.0]

    def voice(t):
        p = t / length
        x = rng.uniform(-1, 1)
        x, state[0] = x - state[0], x
        return x * p ** 4
    return voice


# --- tonal voices ------------------------------------------------------------

def saw(phase):
    return 2 * (phase - math.floor(phase)) - 1


def reese(freq, length, cutoff=520, wobble=0.0, wobble_rate=BPM / 60 / 2):
    """Two detuned saws through a two-pole low-pass, plus a sine sub."""
    s = [0.0, 0.0]

    def voice(t):
        env = min(1.0, t / 0.004) * min(1.0, (length - t) / 0.03)
        a = saw(freq * 0.993 * t) + saw(freq * 1.007 * t + 0.31)
        fc = cutoff * (1 + wobble * (0.5 - 0.5 * math.cos(TAU * wobble_rate * t)))
        k = lp_coef(fc)
        s[0] += k * (a - s[0])
        s[1] += k * (s[0] - s[1])
        sub = math.sin(TAU * freq * 0.5 * t)
        return env * (math.tanh(s[1] * 1.6) * 0.55 + sub * 0.75)
    return voice


def sub(freq, length):
    def voice(t):
        env = min(1.0, t / 0.006) * min(1.0, (length - t) / 0.04)
        return env * math.sin(TAU * freq * t)
    return voice


def stack(freqs, length, attack, release, cutoff_from, cutoff_to, detune=0.006):
    """Detuned saws per note, low-passed from one cutoff to another."""
    s = [0.0, 0.0]

    def voice(t):
        env = min(1.0, t / attack) * min(1.0, max(0.0, (length - t) / release))
        x = 0.0
        for k, f in enumerate(freqs):
            x += saw(f * (1 - detune) * t + k * 0.17) + saw(f * (1 + detune) * t + k * 0.41)
        x /= 2 * len(freqs)
        p = min(1.0, t / length)
        c = lp_coef(cutoff_from * (cutoff_to / cutoff_from) ** p)
        s[0] += c * (x - s[0])
        s[1] += c * (s[0] - s[1])
        return env * s[1]
    return voice


def stab(freqs, length=0.5):
    s = [0.0, 0.0]

    def voice(t):
        env = (1 - math.exp(-800 * t)) * math.exp(-7 * t)
        x = 0.0
        for k, f in enumerate(freqs):
            x += saw(f * 0.995 * t + k * 0.2) + saw(f * 1.005 * t + k * 0.5)
        x /= 2 * len(freqs)
        c = lp_coef(600 + 5200 * math.exp(-9 * t))
        s[0] += c * (x - s[0])
        s[1] += c * (s[0] - s[1])
        return env * s[1] * 1.6
    return voice


def pluck(freq):
    def voice(t):
        env = (1 - math.exp(-600 * t)) * math.exp(-11 * t)
        x = TAU * freq * t
        return env * (math.sin(x) + 0.45 * math.exp(-16 * t) * math.sin(2 * x) + 0.2 * math.exp(-24 * t) * math.sin(3 * x))
    return voice


def lead(freq, length):
    """A square-ish lead with vibrato that comes in late."""
    s = [0.0]

    def voice(t):
        env = min(1.0, t / 0.01) * min(1.0, max(0.0, (length - t) / 0.08))
        vib = 1 + 0.006 * math.sin(TAU * 5.5 * t) * min(1.0, t / 0.25)
        ph = freq * vib * t
        x = math.tanh(3 * math.sin(TAU * ph)) * 0.6 + saw(ph * 1.003) * 0.4
        s[0] += lp_coef(3600) * (x - s[0])
        return env * s[0]
    return voice


def bell(freq):
    def voice(t):
        env = (1 - math.exp(-200 * t)) * math.exp(-2.4 * t)
        return env * (math.sin(TAU * freq * t) + 0.3 * math.sin(TAU * freq * 2.76 * t) * math.exp(-4 * t)
                      + 0.12 * math.sin(TAU * freq * 5.4 * t) * math.exp(-7 * t))
    return voice


def tick(t):
    return math.sin(TAU * 2400 * t) * math.exp(-80 * t)


# --- harmony -----------------------------------------------------------------

# F minor: i - VI - iv - V, one chord a bar. The C major bar leans back into
# Fm on every chapter's downbeat.
CHORDS = [
    (29, [53, 56, 60, 65]),  # Fm   (F1 bass)
    (25, [53, 56, 61, 65]),  # Db   (Db1)
    (34, [53, 58, 61, 65]),  # Bbm  (Bb1)
    (24, [55, 60, 64, 67]),  # C    (C1)
]
# Drop B's lead, one phrase a bar: (beat, note, beats). It ends on B, the
# leading tone, so each phrase lands back on the next chapter's C.
MELODY = [
    [(0, 72, 1.5), (1.5, 75, 0.5), (2, 77, 1), (3, 80, 1)],
    [(0, 77, 1.5), (1.5, 80, 0.5), (2, 73, 1), (3, 72, 1)],
    [(0, 77, 1.5), (1.5, 73, 0.5), (2, 70, 1), (3, 72, 1)],
    [(0, 79, 1.5), (1.5, 76, 0.5), (2, 72, 1), (3, 71, 1)],
]


def drum_bar(start, gain=1.0, fill=False, ghost=True, lowcut=False):
    """One bar of two-step: kick on 1 and the and of 3, snare on 2 and 4."""
    k = 0.85 * gain
    for step in range(16):
        at = start + step * STEP
        if step in (0, 10):
            add(at, 0.35, kick, k, bus='drums')
            sidechain(at)
        if step in (4, 12) and not (fill and step == 12):
            add(at, 0.35, snare, 0.55 * gain * (0.5 if lowcut else 1), bus='drums')
        if ghost and step in (7, 15) and not fill:
            add(at, 0.12, snare, 0.10 * gain, -0.2, bus='drums')
        if step % 2 == 1:
            add(at, 0.05, hat, 0.12 * gain, 0.35, bus='drums')
        if step % 4 == 2:
            add(at, 0.18, open_hat, 0.07 * gain, -0.3, bus='drums')
        add(at, 0.03, shaker, 0.05 * gain * (1.4 if step % 2 else 0.8), 0.15, bus='drums')
    if fill:  # a snare run over the last beat
        for i in range(8):
            add(start + 3 * BEAT + i * STEP / 2, 0.12, snare, 0.18 * gain + 0.04 * i * gain, -0.3 + 0.08 * i, bus='drums')


# --- open --------------------------------------------------------------------

add(0, 3.2, boom, 1.0)
add(0, 2.2, crash, 0.12, 0.3, bus='drums')
add(0, 2 * BAR, stack([hz(29), hz(36), hz(41), hz(44)], 2 * BAR + 0.2, 0.25, 0.4, 140, 1300, 0.01), 0.42)
add(BAR, 2.0, boom, 0.6)
for beat in range(8):
    add(beat * BEAT, 0.06, tick, 0.10 if beat % 4 else 0.16, 0.5 if beat % 2 else -0.5, bus='drums')
add(BAR, BAR, reverse_swell(BAR), 0.10, bus='drums')

# Bars 2-3: drums enter low, a snare roll doubles up, the riser climbs.
for b in (2, 3):
    start = bar_at(b)
    for step in range(16):
        at = start + step * STEP
        if step in (0, 10):
            add(at, 0.35, kick, 0.6, bus='drums')
            sidechain(at, 0.4)
        add(at, 0.03, shaker, 0.04, 0.15, bus='drums')
    for i in range(8 if b == 2 else 16):
        span = BAR / (8 if b == 2 else 16)
        add(start + i * span, 0.12, snare, 0.08 + 0.10 * ((b - 2) * 16 + i) / 32, bus='drums')
    root, chord = CHORDS[b - 2]
    add(start, BAR, reese(hz(root + 12), BAR, cutoff=260 + 260 * (b - 2)), 0.30)
add(bar_at(2), 2 * BAR, riser(2 * BAR), 0.22)

# Bar 4: impact on the DELTA card, a half-time bar under it.
impact = bar_at(4)
add(impact, 3.2, boom, 1.0)
add(impact, 2.2, crash, 0.20, 0.25, bus='drums')
add(impact, 2.2, crash, 0.20, -0.25, bus='drums')
add(impact, 0.6, stab([hz(n) for n in (41, 53, 56, 60, 65)]), 0.42)
add(impact, 2 * BAR, stack([hz(n) for n in (41, 48, 53, 56, 60)], 2 * BAR, 0.02, 0.5, 2400, 500), 0.20)
add(impact, 0.35, kick, 0.9, bus='drums')
add(impact + 2 * BEAT, 0.35, snare, 0.6, bus='drums')
add(impact + 3.5 * BEAT, 0.35, kick, 0.7, bus='drums')

# Bar 5: a last roll, then the fourth beat is silence.
start = bar_at(5)
add(start, 0.35, kick, 0.8, bus='drums')
for i in range(12):
    add(start + i * BEAT / 4, 0.1, snare, 0.10 + 0.04 * i, -0.3 + 0.05 * i, bus='drums')
add(start, 3 * BEAT, riser(3 * BEAT, 1.2), 0.24)

# --- chapters ----------------------------------------------------------------

LIGHT = (6, 7)  # zero-based: the seventh and eighth chapters are the lighter pair
for chapter in range(CHAPTERS):
    base = CHAPTER_START + chapter * CHAPTER_BARS * BAR
    light = chapter in LIGHT
    drop_b = chapter >= 8
    add(base, 2.0, crash, 0.12 if light else 0.17, 0.3 if chapter % 2 else -0.3, bus='drums')
    if chapter in (0, 8):
        add(base, 3.0, boom, 0.8)
    for b in range(CHAPTER_BARS):
        start = base + b * BAR
        root, chord = CHORDS[b]
        last = b == CHAPTER_BARS - 1
        if light:
            drum_bar(start, gain=0.7, fill=last, ghost=False, lowcut=True)
            add(start, BAR, sub(hz(root + 12), BAR), 0.42)
            add(start, BAR, stack([hz(n) for n in chord], BAR + 0.05, 0.12, 0.3, 900, 1400, 0.008), 0.15)
            for i in range(16):  # a sixteenth arpeggio over the chord
                note = (chord + [n + 12 for n in chord])[(i * 3) % 8] + 12
                add(start + i * STEP, 0.3, pluck(hz(note)), 0.06, 0.45 if i % 2 else -0.45)
        else:
            drum_bar(start, gain=1.0, fill=last)
            # The reese rolls: a long note on 1, a push on the and of 3.
            wob = 0.9 if drop_b else 0.5
            add(start, 2.5 * BEAT, reese(hz(root + 12), 2.5 * BEAT, 420, wob), 0.36 if drop_b else 0.32)
            add(start + 2.5 * BEAT, 1.5 * BEAT, reese(hz(root + 12 + (12 if b == 3 else 0)), 1.5 * BEAT, 700, wob), 0.30)
            add(start, BAR, stack([hz(n) for n in chord], BAR + 0.05, 0.05, 0.3, 700, 1100, 0.008), 0.09)
            if drop_b:
                for at, note, beats in MELODY[b]:
                    add(start + at * BEAT, beats * BEAT, lead(hz(note), beats * BEAT), 0.05, 0.2)
        if b == 0:
            add(start, 0.6, stab([hz(n + 12) for n in chord]), 0.20 if not light else 0.12, -0.1)
    end = base + CHAPTER_BARS * BAR
    if chapter == 7:
        add(end - BAR, BAR, riser(BAR, 1.2), 0.22)
    elif chapter < CHAPTERS - 1:
        # The cut into the next chapter (8 frames) rides a short whoosh.
        add(end - 0.42, 0.42, whoosh(0.42), 0.16)

# --- MORE: one card a bar ----------------------------------------------------

MORE_ROOTS = [29, 25, 34, 24, 29, 25, 27, 24]
for b in range(MORE_BARS):
    start = MORE_START + b * BAR
    root = MORE_ROOTS[b]
    chord = [root + 24, root + 31, root + 36, root + 39 if b in (0, 4) else root + 40]
    if b in (2, 6):
        chord[3] = root + 39
    add(start, 0.7, stab([hz(n) for n in chord]), 0.30, 0.15 if b % 2 else -0.15)
    add(start, 1.2, crash, 0.10, -0.3 if b % 2 else 0.3, bus='drums')
    if b < 6:
        drum_bar(start, gain=1.0, fill=b % 2 == 1)
        add(start, 2.5 * BEAT, reese(hz(root + 12), 2.5 * BEAT, 520, 0.8), 0.33)
        add(start + 2.5 * BEAT, 1.5 * BEAT, reese(hz(root + 24), 1.5 * BEAT, 800, 0.8), 0.26)
    else:
        # Bars 6-7: the floor drops out under a snare build.
        for i in range(8 if b == 6 else 16):
            span = BAR / (8 if b == 6 else 16)
            add(start + i * span, 0.12, snare, 0.10 + 0.12 * ((b - 6) * 16 + i) / 32, bus='drums')
        add(start, BAR, sub(hz(root + 12), BAR), 0.35)
add(MORE_START + 6 * BAR, 2 * BAR, riser(2 * BAR, 1.2), 0.26)

# --- outro -------------------------------------------------------------------

add(OUTRO_START, 3.5, boom, 1.0)
add(OUTRO_START, 2.6, crash, 0.2, 0.25, bus='drums')
add(OUTRO_START, 2.6, crash, 0.2, -0.25, bus='drums')
add(OUTRO_START, 0.8, stab([hz(n) for n in (41, 53, 56, 60, 65)]), 0.40)
for b in range(2):  # half time: kick on 1, snare on 3
    start = OUTRO_START + b * BAR
    add(start, 0.35, kick, 0.85, bus='drums')
    sidechain(start)
    add(start + 2 * BEAT, 0.35, snare, 0.5, bus='drums')
    add(start + 3.5 * BEAT, 0.35, kick, 0.5, bus='drums')
    for step in range(8):
        add(start + step * BEAT / 2 + BEAT / 4, 0.05, hat, 0.08, 0.35, bus='drums')
    add(start, BAR, reese(hz(41), BAR, 380, 0.4), 0.26)
ring = OUTRO_START
add(ring, OUTRO_BARS * BAR, stack([hz(n) for n in (41, 48, 53, 56, 60, 65)], OUTRO_BARS * BAR, 0.05, 4.0, 1800, 600, 0.007), 0.20)
for i, note in enumerate([77, 80, 84, 89, 84, 80, 77, 72, 77, 84]):
    add(OUTRO_START + 2 * BAR + i * BEAT * (0.75 + i * 0.08), 2.8, bell(hz(note)), 0.07, -0.5 + i * 0.1)
add(OUTRO_START + 2 * BAR, 6.0, bell(hz(53)), 0.08)

# --- master: duck, sum, soft clip, normalize, fade the last half second -----

left = array('d', (d + m * g for d, m, g in zip(drums_l, music_l, duck)))
right = array('d', (d + m * g for d, m, g in zip(drums_r, music_r, duck)))
peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
gain = 1.3 / peak
pcm = array('h')
for i in range(SAMPLES):
    end = min(1.0, (SAMPLES - 1 - i) / (RATE * 0.5))
    for channel in (left, right):
        x = math.tanh(channel[i] * gain) * 0.89 * end
        pcm.append(round(x * 32767))

out = Path(__file__).with_name('score-0.7.0.wav')
with wave.open(str(out), 'wb') as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(RATE)
    f.writeframes(pcm.tobytes())
print(f'wrote {out} ({SECONDS:.1f} s)')
