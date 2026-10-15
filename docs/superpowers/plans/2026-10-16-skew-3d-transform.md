# Skew and 3D Transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layers and `Group`s take `skewX`/`skewY`, `rotationX`/`rotationY`, `perspective`, and `backfaceVisibility`, rendered sharply by the GPU and web renderers (issue #300).

**Architecture:** One shared matrix model in `celesta-composition`. Skew and orthographic 3D rotation fold into the existing 2D affine path. A layer with a perspective and a 3D rotation (a *projective* layer) is drawn into a canvas in its own plane (a *plane*), then that canvas is drawn through its homography. Facing is decided from the 3D orientation accumulated through ancestors.

**Tech Stack:** Rust 2024 (serde, ts-rs, wgpu/WGSL), TypeScript (`@celesta/react`, `@celesta/web`), node:test, vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-skew-3d-transform-design.md`

## Global Constraints

- Matrix order: `M = T(position) · P(perspective) · Rx(rotationX) · Ry(rotationY) · Rz(rotation) · K(skew) · S(scale)`, angles in degrees, `K = [[1, tan(skew.x)], [tan(skew.y), 1]]`, `Rx`/`Ry` as CSS `rotateX()`/`rotateY()` (Z toward the viewer), `P` sets `w = 1 - z / perspective`.
- A `perspective` that is not finite and positive means none (orthographic), everywhere.
- Facing: back when `cofactor_zz(O) / det(O) < 0` for `O = O_parent · L`; exactly 0 (edge-on) counts as front.
- JSON field names: `skew` (`{x, y}`), `rotationX`, `rotationY`, `perspective`, `backfaceVisibility` (`"visible"` | `"hidden"`), all inside `transform`, all omitted at their defaults.
- React prop names: `skewX`, `skewY`, `rotationX`, `rotationY`, `perspective`, `backfaceVisibility`.
- Plane constants: near clip `w ≥ 1/16`; raster scale rounded up to 1/8 octave, clamped to `[2^-6, 2^6]`; 1-pixel margin round the plane canvas; footprint filter at most 8×8 taps.
- Rust checks: `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`, `git diff --check`; with type changes also `cargo test -p celesta-project -p celesta-composition --features codegen` and the codegen clippy line in `HANDOFF.md`.
- Builds need `PKG_CONFIG_PATH` pointed at Homebrew `ffmpeg@8` (`$(brew --prefix ffmpeg@8)/lib/pkgconfig`).
- Commits are signed through 1Password; a "failed to fill whole buffer" error means it is locked: ask the user to unlock it, never bypass signing.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A wide layer turned nearly edge-on under a short perspective (`rotationY` 80, `perspective` 200, width 1000) puts part of it behind the viewer: it must render without NaN or panic and draw only the part in front. Test in Task 6.
2. A flip animated through exactly 90° (`rotationY = 90`, with and without perspective) is edge-on: nothing drawn, no panic, no division by zero. Tests in Tasks 1 and 5.
3. A huge projective layer (50,000 px square at `rotationX` 60) must not ask for a canvas past the device's maximum texture dimension. Test in Task 6.
4. `perspective` of 0, a negative number, or NaN from React or a project file must render orthographically, not crash. Tests in Tasks 1, 2, and 3.
5. `skewX = 90` (tan is infinite) must draw nothing rather than NaN-filled pixels or a panic. Tests in Tasks 1 and 5.

---

### Task 1: Scene model and matrix math (`celesta-composition`)

**Files:**
- Create: `crates/composition/src/projection.rs`
- Modify: `crates/composition/src/model.rs` (`EvaluatedTransform`, around line 993), `crates/composition/src/lib.rs` (module and re-exports)
- Modify: every `EvaluatedTransform { … }` literal across the workspace that lists fields without `..` (the compiler names them); add `..Default::default()`
- Modify: `packages/react/src/scene.ts` (re-export `BackfaceVisibility`)
- Test: `crates/composition/src/tests.rs`

**Interfaces:**
- Produces (all `pub`, re-exported from the crate root):
  - `pub type Matrix3 = [[f64; 3]; 3];` (row-major), `pub const IDENTITY3: Matrix3`
  - `pub fn multiply3(a: &Matrix3, b: &Matrix3) -> Matrix3`
  - `pub fn invert3(m: &Matrix3) -> Option<Matrix3>` (None when not invertible or not finite)
  - `pub fn project(m: &Matrix3, x: f64, y: f64) -> [f64; 3]` returning `[X/W, Y/W, W]`
  - `pub fn stretch_at(m: &Matrix3, x: f64, y: f64) -> Option<f64>`: largest singular value of the Jacobian of `(x, y) ↦ (X/W, Y/W)`; None when `W ≤ 0` or not finite
  - `pub fn faces_away(orientation: &Matrix3) -> bool`
  - `#[serde(rename_all = "camelCase")] pub enum BackfaceVisibility { #[default] Visible, Hidden }` with `is_visible()`, ts-rs exported
  - New `EvaluatedTransform` fields: `skew: Point` (default 0,0), `rotation_x: f64`, `rotation_y: f64`, `perspective: Option<f64>`, `backface_visibility: BackfaceVisibility`, each `skip_serializing_if` at its default
  - `impl EvaluatedTransform { pub fn perspective_distance(&self) -> Option<f64>; pub fn linear(&self) -> Matrix3; pub fn homography(&self) -> Matrix3; pub fn is_projective(&self) -> bool }`
    - `linear` = `Rx · Ry · Rz · K · S` (3×3; `S = diag(sx, sy, 1)`)
    - `homography`, with `L = linear()` and `d = perspective_distance()`: rows `[L00 − px·L20/d, L01 − px·L21/d, px]`, `[L10 − py·L20/d, L11 − py·L21/d, py]`, `[−L20/d, −L21/d, 1]`; without `d` the `/d` terms are 0
    - `is_projective`: every entry finite and `|H20| + |H21| > 1e-12`

