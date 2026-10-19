# Loop repeat

A 12-second study of `<Loop>`: a background of rings that repeats every
phrase, a dot that drops on every beat, and a two-second BGM phrase played
five and a half times, the last half cut where the loop ends.

- `film.tsx`: the composition. Open it with Celesta using **File → Open…**.
- `make-phrase.py`: writes `assets/phrase.wav` with Python's standard
  library. The WAV and the MP4 are ignored by Git; generate the phrase after
  cloning.

## Reproduce

From the repository root, with a source build:

```sh
python3 examples/loop-repeat/make-phrase.py
node skills/celesta/scripts/inspect.mjs examples/loop-repeat/film.tsx --frames 0,59,60,330
target/release/celesta-exporter --json --react examples/loop-repeat/film.tsx examples/loop-repeat/loop-repeat.mp4
```
