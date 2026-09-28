# AFTERIMAGE

A 24-second film about the shape light leaves behind.

Bone white, vermilion, near-black. Tall, blunt typography against a fine
half-twist ribbon. The ribbon is projected from three dimensions on every
frame; its delayed copies become the afterimage. The score moves from a
small metallic motif into dry percussion, then leaves an unresolved chord
to decay beneath the closing title.

## Watch / edit

- `afterimage.mp4` — finished film, 1920 × 1080, 30 fps, stereo.
- `film.tsx` — open in Celesta to preview; edit in your text editor.
- `poster.jpg` — a rendered still from the film.
- `make-score.py` — deterministic, original soundtrack synthesizer.
- `render.py` — exports bounded batches and joins them without re-encoding
  the picture; muxes the original score once for continuous audio.
- `assets/` — local fonts and the generated 48 kHz stereo score.

All media is local. No network access is required to preview or export.
The composition was made independently of the other examples and website.

Generated WAV and MP4 files are ignored by Git. After cloning, run
`python3 examples/afterimage/make-score.py` from the repository root before
opening `film.tsx`. Follow the reproduction steps below to create the movie.

## Cut

| Time | Image |
| --- | --- |
| 00:00–00:02 | A slit opens onto a red form. |
| 00:02–00:06 | AFTER / IMAGE, staggered across a paper field. |
| 00:06–00:10 | LIGHT LEAVES A MARK. The form turns to pale wire. |
| 00:10–00:14 | HOLD / THAT / FEELING. Three cuts on vermilion. |
| 00:14–00:19 | Three displaced forms slowly converge. |
| 00:19–00:24 | The title holds. The form and sound disappear. |

## Reproduce

From the repository root, with the Celesta exporter and React runtime built:

```sh
python3 examples/afterimage/make-score.py
node skills/celesta/scripts/inspect.mjs examples/afterimage/film.tsx \
  --frames 0,90,225,315,390,480,630,719
python3 examples/afterimage/render.py --overwrite
```

The batch helper needs `ffmpeg` on PATH. It limits each Celesta process to
30 frames; this was faster than a continuous export for this dense line
animation. For an installed app, pass `--exporter /path/to/Celesta-export`.
Export requires a working graphics adapter. `--overwrite` replaces the
previously generated movie.

The normal single-process export works from Celesta's UI, or directly:

```sh
target/release/celesta-exporter --overwrite --preset medium --crf 17 \
  --react examples/afterimage/film.tsx examples/afterimage/afterimage.mp4
```

## Credits and assets

Visuals and music are original procedural work. No stock footage, sampled
music, generated photography, or external service is used at playback time.
The audio generator uses only the Python standard library and a fixed seed.

Fonts are bundled under the SIL Open Font License; the full license and
copyright notices are included beside each font:

- [Bebas Neue](https://github.com/google/fonts/tree/main/ofl/bebasneue),
  by Ryoichi Tsunekawa — display type.
- [IBM Plex Mono](https://github.com/google/fonts/tree/main/ofl/ibmplexmono),
  by IBM — captions.

Change the palette, scene timing, projection, and text in `film.tsx`.
Cut times are in frames; one beat is 15 frames at the film's 120 BPM.
