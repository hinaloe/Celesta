# Skew and 3D transforms (2026-10-16)

Issue #300. Every layer and `Group` takes `skewX`/`skewY`, `rotationX`/
`rotationY`, `perspective`, and `backfaceVisibility`. The design is in
`docs/superpowers/specs/2026-10-16-skew-3d-transform-design.md`, the plan in
`docs/superpowers/plans/2026-10-16-skew-3d-transform.md`.

## Model

- `EvaluatedTransform` (`crates/composition/src/transform.rs`) gains `skew`,
  `rotation_x`, `rotation_y`, `perspective: Option<f64>`, and
  `backface_visibility`. JSON names are `skew` (`{x, y}`), `rotationX`,
  `rotationY`, `perspective`, `backfaceVisibility` (`"visible"` |
  `"hidden"`), all inside `transform` and omitted at their defaults, so old
  scenes and compact React frames are unchanged. A `perspective` that is not
  finite and positive means none, everywhere.
- Matrix: `M = T(position) · P(perspective) · Rx · Ry · Rz(rotation) ·
  K(skew) · S(scale)`, `K = [[1, tan(skew.x)], [tan(skew.y), 1]]`, `Rx`/`Ry`
  as CSS `rotateX()`/`rotateY()`, `P` sets `w = 1 - z / perspective`. Dropping
  the Z row and column gives the 3x3 homography `H` from local points to the
  parent's plane. A group turns about its own origin, any other layer about
  its anchor, which is also its vanishing point.
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
  degenerate affine (edge-on, skew of 90 degrees, any entry non-finite or above
  1e7) draws nothing.
- A layer with a perspective and a 3D rotation is projective and goes through
  a plane canvas (`crates/gpu-renderer/src/plane.rs`), a texture leaf (image,
  video, PSD, text) included. `prepare_plane` runs two passes. The first
  (`measure_plane`) prepares the content in local units only to measure its
  bounds, then rolls everything back. The bounds are clipped to `w >= 1/16`
  (`NEAR_W`) and to what the parent's canvas can show. The raster scale `s` is
  the largest stretch of the parent-to-target transform times `H` at the
  clipped polygon's corners (the nearest corner), rounded up to an eighth of
  an octave and clamped to `[2^-6, 2^6]`. It is lowered so the canvas, with a
  1-pixel margin and sizes rounded to 128-pixel steps, stays within the
  maximum texture dimension and 4 times the scene's pixel area. The second
  pass prepares the content for real with base transform `Scale(s) ·
  Translate(-origin)`.
- The canvas draws onto its parent through the homography as one layer, with
  the layer's opacity and blend mode. The vertex shader writes
  `(x·w, y·w, 0.5·w, w)` so the rasterizer interpolates with perspective
  correction; fragments with `w < 1/16` get coverage 0, so the near clip binds
  the draw too. The fragment shader averages a grid of bilinear taps over the
  pixel's footprint in the canvas, at most 8 by 8, so the far side minifies
  without shimmer. The blend backdrop is sized only from blended canvases.
- A projective group is isolated. Its own `blur`, `shadow`, `glow`, and
  filters apply after the projection in output pixels. Effects of layers
  inside a plane are measured in output pixels (`walk.effect_scale`: `s` over
  the largest stretch at the layer's origin), so a blur does not change size as
  the layer turns; custom shaders and built-in filters inside a plane run in
  the plane's own pixels. Planes nest.
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
  raster frame, then into its parent pixel by pixel. The plane canvas is also
  capped at 16,777,216 pixels (iOS Safari draws nothing past about that), the
  canvas grows by its descendants' effects' reach, and blurs are capped.
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

## Checks

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
