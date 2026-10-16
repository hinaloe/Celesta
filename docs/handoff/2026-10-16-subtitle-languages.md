# Subtitle files per language and format, and without the video (2026-10-16)

One export can write several subtitle files, one per language and format,
and an export with no output video writes only the subtitle files (issue
#367). Builds on [2026-10-14-subtitle-files.md](2026-10-14-subtitle-files.md).

## Languages

- `<Subtitles lang>` (`packages/react/src/subtitles.ts`); without it the
  cues take the walk context's `lang` (the enclosing `<Sequence>`,
  `<Group>`, or `<Composition>`'s), as text does. `HostWalk.collectSubtitle`
  reports the context's `lang`, so `<Dialogue>` lines have one too.
- `SubtitleDescriptor.lang` / `ReactSubtitleDescriptor::lang` is optional
  and left out when unset. Reports in different languages are different
  cues (`subtitles::react_cues` keys on it). Project dialogue items have no
  language.

## Paths

- `ExportOptions::subtitles` is a `Vec<PathBuf>`; `--subtitles` repeats,
  and MCP `export_video`'s `subtitles` is a path or a list.
- `subtitles::files` turns a path and the cues into the files to write. A
  path containing `{lang}` (`LANG_PLACEHOLDER`) is one file per language,
  in `BTreeMap` order, `und` for cues without one; the language is reduced
  to `[A-Za-z0-9_-]` for the file name. Any other path takes every cue and
  fails with `MixedSubtitleLanguages` (`mixed_subtitle_languages`) when the
  cues are in more than one language (no language counts as one).
- `Exporter::write_subtitles` works out every path's files before writing
  any, so a mixed-language failure writes no subtitle file (the video is
  already published by then). A `{lang}` path with no cues warns. Each file
  is reported as `ExportedFile::Subtitles { lang, .. }`; `--json` adds
  `lang` when set.
- `check_outputs` checks every extension before rendering, and existence
  only for paths without `{lang}`; `{lang}` files are checked when written.

## Subtitles without the video

- `ExportJob::output` is `Option<PathBuf>`; `None` runs
  `Exporter::export_react_subtitles` or `Exporter::export_project_subtitles`.
  Neither checks dimensions or encoders. No subtitle paths is `NoOutput`.
- React: a new `collectSubtitles: { from, frames }` request
  (`MountedComposition.collectSubtitles`, answered with
  `collectedSubtitles`, `ReactBridge::collect_subtitles`) walks each frame
  exactly as `renderAt` does (layers built, host elements prepared, statics
  cached) but returns only the subtitles, deduplicated per request. The
  audio-only walk was not reused: it skips host elements' children and
  `<TimeSample>`, which a video export walks. The exporter asks for one
  second of frames at a time and reports `ExportProgress::Rendering` after
  each, so the CLI and MCP show progress and cancellation is noticed.
- CLI: `<OUTPUT>` is optional with `--subtitles`. Without it, picture and
  encoding flags given on the command line are usage errors, and progress
  is printed plainly ("evaluating frame …", one "wrote" line per file)
  instead of the dashboard. MCP: `export_video` without `output`.
- DELTA 0.7.0 (2,720 frames at 1920×1080): subtitle files only in 4.2 s;
  the video with the four files in 22 s, the files byte-identical.

## Example

`examples/delta` declares both caption languages
(`<Subtitles lang={lang}>`, the `captions` project property is gone), and
its README writes the video and `delta-0.7.0.{ja,en}.{srt,vtt}` in one
export.

## Tests

- `packages/react/test/subtitles.test.mjs`: `lang` from the prop, the
  composition, and a sequence; `collectSubtitles()`.
- `crates/exporter/src/subtitles.rs`: `{lang}` expansion, `und`, file-name
  characters, mixed languages, per-language deduplication.
- `crates/exporter/src/main.rs`: repeated `--subtitles`, no `<OUTPUT>`.
- `crates/mcp/src/args.rs`: a list of paths, no `output`.
- `writes_only_a_react_entrys_subtitles_per_language_and_format` in
  `crates/exporter/tests/export_integration.rs`: four files from two
  languages and two formats without a video, the mixed-language failure,
  and `ExportJob` without an output.
