# Density-banded planes design

Follows `2026-10-16-skew-3d-transform-design.md` (issue #300, PR #390), which
this builds on.

## Goal

A projective layer (a `perspective` and a 3D rotation) is drawn through a
plane: its content is rasterized onto one canvas at one scale, that of its
most magnified visible corner, and the canvas is projected onto its parent.
The canvas is capped at the device's maximum texture dimension and 4 times
the scene's pixel area (the browser also caps it at 16,777,216 pixels), so a
long receding plane is lowered a long way. A text column 1200 wide and 20000
tall at `rotationX={70}` and `perspective={800}`, its near edge at the
bottom of a 1920x1080 scene, needs 2.38 at its near corners (1.48 in the
middle of the near edge) but is drawn at 0.587 with a 16384 texture limit
and 0.41 with 8192, so its near text is 4 to 6 times too soft.

Density banding splits such a plane into bands along lines of equal `w`,
each with its own raster scale and canvas, so every band is as sharp as its
own nearest part. With the same budget, the crawl above becomes 8 bands
totalling 4.30M pixels, its near band at the full 2.38.

A single text layer that tall also exceeds the texture limit on its own, so
the GPU renderer also learns to rasterize only a window of a text layer.

## Why bands

`w = g·x + h·y + i` is affine in the layer's local units, and how much the
projection magnifies a point depends mainly on `w` (about `1/w` across and
`1/w²` along the receding direction). Lines of equal `w` are therefore
parallel lines of nearly equal magnification, and the plane splits naturally
into strips between them.

## Band geometry

`plane_bands` in `crates/gpu-renderer/src/plane.rs`, mirrored by
`planeBands` in `packages/web/src/projection.ts`. It replaces the single call
to `plane_raster` in `prepare_plane` and the web `plane()`.

1. The visible polygon `P` is built as today: the content's local box,
   clipped to `w ≥ 1/16` (`NEAR_W`) and then to what the target shows
   (`clip_to_shown`).
2. Today's single `PlaneRaster` is computed. If it was not lowered (its
   scale is the rounded, clamped stretch at `P`'s most magnified corner), it
   is the only band and nothing changes: such planes render byte for byte as
   before and prepare their content twice, as now.
3. A plane also stays one canvas, capped as today, when:
   - its content runs a custom shader or built-in shader effect (the
     measure pass used a shader, `shaders.use_count()`), as those work in
     the plane's own pixel grid and could differ from band to band;
   - an enclosing plane is only being measured (`measuring_plane`, whose
     target is unbounded);
   - the bands below come to one.
4. Boundaries. `w_near` and `w_far` are the least and greatest `w` at `P`'s
   vertices. The band count is
   `n = ceil(log(w_far / w_near) / log(√2))`, at most `MAX_BANDS` (8), and
   the boundaries are geometric:
   `b_j = w_near · (w_far / w_near)^(j / n)` for `j = 0..=n`. With √2 steps
   a band's magnification varies by about 2 times at most; past 8 bands the
   steps widen.
5. Band `k`'s polygon is `P_k = P ∩ {b_k ≤ w ≤ b_(k+1)}`, by the same exact
   half-plane clip (`clip_polygon`). Its scale `s_k` is the largest stretch
   at `P_k`'s corners, rounded up to an eighth of an octave and clamped to
   `[2^-6, 2^6]`, as a single plane's is.
6. Overlap. Band `k`'s canvas covers `P` clipped to
   `b_k − δ ≤ w ≤ b_(k+1) + δ`, the growth only on sides that meet another
   band, with `δ = |(g, h)| · (MARGIN / s_k + reach + footprint(b))`:
   `MARGIN` is 4 texels (the footprint filter's bilinear neighbours at a
   seam); `reach` is the farthest any effect inside the plane spreads past
   its content, in local units, taken from the measure pass's `EndEffect`
   items (`EffectSpec::output_bounds` of an empty box), so a blur that
   crosses a seam sees the same content in both bands; and `footprint(b)` is
   how far half an output pixel on the boundary `b` reaches across it, in
   local units (the pixel square mapped back through the inverse of the
   projection's Jacobian at the boundary's ends). Where the plane recedes
   steeply a pixel spans tens of texels in depth, and the taps of a pixel on
   one side of a seam read that far into the other. The canvas is that polygon's
   box at `s_k`, with today's 1-pixel transparent margin and 128-pixel size
   steps.
7. Budget. Each band's canvas stays within the maximum texture dimension on
   either side, a band over it lowered on its own as a single plane is. The
   bands' canvases together stay within 4 times the scene's area (in the
   browser, within the lesser of that and 16,777,216): over it, every band's
   scale is multiplied by one common factor, the largest that fits.
8. The result is a list of `PlaneRaster`s, each with its `w` range: band `k`
   holds `w` in `[b_k, b_(k+1))`, the nearest band's near side and the
   farthest band's far side unbounded.

For the crawl above: 8 bands from `w` 0.676 to 24.17, scales 2.378, 1.189,
0.707, 0.42, 0.273, 0.162, 0.105, and 0.068, canvases from 2857x782 down to
84x536, 4.30M pixels in all (the single canvas would be 706x11734 at 0.587).
The example's floor (`with-3d-transform.tsx`) becomes three bands at 2.18,
1.54, and 1.0 instead of one at 2.09.

## GPU renderer

### Preparation

`prepare_plane` measures the content once, as today, and the measure pass
also returns the effects' reach and whether a shader was used. For each band
it then does what it does today for the one canvas, with that band's
`to_plane`: pushes a `PlaneEntry`, emits `BeginPlane { width, height }`,
prepares the content with `scene_size` set to the band's canvas and the
band's `effect_scale` (`s_k` over the stretch at the origin), and emits
`EndPlane`. A banded layer is `n` plane pairs in a row; the planner, encoder,
and texture pool already handle any number of them.

The band's canvas is its clip: content outside it lands off the render
target, paths are already outlined only within their `space`, and text is
windowed (below). A text layer whose measured box misses the band's canvas
is skipped in that band, so each band rasterizes only the text it shows; the
overlap holds the effects' reach, so no effect of a skipped text reaches the
pixels the band draws. No `ClipEntry` is added, as one would anti-alias
inside the overlap.

Since `effect_scale` is `s_k` over a stretch shared by every band, an effect
inside the plane has the same size in local units in every band, and lines
up across seams.

Banded planes prepare their content `n + 1` times a frame (once to measure,
once per band); unbanded planes twice, as now.

### Coverage

Each band's canvas holds more than its band (the overlap), so the bands'
canvases overlap where they are drawn. Drawing the overlap twice would show
every seam as a darker line wherever the content or the layer is
translucent, so instead every output pixel is drawn by exactly one band.

`1/W` is affine in the target's pixels: if `(u, v, t)` is the bottom row of
the inverse of the layer's forward map (local units to the target's space),
`1/W = u·X + v·Y + t` at target position `(X, Y)`. So:

