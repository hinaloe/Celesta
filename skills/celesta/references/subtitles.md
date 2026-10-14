# Subtitle files (SRT / WebVTT)

Reading subtitles from an SRT or WebVTT file, drawing them, and writing a
video's subtitles out as a file beside it. `parseSubtitles`,
`formatSubtitles`, and `<Subtitles>` come from `@celesta/react`.
`<Dialogue>` lines ([dialogue.md](dialogue.md)) go into the same file.

## Contents

- [Read a file](#read-a-file)
- [Draw the cues](#draw-the-cues)
- [Write the subtitle file on export](#write-the-subtitle-file-on-export)
- [Write a file from data](#write-a-file-from-data)

## Read a file

Import the file and parse it at the composition's frame rate. The CLI and
the web editor bundle `.srt` and `.vtt` files as their text, and the
editor reloads when one changes.

```tsx
import { parseSubtitles } from '@celesta/react';
import captions from './captions.srt';

const cues = parseSubtitles(captions, { fps: 30 });
// [{ id: '1', from: 15, durationInFrames: 75, text: '字幕ファイルを、そのまま映像に。' }, …]
```

### `parseSubtitles(source, { fps, format? })`

Returns `SubtitleCue[]` in the file's order: `{ id?, from, durationInFrames,
text }`, shown on frames `[from, from + durationInFrames)`. `from` and
`durationInFrames` are what `<Sequence>` takes.

- Times are rounded to the nearest frame at `fps`; a cue keeps at least one
  frame. Pass the composition's `fps`.
- `format` is `'srt'` or `'vtt'`; by default a file starting with `WEBVTT`
  is WebVTT, anything else SRT.
- Accepted: a byte order mark; CRLF, LF, or CR line ends; cues of several
  lines (joined with `\n`); `,` or `.` before the milliseconds; one to three
  or more fraction digits (`01,5` is 1.5 s); a missing hour (`01:02.500`);
  WebVTT cue settings after the end time; `NOTE`, `STYLE`, and `REGION`
  blocks; missing SRT numbers.
- Markup is removed, since `<Text>` draws plain text: SRT `<i>`, `<b>`,
  `<u>`, `<s>`, `<font …>` and `{\an8}`-style overrides; every WebVTT tag
  (`<v Name>`, `<c.class>`, timestamps), with `<rt>` ruby text dropped and
  character references (`&amp;`, `&#x2665;`) decoded.
- Cues whose text is empty after that are left out.
- A malformed block throws with its line number: a block without a timing
  line, times it cannot read, minutes or seconds of 60 or more, or a cue
  that ends before it starts.

The cues come out in file order; sort them by `from` before using
`cueAt()`/`useCue()` on a file that is out of order.

## Draw the cues

Give each cue its own `<Sequence>`, and add `<Subtitles cues>` so an export
can write them out:

```tsx
<Subtitles cues={cues} />
{cues.map((cue, index) => (
  <Sequence key={index} from={cue.from} durationInFrames={cue.durationInFrames}>
    <CaptionBand>{cue.text}</CaptionBand>
  </Sequence>
))}
```

`<Subtitles>` draws nothing. Its cue frames count from the enclosing
`<Sequence>`'s start, like the sequence's children; a cue outside that
sequence is cut to it, the way `<Audio>` plays only inside it. It cannot be
inside `<Static>`, and inside `<FreezeFrame>` it contributes nothing.

`examples/captions/` draws each cue in a band sized with `useTextMetrics()`
and shows the cue's own SRT block next to a timeline.

## Write the subtitle file on export

`--subtitles <file>` writes the video's subtitles beside it, as SRT for
`.srt` and WebVTT for `.vtt`:

```sh
Celesta-export --json --react film.tsx film.mp4 --subtitles film.srt
```

- The file holds every `<Subtitles>` cue and every `<Dialogue>` line (not a
  `held` one) for as long as it is shown, ordered by start. A JSON project
  writes its dialogue items on enabled tracks.
- With `--from`/`--to`, times start at the span's start and cues are cut to
  the span; cues outside it are left out.
- A line reported more than once with the same text and times is one cue.
  Blank lines inside a cue are dropped; WebVTT escapes `&`, `<`, and `>`.
- Video only: with a PNG selection `--subtitles` is a usage error. Without
  `--overwrite` an existing subtitle file is `output_exists`, checked before
  anything renders; another extension is `unsupported_subtitles`.
- The JSON result lists it in `outputs` as `{"type": "subtitles", "path",
  "format": "srt" | "vtt", "cues"}`.
- The MCP `export_video` tool takes the same path as `subtitles`.

## Write a file from data

### `formatSubtitles(cues, { fps, format })`

Writes `SubtitleCue[]` as an SRT or WebVTT string, sorted by `from`. SRT
cues are numbered from 1; WebVTT keeps an `id` that has no line break or
`-->`. Times are rounded to the millisecond. Blank lines inside a cue are
dropped, WebVTT escapes `&`, `<`, and `>`, and cues with no text are left
out. A cue without a finite `from`, a positive `durationInFrames`, or a
string `text` throws. `parseSubtitles()` reads the result back to the same
frames.
