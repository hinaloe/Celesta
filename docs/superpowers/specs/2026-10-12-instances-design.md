# Instances: bulk particle layers design

## Goal

A scene of 100,000 animated `<Rect>`s evaluates at about 6 frames per
second today. Measured on an Apple M4 with every rect moving every frame:

| Stage | 3,000 rects | 100,000 rects |
| --- | ---: | ---: |
| React frame round trip (`protocol-bench`: render, walk, stringify, pipe, serde) | 3.9 ms | 158 ms |
| of which `JSON.stringify` | — | 24 ms (26 MB per frame, ~260 B per rect) |
| GPU renderer (`dense-geometry-bench`, scene building excluded) | ~1.2 ms | ~30 ms |

Every stage pays per element, and the GPU renderer's time is almost all
CPU-side `prepare_draws`, not GPU work. Particles, sparks, snow, and star
fields need many elements of one shape, so this design adds one layer that
draws many of them from columns of numbers:

```tsx
import { Instances, useCurrentFrame } from '@celesta/react';

const N = 100_000;
const xs = new Float32Array(N);
const ys = new Float32Array(N);
const colors = new Uint8Array(N * 4);

function Sparks() {
  const t = useCurrentFrame() / 60;
  for (let i = 0; i < N; i++) {
    xs[i] = 960 + Math.cos(i * 0.618 + t) * (i % 900);
    ys[i] = 540 + Math.sin(i * 0.618 + t) * (i % 500);
    colors.set([255, 180, 60, 200], i * 4);
  }
  return <Instances count={N} x={xs} y={ys} color={colors} shape="circle" width={4} height={4} />;
}
```

Making the generic per-layer path faster (text, images, and mixed scenes)
is separate work and out of scope here.

## React API (`@celesta/react`)

`<Instances>` is a core primitive next to `<Rect>` and `<Image>`, because it
is a new `LayerContent` variant.

| Prop | Type | Default | Meaning |
| --- | --- | --- | --- |
| `count` | non-negative integer | required | Number of particles. |
| `x`, `y` | `Float32Array \| ArrayLike<number>`, length `count` | required | Particle centres, in the layer's own coordinates. |
| `width`, `height` | `number` or `Float32Array \| ArrayLike<number>` of length `count` | rect/circle: required; image: the image's natural size | A number is shared by every particle; an array gives each its own. |
| `rotation` | `Float32Array \| ArrayLike<number>`, length `count` | 0 | Degrees, clockwise, about each particle's centre. |
| `color` | `Uint8Array \| ArrayLike<number>`, length `4 * count` | — | Straight-alpha RGBA, 0–255, per particle. |
| `fill` | color string | `#FFFFFF` | The colour of every particle when `color` is absent. |
| `shape` | `'rect' \| 'circle'` | `'rect'` | Ignored when `src` is given. |
| `cornerRadius` | `number` | 0 | `rect` only. |
| `src` | asset, as `<Image src>` | — | Draws this image for every particle instead of a shape. |

These layer props apply to the layer as a whole: `id`, `scale`, `opacity`,
`blendMode`, `blur`, `shadow`, `glow`, `shader`. Like `Group` and `Path`,
the layer has no box, so its anchor is ignored.

`x`, `y`, and `rotation` on `<Instances>` are always particle columns, never
the layer's own position or rotation, so the same name never means two
things. To move or rotate the particles as a whole, wrap them in
`<Group x y rotation>`. The layer's own transform is the identity apart
from `scale`.

### Meaning

Particle `i` draws exactly what this layer would, in painter's order after
particles `0..i`:

- `shape="rect"` / `"circle"`: a `Rect` of width `w[i]`, height `h[i]`,
  anchored at its centre (anchor 0.5, 0.5), positioned at `(x[i], y[i])`,
  rotated `rotation[i]` degrees, filled with `color[i]` (or `fill`), with
  corner radius `cornerRadius` (`rect`) or `min(w[i], h[i]) / 2` (`circle`),
  and no stroke.
- `src`: the image scaled to `w[i]` x `h[i]` (its natural size when no width
  or height is given), placed and rotated the same way, with every texel's
  colour and alpha multiplied by `color[i] / 255` (white leaves it as it is).

All particles are inside the `Instances` layer, so the layer's transform,
opacity, and clip apply to every one of them.

**Blend modes and effects apply to the layer as a whole.** A non-normal
`blendMode` isolates the layer, as it isolates a `Group`: the particles
composite source-over onto a transparent canvas, and that canvas blends with
the backdrop. Overlapping particles do not accumulate through `add` or
`screen`; per-particle accumulation is a possible later feature (for example
`accumulate="add"`), approximated with fixed-function blending, and is not
part of this design. Effects wrap the layer as they wrap any other layer.

### Validation

