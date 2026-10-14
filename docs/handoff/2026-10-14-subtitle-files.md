# Subtitle files (2026-10-14)

SRT and WebVTT files can be read into frame-timed cues, and a video export
can write its subtitles out as one of them (issue #289). The cues have the
`from` / `durationInFrames` shape issue #197's `CaptionTrack` proposes, so it
can take parsed cues as they are. Example: `examples/captions/film.tsx`.

## Reading and writing in TypeScript

- `packages/react/src/subtitles.ts`, exported from `@celesta/react` and its
  browser entry: `parseSubtitles(source, { fps, format? })`,
  `formatSubtitles(cues, { fps, format })`, and `<Subtitles cues>`.
- Parsing splits on blank lines after removing a BOM and normalizing CRLF
  and CR. A block's timing line is its first or second line (the first is
  then the `id`); WebVTT's header, `NOTE`, `STYLE`, and `REGION` blocks are
  skipped. Times accept `,` or `.`, any fraction length (read as a decimal
  fraction), and a missing hour; minutes and seconds must be below 60.
  Times round to the nearest frame, keeping at least one frame. SRT keeps
  text except `<b|i|u|s|font>` tags and `{\…}` overrides; WebVTT drops `<rt>`
  contents, every tag, and decodes named and numeric references. Empty cues
  are dropped. Errors carry the 1-based line number.
- Formatting sorts by `from`, rounds to milliseconds, numbers SRT cues,
  keeps WebVTT ids without `-->` or line breaks, drops blank lines inside a
  cue, and escapes `&<>` for WebVTT.
- The CLI's esbuild and the web worker's project bundler load `.srt` and
  `.vtt` as text; `packages/react/subtitle-files.d.ts` declares the modules
  and `index.ts` references it with `preserve="true"`, as
  `@celesta/shader` does for `.wgsl`. The editor's reload watcher includes
  both extensions.

## Collecting subtitles while rendering

- `renderAt` returns `subtitles: { text, start, end }[]` (composition
  seconds) beside `audio`; the CLI sends it only when non-empty.
  `WalkContext.subtitles` collects them; it is `null` inside
  `<FreezeFrame>` and for audio-only sweeps.
- `<Subtitles>` is the `subtitles` host type. On each frame it reports the
  cues active at the local time, from `origin + from / fps` to the cue's
  end, cut to the enclosing sequence's range. It is time-dependent, so
  `<Static>` rejects it.
- Host elements get a `subtitles(node, walk)` hook and
  `HostWalk.collectSubtitle(text)`, which reports the text for the whole
  enclosing sequence range. `@celesta/character` reports each `<Dialogue>`
  that is not `held`, flattening its spans.
- `celesta-react-bridge` adds `ReactSubtitleDescriptor` and
  `FrameEvaluation::subtitles` (`#[serde(default)]`).

## Writing the file on export

- `ExportOptions::subtitles: Option<PathBuf>`; `--subtitles <FILE>` in the
  CLI (a usage error with PNG output or `--inspect`) and `subtitles` in the
  MCP `export_video` tool.
- `crates/exporter/src/subtitles.rs`: the extension picks the format
  (`unsupported_subtitles` otherwise), and `check_output` runs with the
  video's checks, so an existing file fails as `output_exists` before
  rendering. React exports gather every rendered frame's reports, keep one
  per `(text, start, end)`, shift them by the window start, cut them to
  `[0, window duration]`, and sort by start. Only frames in the
  `--from`/`--to` span are rendered, which is enough: a cue is reported in
  full by any frame that shows it. JSON projects write their `dialogue`
  items on enabled tracks (item and track `enabled`; `muted`/`solo` are for
  audio). A companion project's dialogue is not included.
- The file is written through a temporary file after the video is
  published and reported as `ExportedFile::Subtitles { path, format, cues }`
  (`{"type": "subtitles", …}` in `--json`).

## Tests

- `packages/react/test/subtitles.test.mjs`: parsing (BOM, CR/CRLF,
  multi-line, loose timecodes, WebVTT blocks and markup, rounding, errors),
  formatting, round trips, and `<Subtitles>` reports per frame.
- `packages/character/test/dialogue-subtitles.test.mjs`: `<Dialogue>` and
  `DialogueSeries holdSubtitle` reports.
- `crates/exporter/src/subtitles.rs` unit tests, and
  `writes_a_react_entrys_subtitles_shifted_to_the_exported_range` in
  `crates/exporter/tests/export_integration.rs` (an `.srt` import through
  the CLI, a sequence offset, and a range).