- `PreparedContent::Canvas` gains a band, `(u, v, e_far, e_near)`, written
  into the canvas instance's `fill`, which a canvas leaves unused, so
  `LayerInstance` stays 144 bytes.
- `(u, v, t)` is computed once per layer, in f64, and rounded to f32 once.
  Each boundary's `e = t − 1/b` is computed once and given to both bands
  that meet there; at `write_instance` both add the target canvas's origin
  (`u·x0 + v·y0`) by the same expression. Neighbouring bands thus carry
  bit-identical values for their shared boundary.
- `fs_main` and `fs_blend` compute `s = u·x + v·y` at the fragment's pixel
  centre (`@builtin(position).xy`), after the derivatives, and discard unless
  `s + e_far > 0 && s + e_near ≤ 0`. Where two bands meet, one tests
  `s + e ≤ 0` and the other `s + e > 0` on the same `s` and `e`, so each
  pixel passes exactly one.
- An unbanded canvas, and every other canvas, writes `(0, 0, 1, −1)`, which
  always passes, so their pixels do not change.
- The `w < 1/16` discard is kept as is.

Each band draws with the layer's opacity and blend mode. The bands cover
disjoint pixels, so each pixel composites once, and a backdrop copied
between bands is still the right one for the pixels the next band covers.

### Hit testing

Each band is a `PlaneEntry`, as a plane is now. A layer is one hit region
however many bands draw it: a layer that an earlier band of the plane
already recorded is left out of the later ones. Every band holds the same
content, so whichever band's region a pointer maps into answers the same.

## Text windows

A GPU text layer is one texture, and `rasterize_text` lowers its scale until
its larger side fits the texture limit. A text column 20000 tall would be
lowered to 0.41 even in a band that needs 2.38.

- When a text layer's whole raster (its layout size times its raster scale,
  plus the stroke and overflow pads) would exceed the texture limit on
  either side, it is rasterized only for a window: the target canvas
  (`scene_size`) mapped back through the text's affine state into the
  text's raster pixels, intersected with its box, and snapped outward to a
  grid of 512 raster pixels. When the target shows none of it, it is not
  drawn. A windowed text's hit region is the whole text's box.
- `TextRasterizer::rasterize` (`celesta-renderer`) takes an optional
  window. The layout is the same as without one; glyphs, decorations, and
  runs outside the window are skipped, and the image covers only the window.
  Its anchor box (`AnchorBox`) is relative to the window and signed, so
  `text_layer` places the window exactly where that part of the whole text
  would land.
