# Built-in stylize effects and chroma key (2026-10-14)

Issues #292 and #294. Layers and groups take `pixelate`, `halftone`,
`chromaticAberration`, `wave`, `noise`, `scanlines`, `zoomBlur`, and
`chromaKey` as props, and `@celesta/shader` exports functions of the same
names for the `shader` array, as #285's color filters do. They run on the
GPU and in `@celesta/web`. The design, with each effect's arithmetic, is
`docs/superpowers/specs/2026-10-14-builtin-effects-design.md`.

- Order: the `shader` prop's filters, then `chromaKey`, `pixelate`,
  `wave`, `zoomBlur`, `chromaticAberration`, the color filters, `halftone`,
  `noise`, `scanlines` (`FILTER_PROPS`), then `shadow`/`glow` and `blur`.
  Values that change nothing add no filter (`pixelate` ≤ 1, `halftone` 0,
  a zero offset, amplitude, or amount); a chroma key always keys.
- Scene model: `LayerFilter` gains a variant per effect, every field
  written by the walker. `noise.seed` is a `u32`; the walker fills an
  omitted seed with `Math.round(seconds(context.mediaTime) * fps)`, the
  frame `useCurrentFrame()` returns at that layer, and throws inside
  `<Static>`. `mediaTime` is the frame's moment inside a `<MotionBlur>`
  sample or a `<Trail>` copy, as media uses it, so every sample shows the
  frame's grain instead of averaging two seeds' grain to gray. An explicit
  `seed` must be an integer, so one computed from `useCurrentFrame()` inside
  a sample, which is fractional there, is refused.
  The function form (`noise(0.2)`) keeps the seed open in the
  `ShaderEffect` and resolves it when the walker serializes it.
- GPU: `builtin_effect.wgsl`, assembled and compiled like
  `color_filter.wgsl` (`builtin_source`), with `op` (kind and three values)
  and `more` (the rest). `ShaderProcessor::use_builtin_effect` records each
  use's padding: pixelate `size`, halftone `size·√2`, chromatic aberration
  `|offset|`, wave `|amplitude|`, zoom blur `amount / (1 − amount)` times
  the scene's diagonal, all at most 512. Angles are reduced to one turn
  before the `f32` upload; the seed goes as two exact 16-bit halves.
  `GpuRenderError::ColorFilter` became `BuiltinFilter`, and its message
  `invalid {filter} filter: …` (was `… color filter: …`).
- `@celesta/web`: `color-filters.ts` became `filters.ts`. Every built-in
  filter is one pass over a premultiplied `Float32Array` covering the
  layer's region of the surface: it reads the previous pass, samples as
  `source_at` does, writes what the layers cover (the shapes' box grown by
  2 pixels, as `PreparedLayer::bounds` does) grown by its padding, and
  clears the rest; the result is written back once. Color filters work as
  before, but the written-back box is now that region rather than the
  opaque pixels' box. `SceneCanvas` computes the shape box only when a
  filter reads it (`READS_CONTENT_BOX`).
- Determinism: noise hashes the scene pixel, the seed, and the channel with
  PCG (`pcg`/`random` in both renderers, with `Math.imul` and `>>> 0` in
  JS), so its random values are the same bits on the GPU and in the browser.
- Cross-renderer check: `write_web_effect_fixtures` (an ignored test in
  `crates/gpu-renderer/src/tests/builtin_effect.rs`) writes a 48×48 test
  pattern and each effect on it as raw premultiplied RGBA to
  `packages/web/test/fixtures/effects/`. `filters.test.mjs` runs the web
  passes on the unfiltered fixture and compares every pixel. On Apple M4
  the largest difference per channel was 2 for halftone and zoom blur and
  1 for the rest; the test allows 2. Regenerate the fixtures after changing
  `builtin_effect.wgsl`:
  `cargo test -p celesta-gpu-renderer write_web_effect_fixtures -- --ignored`.
- Limits: a zoom blur's streaks are cut 512 pixels past the content. A
  pixel whose centre lies on a halftone cell's edge can fall in either cell
  depending on rounding; none did in the fixture. Chroma keying is per
  pixel, so H.264's halved chroma shows as stepped edges on scaled footage;
  `softness` smooths them, and a spatial matte blur is not provided.
  Project timelines (`TimelineEffects`) do not take these effects.
- CPU reference renderer: refuses them, as it refuses every filter.
- `inspect.mjs` and the MCP scene summary print each effect with its
  values, e.g. `pixelate(8 px)`, `noise(0.2, seed 42, color)`.
- Examples: `packages/cli/examples/with-stylize-effects.tsx`, and
  `examples/greenscreen/`, whose footage `footage.tsx` draws and the
  exporter writes to `assets/` (the `.gitignore` lets that MP4 in).