- [ ] **Step 1: Write the failing tests** in `crates/composition/src/tests.rs`:

```rust
fn close(a: &Matrix3, b: &Matrix3) -> bool {
    a.iter().flatten().zip(b.iter().flatten()).all(|(x, y)| (x - y).abs() < 1e-9)
}

#[test]
fn default_transform_is_the_identity() {
    let t = EvaluatedTransform::default();
    assert!(close(&t.linear(), &IDENTITY3) && close(&t.homography(), &IDENTITY3));
    assert!(!t.is_projective());
    assert_eq!(serde_json::to_value(t).unwrap(), serde_json::json!({
        "position": {"x": 0.0, "y": 0.0}, "scale": {"x": 1.0, "y": 1.0},
        "rotation": 0.0, "anchor": {"x": 0.5, "y": 0.5}
    }));
}

#[test]
fn skew_shears_by_the_tangent() {
    let t = EvaluatedTransform { skew: Point { x: 45.0, y: 0.0 }, ..Default::default() };
    assert!(close(&t.linear(), &[[1.0, 1.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]));
}

#[test]
fn orthographic_rotation_y_is_affine() {
    let t = EvaluatedTransform { rotation_y: 60.0, ..Default::default() };
    assert!(close(&t.homography(), &[[0.5, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]));
    assert!(!t.is_projective());
}

#[test]
fn perspective_rotation_y_turns_the_right_edge_away() {
    let t = EvaluatedTransform {
        position: Point { x: 10.0, y: 20.0 }, rotation_y: 90.0, perspective: Some(1000.0),
        ..Default::default()
    };
    let h = t.homography();
    assert!((h[2][0] - 0.001).abs() < 1e-12 && h[2][1].abs() < 1e-12 && h[2][2] == 1.0);
    assert!((h[0][2] - 10.0).abs() < 1e-12 && (h[1][2] - 20.0).abs() < 1e-12);
    assert!(t.is_projective());
    assert!(project(&h, 100.0, 0.0)[2] > 1.0); // farther
}

#[test]
fn perspective_distance_must_be_finite_and_positive() {
    for (value, expected) in [(500.0, Some(500.0)), (0.0, None), (-1.0, None), (f64::NAN, None), (f64::INFINITY, None)] {
        let t = EvaluatedTransform { perspective: Some(value), rotation_y: 30.0, ..Default::default() };
        assert_eq!(t.perspective_distance(), expected);
        assert_eq!(t.is_projective(), expected.is_some());
    }
}

#[test]
fn skew_of_ninety_degrees_is_not_projective() {
    let t = EvaluatedTransform { skew: Point { x: 90.0, y: 0.0 }, perspective: Some(500.0), ..Default::default() };
    assert!(!t.is_projective());
}

#[test]
fn facing_follows_the_accumulated_orientation() {
    let o = |t: EvaluatedTransform| t.linear();
    let ry = |deg| EvaluatedTransform { rotation_y: deg, ..Default::default() };
    assert!(!faces_away(&IDENTITY3));
    assert!(!faces_away(&o(EvaluatedTransform { scale: Point { x: -1.0, y: 1.0 }, ..Default::default() })));
    assert!(faces_away(&o(ry(180.0))));
    assert!(!faces_away(&o(ry(90.0))));
    assert!(!faces_away(&multiply3(&o(ry(100.0)), &o(ry(180.0)))));
    assert!(faces_away(&multiply3(&o(ry(30.0)), &o(ry(180.0)))));
}

#[test]
fn stretch_is_none_behind_the_viewer() {
    let h = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.01, 0.0, 1.0]];
    assert!((stretch_at(&h, 0.0, 0.0).unwrap() - 1.0).abs() < 1e-9);
    assert_eq!(stretch_at(&h, -200.0, 0.0), None);
}

#[test]
fn new_transform_fields_round_trip() {
    let json = serde_json::json!({"skew": {"x": 10.0, "y": -5.0}, "rotationX": 15.0, "rotationY": 30.0,
        "perspective": 800.0, "backfaceVisibility": "hidden"});
    let t: EvaluatedTransform = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(t.backface_visibility, BackfaceVisibility::Hidden);
    let back = serde_json::to_value(t).unwrap();
    for key in ["skew", "rotationX", "rotationY", "perspective", "backfaceVisibility"] {
        assert_eq!(back[key], json[key]);
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p celesta-composition`
Expected: compile errors for the missing items.

- [ ] **Step 3: Implement** `projection.rs` and the model fields as in Interfaces. `faces_away` returns false when `det` is not finite or `|det| ≤ 1e-12`. Fix the workspace's full `EvaluatedTransform` literals (`cargo build --workspace --all-targets` lists them). Add `export type { BackfaceVisibility } from './generated/BackfaceVisibility';` to `scene.ts`.

- [ ] **Step 4: Run the checks**

