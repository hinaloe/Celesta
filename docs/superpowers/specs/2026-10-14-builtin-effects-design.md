# Built-in stylize effects and chroma key design

Issues #292 (pixelate, halftone, chromatic aberration, wave, noise,
scanlines, zoom blur) and #294 (chroma key). Both extend the built-in
filters #285 added: a layer's `filters` list, run by the GPU renderer as
passes of the shader chain and by `@celesta/web` on the layer's pixels.

## API

Each effect is a prop on every visual layer and `Group` (`CommonProps`),
and a function of the same name in `@celesta/shader` for the `shader`
array, as the color filters are. Spatial values are output pixels, angles
degrees, amounts 0–1. A number is the first field.

| Prop | Value | Defaults |
| --- | --- | --- |
| `pixelate` | `size` \| `{ size }` | — |
| `halftone` | `size` \| `{ size, angle }` | `angle: 45` |
| `chromaticAberration` | `offset` \| `{ offset, angle }` | `angle: 0` |
| `wave` | `{ amplitude, wavelength, phase, angle }` | `phase: 0, angle: 0` |
| `noise` | `amount` \| `{ amount, seed, monochrome }` | `seed`: the local frame, `monochrome: true` |
| `scanlines` | `amount` \| `{ amount, spacing, thickness, offset }` | `spacing: 4, thickness: 0.5, offset: 0` |
| `zoomBlur` | `amount` \| `{ amount, centerX, centerY }` | `centerX: 0.5, centerY: 0.5` |
| `chromaKey` | `color` \| `{ color, tolerance, softness, spill }` | `tolerance: 0.2, softness: 0.1, spill: 0.5` |

The props run after the `shader` array in this order:
`chromaKey`, `pixelate`, `wave`, `zoomBlur`, `chromaticAberration`, the
color filters (`brightness` … `vignette`), `halftone`, `noise`,
`scanlines`; then `shadow`/`glow` and `blur`. Keying comes first so it sees
the source's colors, geometry before grading, and the overlays last. Values
that change nothing add no filter: `pixelate` of 1 or less, `halftone` of 0,
and an `offset`, `amplitude`, or `amount` of 0. The functions always add
one. Project timelines (`TimelineEffects`) do not take these effects.

## Semantics

`box` is the content box (`celesta.content`, the box of the layers'
shapes), `local = position - box.xy`, and `source_at` the bilinear,
premultiplied read the custom shader prelude has. Each effect runs as one
pass and clamps as the custom shader entry does.

- **pixelate**: cells of `size` from the box's top-left. A pixel takes its
  cell's average of 4×4 bilinear samples at the cell's sub-cell centres.
  Padding `size`.
- **halftone**: cells of `size` in a grid turned by `angle` about the box's
  top-left. Each cell's colour is the average of 4×4 samples over the
  turned cell. Its dot is a circle at the cell's centre of radius
  `size * sqrt(luma / π)` (the area is `luma` of the cell; Rec. 709 luma of
  the straight colour), cut to the cell, anti-aliased over one pixel, drawn
  in the cell's premultiplied colour; between the dots is transparent.
  Padding `size * √2`.
- **chromaticAberration**: `d = offset * (cos angle, sin angle)`; red from
  `source_at(p - d)`, green from `p`, blue from `p + d`; alpha the largest
  of the three. Padding `|offset|`.
- **wave**: `d = (cos angle, sin angle)`, `n = (-sin angle, cos angle)`;
  reads `source_at(p - d * amplitude * sin(2π dot(local, n) / wavelength +
  phase))`. At angle 0 the rows sway sideways. Padding `|amplitude|`.
- **zoomBlur**: the centre `c = box.xy + (centerX, centerY) * box size`;
  the average of 32 samples `source_at(c + (p - c) * (1 - amount * i / 31))`.
  Streaks run outward, beyond the box: padding
  `amount / (1 - amount) * scene diagonal`, at most 512 (the shader
  chain's limit), so very long streaks are cut 512 pixels past the content.
- **noise**: on the straight colour, `rgb += amount * (2u - 1)`, `u` from a
  32-bit integer hash (PCG) of the scene pixel and the seed: one value for
  all three channels when monochrome, one per channel otherwise. The seed is
  an integer; GPU and browser hash the same bits, so the random values match
  exactly. Omitted, it is the layer's `useCurrentFrame()` (local inside a
  `<Sequence>`, held inside a `<FreezeFrame>`), so the grain moves each
  frame and any frame renders the same way twice. A `<Static>` subtree
  cannot depend on the time, so a noise there needs a `seed`.
- **scanlines**: horizontal bands from the box's top plus `offset`, one per
  `spacing`, `thickness * spacing` thick. A pixel is darkened by
  `amount` times the part of its height the bands cover (exact box
  coverage), multiplying the straight colour.
- **chromaKey**: BT.709 full-range YCbCr of the straight sRGB-encoded
  colour (`Cb = (B - Y) / 1.8556`, `Cr = (R - Y) / 1.5748`). With `d` the
  CbCr distance to the key colour's, the alpha is multiplied by
  `smoothstep(tolerance, tolerance + softness, d)`. Spill: the CbCr
  component along the key's chroma direction, where positive, shrinks by
  `spill`, keeping Y. Neutral colours lie at the key's chroma magnitude
  (0.36 for `#00b140`, 0.60 for `#00ff00`), so `tolerance + softness` must
  stay below it to keep greys opaque; the defaults do for those keys.

## Model and renderers

- `LayerFilter` gets one variant per effect with every field (the walker
  fills defaults; `noise.seed` is resolved to an integer).
- GPU: `builtin_effect.wgsl`, assembled like a custom shader with two
  `vec4` parameters (kind and values), compiled once on first use. Each use
  records its padding, so `ShaderChain::padding` grows the canvas as a
  custom shader's does. The seed travels as two exact 16-bit halves.
- `@celesta/web`: the filter pass moves from 8-bit in-place arithmetic to a
  premultiplied `Float32Array`. Colour filters stay per pixel; the others
  read a copy and write the content box grown by their padding, clamped to
  the surface, as the GPU's `written` region. Sampling repeats
  `source_at`. The content box is computed once when any filter needs it.
- Tests: a GPU test renders a test pattern without and with each effect and
  compares with committed fixtures; the web test runs its filters on the
  unfiltered fixture and compares with the filtered ones.
