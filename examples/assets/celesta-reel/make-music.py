"""Generate the original, deterministic 32-second score for celesta-reel.tsx.

120 BPM, 16 bars. The arrangement follows the picture cut for cut:
  bar 0      cold open: pad, clock ticks, a key click per typed character, riser
  bars 1-2   one kick per word
  bars 3-11  groove: kick, clap, offbeat hats, sub bass, arpeggio;
             bell blips where the code scene saves and reloads
  bars 12-13 build: snare roll and riser, then a beat of silence
  bars 14-15 impact, then a celesta-like bell motif under the logo

Run from any directory: python3 examples/assets/celesta-reel/make-music.py
Only Python's standard library is required.
"""

from array import array
import math
from pathlib import Path
import sys
import wave

RATE = 48_000
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
SECONDS = 32
N = RATE * SECONDS
TAU = 2 * math.pi

buf = [0.0] * N


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def noise_source(seed: int):
    state = seed & 0xFFFFFFFF

    def next_value() -> float:
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return state / 0x7FFFFFFF - 1.0

    return next_value


def add(start: float, length: float, voice) -> None:
    """Mix voice(t) into the buffer for `length` seconds from `start`."""
    i0 = max(0, int(start * RATE))
    i1 = min(N, int((start + length) * RATE))
    for i in range(i0, i1):
        buf[i] += voice((i - i0) / RATE)


def kick(gain: float = 0.9):
    def v(t: float) -> float:
        # Pitch drops from ~150 Hz to ~45 Hz; phase is the integral of that.
        phase = TAU * (45 * t + (105 / 30) * (1 - math.exp(-30 * t)))
        return math.sin(phase) * math.exp(-t * 7) * gain
    return v


def impact():
    rnd = noise_source(99)
    lp = [0.0]

    def v(t: float) -> float:
        phase = TAU * (32 * t + (140 / 12) * (1 - math.exp(-12 * t)))
        sub = math.sin(phase) * math.exp(-t * 1.6) * 0.95
        lp[0] += (rnd() - lp[0]) * 0.18
        crash = lp[0] * math.exp(-t * 2.2) * 0.35
        return sub + crash
    return v


def hat(gain: float, decay: float, seed: int):
    rnd = noise_source(seed)
    prev = [0.0]

    def v(t: float) -> float:
        n = rnd()
        high = n - prev[0]  # first difference: a cheap high-pass
        prev[0] = n
        return high * math.exp(-t * decay) * gain
    return v


def clap(gain: float, seed: int):
    rnd = noise_source(seed)
    lp = [0.0]

    def v(t: float) -> float:
        # Three quick bursts, then a tail, like hands slightly out of sync.
        env = 0.0
        for k in range(3):
            dt = t - k * 0.011
            if dt >= 0:
                env = max(env, math.exp(-dt * 90))
        env = max(env, 0.55 * math.exp(-t * 16))
        lp[0] += (rnd() - lp[0]) * 0.45
        return (rnd() - lp[0]) * env * gain
    return v


def bass(freq: float, gain: float = 0.32):
    def v(t: float) -> float:
        env = min(1.0, t * 400) * math.exp(-t * 5.5)
        tone = math.sin(TAU * freq * t) + 0.25 * math.sin(TAU * freq * 2 * t)
        return tone * env * gain
    return v


def pluck(freq: float, gain: float):
    def v(t: float) -> float:
        env = min(1.0, t * 800) * math.exp(-t * 11)
        # A slightly detuned square-ish pair, softened with odd harmonics only.
        s = 0.0
        for h, a in ((1, 1.0), (3, 0.28), (5, 0.12)):
            s += a * math.sin(TAU * freq * h * t)
            s += a * math.sin(TAU * freq * 1.004 * h * t)
        return s * 0.5 * env * gain
    return v


