# Instances: bulk particle layers (2026-10-12)

`LayerContent::Instances` draws `count` particles of one shape (a rect, a
circle, or one image) from columns of numbers, and `@celesta/react`'s
`<Instances>` produces it. 100,000 animated particles now take about 4 ms
from React to Rust and 6 ms to render on an Apple M4, against 158 ms and
23 ms as 100,000 `Rect` layers; see
[`docs/performance/instances.md`](../performance/instances.md). Design:
[`docs/superpowers/specs/2026-10-12-instances-design.md`](../superpowers/specs/2026-10-12-instances-design.md).

## Behaviour

- Particle `i` draws exactly what a `Rect` anchored at its centre would:
  at `(x[i], y[i])` in the layer's own coordinates, `w` x `h` (per-particle
  `widths`/`heights` or the shared `width`/`height`), rotated `rotation[i]`
  degrees, filled with `colors[i]` (straight RGBA) or the shared `color`
  (white by default). A circle's corner radius is half its shorter side.
- An image shape stretches the image over the particle and multiplies every
  texel by the particle's colour. Given neither size it draws at the
  image's natural size; given one, it keeps the image's aspect ratio, as
  `<Image>` does (`celesta_composition::instance_size`, shared by both
  renderers).
- An SVG sprite is rasterized once per frame, for the particle drawn
  largest relative to the SVG's natural size, and always has mipmaps for
  the smaller ones. `ImageSources::natural_size` reads the size without
  rasterizing: rendering the same SVG layout at two resolutions in one
  frame would evict one with the other and rasterize twice every frame.
- `x`, `y`, and `rotation` on `<Instances>` are always particle columns.
  The walker gives the layer an identity position and rotation; `scale`,
  `opacity`, `blendMode`, and effects keep their layer meaning.
- A non-normal blend mode isolates the layer like a `Group`: particles
  composite source-over with each other, and the result blends once.
- A particle with a non-finite x, y, size, or rotation draws nothing.
- Project JSON (`TimelineContent`) does not have `Instances`.

## Wire format

Columns are standard base64 of the raw bytes: `f32` little-endian for `x`,
`y`, `widths`, `heights`, `rotation`; `u8` RGBA for `colors`. `F32Column`
and `U8Column` (`crates/composition/src/instances.rs`) hold them as
`Arc<[f32]>`/`Arc<[u8]>`, so cloning a `Scene` does not copy them, and
ts-rs types them as `string`. `LayerContent`'s `Deserialize` rejects a
column whose length does not match `count` (`4 * count` for `colors`),
right after the tagged mirror, so renderers index columns unchecked.

`packages/react/src/instances.ts` encodes with `Buffer#toString('base64')`
in pieces of 384 KiB joined into one string: Node returns base64 longer
than about 1 MiB as an external string, which would put the whole frame's
`JSON.stringify` on its slow path. Without `Buffer` (the browser entry) it
falls back to `btoa`. A big-endian host is refused.

## Renderers

- **GPU** (`crates/gpu-renderer/src/instances.rs`): `prepare_layer` makes
  one boxed `PreparedItem::Instances`; `prepare_draws` writes one
  `LayerInstance` per particle and one `GpuDraw` for the whole layer,
  joined with neighbouring draws of the same texture by `push_draw`.
  Rects and circles use kind 1 with exactly the floats a `Rect` layer
  writes (`tests/instances.rs` compares pixels with the equivalent `Rect`
  scenes). Images use kind 3 in `layer.wgsl`: the texture path of kind 0
  times `fill / 255`. `layer_instance()` in `layer.rs` lays out the 36
  floats for both `PreparedLayer::write_instance` and particles, appended
  with one `bytemuck` cast; that also made ordinary layers faster.
  `GpuRenderer::image_texture` is the `Image` arm's texture path, shared
  with image particles.
- **CPU** (`crates/renderer/src/instances.rs`): particle by particle, through
  `rasterize_rect_transformed` and `render_tinted_image_pixels`. It refuses
  a rotated particle (`UnsupportedRotation`), as it refuses a rotated
  `Rect`. Blend-mode isolation is `CpuRenderer::render_isolated`, shared
  with `Group`.

## Not done

- Particles do not accumulate through `add`/`screen` with each other; a
  later `accumulate` option could use fixed-function blending, at the cost
  of exact agreement with the CPU renderer.
- Per-particle gradients and strokes.
- The generic per-layer path (text, images, mixed scenes of many layers)
  is still as slow per layer as before, apart from the `write_instance`
  speed-up.