- The window is part of the texture key. A scrolling crawl therefore reuses
  its textures until a window edge crosses a grid line.
- The layout size needed to decide this is measured once per text, style,
  and width, and cached and evicted with the text textures.
- Text whose raster fits takes today's path with today's keys. This applies
  wherever text is drawn, so a flat credits roll 20000 tall is windowed too,
  instead of drawn at 0.41.

The browser renderer draws text into its canvases directly and needs no
windows.

## Web renderer (`@celesta/web`)

- `planeBands` as above; `planeBox` also returns the effects' reach and
  whether the content runs a shader.
- The browser draws a plane as affine triangles (`plane-pieces.ts`, #394),
  not pixel by pixel, so a band is not cut per pixel there. `drawPlane`
  with a band's depth range draws the band's canvas whole onto a layer and
  replaces the target with it within the band's strip grown by a pixel:
  `1/W` is affine in target pixels, so the strip is a convex polygon, and
  the target is cleared and added to through it, the clip's coverage
  blending a seam pixel between two bands that are both right there. A
  band's canvas holds its content `PLANE_SEAM` (6.5) target pixels past its
  boundaries (`planeBands`'s `seam`, half a pixel on the GPU), room for that
  pixel and for the triangles' overlap and warp where the canvas ends.
- `plane()` makes one surface over where the whole plane lands. For each
  band it draws the content onto a canvas of the band's size at the band's
  `toPlane`, draws it through `drawPlane` with the band's range, and frees
  the canvas. The surface is drawn onto the parent once, at the layer's
  alpha.

## Testing

GPU pixel tests, in a new `crates/gpu-renderer/src/tests/plane_bands.rs`:

- Crawl sharpness: a 1920x1080 scene with one text layer 1200 wide and about
  20000 tall at `rotationX` 70 and `perspective` 800, its near edge near the
  bottom of the screen, against a short plane holding only the bottom 600
  units of the same text with the same near edge on screen. The mean
  absolute alpha step between neighbours over the rows just above the near
  edge must be at least 0.9 times the short plane's (before banding, 0.83
  times for one text layer and 0.69 for many).
  The same with the column made of many small text layers.
- No seams: a long banded plane of a uniform rect at 50% opacity, with
  `normal` and with `multiply`; every pixel inside it is equal within 1 per
  channel, so no row is drawn twice or skipped.
- A blur across a seam: in a small scene, a test-only plane area limit forces
  banding; smooth content with a blurred shape across a band boundary,
  rendered banded and as one uncapped canvas, matches within a small
  tolerance.
- Hit testing finds the layer through the nearest and the farthest band.
- Flat text 20160 tall (more than a 16384 texture holds) at scale 1 is as sharp as a short text of the same lines.

Unit tests:

- `plane_bands` (Rust) and `planeBands` (node): an uncapped plane is one
  band equal to `plane_raster`'s; bands' `w` ranges tile `[w_near, w_far]`
  geometrically, sharing their boundaries; at most 8 bands; each scale at
  least the stretch at its corners while within budget; the total within
  budget; nothing nearer than `NEAR_W`; the crawl gives 8 bands with a near
  scale of 2.378 in both.
- `plane-pieces.test.mjs`: a long plane drawn in bands with the software
  canvas is as close to the GPU's warp as the plane drawn whole, at the
  median, the 90th and 99th percentiles, and at worst; a band's strip holds
  only its range of `w`.
- `scene-canvas.test.mjs`: a long plane draws through several offscreen
  canvases and composites onto its parent once, at its alpha.
- `celesta-renderer`: a windowed raster equals the same rows and columns of
  the whole raster byte for byte, and a text whose raster fits is never
  windowed.

## Example and documentation

- `packages/cli/examples/with-3d-crawl.tsx`: the crawl above, scrolling. Its
  before (PR #390's head) and after screenshots go in the pull request.
- A handoff note, `docs/handoff/2026-10-16-plane-density-bands.md`.
- `docs/handoff/2026-10-16-skew-3d-transform.md`, "Known limitations": the
  softness of long planes becomes the limits that remain. A plane that is
  huge but barely recedes (one band) is still capped; a plane whose content
  runs a shader is not banded; a blur that reaches the 64-plane-pixel cap
  can differ across a seam. The example floor's numbers are updated.
- The layout guide's note (`packages/website/content/{en,ja}/docs/02-(guides)/04-layout.md`):
  the picture is split by distance into bands, each as sharp as its nearest
  part, so a long crawl stays sharp up close; what remains limited as above.
