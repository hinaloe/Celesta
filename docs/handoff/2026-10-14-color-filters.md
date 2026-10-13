# Built-in color filters (2026-10-14)

Issue #285. Layers and groups take `brightness`, `contrast`, `saturation`,
`hue`, `grayscale`, `invert`, `tint`, and `vignette` as props, and
`@celesta/shader` exports functions of the same names that go in the
`shader` array among custom shaders (#286's chains). They run on the GPU
and in `@celesta/web`.

- Semantics: each works on the straight (unpremultiplied) sRGB-encoded
  color, keeps alpha, and clamps its result to 0–1, as CSS `filter`
  functions do. `saturation`, `grayscale`, and `hue` use CSS's matrices
  with Rec. 709 luma (0.2126, 0.7152, 0.0722); `grayscale(a)` is
  `saturation(1 - a)`. `tint` mixes toward its color by `amount` times the
  color's alpha. `vignette` multiplies the color by
  `1 - amount * smoothstep(t)`, `t` running from `radius` to
  `radius + softness` over the distance from the content box's centre (0)
  to its corners (1), so it follows `uv`'s box and is elliptical on a
  non-square layer.
- Order: the `shader` prop's filters, then the props in the order above,
  then `shadow`/`glow` from the result and `blur` on top. Props with values
  that change nothing (`brightness={1}`, `grayscale={0}`, a tint of amount
  0) add no filter; the functions in an array always do.
- Scene model: `LayerEffects.shaders: Vec<LayerShader>` became
  `filters: Vec<LayerFilter>` (JSON `filters`), a `type`-tagged enum read
  through `TypeTagged`: `shader` wraps `LayerShader`, and each color filter
  carries its values (`hue` has `degrees`, `tint` `color` and `amount`,
  `vignette` `amount`, `radius`, `softness`). The walker always writes
  every field. As in #286, the runtime and the renderer ship together, so
  `shaders` is not read; `inspect.mjs` still reads it and the single
  `shader` from older runtimes and prints `filters a → b → …`.
- GPU: `color_filter.wgsl` is assembled and compiled like a custom shader
  (`shader_prelude.wgsl`, two `vec4f` parameters: kind and amounts, and the
  tint color), once, when a layer first uses a color filter. Each filter is
  one pass in the chain (`ShaderProcessor::use_filters`, `UsePipeline`), so
  it pings and pongs between the same two canvases, with no padding. Where the
  canvases are `Rgba16Float` (`canvas_format`), a chain does not quantize
  to 8 bits between filters; each clamps as its own pass would. Non-finite values and bad tint colors
  fail the frame naming the filter (`invalid brightness color filter: …`).
- `@celesta/web`: `color-filters.ts` repeats the arithmetic on
  `getImageData` pixels of the layer's surface, before `blur`, `shadow`,
  and `glow`, and writes back only the box it changed. Its vignette box is
  the box of the layer's non-transparent pixels, which matches the GPU's
  shape box for opaque layers but not for text (glyph ink instead of the
  laid-out quad) or images with transparent margins. Its test compares
  against bytes the GPU renderer drew (within 1 for its dithering). The
  worker now serves `@celesta/shader`; a frame that draws a custom shader
  still throws in `SceneCanvas`.
- CPU reference renderer: refuses every filter, as it refused shaders
  (`RenderError::UnsupportedShader`, message updated).
- Not done: project timelines (`.celesta.json`) have no color filters;
  `evaluate.rs` writes no filters, as it wrote no shaders.
- Performance: the `color-filters` bench workload grades the `shaders`
  image with `saturation`, `tint`, and `vignette`; see
  `docs/performance/custom-shaders.md`.
- Example: `packages/cli/examples/with-color-filters.tsx`.
