"""Generate the original, deterministic 52-second score for film.tsx.

120 BPM, 26 bars, stereo. The arrangement follows the picture:
  bar 0      cold open: a warm pad and a rising bell per beat as the frames multiply
  bar 1      the title: a soft impact, a bright Fmaj9 pad, then a reverse swell
  bars 2-3   index: four-on-the-floor starts, a tick for every row
  bars 4-13  chapters 01-05: full groove (Am-F-C-G), a whoosh on every cut,
             plucks where the timeline clips drop
  bars 14-16 chapter 06: breakdown under the voice line
  bars 17-22 chapters 07-09: the groove returns, a bell chord when the export
             finishes, a snare roll and riser into the outro
  bars 23-25 outro: impact, pad, one bell per chapter number, fade

Run from any directory: python3 examples/feature-tour/make-score.py
Only Python's standard library is required. Writes score.wav next to this file.
"""

from array import array
import math
from pathlib import Path
import sys
import wave

RATE = 44_100
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 26
SECONDS = BAR * BARS
N = int(RATE * SECONDS)
TAU = 2 * math.pi
FPS = 30

left = [0.0] * N
right = [0.0] * N

# Picture cues, in seconds. Keep in sync with film.tsx.
INDEX_AT = BAR * 2
CHAPTER_AT = [BAR * b for b in (4, 6, 8, 10, 12, 14, 17, 19, 21)]
TIMELINE_AT = CHAPTER_AT[4]
EXPORT_DONE = CHAPTER_AT[7] + 95 / FPS
OUTRO_AT = BAR * 23


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def noise_source(seed: int):
    state = seed & 0xFFFFFFFF

    def next_value() -> float:
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return state / 0x7FFFFFFF - 1.0

    return next_value


def add(start: float, length: float, voice, pan: float = 0.0, gain: float = 1.0) -> None:
    """Mix voice(t) into both channels for `length` seconds from `start`.
    `pan` runs from -1 (left) to 1 (right), equal power."""
    angle = (pan + 1) * math.pi / 4
    gl = math.cos(angle) * gain * math.sqrt(2)
    gr = math.sin(angle) * gain * math.sqrt(2)
    i0 = max(0, int(start * RATE))
    i1 = min(N, int((start + length) * RATE))
    for i in range(i0, i1):
        v = voice((i - i0) / RATE)
        left[i] += v * gl
        right[i] += v * gr


# ── Voices ──────────────────────────────────────────────────────────────────


def kick(gain: float = 0.9):
    def v(t: float) -> float:
        phase = TAU * (48 * t + (110 / 28) * (1 - math.exp(-28 * t)))
        click = math.exp(-t * 400) * 0.3
        return (math.sin(phase) * math.exp(-t * 6.5) + click) * gain
    return v


def impact(seed: int):
    rnd = noise_source(seed)
    lp = [0.0]

    def v(t: float) -> float:
        phase = TAU * (34 * t + (150 / 11) * (1 - math.exp(-11 * t)))
        sub = math.sin(phase) * math.exp(-t * 1.4) * 0.95
        lp[0] += (rnd() - lp[0]) * 0.22
        crash = lp[0] * math.exp(-t * 2.0) * 0.4
        return sub + crash
    return v


def hat(gain: float, decay: float, seed: int):
    rnd = noise_source(seed)
    prev = [0.0]

    def v(t: float) -> float:
        n = rnd()
        high = n - prev[0]
        prev[0] = n
        return high * math.exp(-t * decay) * gain
    return v


def clap(gain: float, seed: int):
    rnd = noise_source(seed)
    lp = [0.0]

    def v(t: float) -> float:
        env = 0.0
        for k in range(3):
            dt = t - k * 0.012
            if dt >= 0:
                env = max(env, math.exp(-dt * 85))
        env = max(env, 0.5 * math.exp(-t * 14))
        lp[0] += (rnd() - lp[0]) * 0.4
        return (rnd() - lp[0]) * env * gain
    return v


