# Skew and 3D transforms (2026-10-16)

Issue #300. Every layer and `Group` takes `skewX`/`skewY`, `rotationX`/
`rotationY`, `perspective`, and `backfaceVisibility`. The design is in
`docs/superpowers/specs/2026-10-16-skew-3d-transform-design.md`, the plan in
`docs/superpowers/plans/2026-10-16-skew-3d-transform.md`.

## Model

- `EvaluatedTransform` (`crates/composition/src/model.rs`) gains `skew`,
  `rotation_x`, `rotation_y`, `perspective: Option<f64>`, and
  `backface_visibility`. JSON names are `skew` (`{x, y}`), `rotationX`,
  `rotationY`, `perspective`, `backfaceVisibility` (`"visible"` |
  `"hidden"`), all inside `transform` and omitted at their defaults, so old
  scenes and compact React frames are unchanged. The generated TypeScript
  type marks all five optional (`ts(as = "Option<..>", optional)` on the
  defaulted ones). A `perspective` that is not finite and positive means
  none, everywhere.
- Matrix: `M = T(position) · P(perspective) · Rx · Ry · Rz(rotation) ·
  K(skew) · S(scale)`, `K = [[1, tan(skew.x)], [tan(skew.y), 1]]`, `Rx`/`Ry`
  as CSS `rotateX()`/`rotateY()`, `P` sets `w = 1 - z / perspective`. Dropping
  the Z row and column gives the 3x3 homography `H` from local points to the
  parent's plane. A group turns about its own origin, any other layer about
  its anchor, which is also its vanishing point. The matrix math is in
  `crates/composition/src/projection.rs`. A flat transform (no skew, no 3D
  rotation: `is_flat`) builds `linear()` directly as `Rz · S`, one `sin_cos`
  and no 3x3 products, equal entry for entry to the general path
  (`linear_3d`).
- Facing: `O = O_parent · L` with `L = Rx · Ry · Rz · K · S`; a layer faces
  away when `cofactor_zz(O) / det(O) < 0`. Exactly 0 (edge-on) counts as
  front but draws nothing. A mirror leaves it positive. Perspective plays no
  part, so a plane far from its vanishing point can differ from CSS.
  `backfaceVisibility: 'hidden'` skips the layer and, for a group, its subtree.