def bell(freq: float, gain: float):
    """A small FM bell, close to the sound of a celesta."""
    def v(t: float) -> float:
        index = 2.4 * math.exp(-t * 6)
        mod = math.sin(TAU * freq * 3.5 * t) * index
        env = min(1.0, t * 1200) * math.exp(-t * 2.6)
        return math.sin(TAU * freq * t + mod) * env * gain
    return v


def pad(freqs, length: float, gain: float, attack: float, release: float, cutoff_from: float, cutoff_to: float):
    lp = [0.0]

    def v(t: float) -> float:
        env = min(1.0, t / attack, max(0.0, (length - t) / release))
        saw = 0.0
        for f in freqs:
            for detune in (0.997, 1.003):
                p = (f * detune * t) % 1.0
                saw += 2 * p - 1
        cutoff = cutoff_from + (cutoff_to - cutoff_from) * min(1.0, t / length)
        a = 1 - math.exp(-TAU * cutoff / RATE)
        lp[0] += (saw - lp[0]) * a
        return lp[0] * env * gain
    return v


def riser(length: float, gain: float, seed: int):
    rnd = noise_source(seed)
    state = [0.0, 0.0]

    def v(t: float) -> float:
        x = t / length
        cutoff = 300 + 9000 * x * x
        a = 1 - math.exp(-TAU * cutoff / RATE)
        n = rnd()
        state[0] += (n - state[0]) * a
        state[1] += (state[0] - state[1]) * a
        tone = math.sin(TAU * (200 + 1200 * x * x) * t) * 0.3
        return (state[0] - state[1] * 0.5 + tone) * x * x * gain
    return v


# D minor: Dm9 -> Bbmaj7 -> Gm9 -> A7sus
CHORDS = [
    (50, [62, 65, 69, 72, 76]),
    (46, [58, 62, 65, 69, 74]),
    (43, [55, 58, 62, 65, 69]),
    (45, [57, 62, 64, 67, 72]),
]


def at(bar: int, beat: float = 0.0) -> float:
    return bar * BAR + beat * BEAT


FPS = 30
# Mirrors celesta-reel.tsx: the cold open types one chunk per beat, one
# character per frame.
TYPED_CHUNKS = ['video', ' = f(', 'frame)']
# Seconds where the code scene saves, then edits twice (each hot-reloads).
RELOADS = [15.0, 17.0, 18.0]


def click(seed: int):
    rnd = noise_source(seed)
    prev = [0.0]

    def v(t: float) -> float:
        n = rnd()
        high = n - prev[0]
        prev[0] = n
        body = math.sin(TAU * 1900 * t) * 0.4
        return (high + body) * math.exp(-t * 260) * 0.16
    return v


