# Built-in color filters (2026-10-14)

Issue #285. Layers and groups take `brightness`, `contrast`,
`saturation`, `hue`, `grayscale`, `invert`, `tint`, and `vignette` as
props, project timeline items as `effects` of the same names, and
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
  to 8 bits between filters; each clamps as its own pass would.
  Non-finite values and bad tint colors fail the frame naming the filter
  (`invalid brightness color filter: …`).
- `@celesta/web`: `color-filters.ts` repeats the arithmetic on
  `getImageData` pixels of the layer's surface, before `blur`, `shadow`,
  and `glow`, and writes back only the box it changed. Its test compares
  that arithmetic against bytes the GPU renderer drew (within 1 for its
  dithering). A vignette reads the box of the layer's shapes, which
  `SceneCanvas.shapeBox` computes as `PreparedLayer::shape` and the group
  plan do: a rect's corners; a text layer's image (the layout box in whole
  pixels, a single line's visible rows padded to an even count, grown by
  the stroke, moved onto whole pixels when drawn unscaled); an image's or
  video's display box; a path's box (below); a group's union. In Chrome,
  with the same font (Bebas Neue loaded by `<Font>`), the boxes of a
  stroked single line and a two-line text equalled the GPU's `uv` box to
  the pixel, as did a rotated, round-capped path of a cubic and a quad.
  The worker now serves `@celesta/shader`; a frame that draws a custom
  shader still throws in `SceneCanvas`.
- A path's box (`PendingPath::shape_box`, which `PreparedLayer::shape`
  now returns for paths) changed on the GPU too: it was the stroked
  outline's whole pixels within the scene, which only tiny-skia's stroker
  gives exactly (its round joins and offset curves are quads whose
  control points lie outside the stroke). It is now the box of the points
  the commands name (control points included, and 0,0 when the first
  command draws from there), grown by half the stroke width, its corners
  placed by the layer's transform as a rect's are, and not cut to the
  scene. Custom shaders on paths see it as `uv`/`celesta.content` as well
  (`uv_spans_a_paths_points_grown_by_half_its_stroke`); what a path
  rasterizes did not change.
- CPU reference renderer: refuses every filter, as it refused shaders
  (`RenderError::UnsupportedShader`, message updated).
- Project timelines: `TimelineEffects` takes the same color filters, each
  value a number or keyframes (`brightness` to `invert`), and
  `TimelineTint { color, amount? }` and `TimelineVignette { amount,
  radius?, softness? }` with the props' defaults. Validation uses the
  props' ranges and names the field (`effects.grayscale: must be finite
  and between 0 and 1`). `evaluate_color_filters` evaluates them at the
  item's time in the props' order, holds an overshooting easing to that
  range, and leaves out the ones that change nothing
  (`LayerFilter::is_identity`, the walker's `isIdentityFilter` in Rust).
  A tint color's keyframes interpolate RGBA as a shadow color's do.
- `<ProjectTimeline />` now passes a resolved component item's evaluated
  effects to the group around it (`rawEffects`, beside `rawTransform` and
  `rawOpacity`). Before, the editor's preview applied a component item's
  `blur`, `shadow`, and `glow` (its splice keeps the item's layer) and an
  export dropped them; both now apply them, color filters included.
- The MCP server's scene summary lists a layer's filters as
  `inspect.mjs` does (a custom shader by its id, since the summary has no
  sources).
- Performance: the `color-filters` bench workload grades the `shaders`
  image with `saturation`, `tint`, and `vignette`; see
  `docs/performance/custom-shaders.md`.
- Example: `packages/cli/examples/with-color-filters.tsx`.
