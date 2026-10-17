# Density-banded planes (2026-10-16)

Follows the skew and 3D transforms (PR #390,
`docs/handoff/2026-10-16-skew-3d-transform.md`). The design is in
`docs/superpowers/specs/2026-10-16-plane-density-bands-design.md`, the plan
in `docs/superpowers/plans/2026-10-16-plane-density-bands.md`.

## What changed

A projective layer's plane used to be one canvas at the scale of its most
magnified visible corner, lowered to fit the largest texture and 4 times the
scene's area. A long receding plane was lowered a long way: the example
crawl (one text layer 1200 wide and about 20000 tall, `rotationX={70}`,
`perspective={800}`) needs 2.38 at its near corners and was drawn at 0.587
(16384 texture limit) or 0.41 (8192).

Now such a plane is drawn in up to 8 bands of equal depth, each at the scale
its own nearest part needs. The crawl becomes 8 bands, 2.378 down to 0.068,
4.30M pixels in all, its near text as sharp as a short plane's. A plane that
fits one canvas takes the old path and renders as before.

## GPU renderer

- `plane_bands` (`crates/gpu-renderer/src/plane.rs`) replaces the single
  `plane_raster` call (which stays, for tests). It bands only when the one
  canvas would be lowered below its needed scale, `bandable` (no shader in
  the content but color filters: `ShaderProcessor::uses_pixel_grid_since`),
  and not while an enclosing plane is measured. Boundaries are geometric in
  `w` (`√2` steps, at most `MAX_BANDS` 8). Each band's canvas covers its
  `w` range grown, on sides shared with another band, by 4 texels, the
  effects' reach (from the measure pass's `EndEffect` items), and half an
  output pixel's footprint across the boundary (`half_footprint`, from the
  Jacobian at the boundary's ends; a steep plane's pixel spans tens of
  texels in depth). The bands share the budget: each side within the
  texture limit, their area within `plane_area_limit` (4) scene areas, all
  lowered by one factor past it.
- `prepare_plane` emits one `BeginPlane`/`EndPlane` pair per band
  (`prepare_band`). The canvas instance carries `(u, v, e_far, e_near)` in
  its `fill` slot (`PreparedContent::Canvas::band`; `WHOLE_BAND` is
  `(0, 0, 1, -1)` for every other canvas): `(u, v, t)` is the bottom row of
  the inverse of the layer's forward map, so `1/W = u·x + v·y + t`, and each
  boundary's `t − 1/b` is computed once for both bands meeting there.
  `write_instance` adds the target canvas's origin by the same expression.
  `layer.wgsl`'s `outside_band` discards a fragment unless
  `s + e_far > 0 && s + e_near <= 0` at its pixel centre
  (`@builtin(position)`, which is in scene pixels: any plane makes a frame
  composite through scene-sized canvases). Each pixel is drawn by exactly
  one band, so opacity, blend modes, and translucent content composite once.
- Hit leaves: a layer recorded by an earlier band of a plane is left out of
  the later ones, so a layer stays one region.
- Text windows: when a text layer's whole raster would not fit the texture
  limit, `TextPlacement::windowed` (`text.rs`) picks the part of it the
  target canvas shows, snapped out to 512 raster pixels
  (`TEXT_WINDOW_STEP`), and `TextRasterizer::rasterize_window`
  (`celesta-renderer`) rasterizes only that, laid out as the whole text and
  byte for byte the same pixels. The window is in the texture key, so a
  scrolling crawl re-rasterizes only when a window edge crosses the grid.
  Single-line text is never windowed (its rows are trimmed to its ink). A
  windowed text's `shape` (its hit region) is the whole text's box; one its
  target shows none of is not drawn. Text sizes are measured once and kept
  in `GpuRenderer::text_sizes`, evicted with the textures. This applies to
  flat text too: a 20000-tall credits roll is no longer lowered to fit.
- Inside a band, a text layer whose box misses the band's canvas is skipped,
  so each band rasterizes only the text it shows.

## Web renderer

- `planeBands` in `packages/web/src/projection.ts` mirrors the GPU's, with
  the same numbers in the tests. Its `seam` (target pixels a band's canvas
  holds past its boundaries) is half a pixel by default, as on the GPU; the
  browser passes `PLANE_SEAM` (6.5), as it draws a band's plane whole and
  then keeps a strip of it.
- The browser draws planes as affine triangles (`plane-pieces.ts`, from
  #394), so a band cannot be cut per pixel there. `drawPlane` with a depth
  range (`drawBand`) draws the band's canvas whole onto a layer, then
  replaces the target within the band's strip grown by a pixel
  (`bandStrip`: `1/w` is affine in target pixels, so the strip is a convex
  polygon): cleared there and added, the clip's coverage blending it with
  what an earlier band drew. Both bands are right in that pixel of overlap,
  so the seam does not show. Clipping the triangles at the band instead
  left slivers along it whose filters shifted their samples by pixels.
- `scene-canvas.ts`'s `plane()` draws each band onto a canvas of its own
  and through `drawPlane` onto one surface over where they all land, which
  is drawn onto the parent once. `planeBox` returns the effects' reach and
  whether the content is bandable (only color filters). The browser draws
  text into its canvases directly and needs no windows.
- Tests: `plane-pieces.test.mjs` draws a long plane in bands with the
  software canvas and checks it is as close to the GPU's warp as the plane
  drawn whole (a seam that adds instead of replacing fails it at once).

## Example

`packages/cli/examples/with-3d-crawl.tsx`: the crawl, scrolling away for 8
seconds. Frames 0 and 120 were rendered with a release `celesta-exporter`
from this branch and from `996ba1ae` (PR #390's head) for the pull request's
before and after shots; the near text is crisp after and blurred before,
strokes converge on the vanishing point on both sides, and no seam shows.
The runtime the exporter loads had to be rebuilt in this worktree first
(`pnpm --dir packages/react run codegen`, then `pnpm run build:runtime`).

## Known limitations

- A plane that is huge but barely recedes is one band and still lowered.
- A plane whose content runs a custom shader or a built-in stylize effect is
  not banded (they work in the plane's own pixel grid).
- A blur capped at 64 plane pixels can differ either side of a seam.
- Banded planes prepare their content once per band, plus the measuring
  pass; the far bands are small, but the CPU work grows with the band count.

## Checks

Run on macOS (Apple silicon, Metal) with Homebrew `ffmpeg@8` on
`PKG_CONFIG_PATH` and `CELESTA_REQUIRE_GPU=1`.

- `cargo fmt --all -- --check`, `git diff --check`: clean.
- `cargo test -p celesta-composition -p celesta-gpu-renderer -p
  celesta-renderer -p celesta-project -p celesta-evaluator -p celesta-mcp`:
  all pass (`celesta-gpu-renderer` 231 passed, 1 ignored, the GPU pixel
  tests ran; `celesta-renderer` 192 + 1), rebased onto `main` after #394.
- `cargo clippy --no-deps --all-targets -- -D warnings`: clean for
  `celesta-gpu-renderer` and `celesta-renderer`.
- `pnpm --dir packages/web test`: 105 passed. `tsc --noEmit` in
  `packages/web`: clean.
- `pnpm run test:runtime`: pass (`@celesta/react` 157, among others).
- The example type-checks with `tsc --noEmit` against the built runtime's
  project types and exports with `celesta-exporter --react`.
- Not run: the browser editor against the crawl by eye (the web renderer is
  covered by its node tests), and Windows.
