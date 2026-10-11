# Font stacks (2026-10-12)

`TextStyle.fontFamily` and `<Span style={{ fontFamily }}>` take a family
name or a list of names (issue #204). Each grapheme cluster is drawn with the
first family of the list that has it, so Latin and Japanese can come from
different fonts in one paragraph. It is built on the per-range font spans of
`<Span>` (`2026-10-09-rich-text.md`). Example: `examples/font-stack/film.tsx`.

- Scene type (`crates/composition/src/style.rs`): `FontFamily` is an
  untagged enum, `Name(String)` or `Stack(Vec<String>)`, used by
  `TextStyle.font_family` and `TextFontRun.font_family`. ts-rs generates
  `FontFamily = string | ReadonlyArray<string>` (a `ts(type)` on the
  `Stack` field; `untagged` enums take no container override), so a stack
  declared `as const` type-checks. A name serializes as a plain string,
  so existing scenes and projects round-trip unchanged; an empty list is a
  deserialization error. `names()`, `first()`, and `is_stack()` (more than
  one name) are the accessors.
- Resolution (`crates/renderer/src/font_stack.rs`): `face_runs(text, style)`
  returns `FaceRun { start, end, font_weight, font_family }` code-point
  ranges. Without a stack (in the text or any run) they are the usable font
  runs as they are, so single-family text shapes exactly as before. With
  one, each grapheme cluster takes:
  1. for an emoji-presentation cluster, a color emoji family of the stack
     that has it;
  2. the first family with a face whose cmap has every visible character
     of the cluster (`is_visible_character`: variation selectors, ZWJ, and
     whitespace need no glyph);
  3. the first family with the cluster's first character;
  4. the primary family (the stack's first family with a face, or its
     first name when none has one), where cosmic-text's system fallback
     draws it as before.
  Clusters outside `<Span>` runs that land on the text's primary family get
  no run; everything else (span clusters, and clusters drawn from a later
  family) becomes a run, merged with equal neighbours. The face checked is
  the one `matched_weight` picks, so a family loaded only at 500 is checked
  (and drawn) at 500 for a 400 request.
  The result is kept in `stacked_runs`, by text and the family, weight, and
  font runs it depends on (a reveal or a fill change reuses it), and
  `matched_face` keeps its face id in `matched_faces`; both are cleared when
  a font loads. Shaping and every `run_baselines` call ask for the runs, so
  without the cache each measure or draw resolved the text again.
- Shaping (`shaped_buffer`): the base attributes use the primary family;
  `face_runs` replaces `usable_font_runs`, so stack choices reuse the font
  run path (per-line byte spans, phrase joiners, the base span that keeps
  cosmic-text's ASCII fast path from merging, emoji spans on top).
- Baselines (`run_baselines`): stack runs are runs, so glyphs from later
  families do not move a line, as in CSS and `@celesta/web`. When every
  glyph is in a run and the text has a stack, `primary_extent` places the
  baselines from the primary face's ascent and descent; without a stack the
  old rule (cosmic-text's baselines) stands. `rasterize` pads for ink that
  reaches past the line boxes, as for spans.
- Warnings (`fonts.rs`, `text.rs`): `requested_faces` yields stacks;
  `font_fallback` reports a stack only when none of its families has a
  face; `missing_glyphs` counts a glyph as present when its face belongs to
  any family of the stack. `FontFallback` and `MissingGlyphs` carry
  `families: Vec<String>` (was `family: String`); the exporter and GPU
  renderer dedupe on it. Messages for one family are unchanged; a stack
  reads `none of the font families "A", "B" (weight …) …`.
- `<Font>`-loaded faces stay out of cosmic-text's fallback candidates
  (`FontSystem` derives them from `initial_db`, see `TextRasterizer::fork`).
  Adding them would change how existing single-family projects render
  (Japanese after `fontFamily: 'Inter'` would switch from the system font
  to whatever was loaded), so the documented way is to list them in a
  stack.
- React (`packages/react/src/rich-text.ts`): a span's `fontFamily` may be a
  non-empty array of non-empty strings; runs keep a copy, and adjacent runs
  merge when their lists are equal. `FontFamily` is exported.
- Browser (`packages/web/src/text-layout.ts`): `cssFont` writes the list as
  a CSS `font-family` list before `system-ui, sans-serif`. The browser does
  the per-character choice; characters no family has use the browser's own
  fallback, which can differ from export.
- `@celesta/code` needs no change: `codeStyle()` keeps a given
  `fontFamily`, and every line and both `useTextMetrics` calls get it.

## Verification

- Tests: `crates/renderer/src/font_stack_tests.rs` (cluster choice, marks,
  skipped families, baselines, span stacks, warnings) with the repository's
  Bebas Neue and IBM Plex Mono, whose coverage differs (Б, →, U+0315 only in
  Plex Mono; Δ only in Bebas). `crates/composition/src/tests.rs`,
  `packages/cli/test/rich-text.test.mjs`, `packages/code/test/code.test.mjs`,
  `packages/web/test/text-layout.test.mjs`, and the Chromium script
  `packages/web/test/text-runs.mjs`.
- Export on macOS with JetBrains Mono and Noto Sans JP from Google Fonts:
  in `fontFamily: ['JetBrains Mono', 'Noto Sans JP']`, the Latin crop is
  pixel-identical to a JetBrains Mono line and the Japanese to a Noto Sans
  JP line (after a 1 px vertical shift: the two lines' baselines round
  differently), and no font warning is printed for it.
- `examples/rich-text` and `examples/feature-tour` frames 0, 60, 120, and
  200 render pixel-identically with and without this change.
