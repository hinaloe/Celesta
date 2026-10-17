# Density-banded planes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split a capped perspective plane into bands of equal `w`, each rasterized at its own scale, with an exact per-pixel coverage partition, in the GPU and browser renderers; and rasterize only a window of a GPU text layer too large for one texture.

**Architecture:** `plane_bands` (pure geometry) returns one `PlaneRaster` per band; `prepare_plane` emits one `BeginPlane`/`EndPlane` pair per band, each canvas instance carrying `(u, v, e_far, e_near)` in its unused `fill` slot, and `layer.wgsl` discards a fragment outside its band by `1/W` at the pixel centre. `TextRasterizer::rasterize` takes an optional window in layout units. The web renderer mirrors `plane_bands` and gives `warp` a band range.

**Tech Stack:** Rust (wgpu, WGSL), TypeScript (node:test with `--experimental-strip-types`).

**Spec:** `docs/superpowers/specs/2026-10-16-plane-density-bands-design.md`

## Global Constraints

- Band only when the single `PlaneRaster` was lowered below its rounded, clamped nearest-corner stretch; otherwise output is byte for byte today's.
- No banding while `measuring_plane`, or when the measure pass used a shader that is not a color filter (custom shaders, built-in stylize effects, chroma key).
- `MAX_BANDS = 8`; boundaries `b_j = w_near · (w_far / w_near)^(j / n)`, `n = ceil(ln(w_far / w_near) / ln √2)` clamped to `1..=8`; `n == 1` stays single.
- Overlap `δ = |(g, h)| · (MARGIN / s_k + reach)` in `w`, `MARGIN = 4.0` texels, only on sides that meet another band.
- Budget: each band's sides ≤ max texture dimension; the bands' summed `width · height` ≤ the area limit (GPU `4 · scene_area`; web `min(4 · sceneArea, 16_777_216)`); over it, all scales × one common factor.
- Unbounded band sides use `BAND_OPEN = 1e30` (not infinity, which WGSL may assume away); a whole canvas writes `(0, 0, 1, -1)`.
- Text windows snap to `TEXT_WINDOW_STEP = 512` raster pixels; only multi-line text (or text wrapped by `max_width`) is windowed; never while `measuring_plane`.
- `LayerInstance` stays 144 bytes; `Layer` stays 368 bytes; `LayerState` stays 160 bytes.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Build and test with `PKG_CONFIG_PATH` pointing at Homebrew `ffmpeg@8` and `CELESTA_REQUIRE_GPU=1`.

## Review Focus

- A plane whose `w` gradient is diagonal (rotationX and rotationY together): band boxes overlap more but every pixel is still drawn once — `bands_partition_a_diagonal_plane_exactly` in Task 2.
- A banded plane nested inside another plane, or inside an isolated group whose canvas is offset from the scene origin: the origin offset in `e` must match the fragment's target pixels — `bands_partition_inside_an_offset_group_canvas` in Task 2.
- A crawl that scrolls by a fraction of a pixel per frame: windows are reused across frames instead of re-rasterized — `scrolling_text_reuses_its_window` in Task 4.
- A banded plane with opacity below 1: alpha applied once per pixel — covered by the 50%-opaque seam test in Task 2 (layer opacity 0.5 on top of a 50% fill).
- A layer animating across the banding threshold: the near part's sharpness does not jump — `crossing_the_cap_keeps_the_near_scale` in Task 1.

---

### Task 1: Band geometry (`plane_bands`)

**Files:**
- Modify: `crates/gpu-renderer/src/plane.rs`

**Interfaces:**
- Produces:
  ```rust
  pub(crate) const MAX_BANDS: usize = 8;
  pub(crate) const BAND_OPEN: f64 = 1e30;
  /// One band of a plane: its raster and the `w` it holds, `[near, far)`,
  /// `None` where unbounded.
  #[derive(Clone, Copy, Debug, PartialEq)]
  pub(crate) struct PlaneBand { pub(crate) raster: PlaneRaster, pub(crate) near: Option<f64>, pub(crate) far: Option<f64> }
  /// Empty when nothing shows; one unbounded band equal to `plane_raster`'s
  /// when the plane is not banded.
  pub(crate) fn plane_bands(forward: &Matrix3, local: PixelBounds, target: PixelBounds,
      max_texture: u32, max_area: u64, reach: f64, bandable: bool) -> Vec<PlaneBand>
  ```
  `reach` is in local units; `bandable` is false when measuring or shaders forbid it.