- Children are flattened into their parent's plane (CSS `transform-style:
  flat`); there is no depth sorting, 3D `Instances`, or 3D `Camera`.
- Project files take the same fields in `transform` (`skew`, `rotationX`,
  `rotationY`, `perspective` animatable; `backfaceVisibility` not). Numbers
  must be finite and `perspective` positive at every keyframe.
- React: `CommonProps` in `packages/react/src/components.ts`;
  `extractTransform` reads the props and `compactTransform` leaves them out at
  their defaults. A non-positive or non-finite `perspective` is left out.
- `Layer` grew from 312 to 368 bytes (`layers_stay_small` is 368);
  boxing the 3D fields would have rippled through the `Copy` transform.

## GPU renderer

- Skew and orthographic 3D rotation are affine: `Affine::from_transform`
  builds the 2x2 of `L` plus the translation, so rects, paths, text raster
  scales, clips, hit regions, and instancing take the existing path. A
  degenerate affine (edge-on, skew of 90 degrees, any entry non-finite, or a
  linear entry `a`..`d` above 1e7) draws nothing; the translation is not
  capped, so a group moved far away can move its children back. The browser
  renderer's `degenerate` applies the same cap.
- Cost for flat layers: `prepare_layer` multiplies the walk's orientation by
  a flat `L` with `multiply3_flat` (12 products), and a particle's own
  transform is `Affine::turned` (one `sin_cos`, no `linear()`). Measured on
  this machine (Apple silicon, release, best of 15 runs of 1M): a flat
  layer's linear part, orientation, and affine went from 18.4 ms (turning)
  and 15.8 ms (unturned) per million to 7.8 ms and 4.5 ms; a particle's from
  16.9 ms to 4.2 ms. The pre-branch f32 rotate-scale was 2.6 ms and 2.0 ms.
  So a 100k-layer frame pays about +0.25 to +0.5 ms over the pre-branch
  cost, down from +1.4 to +1.6 ms.
- A layer with a perspective and a 3D rotation is projective and goes through
  a plane canvas (`crates/gpu-renderer/src/plane.rs`), a texture leaf (image,
  video, PSD, text) included. `prepare_plane` runs two passes. The first
  (`measure_plane`) prepares the content in local units only to measure its
  bounds, then rolls everything back. The bounds are clipped to `w >= 1/16`
  (`NEAR_W`) and then to what the parent's canvas can show, by four exact
  half-plane clips (`clip_to_shown`: `X/W >= left` is `X - left·W >= 0`
  where `W > 0`), so a floor whose horizon shows is clipped too. The raster
  scale `s` is
  the largest stretch of the parent-to-target transform times `H` at the
  clipped polygon's corners (the nearest corner), rounded up to an eighth of
  an octave and clamped to `[2^-6, 2^6]`. It is lowered so the canvas, with a
  1-pixel margin and sizes rounded to 128-pixel steps, stays within the
  maximum texture dimension and 4 times the scene's pixel area. The second
  pass prepares the content for real with base transform `Scale(s) ·
  Translate(-origin)`.
- While measuring (`measuring_plane`), texture content is sized without
  being drawn: an image, SVG, PSD, or video frame stands in as a texture of
  the size the real one would have (`stand_in_texture`, sharing the
  placeholder's handles), from `ImageSources::layout` and
  `PsdSources::size_within` (the parsed PSD's canvas, the same level and
  `fit_within` limit as `render_within`). So an SVG is not rasterized and a
  PSD not composited at 1x only to be measured, nothing is uploaded, and the
  measured box, filter margin included, is the one the real texture gives.
  A video frame is still decoded once and kept for the second pass. Both
  passes prepare the layer's content from the layer itself
  (`prepare_plane_content`, then `prepare_content`), without cloning its
  subtree.
- The canvas draws onto its parent through the homography as one layer, with
  the layer's opacity and blend mode. The vertex shader writes
  `(x·w, y·w, 0, w)` so the rasterizer interpolates with perspective
  correction; fragments with `w < 1/16` get coverage 0, so the near clip binds
  the draw too. The fragment shader averages a grid of bilinear taps over the
  pixel's footprint in the canvas, at most 8 by 8, so the far side minifies
  without shimmer. The blend backdrop is sized only from blended canvases.
  The canvas's instance carries the homography's bottom row `(g, h, i)` in
  the `rect` slot, which a canvas leaves zero, flagged by sampling mode 2;
  `LayerInstance` stays nine `vec4`s (144 bytes) for every layer and
  particle.
- A projective group is isolated. Its own `blur`, `shadow`, `glow`, and
  filters apply after the projection in output pixels. Effects of layers
  inside a plane are measured in output pixels (`walk.effect_scale`: `s` over
  the stretch at the layer's origin, which `forward` always maps to `w = 1`),
  so a blur does not change size as the layer turns; custom shaders and
  built-in filters inside a plane run in the plane's own pixels. Blur radii
  inside a plane are capped at `MAX_BLUR` (64) plane pixels, native and web,
  so a large blur in a magnified plane comes out smaller. Planes nest.
- Per-walk data (accumulated orientation, `effect_scale`, current plane) lives
  in `GpuRenderer::walk`, saved and restored around each layer in
  `prepare_layer`, not in `LayerState`, which is copied into every prepared
  item (kept at 160 bytes).
- Hit testing: a projective canvas is a hit region of its own. The pointer
  maps through the inverse homography (rejecting `w <= 0`), at every plane
  level for nested planes, into the raster frame, where the children's regions
  are tested as before (`plane::hit_clips`).

## Other renderers and tools

- `@celesta/web` mirrors the GPU renderer in `packages/web/src/projection.ts`
  (DOM-free: matrix, facing, inverse-homography warp, footprint taps) and
  `scene-canvas.ts`: a projective layer draws into an offscreen canvas in the
  raster frame, then into its parent as affine triangles (`plane-pieces.ts`,
  see `2026-10-17-web-plane-triangles.md`). The plane canvas is also
  capped at 16,777,216 pixels (iOS Safari draws nothing past about that), the
  canvas grows by its descendants' effects' reach, and blurs are capped.
  A flat layer builds no 3x3 (`turnsFlat`, `turnFlat`), and one that neither
  turns nor scales keeps its parent's orientation object: 1M flat layers'
  orientation work went from about 1020 ms to 114 ms (turning) and 8 ms
  (unturned) in Node 24.
- The web warp is CPU work per pixel and the slow part of a browser preview
  of a large plane. Its tap sums are plain locals (they were captured by a
  closure, so V8 boxed them), taps whose texels are all in the source read
  them inline, footprints that cover only transparent 16x16 source tiles
  (a summed-area table) are skipped, and the tap count uses `Math.sqrt`
  rather than `Math.hypot`; the output is byte for byte the same (checked
  over 200 random planes and the floor below). A probe of the example's
  floor (a 3780x2193 raster of noise warped onto 1920x428 output pixels)
  went from about 747 ms to 115 ms per call in Node 24, and to 77 ms
  when half the source is transparent. It now draws only a band along the
  near clip and what no triangle filter fits: see
  `2026-10-17-web-plane-triangles.md` for the `drawImage` path that replaced
  it (about 120 ms to 31–38 ms for the floor in Chrome).
- The CPU reference renderer refuses a nonzero skew, `rotationX`, or
  `rotationY` with `RenderError::UnsupportedTransform { layer, property }`;
  `perspective` alone is accepted.
- `celesta-mcp`'s layer summary and `skills/celesta/scripts/inspect.mjs`
  describe skew, 3D rotation, perspective, and hidden backfaces; a
  non-positive perspective is not described.

## Example and documentation

- `packages/cli/examples/with-3d-transform.tsx` (1920x1080, 30 fps, 6 s): a
  card that turns over every three seconds (`rotationY={frame * 4}`, so twice
  over the clip), three cards with `skewX={-12}`,
  and a floor of tiles with `rotationX={60}` and a perspective of 900. Frames
  0, 30, 45, 60, and 120 of the GPU export were checked by eye: the front is
  crisp at 0 s, the back reads correctly (not mirrored) at 1.5 s and in
  perspective at 1 s and 4 s, the leaning cards are clean, and the floor's far
  rows are smooth with sharp near rows.
- Docs: "Skew and 3D" in the layout guide and the `Group` row of the
  reference, in `packages/website/content/{en,ja}`.
- Before/after PR screenshots are kept out of the repository (rendered from
  the merge base `5c3aa8bf`, where the new props are ignored, and from this
  branch, at 0 s, 1.5 s, and 4 s).

## Known limitations

- A plane is rasterized at one uniform scale, that of its most magnified
  point on screen, then lowered to fit the largest texture and 4 times the
  scene's pixel area (in the browser also 16,777,216 pixels). A long receding
  plane, such as a text crawl 20000 tall, is lowered a long way, so its near
  text softens. The example's floor is capped too: its visible trapezoid's
  box is 1800x1044 local units and its on-screen near corners need a scale
  of 2.18 (8.9M pixels), so it is drawn at 2.10, as before the exact screen
  clip. The clip changes a raster when it drops the most magnified corner or
  shrinks the box: a floor reaching past the screen's bottom goes from 4.55
  to 2.38 uncapped, and one also 6000 wide from 0.89 to 1.50 capped, as its
  box shrinks. Density-banded planes are a planned follow-up.
- `is_projective` turns on at any nonzero 3D rotation, so
  `rotationY={frame * 4}` is affine and not isolated on frame 0 and isolated
  from frame 1: children with blend modes can change how they mix. The guide
  says to start from a nonzero angle.
- Blur radii inside a plane are capped at 64 plane pixels (see above).
- The browser preview draws planes as affine triangles, within half a pixel
  of the GPU and with an antialiased outline
  (`2026-10-17-web-plane-triangles.md`).
- Follow-ups already split off: density-banded planes. The subdivided affine
  `drawImage` path for the web warp (`2026-10-17-web-plane-triangles.md`) and
  size-only stand-ins for images, SVG, and PSD in plane measurement (see
  above) are done.

## Checks

### After the final review fixes

Run on macOS with Homebrew `ffmpeg@8` on `PKG_CONFIG_PATH` and
`CELESTA_REQUIRE_GPU=1`, with every final review fix in place.

- `cargo fmt --all -- --check`, `git diff --check`: clean.
- `cargo test -p celesta-composition -p celesta-gpu-renderer -p
  celesta-renderer -p celesta-project -p celesta-evaluator -p celesta-mcp`:
  534 passed, 0 failed, 1 ignored across 16 test binaries; the GPU pixel
  tests ran.
- `cargo test -p celesta-project -p celesta-composition --features codegen`:
  140 passed. Its clippy line with `--features codegen`: clean.
- `cargo clippy --no-deps --all-targets -- -D warnings`: `celesta-composition`
  clean; `celesta-gpu-renderer` 2 (lib) and 33 (lib test), the same
  pre-existing lints as before (`prepare.rs` argument count, `texture.rs`,
  tests), none in the changed code.
- `pnpm --dir packages/web test`: 88 passed.
- `pnpm run build:runtime && pnpm run test:runtime`: pass (`@celesta/react`
  157, `@celesta/cli` 93, `@celesta/character` 44, `@celesta/shapes` 61,
  `@celesta/transitions` 26, among others).
- The example re-exported with a release `celesta-exporter` built from this
  head: frames 0, 45, and 120 are byte for byte the PNGs of the earlier
  after-shots, so those still stand.

### Before the final review fixes

Run on macOS with Homebrew `ffmpeg@8` on `PKG_CONFIG_PATH`, on the branch head
before the Task 11 commit.

- `cargo fmt --all -- --check`: clean. `git diff --check`: clean.
- `cargo test --workspace`: pass (934 passed, 0 failed, 1 ignored across all
  test binaries; the GPU pixel tests ran).
- `cargo test -p celesta-project -p celesta-composition --features codegen`:
  pass. `cargo clippy -p celesta-composition -p celesta-project --all-targets
  --features codegen -- -D warnings`: clean.
- `cargo clippy --workspace --all-targets -- -D warnings`: **fails**, as it
  already does on `main` under the pinned Rust 1.99, in files this change does
  not touch or in code that predates it: `crates/budoux/src/lib.rs`,
  `crates/media` tests, `crates/renderer` (shaping, effects, layer, path,
  image/psd sources, tests), and `crates/gpu-renderer` (`prepare.rs`,
  `texture.rs`, tests). With `--no-deps` per crate, the error counts on this
  branch and on the merge base `5c3aa8bf` are the same: `celesta-renderer`
  21 (lib) and 44 (lib test), `celesta-gpu-renderer` 2 and 33.
  `celesta-composition`, `celesta-project`, `celesta-evaluator`, and
  `celesta-mcp` are clean. The lint cleanup is a separate task, so this branch
  cannot claim a green workspace clippy.
- `pnpm run build:runtime && pnpm run test:runtime`: pass (for example
  `@celesta/cli` 93 tests, `@celesta/character` 44, `@celesta/shapes` 61,
  `@celesta/transitions` 26).
- `pnpm --dir packages/web test`: pass (83 tests, 0 failed).
- The example type-checks with `tsc --noEmit` against the built runtime and
  exports to MP4 (180 frames) and PNG frames with `celesta-exporter --react`.
- Before and after PNGs of the example at 0 s, 1.5 s, and 4 s were rendered from
  `5c3aa8bf` and from this branch for the pull request. The same text renders
  with wide letter spacing for digits in both, so it is the machine's
  `sans-serif` fallback and not the 3D code.
- Not run: the browser editor against the card example by eye (the web
  renderer is covered by its node tests only), and Windows.