Run: `cargo test -p celesta-composition && cargo test -p celesta-composition --features codegen && pnpm --dir packages/react run codegen && cargo build --workspace --all-targets`
Expected: all pass; `packages/react/src/generated/BackfaceVisibility.ts` exists and `EvaluatedTransform.ts` lists the new fields.

- [ ] **Step 5: Commit** — `feat(composition): add skew, 3D rotation, perspective, and backface visibility to transforms`

---

### Task 2: Project files (`celesta-project`, `celesta-evaluator`)

**Files:**
- Modify: `crates/composition/src/transform.rs` (`Transform`)
- Modify: `crates/project/src/validation.rs` (transform validation, around line 480)
- Modify: `crates/evaluator/src/evaluate.rs` (`evaluate_transform`, line 181)
- Test: `crates/project/src/tests.rs`, the evaluator's test module

**Interfaces:**
- Consumes: Task 1's `EvaluatedTransform` fields and `BackfaceVisibility`.
- Produces: `Transform { skew: Option<AnimatablePoint>, rotation_x: Option<Animatable<f64>>, rotation_y: Option<Animatable<f64>>, perspective: Option<Animatable<f64>>, backface_visibility: Option<BackfaceVisibility> }` added, serde camelCase, omitted when `None`.

- [ ] **Step 1: Write the failing tests**
  - `project`: `validates_the_3d_transform_fields`: an item with `"transform": {"rotationX": 30, "perspective": 0}` reports `….transform.perspective` "must be finite and positive" and nothing for `rotationX`; a `skew.x` keyframe whose value is `1e309` (parsed as infinity) reports `….transform.skew.x` "must be finite"; `"perspective": 800` reports nothing.
  - `evaluator`: `evaluates_3d_transform_fields`: a project item with `skew {x: 10}`, `rotationY` keyframed 0→180 over 1 s, `perspective: 900`, `backfaceVisibility: "hidden"` evaluates at 0.5 s to `skew.x == 10`, `rotation_y == 90`, `perspective == Some(900.0)`, `backface_visibility == Hidden`. Leaving them out evaluates to the defaults.

- [ ] **Step 2: Run** `cargo test -p celesta-project -p celesta-evaluator` — expected FAIL (unknown fields / missing values).

- [ ] **Step 3: Implement.** Validate `skew.x`/`skew.y`/`rotationX`/`rotationY` like `rotation`; `perspective` with `|v| v.is_finite() && *v > 0.0`, message `"must be finite and positive"`. Evaluate each like `rotation` (`evaluate_optional` with the default), `perspective` as `Some(value)` only when set, `backface_visibility` copied with `unwrap_or_default()`.

- [ ] **Step 4: Run** `cargo test -p celesta-project -p celesta-evaluator -p celesta-composition --features codegen` and `pnpm --dir packages/react run codegen` — expected PASS.

- [ ] **Step 5: Commit** — `feat(project): read skew, 3D rotation, perspective, and backface visibility from project files`

---

### Task 3: React props (`@celesta/react`)

**Files:**
- Modify: `packages/react/src/components.ts` (`CommonProps`, line 25)
- Modify: `packages/react/src/render.ts` (`extractTransform` line 339, `compactTransform` line 370)
- Test: `packages/react/test/transform-3d.test.mjs` (new; the `render()` helper pattern of `blend-mode.test.mjs`)

**Interfaces:**
- Consumes: generated `EvaluatedTransform`, `BackfaceVisibility` (Task 1).
- Produces: `CommonProps.skewX?: number; skewY?: number; rotationX?: number; rotationY?: number; perspective?: number; backfaceVisibility?: BackfaceVisibility`.

- [ ] **Step 1: Write the failing test** `transform-3d.test.mjs`:
  - `<Rect id="a" width={10} height={10} skewX={10} rotationY={30} perspective={800} backfaceVisibility="hidden" />` serializes `transform` with `skew: {x: 10, y: 0}`, `rotationX` absent, `rotationY: 30`, `perspective: 800`, `backfaceVisibility: 'hidden'`.
  - `<Group id="g" rotationX={20}>` has `rotationX: 20` and no `skew`/`perspective`/`backfaceVisibility` keys.
  - `perspective={0}`, `{-5}`, `{NaN}` each serialize without a `perspective` key.
  - A plain `<Rect>` has none of the new keys.
  - `backfaceVisibility="sideways"` fails with an error naming `backfaceVisibility` and the two allowed values.

- [ ] **Step 2: Run** `pnpm --dir packages/react run build && pnpm --dir packages/react exec vitest run test/transform-3d.test.mjs` — expected FAIL.

- [ ] **Step 3: Implement.** JSDoc on each prop states the unit, default, the matrix order from Global Constraints, that a `Group` turns about its origin and other layers about their anchor (also the vanishing point), that children flatten into the parent's plane with no depth sorting, and that a projective layer is isolated. `extractTransform` reads them with `numberOr`, `perspective` only when finite and > 0, `backfaceVisibility` validated like `extractBlendMode`. `compactTransform` omits each at its default. `rawTransform` already passes through.

- [ ] **Step 4: Run** `pnpm run build:runtime && pnpm --dir packages/react test` — expected PASS.

- [ ] **Step 5: Commit** — `feat(react): add skew, 3D rotation, perspective, and backfaceVisibility props`

---

### Task 4: CPU reference renderer refusals