At frame evaluation, `<Instances>` throws when `count` is not a
non-negative integer, a column has the wrong length (`4 * count` for
`color`), a column is not an array or typed array, `shape` is not `rect` or
`circle`, `width`/`height` are missing for a shape, or the host is
big-endian. Values are not checked one by one: a particle with a non-finite
coordinate, size, or rotation draws nothing.

## Wire format and scene model

### JSON

```json
{
  "type": "instances",
  "count": 100000,
  "shape": { "type": "circle" },
  "width": 4,
  "height": 4,
  "color": "#FFFFFF",
  "x": "<base64>",
  "y": "<base64>",
  "widths": "<base64>",
  "heights": "<base64>",
  "rotation": "<base64>",
  "colors": "<base64>"
}
```

- Props map to keys as: `fill` → `color`, `color` → `colors`, a number
  `width`/`height` → `width`/`height`, an array `width`/`height` →
  `widths`/`heights`; `x`, `y`, `rotation` keep their names.
- `shape` is `{"type":"rect","cornerRadius":r}`, `{"type":"circle"}`, or
  `{"type":"image","asset":{…}}` (a `ResolvedAsset`, as for `Image`).
- `width`, `height` (shared sizes) and `color` (shared colour, a hex string)
  are omitted when absent. `widths`, `heights`, `rotation`, and `colors` are
  omitted when the prop is absent or a number.
- Columns are base64 of the raw bytes: `f32` little-endian for `x`, `y`,
  `widths`, `heights`, `rotation`; `u8` RGBA for `colors`.
- Node encodes with
  `Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64')`,
  so a `subarray` view sends only its own elements. A non-`Float32Array`
  column is converted with `Float32Array.from` first (a non-`Uint8Array`
  colour column with `Uint8Array.from`, which wraps values modulo 256, so
  authors pass 0–255).

100,000 particles with every column is 3.6 MB of data, 4.8 MB as base64,
against 26 MB of JSON for 100,000 `Rect` layers, and neither side formats or
parses a number per particle.

The JSON fast path of `JSON.stringify` (see
`docs/performance/react-scene-serialization.md`) bails out on strings that
are not flat. Whether V8 makes large base64 results external strings, and
whether those bail out, is measured during implementation; the
`flat-strings` test is extended to cover an `Instances` frame, and
`flatString()` is applied if needed.

### Rust (`celesta-composition`)

```rust
LayerContent::Instances {
    count: u32,
    shape: InstanceShape,
    /// Shared sizes; per-particle `widths`/`heights` take precedence.
    width: Option<f64>,
    height: Option<f64>,
    /// Shared colour (hex) when `colors` is absent; white when both are.
    color: Option<String>,
    x: F32Column,
    y: F32Column,
    widths: Option<F32Column>,
    heights: Option<F32Column>,
    rotation: Option<F32Column>,
    colors: Option<U8Column>,
}

pub enum InstanceShape {
    Rect { corner_radius: f64 },
    Circle,
    Image { asset: ResolvedAsset },
}

pub struct F32Column(pub Arc<[f32]>);
pub struct U8Column(pub Arc<[u8]>);
```

- `F32Column` and `U8Column` serialize as base64 strings and deserialize
  from them (the `base64` crate, at the 0.22 already in `Cargo.lock`);
  ts-rs emits them as `string`. `Arc` keeps cloning a `Scene` cheap.
- Deserializing rejects a column whose length is not `count` (`4 * count`
  for `colors`), so renderers can index columns without checks. The check
  runs in `LayerContent`'s `Deserialize` right after the tagged mirror, so
  it guards every deserialized scene, not only the bridge's.
- `LayerContent::Instances` and `InstanceShape` get externally tagged
  mirrors for `TypeTagged`, and join `every_tagged_variant_round_trips`.
- Codegen regenerates `packages/react/src/generated/`; `scene.ts`
  re-exports `InstanceShape`.
- Project JSON (`celesta-project`, `TimelineContent`) does not get
  `Instances`. It is a React-only layer.

### Other consumers

- `celesta-exporter`'s `absolutize_layers` absolutizes an `Image` shape's
  asset.
- The editor shows an `Instances` layer as one layer in the timeline and
  Inspector; nothing else in the editor looks inside it.
- `celesta-bench` workloads and the examples that match `LayerContent`
  exhaustively get the new arm.

## GPU renderer (`celesta-gpu-renderer`)

### Prepare

`prepare_layer` turns an `Instances` layer into one
`PreparedItem::Instances(PreparedInstances)`:

```rust
pub(crate) struct PreparedInstances {
    pub(crate) state: LayerState,      // the layer's transform, opacity, clip
    pub(crate) shape: PreparedInstanceShape,  // rect params, or a texture
    pub(crate) columns: InstanceColumns,      // Arc clones of the scene's columns
    pub(crate) bounds: PixelBounds,    // every particle's quad, in scene pixels
    pub(crate) shape_box: PixelBounds, // without filter margins
}
```

