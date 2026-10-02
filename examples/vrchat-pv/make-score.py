"""Original score for "OKAERI" — 68 s, 120 BPM, D major, 48 kHz stereo.

Deterministic: numpy + scipy only, fixed seed. Writes assets/score.wav.
One bar = 2 s = 60 frames at 30 fps. Sections follow the film's cut:

  bars  0-3   cold open: muffled pad, train clatter, headphone melody
  bars  4-5   log in: riser, snare roll, filter opens
  bars  6-13  drop: four-on-the-floor, side-chained supersaw, arp, lead
  bars 14-18  avatars: groove, plucks
  bars 19-23  worlds: groove + arp, camera shutters
  bars 24-27  friends: breakdown, piano and pad
  bars 28-29  flicker: full drop again
  bars 30-31  pier: pad and melody, everyone logs off
  bars 32-33  logo: last chord rings out
"""
import pathlib, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 34
N = int(BARS * BAR * SR)
rng = np.random.default_rng(20261002)
OUT = pathlib.Path(__file__).parent / 'assets' / 'score.wav'

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def at(beat): return int(round(beat * BEAT * SR))
def secs(n): return np.arange(n) / SR

def lp(x, f, order=2): return sosfilt(butter(order, min(f, SR / 2 - 100), 'low', fs=SR, output='sos'), x)
def hp(x, f, order=2): return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)

def saw(freq, n, phase=0.0):
    """Band-limited (polyBLEP) sawtooth."""
    dt = freq / SR
    t = (phase + dt * np.arange(n)) % 1.0
    y = 2 * t - 1
    m = t < dt
    u = t[m] / dt; y[m] -= u + u - u * u - 1
    m = t > 1 - dt
    u = (t[m] - 1) / dt; y[m] -= u * u + u + u + 1
    return y

def env(n, a=0.005, d=0.1, s=0.0, r=0.05):
    t = secs(n)
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = int(r * SR)
    if rel and n > rel:
        e[-rel:] *= np.linspace(1, 0, rel)
    return e

class Bus:
    def __init__(self): self.l = np.zeros(N); self.r = np.zeros(N)
    def add(self, x, start, pan=0.0, gain=1.0):
        if start >= N: return
        x = x[: N - start] * gain
        self.l[start:start + len(x)] += x * np.cos((pan + 1) * np.pi / 4)
        self.r[start:start + len(x)] += x * np.sin((pan + 1) * np.pi / 4)
    def arr(self): return np.stack([self.l, self.r])

# Royal road (王道進行) in D: IV - V - iii - vi, one bar each.
CHORDS = [
    [55, 59, 62, 66],  # Gmaj7
    [57, 61, 64, 67],  # A7
    [54, 57, 61, 64],  # F#m7
    [59, 62, 66, 69],  # Bm7
]
ROOTS = [43, 45, 42, 47]
# beat, length (beats), midi — one four-bar phrase
MELODY = [
    (0, 1.5, 78), (1.5, 0.5, 76), (2, 1, 74), (3, 1, 81),
    (4, 1.5, 79), (5.5, 0.5, 78), (6, 1, 76), (7, 1, 73),
    (8, 1.5, 76), (9.5, 0.5, 78), (10, 1, 81), (11, 1, 85),
    (12, 2, 86), (14, 1, 85), (15, 1, 81),
]

pad, keys, bass, saws, arp, lead, drums, fx = (Bus() for _ in range(8))
duck = np.ones(N)  # side-chain envelope, filled where the kick plays

# ---------------------------------------------------------------- instruments
def pad_chord(bar, bars=1, gain=0.10, cutoff=1800, chord=None):
    n = at(4 * bars) + int(0.6 * SR)
    for k, note in enumerate(CHORDS[bar % 4 if chord is None else chord]):
        voice = sum(saw(midi(note) * (1 + d), n, rng.random()) for d in (-0.006, 0.0, 0.0065))
        voice = lp(voice, cutoff) * env(n, a=0.35, d=99, s=1, r=0.6)
        pad.add(voice, at(bar * 4), pan=(k - 1.5) * 0.35, gain=gain)

def supersaw(bar, gain=0.055):
    n = at(4) + int(0.15 * SR)
    for k, note in enumerate(CHORDS[bar % 4] + [CHORDS[bar % 4][0] + 12]):
        for v, d in enumerate(np.linspace(-0.012, 0.012, 7)):
            x = lp(saw(midi(note) * (1 + d), n, rng.random()), 5200) * env(n, a=0.01, d=99, s=1, r=0.12)
            saws.add(x, at(bar * 4), pan=(v - 3) / 3 * 0.8, gain=gain / 3)