- [ ] **Step 1: Write the failing unit tests** in `plane.rs`'s `mod tests`, with a `crawl()` forward map (`EvaluatedTransform { position: (960, 900), rotation_x: 70, perspective: Some(800) }.homography()`) and local box `[-600, -19724, 600, 276]`, `SCREEN`, `max_texture` 16384, `max_area` `4 · 1920 · 1080`:
  - `an_uncapped_plane_is_one_band_equal_to_plane_raster`: the floor test's `[-900, -750, 900, 294]` with `u64::MAX` area → `vec![PlaneBand { raster: plane_raster(..).unwrap(), near: None, far: None }]`.
  - `a_capped_crawl_is_split_into_eight_bands`: `bands.len() == 8`; `bands[0].raster.scale` within 1e-3 of 1.542; `bands[7].raster.scale` within 1e-3 of 0.068; `bands[0].near == None`, `bands[7].far == None`.
  - `bands_share_their_boundaries_geometrically`: `bands[k].far == bands[k + 1].near` exactly; ratios `far / near` equal within 1e-9 for interior bands; first boundary ≈ `w_near` 0.6758 within 1e-3.
  - `band_scales_cover_their_corners`: for each band, clip `P` to its `w` range and assert `scale ≥ stretch_at` at each corner (crawl fits the budget, so no lowering).
  - `bands_stay_within_the_budget`: crawl with `max_area` 1_000_000 → summed `width · height ≤ 1_000_000`, every side ≤ 16384, and `bands[0].raster.scale > plane_raster(..).scale`.
  - `bands_never_reach_past_the_near_clip`: a crawl box reaching `y = 2000` (past `w = 1/16`) → `bands[0]`'s polygon corners all have `w ≥ NEAR_W`; check via `bands[0].raster` box top-left mapped back: the box's largest `y` ≤ the `y` where `w = NEAR_W` plus the margin.
  - `unbandable_planes_stay_single`: crawl with `bandable = false` → one band equal to `plane_raster`'s.
  - `crossing_the_cap_keeps_the_near_scale`: the crawl with `max_area` just above and just below its single raster's need → the nearest band's scale is the same rounded 1.542 both times (above: single band at 1.542; below: banded, `bands[0]` 1.542).

- [ ] **Step 2: Run them to see them fail**

  Run: `cargo test -p celesta-gpu-renderer --lib plane::tests`
  Expected: compile error, `plane_bands` not found.

- [ ] **Step 3: Implement `plane_bands`**
  - Factor `plane_raster`'s body into `fn polygon_shown(forward, local, target) -> Vec<[f64; 2]>` and `fn raster_of(polygon, desired: f64, max_texture, max_area) -> Option<PlaneRaster>`; `plane_raster` keeps its signature and results.
  - Lowered test: `raster.scale < desired` where `desired = round_up_to_eighth_octave(max stretch).clamp(MIN_SCALE, MAX_SCALE)`.
  - `w` at a point is `forward[2][0]·x + forward[2][1]·y + forward[2][2]`; band polygons by `clip_polygon` against `w − b` and `b − w`.
  - Each band's raster: `raster_of(grown_polygon, s_k, max_texture, u64::MAX)`, then if `Σ width·height > max_area`, multiply every `s_k` by `f = sqrt(max_area / Σ)` and recompute, shrinking `f` by 1% until it fits (at most 64 steps).

- [ ] **Step 4: Run the tests to see them pass**

  Run: `cargo test -p celesta-gpu-renderer --lib plane::tests`
  Expected: all pass, the existing `plane_raster` tests unchanged.

- [ ] **Step 5: Commit** — `feat(gpu): split capped planes into bands of equal depth`

### Task 2: Banded planes in the GPU renderer, with an exact coverage partition