- A non-normal blend mode is wrapped in `BeginGroup`/`EndGroup` exactly as
  an isolated group; effects are wrapped by the existing effect handling.
- `bounds` is one pass over the columns: the union of each particle's
  centre ± half its diagonal, transformed by the layer's affine, grown as a
  rect's bounds are. `plan_groups` reads it like a layer's `bounds()` and
  `shape()`.
- An `Image` shape's texture comes from the same cached path as an `Image`
  layer, rasterized for the layer's density times the largest particle
  scale relative to the image's natural size, with mipmaps for smaller
  particles.

### Instances and draws

When the steps are built, `PreparedInstances` writes `count`
`LayerInstance`s (the existing 144-byte format) into the frame's instance
bytes:

- Particle affine = layer affine × translate(x, y) × rotate(rotation), with
  anchor (0.5, 0.5) and size (w, h).
- `rect`/`circle`: kind 1 (shaded rect); `rect` data
  `[w/2, h/2, radius, 0]`; `fill` the particle's straight RGBA in 0–255;
  `stroke` zero.
- `image`: a new kind 3, a texture multiplied by `fill / 255` in
  `layer.wgsl`; kinds 0–2 are unchanged.
- A particle with a non-finite value is written as a zero-size quad.
- Writing uses one reserved `Vec<u8>` and `bytemuck` casts of a
  `#[repr(C)]` instance struct; nothing allocates per particle.
- The whole layer is one `GpuDraw` with `instances: start..start + count`,
  joined with neighbouring draws of the same texture by the existing rule.

`instance_count` counts `count` for each `Instances` item. A frame whose
instances exceed `max_buffer_size` fails with the existing
`TooManyLayers` (about 1.8 million particles at a 256 MiB limit).

## CPU renderer (`celesta-renderer`)

The reference renderer draws particle by particle:

- `rect`/`circle`: `rasterize_rect_transformed` with the particle's solid
  colour, then `render_output_pixels`, as a `Rect` layer.
- `image`: the image's pixels composited with a colour multiplier, a new
  parameter of the image compositing helper (white keeps today's output).
- The CPU renderer does not rotate layers. Any non-zero particle rotation
  returns `RenderError::UnsupportedRotation`, as a rotated `Rect` does.
- A non-normal blend mode isolates the layer through the CPU renderer's
  existing group isolation.

## Errors

| Condition | Where | Error |
| --- | --- | --- |
| Bad `count`, column type or length, shape, missing size, big-endian host | `@celesta/react` walk | thrown `Error` with the prop name |
| Column length does not match `count` | scene deserialization | serde error, reported by the bridge as a frame error |
| Image cannot be decoded | GPU and CPU renderers | existing `ImageDecode` |
| Too many instances for the device | GPU renderer | existing `TooManyLayers` |
| Rotation on the CPU renderer | CPU renderer | existing `UnsupportedRotation` |

## Testing

- **composition:** base64 round trip of both column types; length mismatch
  rejected for each column; shared and per-particle sizes; every tagged
  variant round trips.
- **React (`packages/react/test/instances.test.mjs`):** the emitted layer
  JSON for shapes and image; a `subarray` column sends only its elements;
  `number[]` columns are accepted; each validation error; the layer's
  `scale`/`opacity` and an identity position and rotation; the frame has no
  cons or sliced strings (`flat-strings` test).
- **GPU (`tests.rs`):** an `Instances` layer renders the same pixels as the
  equivalent scene of `Rect` layers anchored at their centres, for `rect`,
  `circle`, per-particle sizes, colours, and rotations; a blend-mode
  `Instances` matches the same particles as `Rect`s in a `Group` with that
  blend mode; an image shape's colour multiplier against expected pixels;
  particles inside a clipped group; a non-finite particle draws nothing.
- **CPU:** the same `Rect` equivalence without rotation; the image colour
  multiplier; rotation is rejected; GPU and CPU agree on an unrotated
  `Instances` scene within the tolerance existing parity tests use.

## Benchmarks and done criteria

- `dense-geometry-bench` gets an `instances` geometry beside `rects` and
  `paths`, drawing the same ribbons as one `Instances` layer.
- A React entry with 100,000 particles and every column, for
  `protocol-bench`.

On the Apple M4, with 100,000 particles and every column:

- `protocol-bench` median: 158 ms → **≤ 20 ms** per frame.
- GPU renderer (excluding scene building): ~30 ms → **≤ 10 ms** per frame.

If either is missed, the result is reported with a profile of where the
time goes before the work is called done.

## Documentation

- `docs/handoff/2026-10-12-instances.md`: what was built and why.
- `docs/performance/instances.md`: the measurements above, before and after.
- README "What you can do": particles.
- `skills/celesta`: how and when to use `<Instances>`.