def pluck(note, start_beat, length=0.5, gain=0.12, cutoff=3800, pan=0.0, bus=None):
    n = at(length) + int(0.35 * SR)
    f = midi(note)
    x = saw(f, n) * 0.6 + np.sin(2 * np.pi * f * secs(n)) * 0.6
    x = lp(x, cutoff) * env(n, a=0.002, d=0.18, s=0.0, r=0.05)
    (bus or keys).add(x, at(start_beat), pan=pan, gain=gain)

def piano(note, start_beat, length=1.0, gain=0.16, pan=0.0):
    n = at(length) + int(1.2 * SR)
    f = midi(note); t = secs(n)
    x = sum(np.sin(2 * np.pi * f * h * t * (1 + 0.0004 * h * h)) * np.exp(-t * (1.6 + h * 0.9)) / h
            for h in range(1, 7))
    x *= env(n, a=0.003, d=99, s=1, r=0.2)
    keys.add(x, at(start_beat), pan=pan, gain=gain)

def lead_note(note, start_beat, length, gain=0.07, cutoff=6000):
    n = at(length) + int(0.1 * SR)
    t = secs(n)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t - 0.15, 0, 1)
    f = midi(note)
    ph = np.cumsum(f * vib) / SR
    x = (2 * (ph % 1) - 1) * 0.5 + np.sign(np.sin(2 * np.pi * ph)) * 0.25
    x = lp(x, cutoff) * env(n, a=0.01, d=0.5, s=0.7, r=0.08)
    lead.add(x, at(start_beat), gain=gain)

def bass_note(note, start_beat, length, gain=0.32):
    n = at(length)
    f = midi(note)
    t = secs(n)
    x = np.sin(2 * np.pi * f * t) + 0.35 * lp(saw(f, n), 900)
    x *= env(n, a=0.004, d=0.6, s=0.75, r=0.03)
    bass.add(x, at(start_beat), gain=gain)

def kick(beat, gain=0.9):
    n = int(0.45 * SR); t = secs(n)
    f = 45 + 110 * np.exp(-t / 0.035)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    x += 0.3 * np.exp(-t / 0.004) * rng.standard_normal(n) * 0.3
    drums.add(np.tanh(x * 1.6), at(beat), gain=gain)
    s = at(beat); m = min(N - s, int(0.4 * SR))
    duck[s:s + m] = np.minimum(duck[s:s + m], 1 - 0.75 * np.exp(-secs(m) / 0.09))

def clap(beat, gain=0.32):
    n = int(0.3 * SR); t = secs(n)
    noise = bp(rng.standard_normal(n), 900, 5000)
    e = sum(np.exp(-np.clip(t - d, 0, None) / 0.008) * (t >= d) for d in (0, 0.011, 0.022))
    x = noise * (e * 0.6 + np.exp(-t / 0.09) * 0.5)
    drums.add(x, at(beat), gain=gain, pan=0.05)

def hat(beat, gain=0.07, open_=False, pan=0.25):
    n = int((0.25 if open_ else 0.06) * SR); t = secs(n)
    x = hp(rng.standard_normal(n), 7500) * np.exp(-t / (0.08 if open_ else 0.015))
    drums.add(x, at(beat), gain=gain, pan=pan)

def snare(beat, gain=0.18):
    n = int(0.18 * SR); t = secs(n)
    x = bp(rng.standard_normal(n), 1200, 7000) * np.exp(-t / 0.05)
    x += np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.04) * 0.6
    drums.add(x, at(beat), gain=gain)

def clack(beat, gain=0.10):
    """Rail joint: a dull double knock."""
    for off, g in ((0, 1.0), (0.11, 0.8)):
        n = int(0.12 * SR); t = secs(n)
        x = lp(rng.standard_normal(n), 700) * np.exp(-t / 0.02) * 3
        x += np.sin(2 * np.pi * 95 * t) * np.exp(-t / 0.03)
        fx.add(x, at(beat) + int(off * SR), gain=gain * g, pan=-0.2)

def shutter(beat, gain=0.22):
    """Camera shutter: two clicks and a breath of noise."""
    for off, g in ((0, 1.0), (0.07, 0.7)):
        n = int(0.05 * SR); t = secs(n)
        x = hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.006)
        fx.add(x, at(beat) + int(off * SR), gain=gain * g, pan=0.3)