def snare(gain: float, seed: int):
    rnd = noise_source(seed)

    def v(t: float) -> float:
        body = math.sin(TAU * 190 * t) * math.exp(-t * 30) * 0.5
        return (body + rnd() * math.exp(-t * 22) * 0.7) * gain
    return v


def bass(freq: float, length: float, gain: float = 0.34):
    lp = [0.0]

    def v(t: float) -> float:
        env = min(1.0, t * 300) * min(1.0, max(0.0, (length - t) * 60))
        saw = 2 * ((freq * t) % 1.0) - 1
        lp[0] += (saw - lp[0]) * 0.08
        return (lp[0] * 0.8 + 0.6 * math.sin(TAU * freq * t)) * env * gain
    return v


def pluck(freq: float, gain: float):
    def v(t: float) -> float:
        env = min(1.0, t * 900) * math.exp(-t * 13)
        s = 0.0
        for h, a in ((1, 1.0), (2, 0.35), (3, 0.2), (4, 0.08)):
            s += a * math.sin(TAU * freq * h * t) * math.exp(-t * 4 * h)
        return s * env * gain
    return v


def bell(freq: float, gain: float, decay: float = 2.4):
    """A small FM bell, close to the sound of a celesta."""
    def v(t: float) -> float:
        index = 2.2 * math.exp(-t * 5)
        mod = math.sin(TAU * freq * 3.5 * t) * index
        env = min(1.0, t * 1200) * math.exp(-t * decay)
        return math.sin(TAU * freq * t + mod) * env * gain
    return v


def pad(freqs, length: float, gain: float, attack: float, release: float, cutoff_from: float, cutoff_to: float):
    lp = [0.0, 0.0]

    def v(t: float) -> float:
        env = min(1.0, t / attack, max(0.0, (length - t) / release))
        saw = 0.0
        for f in freqs:
            for detune in (0.996, 1.004):
                saw += 2 * ((f * detune * t) % 1.0) - 1
        cutoff = cutoff_from + (cutoff_to - cutoff_from) * min(1.0, t / length)
        a = 1 - math.exp(-TAU * cutoff / RATE)
        lp[0] += (saw - lp[0]) * a
        lp[1] += (lp[0] - lp[1]) * a
        return lp[1] * env * gain / len(freqs)
    return v


def whoosh(length: float, peak: float, gain: float, seed: int, rising: bool = True):
    """Band-limited noise that swells toward `peak` seconds, then falls away."""
    rnd = noise_source(seed)
    lp = [0.0, 0.0]

    def v(t: float) -> float:
        if t < peak:
            env = (t / peak) ** 2.5
        else:
            env = math.exp(-(t - peak) * 9)
        sweep = t / length if rising else 1 - t / length
        a = 0.02 + 0.3 * sweep
        lp[0] += (rnd() - lp[0]) * a
        lp[1] += (lp[0] - lp[1]) * a
        return (lp[0] - lp[1] * 0.5) * env * gain
    return v


def tick(freq: float, gain: float):
    def v(t: float) -> float:
        return math.sin(TAU * freq * t) * math.exp(-t * 90) * gain
    return v


# ── Harmony ─────────────────────────────────────────────────────────────────

# A minor: Am - F - C - G, one chord per bar.
CHORDS = [
    (45, [57, 60, 64, 67]),  # Am7
    (41, [53, 57, 60, 64]),  # Fmaj7
    (48, [55, 60, 64, 67]),  # C
    (43, [55, 59, 62, 67]),  # G
]


def chord_at(bar: int):
    return CHORDS[bar % 4]


# ── Arrangement ─────────────────────────────────────────────────────────────