**Files:**
- Modify: `crates/gpu-renderer/src/plane.rs` (`prepare_plane`, `measure_plane`)
- Modify: `crates/gpu-renderer/src/layer.rs` (`PreparedContent::Canvas`, `PreparedLayer::plane`, `write_instance`)
- Modify: `crates/gpu-renderer/src/layer.wgsl` (`fs_main`, `fs_blend`)
- Modify: `crates/gpu-renderer/src/shader.rs` (`uses_pixel_grid_since`)
- Modify: `crates/gpu-renderer/src/renderer.rs` (field `plane_area_limit`)
- Create: `crates/gpu-renderer/src/tests/plane_bands.rs`; register `mod plane_bands;` in `crates/gpu-renderer/src/tests.rs`

**Interfaces:**
- Consumes: `plane_bands`, `PlaneBand`, `BAND_OPEN` (Task 1).
- Produces:
  - `PreparedContent::Canvas { premultiplied: bool, projection: [f32; 3], band: [f32; 4] }`; `PreparedLayer::plane(state, blend_mode, projection, band: [f32; 4])`; `pub(crate) const WHOLE_BAND: [f32; 4] = [0.0, 0.0, 1.0, -1.0];` (`canvas()` uses it).
  - `ShaderProcessor::uses_pixel_grid_since(&self, first: usize) -> bool` — any use after `first` whose pipeline is not `UsePipeline::ColorFilter`.
  - `GpuRenderer::plane_area_limit: u64` (scene areas, default 4, replacing `MAX_PLANE_AREA`); tests set it.
  - `measure_plane` returns `Result<Option<PlaneMeasure>, _>` with `struct PlaneMeasure { bounds: PixelBounds, reach: f64, bandable: bool }`; `reach` = largest side of `spec.output_bounds(PixelBounds([0.0; 4]))` over the measured `EndEffect` items.

- [ ] **Step 1: Write the failing GPU tests** in `tests/plane_bands.rs` (helpers from `transform_3d.rs` made `pub(super)`: `in_perspective`, `group_at`, `sized_scene`, `transparent_renderer`):
  - `a_long_plane_has_no_seams`: 1920x1080, `group_at(960, 900)` in perspective (70, 0, 800) holding a `#FFFFFF80` rect `[-600, -19724, 1200, 20000]`, group opacity 0.5; every pixel whose 5x5 neighbourhood is fully inside the projected rect (test through `invert3(homography)` and the local box) has alpha within 1 of the median. Also with `BlendMode::Multiply` over an opaque `#808080` background rect: RGB within 1 of the median.
  - `bands_partition_a_diagonal_plane_exactly`: same with perspective (60, 35, 800), the rect `[-3000, -3000, 6000, 6000]`, `plane_area_limit = 1`.
  - `bands_partition_inside_an_offset_group_canvas`: the long plane inside a `BlendMode::Screen` group positioned so its canvas starts at `(300, 200)`; same flatness check.
  - `a_blur_across_a_seam_matches_one_canvas`: 640x360 scene, a long plane of a 600x6000 `#3060C0FF` rect plus a 200x200 white rect with `blur 12` placed across `bands[0]`'s far boundary (computed with `plane_bands` on the same transform); rendered with `plane_area_limit = 1` (banded) and `plane_area_limit = 1000` (single): max channel difference ≤ 6 within the near half of the screen.
  - `hits_through_the_near_and_far_bands`: the long plane of rects with `record_hit_regions`; `hit_test` at a pixel near the bottom edge and one near the horizon both return the rect's id, and the rect's id appears in `hit_regions` exactly once (Step 3 records hit leaves from the first band only).
  - `a_crawl_of_many_text_layers_is_sharp_near_its_edge`: 40 text layers (`text_layer`, font size 40, `max_width` 1200, 10 lines of `"HELIOS CRAWL HHHH"`) stacked from `y = 276` upwards in a crawl group; and a short plane holding the 2 nearest layers; `sharpness(frame) = mean |alpha(x, y) − alpha(x − 1, y)|` over the 40 rows above the near edge's projected `y` and the middle 800 columns; banded ≥ 0.9 × short.

- [ ] **Step 2: Run them to see them fail**

  Run: `cargo test -p celesta-gpu-renderer --lib tests::plane_bands`
  Expected: the sharpness test fails (ratio about 0.4); the others fail to compile until `plane_area_limit` exists.