def riser(start_beat, beats, gain=0.18):
    n = at(beats); t = secs(n); p = t / t[-1]
    noise = rng.standard_normal(n)
    # sweep a band-pass upward by processing in short blocks
    out = np.zeros(n); blk = 2400
    for i in range(0, n, blk):
        c = 300 * (40 ** p[i])
        out[i:i + blk] = bp(noise[i:i + blk + 0], c * 0.7, min(c * 1.4, 20000))[: len(out[i:i + blk])]
    tone = np.sin(2 * np.pi * np.cumsum(200 + 1400 * p ** 2) / SR) * 0.25
    fx.add((out + tone) * p ** 1.6, at(start_beat), gain=gain)

def impact(beat, gain=0.5):
    n = int(2.5 * SR); t = secs(n)
    x = np.sin(2 * np.pi * np.cumsum(30 + 60 * np.exp(-t / 0.1)) / SR) * np.exp(-t / 0.7)
    x += lp(rng.standard_normal(n), 2500) * np.exp(-t / 0.35) * 0.4
    fx.add(x, at(beat), gain=gain)

def reverse_swell(end_beat, beats=2, gain=0.12):
    n = at(beats); t = secs(n)
    x = sum(saw(midi(nn), n, rng.random()) for nn in CHORDS[0])
    x = lp(x, 2400) * (t / t[-1]) ** 3
    fx.add(x, at(end_beat - beats), gain=gain)

# ---------------------------------------------------------------- arrangement
def bars(a, b): return range(a, b + 1)

# cold open: muffled — everything here goes through a "headphone" low-pass later
for b in bars(0, 3):
    pad_chord(b, gain=0.09, cutoff=900)
    for beat in (0, 2):
        clack(b * 4 + beat + 0.5, gain=0.07 if b < 3 else 0.05)
for beat, length, note in MELODY:
    if beat < 16:
        pluck(note - 12, beat, length, gain=0.07, cutoff=1500, pan=0.15)

# log in: bars 4-5
for b in bars(4, 5):
    pad_chord(b, gain=0.08, cutoff=1200 + (b - 4) * 2200)
riser(16, 8, gain=0.20)
roll = [16 + i * 1.0 for i in range(4)] + [20 + i * 0.5 for i in range(4)] + \
       [22 + i * 0.25 for i in range(4)] + [23 + i * 0.125 for i in range(8)]
for i, beat in enumerate(roll):
    snare(beat, gain=0.05 + 0.15 * i / len(roll))

# drop: bars 6-13
impact(24, gain=0.55)
for b in bars(6, 13):
    supersaw(b)
    for beat in range(4):
        kick(b * 4 + beat)
        hat(b * 4 + beat + 0.5, gain=0.08, open_=True)
        hat(b * 4 + beat + 0.25, gain=0.03, pan=-0.3)
        hat(b * 4 + beat + 0.75, gain=0.03, pan=-0.3)
    clap(b * 4 + 1); clap(b * 4 + 3)
    for e in range(8):
        bass_note(ROOTS[b % 4], b * 4 + e * 0.5, 0.45)
    chord = CHORDS[b % 4]
    for s in range(16):
        note = (chord + [c + 12 for c in chord])[s % 8] + 12
        pluck(note, b * 4 + s * 0.25, 0.25, gain=0.035, cutoff=5000, pan=(-0.5 if s % 2 else 0.5), bus=arp)
for b0 in (6, 10):
    for beat, length, note in MELODY:
        lead_note(note, b0 * 4 + beat, length)

# avatars: bars 14-18
for b in bars(14, 18):
    pad_chord(b, gain=0.05, cutoff=2400)
    for beat in range(4):
        kick(b * 4 + beat, gain=0.8)
        hat(b * 4 + beat + 0.5, gain=0.07)
    clap(b * 4 + 1, gain=0.22); clap(b * 4 + 3, gain=0.22)
    for e in range(8):
        bass_note(ROOTS[b % 4], b * 4 + e * 0.5, 0.4, gain=0.28)
    chord = CHORDS[b % 4]
    for beat in (0, 0.75, 1.5, 2.5, 3.0):
        for k, note in enumerate(chord):
            pluck(note + 12, b * 4 + beat, 0.4, gain=0.045, cutoff=3200, pan=(k - 1.5) * 0.3)