**Files:**
- Modify: `crates/renderer/src/error.rs` (new variant), `crates/renderer/src/layer.rs` (`render_layer`, line 24)
- Test: `crates/renderer/src/tests.rs`

**Interfaces:**
- Produces: `RenderError::UnsupportedTransform { layer: String, property: &'static str }`, displayed as ``CPU reference renderer does not support `{property}` on layer `{layer}` ``, with `property` one of `"skewX"`, `"skewY"`, `"rotationX"`, `"rotationY"`.

- [ ] **Step 1: Write the failing test** `refuses_skew_and_3d_rotation`: a rect with each of `skew.x = 5`, `skew.y = 5`, `rotation_x = 5`, `rotation_y = 5` fails with the matching `property`; a rect with only `perspective: Some(500.0)` and `backface_visibility: Hidden` renders like a plain rect.

- [ ] **Step 2: Run** `cargo test -p celesta-renderer refuses_skew` — expected FAIL.

- [ ] **Step 3: Implement** the check next to the rotation check, in the order listed.

- [ ] **Step 4: Run** `cargo test -p celesta-renderer` — expected PASS.

- [ ] **Step 5: Commit** — `feat(renderer): refuse skew and 3D rotation in the CPU reference renderer`

---

### Task 5: GPU affine path and facing

**Files:**
- Modify: `crates/gpu-renderer/src/transform.rs` (`Affine::from_transform`, `is_degenerate`, `LayerState`)
- Modify: `crates/gpu-renderer/src/prepare.rs` (`prepare_layer` start; every `LayerState { … }` literal gets `..parent`/`..state` or explicit new fields)
- Test: `crates/gpu-renderer/src/tests/transform_3d.rs` (new module, registered in `tests.rs`)

**Interfaces:**
- Consumes: `EvaluatedTransform::linear`, `faces_away`, `multiply3`, `Matrix3` (Task 1).
- Produces: `LayerState` fields `orientation: Matrix3` (default `IDENTITY3`), `effect_scale: f32` (default 1), `plane: Option<u32>` (default None); `LayerState::then` multiplies `orientation` by `transform.linear()` and passes the other two through. `Affine::from_transform` takes `a = L00, b = L10, c = L01, d = L11` (as f32) and the position. `Affine::is_degenerate` is also true when the determinant is not finite.

- [ ] **Step 1: Write the failing tests** in `tests/transform_3d.rs`:
  - `skews_rects_by_the_tangent`: 64×64 scene, red 20×20 rect at (10, 10), anchor 0, `skew.x = 45`: pixel (35, 25) red, (22, 25) and (47, 25) transparent.
  - `orthographic_rotation_y_matches_scale_x`: a rect with `rotation_y = 60` and one with `scale.x = 0.5` render identical frames (max channel difference 0).
  - `hides_backfaces_through_parents`: group at (32, 32) with `rotation_y = 120` (no perspective) holding red rect A (`Hidden`) and a child group with `rotation_y = 180` (`Hidden`) holding blue rect B over the same area: centre pixel blue; with the group at `rotation_y = 30`: red.
  - `edge_on_layers_draw_nothing`: `rotation_y = 90` with and without `perspective: Some(400.0)`, and `skew.x = 90`: the frame is entirely transparent and rendering returns Ok.

- [ ] **Step 2: Run** `cargo test -p celesta-gpu-renderer transform_3d` — expected FAIL (skew ignored, backfaces drawn).

- [ ] **Step 3: Implement.** At the top of `prepare_layer`, before computing `state`: when `layer.transform.backface_visibility` is `Hidden` and `faces_away(&multiply3(&parent.orientation, &layer.transform.linear()))`, return `Ok(())`.

- [ ] **Step 4: Run** `cargo test -p celesta-gpu-renderer` — expected PASS; existing tests unchanged.

- [ ] **Step 5: Commit** — `feat(gpu-renderer): draw skew and orthographic 3D rotation, and hide backfaces`

---

### Task 6: GPU projective planes

**Files:**
- Create: `crates/gpu-renderer/src/plane.rs` (pure geometry and `prepare_plane`)
- Modify: `crates/gpu-renderer/src/layer.rs` (`PreparedItem`, `PreparedLayer`, `InstanceFields`, `layer_instance`, `LAYER_INSTANCE_FLOATS`)
- Modify: `crates/gpu-renderer/src/draw.rs` (`LAYER_INSTANCE_SIZE`, `LAYER_INSTANCE_ATTRIBUTES`)
- Modify: `crates/gpu-renderer/src/plan.rs` (`plan_groups`, `GroupPlan`)
- Modify: `crates/gpu-renderer/src/prepare.rs` (dispatch to `prepare_plane`, item-to-step loop, instance count)
- Modify: `crates/gpu-renderer/src/text.rs` (factor the 1/8-octave rounding out of `text_raster_scale`; `PendingText::measured_bounds`)
- Modify: `crates/gpu-renderer/src/layer.wgsl`
- Test: `crates/gpu-renderer/src/plane.rs` (unit tests), `crates/gpu-renderer/src/tests/transform_3d.rs`