def groove(bar: int, energy: float) -> None:
    t0 = bar * BAR
    root, notes = chord_at(bar)
    for b in range(4):
        add(t0 + b * BEAT, 0.5, kick(0.95))
        add(t0 + b * BEAT + BEAT / 2, 0.12, hat(0.16, 30, bar * 8 + b), pan=0.35)
        # Bass on the offbeats, pumping under the kick.
        add(t0 + b * BEAT + BEAT / 2, BEAT / 2 - 0.02, bass(hz(root), BEAT / 2 - 0.02))
    for b in (1, 3):
        add(t0 + b * BEAT, 0.35, clap(0.34, bar * 4 + b), pan=-0.05)
    for s in range(16):
        if s % 2 == 1:
            add(t0 + s * BEAT / 4, 0.05, hat(0.07 * energy, 70, bar * 32 + s), pan=-0.4 if s % 4 == 1 else 0.4)
    # Arpeggio: chord tones in sixteenths, up an octave when energy is high.
    pattern = [0, 1, 2, 3, 2, 1, 3, 0]
    for s in range(16):
        note = notes[pattern[s % 8]] + (12 if energy > 1 and s % 8 >= 4 else 0)
        pan = -0.5 + (s % 8) / 7
        add(t0 + s * BEAT / 4, 0.35, pluck(hz(note + 12), 0.075), pan=pan)