# worlds: bars 19-23, a shutter on every other beat from bar 19
for b in bars(19, 23):
    pad_chord(b, gain=0.05, cutoff=2600)
    for beat in range(4):
        kick(b * 4 + beat, gain=0.8)
        hat(b * 4 + beat + 0.5, gain=0.07)
        hat(b * 4 + beat + 0.25, gain=0.025, pan=-0.3)
        hat(b * 4 + beat + 0.75, gain=0.025, pan=-0.3)
    clap(b * 4 + 1, gain=0.22); clap(b * 4 + 3, gain=0.22)
    for e in range(8):
        bass_note(ROOTS[b % 4], b * 4 + e * 0.5, 0.4, gain=0.28)
    chord = CHORDS[b % 4]
    for s in range(16):
        note = (chord + [c + 12 for c in chord])[(s * 3) % 8] + 12
        pluck(note, b * 4 + s * 0.25, 0.25, gain=0.03, cutoff=4200, pan=(-0.5 if s % 2 else 0.5), bus=arp)
for k in range(10):
    shutter(76 + k * 2)

# friends: bars 24-27 breakdown
for b in bars(24, 27):
    pad_chord(b, gain=0.10, cutoff=2000)
    bass_note(ROOTS[b % 4] + 12, b * 4, 3.9, gain=0.16)
for beat, length, note in MELODY:
    piano(note - 12, 96 + beat, length, gain=0.20)
for b in bars(24, 27):
    for k, note in enumerate(CHORDS[b % 4]):
        piano(note - 12, b * 4 + k * 0.5, 2, gain=0.06, pan=(k - 1.5) * 0.3)
riser(104, 4, gain=0.16)
reverse_swell(112, 2, gain=0.10)

# flicker: bars 28-29, full drop
impact(112, gain=0.45)
for b in bars(28, 29):
    supersaw(b, gain=0.06)
    for beat in range(4):
        kick(b * 4 + beat)
        hat(b * 4 + beat + 0.5, gain=0.08, open_=True)
    clap(b * 4 + 1); clap(b * 4 + 3)
    for e in range(8):
        bass_note(ROOTS[b % 4], b * 4 + e * 0.5, 0.45)
for beat, length, note in MELODY[:7]:
    lead_note(note, 112 + beat, length)

# pier: bars 30-31, everyone logs off
for b in bars(30, 31):
    pad_chord(b, gain=0.09, cutoff=1600, chord=b - 28)
for beat, length, note in MELODY[8:]:
    piano(note - 12, 120 + beat - 8, length, gain=0.18)

# logo: bars 32-33, final Dmaj9 rings
n = at(8) + int(2 * SR)
for k, note in enumerate([50, 57, 62, 66, 69, 76]):
    x = sum(saw(midi(note) * (1 + d), n, rng.random()) for d in (-0.005, 0, 0.005))
    x = lp(x, 2200) * env(n, a=0.02, d=2.4, s=0.0, r=1.0)
    pad.add(x, at(128), pan=(k - 2.5) * 0.25, gain=0.07)
    piano(note, 128 + k * 0.08, 6, gain=0.07, pan=(k - 2.5) * 0.25)
impact(128, gain=0.30)

# ---------------------------------------------------------------- mix
def stereo_reverb(x, seconds=2.4, mix=0.25):
    n = int(seconds * SR); t = secs(n)
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-t * 6.9 / seconds)
        ir = lp(ir, 6000); ir /= np.sqrt(np.sum(ir ** 2))
        out[ch] = fftconvolve(x[ch], ir)[: x.shape[1]]
    return x + out * mix

def headphones(x, end):
    """The cold open plays as if through a train passenger's headphones."""
    y = x.copy()
    muffled = np.stack([lp(c, 1100, 4) for c in x]) * 0.9
    ramp = np.clip((np.arange(N) - end * 0.85) / (end * 0.15), 0, 1)
    ramp[:int(end * 0.85)] = 0
    for ch in range(2):
        y[ch] = muffled[ch] * (1 - ramp) + x[ch] * ramp
    return y

mix = (pad.arr() * duck + saws.arr() * duck * 1.0 + arp.arr() * duck * 0.9 +
       keys.arr() + lead.arr() + bass.arr() * duck ** 0.5 + drums.arr() + fx.arr())
mix = stereo_reverb(mix, 2.6, 0.22)
mix = headphones(mix, at(16))
mix[:, at(23.5):at(24)] *= np.linspace(1, 0.15, at(24) - at(23.5))  # breath before the drop
mix = hp(mix, 28)
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.6) / np.tanh(1.6) * 0.92
fade = int(0.5 * SR); mix[:, :int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
mix[:, -fade:] *= np.linspace(1, 0, fade)

OUT.parent.mkdir(parents=True, exist_ok=True)
pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
with wave.open(str(OUT), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print(f'wrote {OUT} ({N / SR:.1f} s)')