**Interfaces:**
- Consumes: Task 1 math; Task 5 `LayerState` fields.
- Produces:
  - `PreparedItem::BeginPlane { width: u32, height: u32 }` and `PreparedItem::EndPlane(PreparedLayer)`.
  - `PreparedLayer.projection: [f32; 3]`, the bottom row of the map from the layer's quad units to its target (`[0, 0, 1]` for everything else); `PreparedLayer::plane(state: LayerState, blend_mode: BlendMode, projection: [f32; 3]) -> Self` (a premultiplied canvas).
  - `GroupPlan.lands: Option<PixelBounds>`: where the group's canvas lands in its parent's space; `canvas.bounds()` for every existing kind, the projected bounds for a plane. Every `End*` step's `area` uses it.
  - `pub(crate) fn round_up_to_eighth_octave(scale: f64) -> f64` (text.rs; `text_raster_scale` calls it, clamping as before).
  - In `plane.rs`:
    - `pub(crate) const NEAR_W: f64 = 1.0 / 16.0;`
    - `pub(crate) fn clip_in_front(m: &Matrix3, corners: &[[f64; 2]]) -> Vec<[f64; 2]>`: the convex polygon clipped to `w ≥ NEAR_W` (Sutherland–Hodgman on the line `w = NEAR_W`).
    - `pub(crate) fn projected_bounds(m: &Matrix3, width: u32, height: u32) -> Option<PixelBounds>`: the canvas rectangle clipped by `clip_in_front`, projected, boxed, grown by 2 px; None when empty.
    - `pub(crate) struct PlaneRaster { scale: f64, left: f64, top: f64, width: u32, height: u32 }` (local units → plane pixels is `Translate(1 − left·scale, 1 − top·scale) · Scale(scale)`).
    - `pub(crate) fn plane_raster(forward: &Matrix3, local: PixelBounds, target: PixelBounds, max_texture: u32) -> Option<PlaneRaster>`, `forward` = layer-local → target space.
    - `impl GpuRenderer { pub(crate) fn prepare_plane(&mut self, layer: &Layer, parent: LayerState, output: &mut Vec<PreparedItem>) -> Result<(), GpuRenderError> }`
  - `LayerInstance` gains `@location(9) projection: vec4<f32>` (g, h, i, unused); `LAYER_INSTANCE_FLOATS = 40`, `LAYER_INSTANCE_SIZE = 10 * 4 * 4`.

`plane_raster` algorithm:

```text
polygon = clip_in_front(forward, corners(local))
if every corner of `target` maps through invert3(forward) to W > 0:
    polygon = polygon clipped to the box of those four local points
if polygon is empty: None
scale = max(stretch_at(forward, v) for v in polygon) → round_up_to_eighth_octave → clamp [2^-6, 2^6]
box = bounding box of polygon
while ceil(box.width · scale) + 2 > max_texture or ceil(box.height · scale) + 2 > max_texture:
    scale = (max_texture − 2) / max(box.width, box.height)   (once; not rounded)
width, height = ceil(box.width · scale) + 2, ceil(box.height · scale) + 2
```