def main() -> None:
    # Bar 0: the frames multiply. A warm Fmaj7 pad, a rising C major bell per
    # beat, a soft shaker on the eighths.
    add(0, BAR, pad([hz(53), hz(57), hz(60), hz(64)], BAR, 0.26, 0.25, 0.2, 700, 2200))
    for b in range(4):
        note = [72, 76, 79, 84][b]
        add(b * BEAT, 1.4, bell(hz(note), 0.2, 2.8), pan=[-0.3, 0.3, -0.15, 0.15][b])
        add(b * BEAT + 0.125, 1.0, bell(hz(note + 7), 0.07, 3.2), pan=[0.3, -0.3, 0.15, -0.15][b])
    for e in range(8):
        add(e * BEAT / 2, 0.08, hat(0.05 if e % 2 else 0.03, 45, 300 + e), pan=0.4 if e % 2 else -0.4)
    add(BAR - 0.8, 0.85, whoosh(0.85, 0.8, 0.35, 11))

    # Bar 1: the title.
    add(BAR, 3.0, impact(21), gain=0.7)
    add(BAR, BAR, pad([hz(53), hz(60), hz(64), hz(67), hz(69)], BAR, 0.3, 0.05, 0.6, 2800, 900))
    add(BAR + BEAT, 2.0, bell(hz(76), 0.16, 1.8), pan=0.3)
    add(BAR + BEAT * 2, 2.0, bell(hz(79), 0.14, 1.8), pan=-0.3)
    add(INDEX_AT - 0.9, 0.95, whoosh(0.95, 0.9, 0.45, 12))

    # Bars 2-3: the index.
    for bar in (2, 3):
        t0 = bar * BAR
        for b in range(4):
            add(t0 + b * BEAT, 0.5, kick(0.8))
            add(t0 + b * BEAT + BEAT / 2, 0.1, hat(0.12, 34, bar * 4 + b), pan=0.3)
        if bar == 3:
            root, _ = chord_at(bar)
            for b in range(4):
                add(t0 + b * BEAT + BEAT / 2, BEAT / 2 - 0.02, bass(hz(root), BEAT / 2 - 0.02, 0.26))
    for i in range(9):  # one tick per row as it slides in
        add(INDEX_AT + (6 + i * 4) / FPS, 0.08, tick(1500 + i * 120, 0.16), pan=-0.6 + i * 0.15)
    for i in range(9):  # the highlight scanning down
        add(INDEX_AT + (60 + i * 4) / FPS, 0.06, tick(3000, 0.06), pan=0.5)
    add(INDEX_AT + 100 / FPS, 1.1, whoosh(1.1, 0.53, 0.5, 13))

    # Bars 4-13: chapters 01-05.
    add(CHAPTER_AT[0], 2.5, impact(22), gain=0.5)
    for bar in range(4, 14):
        groove(bar, 0.8 if bar < 6 else 1.0)
    # Clips dropping onto the timeline.
    for i in range(4):
        for k in range(2):
            at = TIMELINE_AT + (10 + i * 15 + k * 5) / FPS
            add(at, 0.6, bell(hz([72, 76, 79, 84][i] + k * 12), 0.08, 5), pan=-0.4 + i * 0.25)

    # Bars 14-16: chapter 06, the voice. Pad, soft hats, sub on downbeats.
    for bar in range(14, 17):
        t0 = bar * BAR
        root, notes = chord_at(bar)
        add(t0, BAR, pad([hz(n) for n in notes], BAR, 0.34, 0.3, 0.4, 900, 1500))
        add(t0, BAR, bass(hz(root - 12), BAR - 0.05, 0.3))
        for s in range(8):
            add(t0 + s * BEAT / 2 + BEAT / 4, 0.06, hat(0.05, 60, bar * 8 + s), pan=0.4 if s % 2 else -0.4)
    add(CHAPTER_AT[6] - 1.6, 1.65, whoosh(1.65, 1.6, 0.55, 14))

    # Bars 17-22: chapters 07-09, then the build.
    add(CHAPTER_AT[6], 2.5, impact(23), gain=0.7)
    for bar in range(17, 22):
        groove(bar, 1.2)
    add(EXPORT_DONE, 3.0, bell(hz(81), 0.2, 1.6), pan=-0.2)
    add(EXPORT_DONE, 3.0, bell(hz(88), 0.14, 1.6), pan=0.2)
    add(EXPORT_DONE + 0.12, 3.0, bell(hz(93), 0.1, 1.6), pan=0.0)
    bar = 22
    t0 = bar * BAR
    root, notes = chord_at(bar)
    for b in range(3):
        add(t0 + b * BEAT, 0.5, kick(0.9))
    hits = [0, 0.25, 0.5, 0.75, 1.0, 1.125, 1.25, 1.375, 1.5, 1.5625, 1.625, 1.6875, 1.75, 1.8125, 1.875, 1.9375]
    for k, h in enumerate(hits):
        add(t0 + h, 0.2, snare(0.12 + 0.2 * k / len(hits), 40 + k), pan=0.2 if k % 2 else -0.2)
    add(t0, BAR, pad([hz(n) for n in notes], BAR, 0.2, 1.5, 0.05, 300, 3000))
    add(t0, BAR, whoosh(BAR, BAR - 0.02, 0.6, 15))

    # Bars 23-25: the outro.
    add(OUTRO_AT, 4.0, impact(24), gain=1.0)
    add(OUTRO_AT, BAR * 3, pad([hz(45), hz(57), hz(64), hz(67), hz(71)], BAR * 3, 0.4, 0.05, 2.5, 2600, 500))
    add(OUTRO_AT, BAR * 3, bass(hz(33), BAR * 3 - 0.1, 0.28))
    scale = [69, 72, 74, 76, 79, 81, 84, 86, 88]  # A minor pentatonic, rising
    for i, note in enumerate(scale):  # one per chapter number as it lights up
        add(OUTRO_AT + (44 + i * 6) / FPS, 2.5, bell(hz(note), 0.13, 2.2), pan=-0.6 + i * 0.15)
    add(OUTRO_AT + BAR * 1.5, 4.0, bell(hz(57), 0.18, 1.0), pan=0.0)
    add(OUTRO_AT + BAR * 1.5, 4.0, bell(hz(64), 0.12, 1.0), pan=0.0)

    # Master: gentle tanh limiting, a fade on the last half second, 16-bit.
    peak = max(max(abs(x) for x in left), max(abs(x) for x in right)) or 1.0
    drive = 1.6 / peak
    fade = int(RATE * 0.5)
    out = array('h')
    for i in range(N):
        g = min(1.0, (N - i) / fade)
        out.append(int(math.tanh(left[i] * drive) * 0.89 * g * 32767))
        out.append(int(math.tanh(right[i] * drive) * 0.89 * g * 32767))
    if sys.byteorder == 'big':
        out.byteswap()

    path = Path(__file__).resolve().parent / 'score.wav'
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(out.tobytes())
    print(f'wrote {path} ({SECONDS:.0f} s)')


if __name__ == '__main__':
    main()
