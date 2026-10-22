# Word-by-word captions (2026-10-23)

`<CaptionTrack>` can light the word being spoken and show a long cue a page
at a time (issue #308), the caption style of vertical short videos.
Example: `examples/word-captions/film.tsx`.

## Words and pages

- `packages/components/src/caption-words.ts`. `timedWords()` turns a cue
  into words, each a grapheme-cluster range of the cue's `text` (trailing
  space trimmed) with `[from, until)` in track frames. Given `words` are
  found in `text` in order with `indexOf` from the end of the word before;
  what lies between two words (punctuation) belongs to the word before, and
  text before the first word to none. A word without `durationInFrames`
  lasts until the next one, or the cue's end (after an `overlap: 'latest'`
  cut). Without `words`, words start after spaces, and for
  `wordUnit: 'phrase'` also at BudouX phrase boundaries that fall between
  grapheme clusters; the cue's frames are shared out by cluster count. With
  `'phrase'`, a given word that does not start a phrase joins the one
  before.
- `paginate()` is greedy: a page takes the next word unless that would pass
  `maxWords`, the word before ends a sentence (`SENTENCE_END`), the gap
  from the word before's `until` is at least `pause`, or the page no longer
  fits `maxLines` at `fontSize` (measured, with emphasis, through
  `useTextMeasurer()`). A single word too long for a page gets one anyway,
  and is then fitted, clipped, or refused as any caption is. The first page
  starts at cluster 0 and shows from the cue's start; the others from their
  first word. Words and pages are kept in a `useMemo` keyed by a JSON
  string of everything they depend on.
- `highlight` or `paging` turns this mode on; `words` alone does not.
  Pages cut; the cue's own `enter`/`exit` still apply.

## Drawing the highlight

- `litWord()` in `caption-track.ts`. Colors are `<Span>` fills from
  `coloredContent()`: the word being spoken takes `highlight.color` over its
  emphasis; other words keep their emphasis color, else `spokenColor` /
  `upcomingColor`. The weight never changes per word, as it would reflow
  the page between frames; the page is fitted with emphasis only, so color
  changes reuse the fit.
- The band and the growth need `TextMetrics.glyphs`. `wordLines()` groups
  the current word's glyphs (code-point ranges) by line, skipping lines
  past the shown ones. Glyph `x` includes alignment within `maxWidth`, and
  the page `<Text>` is drawn at `x: -offset`, so a glyph sits at
  `g.x - offset` in the band's coordinates. Without glyphs (the browser
  measurer, test stubs) only the colors change.
- With `scale`, the page leaves the current word clear (`#00000000`) and
  the word is drawn again per line in a `<Group scale>` centred on its line.
- With `background`, each line of the word gets a `<Group clip>` of the
  band rect (rounded like the band) holding the band `<Rect>`, a copy of the
  page in `highlight.color` (weights kept, so it lies on the same glyphs),
  and the grown word. Whatever the band covers therefore reads on it: the
  current word while the band slides in, and the edges of neighbouring
  words the padding and growth spill into. Off the band, the current word
  keeps its ordinary color.
- Over `transitionInFrames` (ease-out cubic) the word grows from 1 and the
  band slides along the line from the word before's band at full scale; a
  word on another line, or the first word, cuts its band in and grows it
  with the word.

## Japanese phrases in TypeScript

- `packages/text/src/phrases.ts` ports `crates/budoux` (code points, the
  doubled integer base score) and exports `phrases()` and
  `phraseBoundaries()`. `budoux-ja.ts` is the model, generated from
  `crates/budoux/src/models/ja.json`; `test/phrases.test.mts` checks the two
  are equal and repeats the Rust tests' cases. Both files are Apache-2.0
  only, so `@celesta/text`'s license is now
  `(MIT OR Apache-2.0) AND Apache-2.0`.
- `useTextMeasurer()` (`text-measurer.ts`) returns a synchronous measurer
  with the same theme, inherited `lang`/`fontFallback`, and declared fonts
  as `useTextMetrics()`, for measuring a number of texts in one render.

## Validation

- `pnpm -C packages/text test`, `pnpm -C packages/components test`.
- `examples/word-captions` was exported with a release
  `celesta-exporter` whose `runtime/react` pointed at this tree's
  `packages/cli`; contact sheets checked the band sliding frame by frame.
