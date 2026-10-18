# Text stroke lists (2026-10-18)

`TextStyle.stroke` takes one `Stroke` or a list of them, for the double
outline (white inside, character color outside) common in Japanese
subtitles (issue #86). `<Rect>`'s and `<Path>`'s `stroke` are unchanged.

- Type: `TextStroke` (`crates/composition/src/style.rs`), an untagged
  `One(Stroke)` / `Many(Vec<Stroke>)`; TypeScript sees
  `Stroke | ReadonlyArray<Stroke>`. Its hand-written `Deserialize` picks
  the variant by JSON shape (object or array), so an error inside a listed
  stroke names that field instead of serde's "did not match any variant".
  A single stroke serializes as before; an empty list draws nothing.
- Width semantics: each `width` is measured from the glyph outline, not
  added to the strokes inside it, so the list's order does not matter. The
  issue left absolute vs. cumulative widths open; absolute widths map
  directly to what is seen, and make the order irrelevant.
- CPU rasterizer (`crates/renderer/src/shaping.rs`, shared by the GPU
  renderer): strokes are sorted by rounded radius, thinnest first. Each
  dilates the glyph mask by its own radius and takes
  `its coverage × (1 − covered)`, where `covered` starts as the glyph mask
  and accumulates each stroke's share. With one stroke this is exactly the
  old formula. Padding, the drawn window and single-line row trimming use
  the widest radius. Of two strokes with the same radius, the one listed
  first wins.
- GPU placement (`crates/gpu-renderer/src/text.rs`) reaches by
  `TextStroke::width()`, the widest stroke.
- Web renderer (`packages/web/src/scene-canvas.ts`): `textStrokes()` lists
  the strokes widest first. The first is stroked normally; each narrower one
  is first cut out (`destination-out`) and then added (`lighter`), as the
  fill already is, so a translucent inner stroke shows what lies beneath the
  text rather than the wider stroke, matching the native renderers.
- Validation reports `…style.stroke[i].width` / `.paint` for a list, and
  `…style.stroke.width` for a single stroke, as before.
- Verified: a scene with a single stroke and with the old two-layer
  workaround renders byte-identical on `main` and this branch, and one
  layer with a two-stroke list matches the two-layer workaround (same alpha,
  color within 1/255).
