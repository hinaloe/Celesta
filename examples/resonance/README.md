# RESONANCE

A 16-second audio visualizer driven by its own soundtrack. `prepare()`
analyzes the score three times with `loadAudioSpectrum()`, and each frame
reads the results with `useAudioSpectrum()`:

- the ring: 64 log-spaced bands from 30 Hz to 12 kHz (FFT 4096), mirrored
  left and right, with a fast attack and a short release;
- the floor: 48 mel-spaced bands (FFT 2048) with a longer release;
- the meter and the glow: the RMS with a slow release, shown in dBFS.

Original, locally synthesized 120 BPM score: a low pad alone, then kick,
bass, claps, hats, and a high arpeggio, a rising sweep over a breakdown, and
a last hit ringing out to silence. 1920 × 1080 / 30 fps.

`film.tsx` is the whole composition; `poster.jpg` is frame 121 of it.

## Reproduce

From the repository root:

```sh
python3 examples/resonance/make-score.py
node skills/celesta/scripts/inspect.mjs examples/resonance/film.tsx --frames 30,121,331,421
target/release/celesta-exporter --react --frame 30,121,331,421 --contact-sheet \
  examples/resonance/film.tsx examples/resonance/frames.png
target/release/celesta-exporter --react examples/resonance/film.tsx examples/resonance/resonance.mp4
```

The soundtrack and MP4 are generated and ignored by Git. Run the score
generator before opening the composition on a fresh checkout. Bebas Neue and
IBM Plex Mono are referenced from `../afterimage/assets/fonts/` (SIL Open
Font License).