def build() -> None:
    # Cold open: a pad opening up, clock ticks, key clicks, a riser.
    add(at(0), BAR, pad([hz(n) for n in CHORDS[0][1][:4]], BAR, 0.05, 0.12, 0.2, 400, 2600))
    for k in range(8):
        add(at(0, k / 2), 0.05, hat(0.10 if k % 2 == 0 else 0.05, 120, 7 + k))
    for chunk, text in enumerate(TYPED_CHUNKS):
        for j in range(len(text)):
            add((chunk * 15 + j) / FPS, 0.03, click(40 + chunk * 8 + j))
    add(at(0, 1), BEAT * 3, riser(BEAT * 3, 0.22, 3))

    # Drop: one kick per word, sub notes following the chords.
    for bar in range(1, 3):
        root = CHORDS[bar % 4][0]
        for beat in range(4):
            add(at(bar, beat), 0.5, kick(1.0))
            add(at(bar, beat), 0.45, bass(hz(root), 0.26))
        add(at(bar), BAR, pad([hz(n) for n in CHORDS[bar % 4][1][:4]], BAR, 0.022, 0.02, 0.4, 1400, 2400))

    # Groove.
    for bar in range(3, 12):
        root, chord = CHORDS[bar % 4]
        for beat in range(4):
            add(at(bar, beat), 0.5, kick(0.95))
            add(at(bar, beat + 0.5), 0.08, hat(0.20, 70, bar * 8 + beat))
            for sixteenth in (0.25, 0.75):
                add(at(bar, beat + sixteenth), 0.04, hat(0.07, 140, bar * 16 + beat))
            if beat in (1, 3):
                add(at(bar, beat), 0.3, clap(0.30, bar * 4 + beat))
            # Off-beat sub bass on the "and".
            add(at(bar, beat + 0.5), 0.24, bass(hz(root), 0.30))
        # Sixteenth-note arpeggio, brighter from bar 6 on.
        order = [0, 2, 1, 3, 2, 4, 3, 1]
        for step in range(16):
            note = chord[order[step % 8]] + (12 if bar >= 6 and step % 4 == 3 else 0)
            add(at(bar, step / 4), 0.22, pluck(hz(note), 0.045 if bar < 6 else 0.055))
        add(at(bar), BAR, pad([hz(n) for n in chord[:4]], BAR, 0.016, 0.3, 0.4, 900, 1500))
        # A short lead phrase under the timeline.
        if bar >= 10:
            lead = {10: [(0, 74), (1.5, 76), (3, 79)], 11: [(0, 81), (2, 76)]}[bar]
            for beat, note in lead:
                add(at(bar, beat), 1.2, bell(hz(note), 0.06))
    for k, when in enumerate(RELOADS):
        add(when, 1.0, bell(hz(93 + (k % 2) * 2), 0.07))
        add(when + BEAT / 2, 0.8, bell(hz(98), 0.035))

    # Build: kick continues, snare roll accelerates, riser, silence on the last beat.
    for bar in range(12, 14):
        root, chord = CHORDS[bar % 4]
        for beat in range(4):
            if bar == 13 and beat == 3:
                continue
            add(at(bar, beat), 0.5, kick(0.9))
            add(at(bar, beat + 0.5), 0.2, bass(hz(root), 0.26))
        add(at(bar), BAR, pad([hz(n) for n in chord[:4]], BAR, 0.02, 0.3, 0.3, 900, 4000))
    roll = []
    t = at(12)
    step = BEAT / 2
    while t < at(13, 3):
        roll.append(t)
        if t >= at(12, 2):
            step = BEAT / 4
        if t >= at(13):
            step = BEAT / 8
        t += step
    for k, when in enumerate(roll):
        add(when, 0.15, clap(0.10 + 0.22 * k / len(roll), 500 + k))
    add(at(12), at(13, 3) - at(12), riser(at(13, 3) - at(12), 0.26, 11))

    # Impact and the logo.
    add(at(14), 4.0, impact())
    add(at(14), at(16) - at(14), pad([hz(n) for n in (50, 57, 62, 65, 69, 76)], at(16) - at(14), 0.03, 0.05, 1.6, 2600, 700))
    motif = [(0.0, 86), (0.5, 81), (1.0, 88), (1.5, 84), (2.0, 89), (3.0, 86),
             (4.0, 81), (4.5, 84), (5.0, 86)]
    for beat, note in motif:
        add(at(14, beat), 2.5, bell(hz(note), 0.075))
        add(at(14, beat + 0.75), 2.0, bell(hz(note), 0.025))  # echo


def main() -> None:
    build()
    peak = max(abs(v) for v in buf) or 1.0
    gain = 0.89 / peak
    fade_out = int(0.8 * RATE)
    output = Path(__file__).with_name('music.wav')
    with wave.open(str(output), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        values = array('h')
        for i, v in enumerate(buf):
            v *= gain
            if i > N - fade_out:
                v *= (N - i) / fade_out
            # Soft clip for glue.
            v = math.tanh(v * 1.2) / math.tanh(1.2)
            values.append(round(32767 * max(-1.0, min(1.0, v))))
        if sys.byteorder != 'little':
            values.byteswap()
        wav.writeframes(values.tobytes())
    print(output)


if __name__ == '__main__':
    main()
