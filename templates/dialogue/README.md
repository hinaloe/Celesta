# Character dialogue template

Two characters talk through a script, line by line: each line moves the
speaker's mouth and shows the text in a subtitle band with the speaker's
name. The sample has no recordings, so each line is timed from the length
of its text; add a voice to a line and it plays the recording and lasts as
long as it. `film.tsx` declares its inputs with `defineProjectProperties()`
and `props.json` holds the values this project renders with. `prepare()`
reads the script file named by the `script` property, and `planDialogue()`
lays the lines out, so the composition's length follows the script.
1920 × 1080 (16:9) or 1080 × 1920 (9:16), 30 fps.

Create a project from it:

```sh
celesta-editor --init my-talk --template dialogue
cd my-talk
celesta-editor film.tsx
celesta-exporter --react film.tsx talk.mp4
```

## What to replace

- `assets/` — the sample portraits (`shizuku-*.png`, `komugi-*.png`) and
  the mouth images both characters share for lip sync (`mouth-*.png`). Put
  your own here, or anywhere `script.json` can point at.
- `script.json` — the cast and the lines:

  ```json
  {
    "characters": {
      "shizuku": {
        "name": "しずく",
        "color": "#3f8fd6",
        "portraits": { "normal": "assets/shizuku-normal.png", "smile": "assets/shizuku-smile.png" },
        "mouths": { "closed": "assets/mouth-closed.png", "a": "assets/mouth-a.png", "i": "assets/mouth-i.png", "u": "assets/mouth-u.png", "e": "assets/mouth-e.png", "o": "assets/mouth-o.png" }
      }
    },
    "lines": [
      { "scene": "intro", "speaker": "shizuku", "text": "こんにちは、しずくです。", "reading": "こんにちわ、しずくです" }
    ]
  }
  ```

  Each character has the `name` on its name plate, the `color` of its
  subtitle band, a portrait per expression (the first one listed is shown
  when a line names none), and a mouth image for `closed` and each vowel
  `a`, `i`, `u`, `e`, `o`, drawn over the portrait. Portraits and mouths of
  one character are the same size. Portraits are scaled to fit their share
  of the frame, reading their size from PNG files (other formats are taken
  to be 360 × 400, `DEFAULT_PORTRAIT_SIZE` in `film.tsx`). Characters
  stand in the order they are listed.

  Each line names its `speaker` (a key of `characters`) and its `text`.
  Optional: `voice`, a recording of the line (see below); `reading`, the
  kana the lip sync follows (`text` with kanji has too few vowels to
  follow); `expression`, a key of the speaker's `portraits`; and `scene`, a
  name for a run of lines — a longer pause comes before the first line of
  each new scene. Every path resolves from the folder holding `script.json`.
  A line without a voice lasts 0.15 seconds per character of its text
  (punctuation included), at least 1.5 seconds, and the mouth opens on each
  vowel of its reading in turn.
- Voices — to add recordings, put WAV files in `assets/voices/` and give
  each recorded line a `voice`:

  ```json
  { "speaker": "shizuku", "text": "こんにちは、しずくです。", "reading": "こんにちわ、しずくです", "voice": "assets/voices/001.wav" }
  ```

  That line then plays the recording, lasts as long as it, and moves the
  mouth with the loudness of the recording through the vowels of its
  reading. Voices must be uncompressed WAV files, which lip sync reads.
  Lines with and without voices can be mixed.
- `props.json` — the title, format, script, background, and music. Preview
  and export load it automatically.
- The layout numbers, colors, and timings (the pauses before, between, and
  after the lines, the length of a line without a voice, the hop of the
  speaker, the music volume) are in the constants block at the top of
  `film.tsx`.

## Properties

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `title` | string | `セリフの並べ方` | The heading at the top. Long titles shrink to fit (two lines in 9:16). |
| `format` | `16:9` / `9:16` | `16:9` | 1920 × 1080 with the portraits above the subtitle band, or 1080 × 1920 with the portraits at the bottom and the band above them. |
| `script` | path | `./script.json` | The cast and the lines. |
| `background` | path | `""` | An image to fill the frame with, cropped to it; `""` for a solid color. |
| `backgroundColor` | color | `#1f2433` | The background without an image (and behind a transparent one). |
| `music` | path | `""` | Music under the lines, repeated when shorter and faded out at the end; `""` for none. |

## Another script

`--props-file` renders with another set of values instead of `props.json`.
A file such as `episode-2.json` beside `film.tsx`:

```json
{
  "title": "字幕の帯",
  "format": "9:16",
  "script": "episode-2/script.json",
  "background": "episode-2/room.png",
  "backgroundColor": "#1f2433",
  "music": "episode-2/music.wav"
}
```

```sh
celesta-exporter --react film.tsx episode-2.mp4 --props-file episode-2.json
```

Relative paths in it resolve from its own folder, and properties left out
of it use the defaults in `film.tsx`. `--props` overrides single values
without another file:

```sh
celesta-exporter --react film.tsx talk-vertical.mp4 --props '{"format":"9:16"}'
```

From the repository root, the paths start with `templates/dialogue/`:

```sh
cargo run -p celesta-exporter --release -- --react templates/dialogue/film.tsx talk.mp4
```

## License

The characters しずく (Shizuku, a water drop) and こむぎ (Komugi, a bread
bun), their portraits and mouths in `assets/`, and `script.json` are made
for Celesta and licensed like the Celesta repository (MIT OR Apache-2.0).
They come from `examples/assets/dialogue-demo` in the Celesta repository,
which also has the script that drew them. Noto Sans JP is loaded from
Google Fonts (SIL Open Font License). Voices you add are under their own
licenses.