- [ ] **Step 3: Implement**
  - `prepare_plane`: compute `plane_bands(.., measure.reach, measure.bandable && !self.measuring_plane)`. Compute once `inverse = invert3(&forward)` and `(u, v, t) = inverse[2]` (f64); each boundary `e(b) = t − 1/b` once, `BAND_OPEN` for `None` far (`e_far`) and `−BAND_OPEN` for `None` near (`e_near`). Per band, the existing push / `BeginPlane` / prepare / `EndPlane` sequence with `band = [u, v, e_far, e_near] as f32`. Record hit leaves only for the first band: truncate `self.hit_leaves` back after preparing every later band.
  - `write_instance`: for a canvas, `fill = [u, v, e_far + (u·target.x + v·target.y), e_near + (u·target.x + v·target.y)]`, the offset computed once in one `let`.
  - `layer.wgsl`: `fn outside_band(input: VertexOutput) -> bool` = `sampling.x == 2.0 && !(s + fill.z > 0.0 && s + fill.w <= 0.0)` with `s = dot(input.fill.xy, input.position.xy)`; discard in `fs_main` and `fs_blend` next to `behind_near_clip`. Document the `fill` slot for canvases in `LayerInstance`'s comment.

- [ ] **Step 4: Run the new and existing GPU tests**

  Run: `CELESTA_REQUIRE_GPU=1 cargo test -p celesta-gpu-renderer`
  Expected: all pass, `transform_3d` untouched.

- [ ] **Step 5: Commit** — `feat(gpu): draw capped planes in bands, each pixel from exactly one`

### Task 3: Windowed text rasters (`celesta-renderer`)

**Files:**
- Modify: `crates/renderer/src/shaping.rs` (`TextRasterizer::rasterize`, new `rasterize_window`)
- Modify: `crates/renderer/src/text.rs` (`AnchorBox` signed: `left: i32, top: i32`)
- Test: `crates/renderer/src/tests.rs`

**Interfaces:**
- Produces:
  ```rust
  /// A part of a text layer's layout box, in its layout units (scale 1)
  /// from the layout box's top-left: `[left, top, right, bottom]`.
  pub type TextWindow = [f64; 4];
  impl TextRasterizer {
      pub fn rasterize_window(&mut self, text: &str, style: &TextStyle, max_width: Option<f64>,
          scale: f32, window: Option<TextWindow>) -> Result<RasterizedText, RenderError>;
  }
  ```
  `rasterize(..)` calls it with `None`. With a window, the image covers the window's pixels (`floor(left·s)` to `ceil(right·s)`, offset by the pads, clamped to the whole image); the anchor box and baseline are relative to the window's top-left; single-line text ignores the window.

- [ ] **Step 1: Write the failing tests**
  - `a_text_window_is_the_same_pixels_as_the_whole_raster`: 30 lines of `"Window HHHH"` at font size 24, `max_width` 300, scale 1.5, with a `#FF0000` stroke of 2; window `[40.0, 200.0, 260.0, 420.0]`; every pixel of the windowed raster equals the whole raster's at the offset `(window image origin)`, byte for byte, and `anchor_in_image` maps the same layout point to the same whole-image pixel.
  - `a_window_keeps_gradient_fills_in_place`: same with a linear gradient fill: byte for byte equal.
  - `single_line_text_ignores_the_window`: `rasterize_window(.., Some(window))` == `rasterize(..)`.

- [ ] **Step 2: Run them to see them fail**

  Run: `cargo test -p celesta-renderer text_window` and `single_line_text_ignores`
  Expected: compile error, `rasterize_window` not found.

- [ ] **Step 3: Implement**: compute the whole image's geometry as today; the window in image pixels; allocate the mask and glyph buffers for the window grown by `stroke_radius` (clamped to the image), offset the glyph callback and the stroke's `color_at` by that origin, skip runs whose `line_top`/`line_height` (plus overflow and stroke) miss the grown window, dilate, then crop to the window. `AnchorBox.left/top` become `i32`; `anchor_in_image` uses them signed.

- [ ] **Step 4: Run the renderer tests**

  Run: `cargo test -p celesta-renderer`
  Expected: all pass.

- [ ] **Step 5: Commit** — `feat(renderer): rasterize a window of a text layer`

### Task 4: Text windows in the GPU renderer

**Files:**
- Modify: `crates/gpu-renderer/src/text.rs` (`PendingText::window`, `rasterize_text`)
- Modify: `crates/gpu-renderer/src/prepare.rs` (text branch: window decision, key, `shape`)
- Modify: `crates/gpu-renderer/src/renderer.rs` (field `text_sizes`)
- Test: `crates/gpu-renderer/src/tests/plane_bands.rs`