`prepare_plane` algorithm (dispatched from `prepare_layer` after the effects block and before the content `match`, when `layer.transform.is_projective()`; the effects block's inner call reaches it):

```text
forward = parent.transform (as Matrix3) · layer.transform.homography()
inner = layer with transform { anchor: layer's, all else default }, opacity 1, blend Normal, no effects
orientation = parent.orientation · layer.transform.linear()
target = the space being drawn in: the enclosing plane's (0, 0, width, height), else the scene
— pass 1: remember the lengths of output, pending_texts, pending_paths, clip_entries,
  paint_entries, hit_leaves, plane_entries; prepare `inner` with transform IDENTITY, clip None,
  opacity 1, `orientation`; local = content_bounds of the new items (pending text by
  `PendingText::measured_bounds`, pending paths by `shape_box` placed by their state);
  truncate everything back
— raster = plane_raster(forward, local, target, max_texture_dimension)?; none → Ok(())
— pass 2: push BeginPlane { width, height }; push the plane's space; prepare `inner` with
  transform = the raster's local → plane-pixel map, clip None, opacity 1, `orientation`,
  effect_scale (Task 7), plane = Some(new plane entry index); pop the space
— to_parent = forward · inverse(local → plane-pixel); push EndPlane(PreparedLayer::plane(
  { transform: to_parent's top two rows, opacity: parent.opacity × layer.opacity, clip: parent.clip, .. },
  layer.blend_mode, to_parent's bottom row))
```

`content_bounds` is `plan_groups`'s walk returning the outermost `Covered::content`, with pending items resolved by a callback: refactor `plan_groups` into one walk both use, so nested groups, masks, and effects grow the bounds exactly as they plan canvases.

`plan_groups`: `BeginPlane` opens a plan whose canvas is exactly `(0, 0, width, height)` and pushes that region as the space nested plans are clamped to; `EndPlane` pops it, sets `lands = projected_bounds(layer's map, width, height)`, and covers its parent with `lands`.

Shader (`layer.wgsl`):
- `vs_main` computes `hom = (matrix · local + translation, dot(projection.xy, local) + projection.z)` and outputs `vec4(clip.xy · hom.z, 0.0, hom.z)` with `clip` computed from `hom.xy / hom.z` as today (identical for affine layers, where `hom.z = 1`).
- A projective instance (`projection.xy ≠ 0`) has `clip_sampling.y = 2`; `VertexOutput` passes the forward map flat (`inverse` = matrix, `inverse_translation_caps.xy` = translation) and a new `@location(12) @interpolate(flat) projection: vec4<f32>`.
- `fs_main` and `fs_blend` take `dpdx(input.uv)` and `dpdy(input.uv)` first (uniform control flow) and pass them to `source_color`. With `sampling.x == 2`: `world` comes from `uv` through the forward map (`projected_world`), not the interpolated `world`; the color is the premultiplied average of an `nx × ny` grid of `bilinear` taps at level 0 spanning `uv ± (dx, dy)/2`, `n = clamp(ceil(length(d · texels)), 1, 8)` per axis, unpremultiplied at the end.
- `write_instance` writes `projection` into the new attribute, and sets `exact = false`, the sampling flag 2, and level of detail 0 for a projective layer.

- [ ] **Step 1: Write the failing unit tests** in `plane.rs`:
  - `projected_bounds_of_an_affine_canvas_is_its_box`: `IDENTITY3`, 10×20 → `[-2, -2, 12, 22]`.
  - `projected_bounds_drop_what_is_behind_the_viewer`: bottom row `[-0.01, 0, 1]`, 200×10 → `Some`, every value finite, left `-2`.
  - `plane_raster_of_an_unscaled_layer`: identity, local `[0, 0, 100, 50]`, target `[0, 0, 1920, 1080]`, 8192 → scale 1, width 102, height 52, left 0, top 0.
  - `plane_raster_follows_a_scale`: `Scale(2)` → scale 2, width 202.
  - `plane_raster_covers_the_nearest_corner`: `forward` = `rotationY 60, perspective 1000, position (500, 500)` homography, local `[-100, -100, 100, 100]`: `scale ≥ stretch_at` at each corner and `(scale.log2() * 8.0)` is an integer within 1e-9.
  - `plane_raster_is_limited_to_the_visible_part`: identity, local `[-1e6, -1e6, 1e6, 1e6]`, target `[0, 0, 1920, 1080]` → width 1922, height 1082.
  - `plane_raster_stays_within_the_texture_limit`: identity, local `[0, 0, 10000, 10]`, target `[0, 0, 20000, 20000]`, 8192 → width ≤ 8192 and scale < 1.

- [ ] **Step 2: Run** `cargo test -p celesta-gpu-renderer plane::` — expected FAIL.

- [ ] **Step 3: Implement** `plane.rs`'s pure functions and `round_up_to_eighth_octave`.

- [ ] **Step 4: Run** `cargo test -p celesta-gpu-renderer plane::` — expected PASS.

- [ ] **Step 5: Write the failing scene tests** in `tests/transform_3d.rs` (expected positions from `project(&layer.transform.homography(), …)`):
  - `projects_a_rect_through_its_perspective`: 200×200 scene, red 100×100 rect, anchor 0.5, at (100, 100), `rotation_y = 45`, `perspective = 300`: for each edge midpoint of the projected quad, the pixel 3 px inward is red (alpha 255) and 3 px outward transparent.
  - `projective_text_stays_sharp`: "H", 120 px, in a group at (100, 100) with `rotation_x = 30`, `perspective = 800`; and the same without 3D. The largest alpha step between horizontally adjacent pixels on the row through the stems is at least 0.75 times the flat render's.
  - `flips_a_card`: the spec's card example (scene 400×400, faces 120×160, `perspective = 600`): `rotation_y = 30` → centre is the front colour; `150` → the back colour; `90` → the pixel 10 px left of the centre is transparent (edge-on).
  - `nests_projective_groups`: a `rotation_x = 20, perspective = 800` group holding a `rotation_y = 30, perspective = 600` rect over the centre: renders Ok, centre red.
  - `clips_inside_and_outside_a_projective_group`: a clipped parent group (clip = left half of the scene) around a projective rect crossing the middle → a pixel right of the middle inside the quad is transparent; a projective group with its own clip on its left half → the right half of its quad is transparent.
  - `draws_only_what_is_in_front_of_the_viewer`: 1000×100 rect, anchor 0.5, at the scene centre, `rotation_y = 80`, `perspective = 200`: Ok, at least one red pixel, no pixel's channels outside 0–255 (readback succeeds).
  - `caps_huge_planes_at_the_texture_limit`: 50,000 × 50,000 rect, `rotation_x = 60`, `perspective = 1000`: Ok.
  - `blends_a_projective_layer_with_its_mode`: a projective white rect with `BlendMode::Difference` over a red background: centre is cyan (0, 255, 255).

- [ ] **Step 6: Run** `cargo test -p celesta-gpu-renderer transform_3d` — expected FAIL (projective layers drawn flat).

- [ ] **Step 7: Implement** `prepare_plane`, the items, planning, instance layout, and shader changes as specified above.

- [ ] **Step 8: Run** `cargo test -p celesta-gpu-renderer && cargo clippy -p celesta-gpu-renderer --all-targets -- -D warnings` — expected PASS, existing tests unchanged.

- [ ] **Step 9: Commit** — `feat(gpu-renderer): draw perspective layers through a canvas in their own plane`

---

### Task 7: Effect sizes inside planes

**Files:**
- Modify: `crates/gpu-renderer/src/effect.rs` (`EffectSpec`), `crates/gpu-renderer/src/plane.rs`, `crates/gpu-renderer/src/prepare.rs` (effects block)
- Test: `effect.rs` unit tests, `tests/transform_3d.rs`

**Interfaces:**
- Consumes: Task 6's `PlaneRaster`, `LayerState.effect_scale`.
- Produces: `EffectSpec::scaled(self, factor: f32) -> Self` (blur, shadow blur and offset, glow blur multiplied, blurs then clamped to 64 as `parse` does); `pub(crate) fn effect_scale(forward: &Matrix3, raster: &PlaneRaster) -> f32` = `raster.scale / stretch_at(forward, 0, 0)` (1 when that is None). Pass 2 of `prepare_plane` sets `effect_scale = parent.effect_scale × effect_scale(forward, &raster)`. The effects block uses `EffectSpec::parse(..)?.scaled(state.effect_scale)`. Custom shaders and built-in filters keep plane pixels (documented in Task 11).

- [ ] **Step 1: Write the failing tests**: `scales_blurs_and_shadow_offsets` (`blur 4, shadow {blur 2, offset (3, -1)}, glow 5` scaled by 2 → 8, 4, (6, -2), 10; blur 40 × 2 → 64); `effect_scale_is_one_for_a_flat_plane` (identity forward, raster scale 1 → 1.0); scene test `blurs_inside_a_plane_in_output_pixels`: a blurred (8 px) rect inside a group with `rotation_x = 0.01`, `perspective = 1000`, scaled 2 by its parent group, matches the same scene without the 3D props within a max channel difference of 6.

- [ ] **Step 2: Run** `cargo test -p celesta-gpu-renderer effect` — expected FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** `cargo test -p celesta-gpu-renderer` — expected PASS.
- [ ] **Step 5: Commit** — `fix(gpu-renderer): measure effects inside a perspective layer in output pixels`

---

### Task 8: Hit testing through planes

**Files:**
- Modify: `crates/gpu-renderer/src/hit.rs` (`HitClip`, `HitLeaf`), `crates/gpu-renderer/src/plane.rs`, `crates/gpu-renderer/src/prepare.rs` (`resolve_hit_regions`, `prepare_draws` reset)
- Test: `tests/transform_3d.rs`

**Interfaces:**
- Consumes: Task 6's plane entries.
- Produces: `pub(crate) struct PlaneEntry { to_parent: Matrix3, parent: Option<u32>, clip: Option<u32> }` in `GpuRenderer::plane_entries` (cleared per frame, rolled back by pass 1); `HitLeaf.plane: Option<u32>` (from `LayerState.plane`); `HitClip.to_local: Option<[f64; 9]>` (scene → the clip's space, row-major; `None` for scene space), applied in `contains` before the inverse affine, a point with `W ≤ 0` not contained.
- Resolving a leaf in a plane: its corners and hole map through each `to_parent` up the chain to scene pixels (the region is dropped if any `W ≤ 0`); its own clips get `to_local` = the inverse of the composed plane → scene map; then the plane's `clip` chain follows in the parent's space, and so on outwards.

- [ ] **Step 1: Write the failing test** `hit_tests_through_a_projection` (record hit regions on): a projective rect `card` (`rotation_y = 45`, `perspective = 300`) at the centre: the projected centre hits `card`; a point 3 px outside the far edge's midpoint hits nothing; a projective group with a clip on its left half: a point inside the quad's right half hits nothing.

- [ ] **Step 2: Run** `cargo test -p celesta-gpu-renderer hit_tests_through` — expected FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** `cargo test -p celesta-gpu-renderer` — expected PASS.
- [ ] **Step 5: Commit** — `feat(gpu-renderer): hit-test layers through perspective planes`

---

### Task 9: Web renderer (`@celesta/web`)

**Files:**
- Create: `packages/web/src/projection.ts`
- Modify: `packages/web/src/types.ts` (`Transform`), `packages/web/src/scene-canvas.ts` (`layer`, `shapeBox`)
- Test: `packages/web/test/projection.test.mjs` (new), `packages/web/test/scene-canvas.test.mjs`

**Interfaces:**
- Consumes: the JSON fields of Task 1.
- Produces, in `projection.ts` (DOM-free, mirroring Task 1 and Task 6 exactly, same constants): `type Matrix3 = number[][]`, `IDENTITY3`, `multiply3`, `invert3`, `project`, `stretchAt`, `facesAway`, `linear(t: Transform)`, `homography(t: Transform)`, `isProjective(t: Transform)`, `planeRaster(forward, local: Box, target: Box, maxSize: number)`, `effectScale(forward, raster)`, and `tapCount(toSource: Matrix3, x: number, y: number): [number, number]`, and `warp(source: Uint8ClampedArray, sourceWidth: number, sourceHeight: number, target: Uint8ClampedArray, targetWidth: number, toSource: Matrix3, box: Box): void` — composites the straight-alpha source onto the straight-alpha target source-over at each target pixel of `box` whose centre maps (through `toSource`, `W > 0`) into the source, averaging an `nx × ny` grid of premultiplied bilinear taps over the pixel's footprint (from `toSource`'s Jacobian there, `n = clamp(ceil(extent), 1, 8)` per axis).
- `Transform` (types.ts) gains `skew?`, `rotationX?`, `rotationY?`, `perspective?`, `backfaceVisibility?`.
- `SceneCanvas.layer(ctx, layer, parent, opacity, orientation = IDENTITY3, effectScale = 1)`.

- [ ] **Step 1: Write the failing tests** in `projection.test.mjs` (built with esbuild like `scene-canvas.test.mjs`): the Task 1 matrix and facing cases with the same values; `planeRaster` cases from Task 6 Step 1; `warp` of an opaque 4×4 red source through `Scale(2)` onto an 8×8 target fills it all red; through the Task 1 `rotationY 90, perspective 1000` homography, target pixels whose centre has `W ≤ 0` are left as they were; `tapCount` of `Scale(8)` (target → source) is `[8, 8]`.
  In `scene-canvas.test.mjs`: a `Hidden` rect inside a group with `rotationY: 180` draws nothing (no `fill` operation); a projective rect creates a canvas sized by `planeRaster` and composites it once (mock `getImageData`/`putImageData`/`createImageData`).

- [ ] **Step 2: Run** `pnpm --dir packages/web test` — expected FAIL.

- [ ] **Step 3: Implement.** In `layer`: backface check first (as Task 5); when `skew`, `rotationX`, and `rotationY` are all 0 keep today's `translate().rotate().scale()` chain (existing tests and output unchanged), otherwise `parent.translate(x, y).multiply(new DOMMatrix([L00, L10, L01, L11, 0, 0]))`. A projective layer: local bounds from `shapeBox` of the layer with its transform reset (anchor kept) under an identity parent, `forward` from `parent` and `homography`, `planeRaster` against the context's canvas box; draw the reset layer onto a `width × height` surface with the raster's local → pixel matrix, the orientation, and `effectScale`; then `warp` it onto a context-sized surface and draw that onto `ctx` with the layer's alpha, through `this.blend` for a non-normal mode. Effect sizes (`blur`, shadow, glow) multiply by `effectScale`.

- [ ] **Step 4: Run** `pnpm --dir packages/web test && pnpm --dir packages/web run build` — expected PASS.

- [ ] **Step 5: Commit** — `feat(web): draw skew, 3D rotation, perspective, and hidden backfaces in the browser renderer`

---

### Task 10: MCP layer summary

**Files:**
- Modify: `crates/mcp/src/summary.rs` (`describe_transform`, line 100)
- Test: `crates/mcp/src/summary.rs` tests

- [ ] **Step 1: Write the failing test** `describes_skew_and_3d_transforms`: a layer with `skew {x: 10, y: 0}`, `rotationX 15`, `rotationY 30`, `perspective 800`, `backfaceVisibility "hidden"` is described with, after `rotate`, the parts `skew (10°, 0°)`, `rotate X 15°`, `rotate Y 30°`, `perspective 800`, `backface hidden`; a layer without them gets none of these parts.
- [ ] **Step 2: Run** `cargo test -p celesta-mcp describes_skew` — expected FAIL.
- [ ] **Step 3: Implement** with the existing `fmt` and `point` helpers.
- [ ] **Step 4: Run** `cargo test -p celesta-mcp` — expected PASS.
- [ ] **Step 5: Commit** — `feat(mcp): describe skew and 3D transforms in layer summaries`

---

### Task 11: Example, documentation, and screenshots

**Files:**
- Create: `packages/cli/examples/with-3d-transform.tsx`
- Create: `docs/handoff/2026-10-16-skew-3d-transform.md`
- Modify: `HANDOFF.md` (one bullet under "Renderer and export constraints" pointing to the note)
- Modify: `packages/website/content/en/docs/02-(guides)/04-layout.md`, `packages/website/content/ja/docs/02-(guides)/04-layout.md` (a "Skew and 3D" section after "Coordinates and anchors")
- Modify: `packages/website/content/en/docs/03-(reference)/01-reference.md`, the ja counterpart (the `Group` row mentions 3D rotation)

- [ ] **Step 1: Write the example** (1920×1080, 30 fps, 6 s): a card that turns over continuously (front: title text and a star path; back: different text and a circle), using `interpolate` on the frame for `rotationY` 0→360, `perspective={1400}`, faces `backfaceVisibility="hidden"`; a row of three cards leaning with `skewX={-12}`; a floor of tiles tilted back with `rotationX={60}` and `perspective={900}` with text on them.

- [ ] **Step 2: Render and check it**

Run: `cargo run -p celesta-exporter -- --react packages/cli/examples/with-3d-transform.tsx /tmp/claude/with-3d.mp4` (use the session scratchpad), then extract frames at 0 s, 1 s, 1.5 s, and 4 s as PNGs.
Expected: export succeeds; the card's text is crisp at the near edge; the back face reads correctly (not mirrored) at 1.5 s; the tiles' far rows are smooth (no shimmer) and the near rows sharp.

- [ ] **Step 3: Write the docs.** Guide sections (en and ja, same content): the props table, the matrix order, the pivot and vanishing point, flattening and painter's order, the card example, that a perspective layer is isolated, that effect sizes stay in output pixels while custom shaders and built-in filters inside a perspective layer run in its own raster pixels, and that the CPU reference renderer refuses skew and 3D rotation. The handoff note records the model, the plane pipeline (two passes, raster scale, footprint filter, hit testing), the web renderer's mirror, and the checks actually run with their results.

- [ ] **Step 4: Screenshots for the PR.** Render the same frame of the example before (on `main`, where the new props are ignored) and after this branch into the scratchpad as PNGs; attach them to the PR with `gh pr edit --attach`.

- [ ] **Step 5: Run the full checks** from Global Constraints plus `pnpm run build:runtime && pnpm run test:runtime`. Expected: all pass; record results in the handoff note.

- [ ] **Step 6: Commit** — `docs: document skew and 3D transforms, with a card-flip example`
