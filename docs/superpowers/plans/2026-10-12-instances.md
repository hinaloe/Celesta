# Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `Instances` layer that draws up to ~100,000 rect, circle, or image-sprite particles from typed-array columns, fast enough that a 100,000-particle frame round-trips React → Rust in ≤ 20 ms and renders on the GPU in ≤ 10 ms (Apple M4).

**Architecture:** `LayerContent::Instances` carries base64-encoded columns that deserialize into `Arc<[f32]>` / `Arc<[u8]>`. The GPU renderer turns the layer into one boxed `PreparedItem::Instances` and writes one existing 144-byte `LayerInstance` per particle in a tight loop, drawn as one instanced draw; image sprites use a new shader kind 3 (texture × colour). The CPU reference renderer draws particle by particle through the existing rect and image helpers. `@celesta/react` adds `<Instances>`, which encodes typed arrays with `Buffer#toString('base64')`.

**Tech Stack:** Rust 2024 (serde, ts-rs, base64 0.22, bytemuck, wgpu, WGSL), TypeScript (React 18 reconciler), vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-instances-design.md`

## Global Constraints

- JSON keys: `type: "instances"`, `count`, `shape`, `width`, `height`, `color`, `x`, `y`, `widths`, `heights`, `rotation`, `colors`. Props map `fill` → `color`, `color` → `colors`, array `width`/`height` → `widths`/`heights`.
- `shape` JSON: `{"type":"rect","cornerRadius":r}`, `{"type":"circle"}`, `{"type":"image","asset":{…}}`.
- Columns: standard base64 with padding of raw bytes; `f32` little-endian for `x`, `y`, `widths`, `heights`, `rotation`; `u8` straight-alpha RGBA for `colors` (length `4 * count`).
- Particle `i` ≡ a `Rect` anchored at (0.5, 0.5), at `(x[i], y[i])`, rotated `rotation[i]` degrees, `w[i]` × `h[i]`, filled `colors[i]` (else `color`, else `#FFFFFF`), corner radius `cornerRadius` (rect) or `min(w, h) / 2` (circle), no stroke. Image: the image at `w[i]` × `h[i]` (natural size when no width/height), texel colour and alpha × `colors[i] / 255`.
- Per-particle sizes take precedence over shared ones.
- `x`, `y`, `rotation` on `<Instances>` are always particle columns; the layer's own transform is identity apart from `scale`.
- A non-normal blend mode isolates the layer like a `Group`; effects wrap it like any layer.
- A particle with a non-finite x, y, size, or rotation draws nothing.
- Shader kinds 0–2 keep their behaviour; images use the new kind 3.
- Project JSON (`TimelineContent`) does not get `Instances`.
- Build with `PKG_CONFIG_PATH="$(brew --prefix ffmpeg@8)/lib/pkgconfig"` on macOS (FFmpeg 9 breaks the build).
- Edit files with the Edit tool, not `sed`/`perl`/`python` rewrites.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **`count = 0`** (an emitter that has not started): empty columns are `""`, the GPU renderer must not emit an empty draw or a zero-sized buffer write, and the CPU renderer draws nothing. Pinned in Tasks 1, 3, and 5.
2. **One typed array reused and mutated every frame** (the spec's own example): each frame must send the array's current contents, never a cached encoding. Pinned in Task 5.
3. **A blend-mode `Instances` layer partly off the scene edge**: the isolated canvas is clamped to the scene and the visible particles still draw. Pinned in Task 3.
4. **`Instances` inside a scaled and rotated parent `Group`**: particles follow the parent exactly as `Rect`s would. Pinned in Task 3.
5. **A shared `width` with per-particle `heights`**: each axis picks its own source. Pinned in Tasks 1 and 3.

---

### Task 1: Scene model

**Files:**
- Create: `crates/composition/src/instances.rs`
- Modify: `crates/composition/src/model.rs` (`LayerContent`, `LayerContentDef`, `impl Deserialize for LayerContent`)
- Modify: `crates/composition/src/lib.rs` (module + re-exports)
- Modify: `crates/composition/Cargo.toml` (`base64 = "0.22.1"`)
- Test: `crates/composition/src/tests.rs`
- Modify (add an arm wherever `cargo check --workspace --all-targets` reports a non-exhaustive match): `crates/exporter/src/project.rs` (`absolutize_layers`), `crates/gpu-renderer/src/prepare.rs`, `crates/renderer/src/layer.rs`, and any other site.

**Interfaces:**
- Produces, re-exported from `celesta_composition`:
  - `pub struct F32Column(pub Arc<[f32]>)` and `pub struct U8Column(pub Arc<[u8]>)`, both `Clone + Debug + PartialEq + Serialize + Deserialize`, `Deref<Target = [f32]>` / `Deref<Target = [u8]>`, and `From<Vec<f32>>` / `From<Vec<u8>>`.
  - `pub enum InstanceShape { Rect { corner_radius: f64 }, Circle, Image { asset: ResolvedAsset } }`, tagged by `type`, camelCase, deserialized through `TypeTagged` like `LayerContent`.
  - `LayerContent::Instances { count: u32, shape: InstanceShape, width: Option<f64>, height: Option<f64>, color: Option<String>, x: F32Column, y: F32Column, widths: Option<F32Column>, heights: Option<F32Column>, rotation: Option<F32Column>, colors: Option<U8Column> }`; `Option`s skip serializing when `None`. Renderers index the columns directly; deserialization guarantees their lengths.

- [ ] **Step 1: Write the failing tests** in `crates/composition/src/tests.rs`:
  - `instance_columns_round_trip_as_base64`: `F32Column::from(vec![1.5, -2.0])` serializes to `"AADAPwAAAMA="`; `U8Column::from(vec![255, 0, 128, 64])` to `"/wCAQA=="`; both parse back equal; `F32Column::from(vec![])` serializes to `""` and parses back.
  - `instances_round_trip_with_every_column`: a full `LayerContent::Instances` (count 2, `Circle`, shared `width: Some(4.0)`, per-particle `heights`, `rotation`, `colors`) round trips through a string and a `serde_json::Value`, and its JSON has `"type":"instances"` first and keys `widths`/`heights`/`colors`.
  - `instances_reject_columns_of_the_wrong_length`: for each of `x`, `y`, `widths`, `heights`, `rotation` with 3 values and `count: 2`, and `colors` with 7 bytes, `serde_json::from_str::<LayerContent>` fails with a message containing the column name and `count 2`.
  - `instances_with_no_particles_parse`: `{"type":"instances","count":0,"shape":{"type":"rect","cornerRadius":0},"x":"","y":""}` parses with empty columns.
  - Add `Instances` (with `Rect`, `Circle`, and `Image` shapes) and `InstanceShape` to `every_tagged_variant_round_trips`.

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p celesta-composition instances`
Expected: compile errors for `F32Column`, `InstanceShape`, `LayerContent::Instances`.

- [ ] **Step 3: Implement** the types in `instances.rs` and the variant in `model.rs` (and `LayerContentDef`). Column (de)serialization uses `base64::engine::general_purpose::STANDARD`; `f32`s via `f32::from_le_bytes` / `to_le_bytes`; a base64 string whose byte length is not a multiple of 4 is a `F32Column` error. Codegen: annotate each column field `#[cfg_attr(feature = "codegen", ts(type = "string"))]`. The length check runs in `impl Deserialize for LayerContent` right after `LayerContentDef::deserialize(TypeTagged(deserializer))`, failing with `D::Error::custom(format!("instances column `{name}` has {len} values; count {count} needs {expected}"))`. Add the compile-required arms: exporter absolutizes `InstanceShape::Image`'s asset; the GPU renderer returns `GpuRenderError::UnsupportedContent { layer, content: "instances" }` and the CPU renderer draws nothing, both replaced in Tasks 2 and 3.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p celesta-composition && cargo check --workspace --all-targets`
Expected: PASS, and the workspace builds.

- [ ] **Step 5: Regenerate bindings** with `pnpm --dir packages/react run codegen` and re-export `InstanceShape` from `packages/react/src/scene.ts`. `pnpm --dir packages/react run build` succeeds.

- [ ] **Step 6: Commit** — `feat(composition): add Instances layer content`

### Task 2: CPU renderer

**Files:**
- Modify: `crates/renderer/src/layer.rs` (the `Instances` arm), `crates/renderer/src/images.rs` (`render_image_pixels` gains `tint: [u8; 4]`; existing callers pass `[255; 4]`)
- Test: `crates/renderer/src/tests.rs`

**Interfaces:**
- Consumes: Task 1's `LayerContent::Instances`, `InstanceShape`, column `Deref`s.
- Produces: `render_image_pixels(frame, image_width, image_height, pixels, anchor, state, tint: [u8; 4])`, used again by nothing else in this plan.

- [ ] **Step 1: Write the failing tests:**
  - `instances_draw_like_centred_rects`: a 40×40 scene with `Instances { count: 3, Rect { corner_radius: 2.0 }, width: Some(10.0), heights: [6, 8, 10], colors: three different RGBA with alpha 200 }` renders pixel-identically to three `Rect` layers anchored (0.5, 0.5) with the same values. Repeat with `Circle` (radius = min(w, h) / 2).
  - `instances_with_no_particles_draw_nothing`: `count: 0` leaves the frame equal to an empty scene's.
  - `instances_reject_rotated_particles`: a non-zero `rotation` value returns `RenderError::UnsupportedRotation` with the layer id.
  - `instance_images_multiply_their_colour`: a 2×2 opaque white PNG asset drawn at natural size with colour `[255, 0, 0, 128]` yields `[255, 0, 0, 128]`-over-background pixels, and colour `[255, 255, 255, 255]` yields the image unchanged.
  - `blended_instances_match_a_blended_group`: `Instances` with `BlendMode::Screen` over a background rect equals a `Group` with `Screen` containing the equivalent `Rect`s.

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p celesta-renderer instances`
Expected: FAIL (the arm draws nothing).

- [ ] **Step 3: Implement the arm.** For rect/circle, each particle runs the same code as the `Rect` arm (`resolve_rect_paint` with a `Paint::Solid` of the particle colour formatted as `#rrggbbaa`, `rasterize_rect_transformed`, `render_output_pixels`) with anchor (0.5, 0.5). Skip particles with non-finite values. For images, load the image as the `Image` arm does, scale `state.scale` by `w / natural_width` and `h / natural_height`, and call `render_image_pixels` with the tint. A non-normal blend mode goes through the same isolation the `Group` arm uses.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p celesta-renderer`
Expected: PASS (all existing tests too).

- [ ] **Step 5: Commit** — `feat(renderer): draw Instances layers`

### Task 3: GPU renderer — rect and circle particles

**Files:**
- Create: `crates/gpu-renderer/src/instances.rs`
- Modify: `crates/gpu-renderer/src/layer.rs` (`PreparedItem::Instances(Box<PreparedInstances>)`; extract the float layout of `PreparedLayer::write_instance` into a shared helper)
- Modify: `crates/gpu-renderer/src/prepare.rs` (`prepare_layer` arm; `prepare_draws` instance count, draw loop)
- Modify: `crates/gpu-renderer/src/plan.rs` (`plan_groups` treats `Instances` like `Layer`)
- Modify: `crates/gpu-renderer/src/lib.rs` (module)
- Test: `crates/gpu-renderer/src/tests.rs`

**Interfaces:**
- Consumes: Task 1's types.
- Produces:
  - `pub(crate) const LAYER_INSTANCE_FLOATS: usize = 36;` and `pub(crate) fn layer_instance(fields: &InstanceFields) -> [f32; LAYER_INSTANCE_FLOATS]` in `layer.rs`, where `InstanceFields` names every value `write_instance` writes today (affine, translation, size, anchor, opacity, kind, target, blend mode, premultiplied, rect, fill, stroke, clip, filter, level of detail, raster scale). `PreparedLayer::write_instance` calls it and appends with `bytemuck::cast_slice`; its output bytes do not change.
  - `pub(crate) struct PreparedInstances { state: LayerState, shape: PreparedInstanceShape, count: u32, columns: InstanceColumns, bounds: PixelBounds, shape_box: PixelBounds }` with `fn bounds(&self) -> PixelBounds`, `fn shape(&self) -> PixelBounds`, `fn count(&self) -> u32`, `fn write_instances(&self, target: CanvasRegion, output: &mut Vec<u8>)`.
  - `pub(crate) enum PreparedInstanceShape { Rect { corner_radius: f32 }, Circle, Image(LayerTexture) }` (`Image` is filled in Task 4).

- [ ] **Step 1: Write the failing tests** (each builds an `Instances` scene and an equivalent scene of `Rect`s anchored at (0.5, 0.5), renders both, and asserts `max_channel_difference`-style equality of the two GPU frames is 0):
  - `instances_shade_like_centred_rects` — 64×64, 50 particles of `Rect { corner_radius: 3.0 }` with per-particle `widths`, shared `height: Some(7.0)`, `rotation` from 0 to 350°, translucent `colors`.
  - `circle_instances_shade_like_round_rects` — same with `Circle`.
  - `instances_follow_a_scaled_rotated_parent` — both scenes inside `group(transform with scale 1.5 and rotation 30°)`.
  - `instances_draw_through_a_group_clip` — both inside `clipped_group`.
  - `blended_instances_match_a_blended_group_off_the_edge` — `Screen` `Instances` whose particles straddle the scene's right edge vs `blend_group(1.0, Screen, rects)`.
  - `instances_are_one_draw` — `prepare_draws` on a scene with a `Rect`, a 1,000-particle `Instances`, then a `Rect` yields one `GpuStep::Draw` with `instances == 0..1002`.
  - `empty_and_non_finite_instances_draw_nothing` — `count: 0` adds no step; a particle with `x = NaN` is absent from the frame while its neighbours draw.

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p celesta-gpu-renderer instances`
Expected: FAIL with `UnsupportedContent { content: "instances" }`.

- [ ] **Step 3: Implement.** `prepare_layer`: compute `state`; a non-normal blend wraps the item in `BeginGroup`/`EndGroup` exactly as the isolated `Group` branch does; skip the item when `count == 0`. `PreparedInstances::new` makes one pass for `bounds`/`shape_box`: per finite particle, the four corners of its quad under `state.transform × translate(x, y) × rotate(r)`, unioned, grown by 2 px like `PreparedLayer::bounds`. `write_instances` reserves `count × 144` bytes and writes each particle with `layer_instance`: kind 1, anchor (0.5, 0.5), `rect = [w/2, h/2, min(radius, w/2, h/2), 0]`, `fill` = straight RGBA 0–255, `stroke = [0; 4]`, the layer's opacity, clip, and blend index; a non-finite particle gets size (0, 0). The particle affine is `state.transform.multiply(Affine::from_transform(&EvaluatedTransform { position: (x, y), rotation: r, anchor: (0, 0), scale: (1, 1) }))`, so it matches `Rect` layers bit for bit. In `prepare_draws`, an `Instances` item adds `count` to `instance_count`, calls `write_instances`, and pushes or extends a `GpuDraw` of the placeholder texture with `index..index + count`. Parse the shared `color` once per layer.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p celesta-gpu-renderer`
Expected: PASS (all existing tests too — `write_instance`'s bytes are unchanged).

- [ ] **Step 5: Commit** — `feat(gpu-renderer): draw rect and circle Instances in one draw`

### Task 4: GPU renderer — image sprites

**Files:**
- Modify: `crates/gpu-renderer/src/layer.wgsl` (kind 3), `crates/gpu-renderer/src/instances.rs`, `crates/gpu-renderer/src/prepare.rs` (image texture for the shape)
- Test: `crates/gpu-renderer/src/tests.rs`

**Interfaces:**
- Consumes: Task 3's `PreparedInstanceShape::Image(LayerTexture)`, `layer_instance`; the `Image` arm's texture path in `prepare.rs` (extract it into `fn image_texture(&mut self, asset: &ResolvedAsset, width: Option<f64>, height: Option<f64>, density: f64) -> Result<(LayerTexture, f64, f64), GpuRenderError>` returning the texture and the display width/height; the `Image` arm calls it).

- [ ] **Step 1: Write the failing tests:**
  - `image_instances_multiply_their_colour` — a 4×4 opaque white seeded image (see `seeded_image`) as an `Image` shape at natural size, colours `[255, 0, 0, 255]` and `[0, 0, 255, 128]`, at whole-pixel positions: the covered pixels are red and half-blue over the background.
  - `image_instances_match_the_cpu_renderer` — an unrotated scene of 20 image particles at natural size and whole-pixel centres matches `celesta_renderer`'s frame with `max_channel_difference ≤ 1`.
  - `image_instances_scale_and_rotate` — one particle at 2× natural size rotated 90° covers the expected 8×8 box.

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p celesta-gpu-renderer image_instances`
Expected: FAIL (`Image` shape unsupported).

- [ ] **Step 3: Implement.** Shader: kind 3 takes the texture path in `vs_main`; `layer_color` reads mip levels for kinds 0 and 3; `source_color` multiplies a kind-3 colour by `fill / 255` (rgb and alpha, straight). Prepare: density = the layer's density (as the `Image` arm computes it) × the largest `max(w / natural_width, h / natural_height)` over the particles. Each particle's affine additionally scales by `w / texture_width`, `h / texture_height`; size is the texture's texels, raster scale 1, and filtering follows the same exact-copy rule as `PreparedLayer::write_instance` (pixel-aligned when the scale is uniform 1). The draw uses the sprite texture, so neighbouring draws of other textures stay separate.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p celesta-gpu-renderer`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(gpu-renderer): draw image sprite Instances with a colour multiplier`

### Task 5: `<Instances>` in `@celesta/react`

**Files:**
- Create: `packages/react/src/instances.ts`
- Modify: `packages/react/src/components.ts` (`Instances`, `InstancesProps`), `packages/react/src/index.ts` (export), `packages/react/src/render.ts` (`HOST_TYPES` gains `'instances'`; `buildLayer` branch)
- Test: `packages/react/test/instances.test.mjs`, `packages/react/test/flat-strings.test.mjs`
- Test: `crates/react-bridge/tests/node_integration.rs` with entry `packages/cli/examples/with-instances.tsx`

**Interfaces:**
- Consumes: the generated `LayerContent` / `InstanceShape` types (Task 1).
- Produces:
  - `export function Instances(props: InstancesProps)` creating host `'instances'`.
  - `InstancesProps = { count: number; x: Column; y: Column; width?: number | Column; height?: number | Column; rotation?: Column; color?: Uint8Array | ArrayLike<number>; fill?: string; shape?: 'rect' | 'circle'; cornerRadius?: number; src?: ImageProps['src']; id?: string; scale?: number; scaleX?: number; scaleY?: number; opacity?: number; blendMode?: BlendMode } & EffectProps`, with `type Column = Float32Array | ArrayLike<number>`.
  - `export function instancesContent(props: Record<string, unknown>, resolveAsset: (src: unknown) => ResolvedAsset): LayerContent` in `instances.ts`; it throws `Error`s whose messages start with `<Instances> ` and name the prop.

- [ ] **Step 1: Write the failing tests** in `instances.test.mjs` (spawning the CLI as `image.test.mjs` does):
  - the circle example (count 2, `x`/`y` `Float32Array`s, `width={4} height={4}`, `color` `Uint8Array`) emits `{type:'instances', count:2, shape:{type:'circle'}, width:4, height:4, x:<base64 of LE f32s>, y:…, colors:<base64>}` with no `color`, `widths`, `heights`, `rotation` keys, and the layer's transform has position (0, 0), rotation 0;
  - `x={new Float32Array([9, 1, 2]).subarray(1)}` with `count={2}` sends only `1, 2`;
  - `x={[1, 2]}` (a plain array) is accepted; array `width` becomes `widths`;
  - `src` emits `shape: {type:'image', asset:…}` and no size keys when sizes are absent;
  - `scale={2} opacity={0.5}` reach the layer; the walked layer has no `x`/`y` taken from the columns;
  - each of `count={-1}`, `count={1.5}`, `x` of the wrong length, `color` of length `4 * count - 1`, `shape="star"`, a rect without `width` fails the frame with an error matching `/<Instances> (count|x|color|shape|width)/`;
  - `count={0}` with empty arrays emits `x: ""`;
  - one `Float32Array` mutated between two frame requests sends different `x` values in each frame.
  In `flat-strings.test.mjs`, add an `Instances` with 10,000 particles to the walked frame.
  In `node_integration.rs`, `instances_reach_rust_as_columns_when_node_is_available`: `with-instances.tsx` (3 circles) produces `LayerContent::Instances` whose `x` equals the entry's values.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --dir packages/react run build && pnpm --dir packages/react exec vitest run test/instances.test.mjs test/flat-strings.test.mjs`
Expected: FAIL (`Instances` is not exported).

- [ ] **Step 3: Implement.** `buildLayer`'s `'instances'` branch uses `extractTransform` on props without `x`, `y`, `rotation`, `anchorX`, `anchorY`, then `instancesContent`. Encode a column with `Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64')` after converting non-`Float32Array` (`Uint8Array` for colours) input with `.from`. Throw `<Instances> requires a little-endian host` when `os.endianness() !== 'LE'`. If the flat-strings test reports the base64 strings, pass them through `flatString()` and re-measure Task 6's numbers both ways.

- [ ] **Step 4: Run the tests**

Run: `pnpm --dir packages/react exec vitest run && pnpm run build:runtime && cargo test -p celesta-react-bridge --test node_integration instances`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(react): add <Instances> for bulk particles`

### Task 6: Benchmarks against the done criteria

**Files:**
- Modify: `crates/gpu-renderer/examples/dense-geometry-bench.rs` (`Geometry::Instances`: the same ribbon segments as one `Instances` layer of rects)
- Create: `crates/react-bridge/examples/instances-100k.tsx` (100,000 circles, every column, positions animated from `useCurrentFrame()`, arrays allocated once at module scope)
- Create: `docs/performance/instances.md`

- [ ] **Step 1: Add the `instances` geometry** and run `cargo run --release -p celesta-gpu-renderer --example dense-geometry-bench -- 120 3 298 3`. Expected: the `instances` line shows ≤ 10 ms/frame (scene building excluded) beside `rects` ~30 ms.
- [ ] **Step 2: Add the entry** and run `cargo run --release -p celesta-react-bridge --example protocol-bench -- crates/react-bridge/examples/instances-100k.tsx 120`. Expected: median ≤ 20 ms.
- [ ] **Step 3: If either target is missed**, profile (`sample` on macOS for Rust, `JSON.stringify` probe from `docs/performance/react-scene-serialization.md` for Node) and record where the time goes before changing anything; report the miss to the user rather than closing the task.
- [ ] **Step 4: Write `docs/performance/instances.md`**: machine, commands, the before table from the spec, the after numbers, and the flat-string finding from Task 5.
- [ ] **Step 5: Commit** — `perf: benchmark Instances against 100k rects`

### Task 7: Documentation

**Files:**
- Create: `docs/handoff/2026-10-12-instances.md`
- Modify: `README.md` ("What you can do": particles via `<Instances>`), `skills/celesta/references/react-core.md` (the `<Instances>` API and the `<Group>` wrapping rule), `skills/celesta/references/performance.md` (when to use `<Instances>` instead of many `<Rect>`s, and that blend modes do not accumulate per particle)

- [ ] **Step 1: Write the docs** from the spec and Task 6's numbers.
- [ ] **Step 2: Check** `pnpm --dir packages/react run build` and `cargo test --workspace` still pass.
- [ ] **Step 3: Commit** — `docs: document Instances`