**Interfaces:**
- Consumes: `TextRasterizer::rasterize_window`, `TextWindow` (Task 3).
- Produces:
  - `GpuRenderer::text_sizes: HashMap<String, TextSize>` keyed by `"{text}\0{style:?}\0{max_width:?}"`, `struct TextSize { width: f64, height: f64, ascent: f64, multiline: bool, last_used: u64 }`, evicted with the textures (same generation rule, cleared on font change).
  - `fn text_window(size: &TextSize, style: &TextStyle, anchor: Point, baseline_anchor: bool, transform: Affine, raster_scale: f32, target: (u32, u32), limit: u32) -> Option<TextWindow>` in `text.rs`: `None` when the whole raster fits `limit` (`(extent + 2·reach) · scale ≤ limit` on both sides, `reach` as in `measured_bounds`) or the text is one line; otherwise the target rect mapped back through `transform`, shifted by the anchor offset into layout units, intersected with `[-reach, -reach, width + reach, height + reach]`, snapped outward to `TEXT_WINDOW_STEP / raster_scale`.
  - A windowed text's `PreparedLayer::shape` is the whole text's measured box in target pixels.

- [ ] **Step 1: Write the failing GPU tests**
  - `a_crawl_of_one_text_layer_is_sharp_near_its_edge`: Task 2's crawl with one text layer (400 lines, `max_width` 1200, anchor so its box spans `y` −19724 to 276) vs its short plane of 15 lines; banded ≥ 0.9 × short.
  - `tall_flat_text_keeps_its_scale`: a flat text 12000 tall at scale 1 in a 1920x1080 scene; the sharpness of its stems over the scene's middle rows is at least 0.95 × that of a 10-line text in the same place (today about 0.4×, lowered to fit 16384 or 8192).
  - `scrolling_text_reuses_its_window`: render the tall text at `y` and at `y − 0.5` → the second frame rasterizes no new text (the texture cache's text key count is unchanged and `pending_texts` was empty: assert via the existing `textures` key set).
  - `hits_windowed_text_anywhere`: `hit_test` on the tall flat text at a point outside its current window (but inside the text, offscreen side clamped to the scene) still hits it; its `hit_regions` entry spans the whole text's box.

- [ ] **Step 2: Run them to see them fail**

  Run: `CELESTA_REQUIRE_GPU=1 cargo test -p celesta-gpu-renderer --lib tests::plane_bands`
  Expected: the one-layer crawl and tall-text tests fail.

- [ ] **Step 3: Implement**: in the text branch, look up or measure `TextSize`; unless `self.measuring_plane`, compute `text_window(.., self.scene_size, self.max_texture_dimension)`; append `"\0{window:?}"` to the key only when `Some`; carry the window in `PendingText` and pass it to `rasterize_window`; set `shape` for windowed text.

- [ ] **Step 4: Run all GPU and renderer tests**

  Run: `CELESTA_REQUIRE_GPU=1 cargo test -p celesta-gpu-renderer -p celesta-renderer`
  Expected: all pass.

- [ ] **Step 5: Commit** — `feat(gpu): rasterize only the shown window of text too large for one texture`

### Task 5: `planeBands` and the banded `warp` (web)

**Files:**
- Modify: `packages/web/src/projection.ts`
- Test: `packages/web/test/projection.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export const MAX_BANDS = 8;
  export type PlaneBand = { raster: PlaneRaster; near: number | null; far: number | null };
  export function planeBands(forward: Matrix3, local: Box, target: Box, maxSize: number, maxArea: number, reach: number, bandable: boolean): PlaneBand[];
  /** `[qFar, qNear]` in `1/W`: draws a pixel only when `qFar < 1/W ≤ qNear`. */
  export function bandRange(band: PlaneBand): [number, number];
  export function warp(source, sourceWidth, sourceHeight, target, targetWidth, toSource, box, band?: [number, number]): void;
  ```
  `bandRange` gives `-Infinity`/`Infinity` for unbounded sides (JS compares them exactly).

- [ ] **Step 1: Write the failing tests** — the same cases as Task 1's Rust tests with the same numbers (`a capped crawl is split into eight bands`: 8 bands, near 1.542, far 0.068 within 1e-3; shared boundaries; budget; unbandable stays single; uncapped equals `planeRaster`), plus `two bands meeting at a boundary warp exactly what one warp does`: a 64x64 random source, a projective `toSource`, the warp once whole and once as two bands split at the median `1/W` of the target box → targets equal byte for byte.

- [ ] **Step 2: Run them to see them fail**

  Run: `pnpm --dir packages/web test`
  Expected: `planeBands` is not exported.

- [ ] **Step 3: Implement** — the same algorithm as Task 1; in `warp`, `if (band && !(w > band[0] && w <= band[1])) continue;` right after the `w` test.

- [ ] **Step 4: Run the web tests**

  Run: `pnpm --dir packages/web test`
  Expected: all pass.

- [ ] **Step 5: Commit** — `feat(web): split capped planes into bands and warp each pixel from one`

### Task 6: Banded planes in `scene-canvas.ts`

**Files:**
- Modify: `packages/web/src/scene-canvas.ts` (`plane`, `planeBox`)
- Test: `packages/web/test/scene-canvas.test.mjs`

**Interfaces:**
- Consumes: `planeBands`, `bandRange`, `warp` with a band (Task 5).
- Produces: `planeBox` returns `{ box: Box; reach: number; bandable: boolean } | null`; `bandable` false when any layer in the content has a filter outside the color filters (`brightness`, `contrast`, `saturation`, `hue`, `grayscale`, `invert`, `tint`, `vignette`); `shapeBox` uses `.box`.

- [ ] **Step 1: Write the failing test** `a long plane draws through one canvas per band and composites once`: with the existing fake canvas, a crawl-shaped plane in a 192x108 scene with `MAX_PLANE_AREA` forcing banding → the number of plane surfaces created equals `planeBands(..).length` (> 1), each sized by its band's raster; exactly one `drawImage` onto the parent, with `globalAlpha` equal to the layer's alpha.

- [ ] **Step 2: Run it to see it fail**

  Run: `pnpm --dir packages/web test`
  Expected: one plane surface instead of several.

- [ ] **Step 3: Implement**: the landing surface is the box of `clipInFront(forward, corners(local))` projected through `forward`, clamped to the canvas, shared by every band; per band: draw, `getImageData`, `warp(.., fromLanded_k, box, bandRange(band))` into the shared `image`, free the canvas; `putImageData` and `drawImage` once.

- [ ] **Step 4: Run the web tests**

  Run: `pnpm --dir packages/web test`
  Expected: all pass.

- [ ] **Step 5: Commit** — `feat(web): draw capped planes in bands`

### Task 7: Example, docs, screenshots, and checks

**Files:**
- Create: `packages/cli/examples/with-3d-crawl.tsx`
- Create: `docs/handoff/2026-10-16-plane-density-bands.md`
- Modify: `docs/handoff/2026-10-16-skew-3d-transform.md` ("Known limitations")
- Modify: `packages/website/content/en/docs/02-(guides)/04-layout.md`, `packages/website/content/ja/docs/02-(guides)/04-layout.md` (the paragraph at line 26)

- [ ] **Step 1: Write the example**: 1920x1080, 30 fps, 8 s; a `Group` at `x={960} y={900}` with `rotationX={70} perspective={800}` holding one `Text` 1200 wide, about 400 lines, scrolling up by `frame * 6`.
- [ ] **Step 2: Type-check and export it** with a `celesta-exporter` built from this branch and from `996ba1ae` (PR #390's head); PNG frames at 0 s and 4 s for before/after.
- [ ] **Step 3: Update the docs** per the spec's "Example and documentation" section, in en and ja.
- [ ] **Step 4: Run the checks**: `cargo fmt --all -- --check`, `git diff --check`, `CELESTA_REQUIRE_GPU=1 cargo test -p celesta-composition -p celesta-gpu-renderer -p celesta-renderer -p celesta-project -p celesta-evaluator -p celesta-mcp`, `cargo clippy --no-deps --all-targets -p celesta-gpu-renderer -p celesta-renderer -- -D warnings` (no new lints over the counts in the 3D handoff), `pnpm --dir packages/web test`; record the results in the handoff.
- [ ] **Step 5: Commit**, push, attach the screenshots to the PR with `gh pr edit --attach`, and update its body.
