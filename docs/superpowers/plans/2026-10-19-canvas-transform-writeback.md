# Canvas Transform Write-back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag or type `x`/`y`/`rotation`/`scale` of a selected layer in the standalone React preview and write the value back into the literal (or literal keyframe) in the user's JSX, with one undo history shared with props-file edits.

**Architecture:** A new GPUI-free crate `celesta-source-edit` parses TSX with oxc, resolves each prop to an `EditTarget`, and applies byte-span edits. The runtime's `layerSource` reply gains element kind, layer ids, local frame, and received props. The preview worker applies a transform override during drags and reports the selected layer's parent transform; the editor resolves, writes, and records `FileEdit`s in an `EditHistory`.

**Tech Stack:** Rust 2024 (workspace), `oxc_parser`/`oxc_ast`/`oxc_allocator`/`oxc_span` 0.154, GPUI via `gpui-kit` 0.6, TypeScript + vitest (`packages/react`, `packages/shapes`, `packages/cli`).

**Spec:** `docs/superpowers/specs/2026-10-19-canvas-transform-writeback-design.md`

## Global Constraints

- Editable props: `x`, `y`, `rotation`, and `scaleX`/`scaleY` when either is written, else `scale`. Nothing else.
- Only `kind: 'primitive'` elements written in the user's files; only `ReactPreviewMode::WholeScene`.
- Defaults for insertion: `x`, `y`, `rotation` 0; `scale`, `scaleX`, `scaleY` 1.
- Keyframe match tolerance 1e-6; editable only when the effective frame equals an `inputRange` entry.
- Number format: integer when within 0.005 of one, else up to 2 decimals, trailing zeros trimmed; `-0` is written `0`.
- Edits are span replacements on the original text; never re-print the AST.
- Writes are atomic (temp file + rename), then `watched_mtime` is resampled before `request_react_reload`.
- History: at most 100 entries, in memory, cleared when the entry changes; Cmd+Z / Cmd+Shift+Z (Ctrl elsewhere) when no text input is focused.
- UI: radius 0, no gradients, no uppercase labels, lucide icons (`diamond`, `lock`, `chevron-left`, `chevron-right`), English labels; reason texts copied verbatim from the spec's Layer section.
- Export, `inspect`, and MCP output must not change.
- Rust build needs `PKG_CONFIG_PATH` pointing at Homebrew `ffmpeg@8` (`$(brew --prefix ffmpeg@8)/lib/pkgconfig`).
- JS tests in `packages/react` run against `dist/`: `pnpm --filter @celesta/react run build` before `vitest`.

## Review Focus

1. **One JSX element rendered many times** (`items.map(i => <Rect x={10} …/>)`): editing the literal moves every copy. The spec is silent; this plan locks it with `LockReason::Repeated { count }` ("Rendered 12 times from this element") — Task 4 counts, Task 3 locks.
2. **File edited between selection and commit**: stale spans must never be applied — Task 8 re-reads and re-resolves and aborts on mismatch (test `commit_aborts_when_target_moved`).
3. **CRLF files and non-ASCII text before the element** shift line/column → byte offset conversion — Task 1 tests `element_at_crlf` and `element_at_after_non_ascii`.
4. **Parent with 3D rotation/perspective or zero scale**: no affine inverse; drags must not produce NaN writes — Task 7 returns `None`, Task 9 shows "Can't drag inside a 3D-transformed or collapsed group".
5. **Write that the reload rejects** (e.g. the bundle fails for unrelated reasons right after): the edit is still in history and undoable — Task 6 test `undo_after_failed_reload_restores_before`.

---

### Task 1: `celesta-source-edit` crate — locate and apply

**Files:**
- Create: `crates/source-edit/Cargo.toml`, `crates/source-edit/src/lib.rs`, `crates/source-edit/src/locate.rs`, `crates/source-edit/src/apply.rs`, `crates/source-edit/tests/locate_apply.rs`
- Modify: `Cargo.toml` (workspace `members` += `"crates/source-edit"`)

**Interfaces:**
- Produces:
  - `pub struct ElementRef { pub start: u32, pub end_of_attributes: u32 }` — byte offsets of `<` and of the insertion point (after the last attribute, or after the tag name).
  - `pub fn element_at(text: &str, line: u32, column: u32) -> Option<ElementRef>` — 1-based line/column as `layerSource` reports them.
  - `pub enum Edit { Replace { start: u32, end: u32, value: f64 }, Insert { at: u32, name: String, value: f64 } }`
  - `pub fn apply(text: &str, edits: &[Edit]) -> Result<String, ApplyError>` (`ApplyError::Overlap`)
  - `pub fn format_number(value: f64) -> String`
  - `pub(crate) fn parse(text: &str, alloc: &Allocator) -> Program` (TSX source type) shared with Task 2.

- [ ] **Step 1: Write failing tests** in `tests/locate_apply.rs`:
  - `element_at_finds_nested_self_closing`: in a component returning `<Group>\n  <Rect width={10} />\n</Group>`, `element_at(text, 2, 3)` returns the `<Rect` start; `end_of_attributes` is right after `width={10}`.
  - `element_at_bare_tag`: `<Group>` with no attributes → `end_of_attributes` right after `Group`.
  - `element_at_crlf`: same as the first with `\r\n` line endings.
  - `element_at_after_non_ascii`: line `const t = "日本語"; const e = <Rect x={1} />;` — the column esbuild reports for `<Rect` (record the value from a real `jsxDEV` bundle of this line once and hardcode it, noting in a comment whether esbuild counts bytes or UTF-16 units) resolves to the `<Rect` byte offset.
  - `element_at_none_off_element` → `None`.
  - `format_number`: `120.0→"120"`, `120.004→"120"`, `-12.0→"-12"`, `0.125→"0.13"`, `1.5→"1.5"`, `-0.0→"0"`, `-0.001→"0"`.
  - `apply_replace_and_insert_in_one_pass`: `<Rect x={1} y={2} />` with `Replace` on `1` → 40 and `Insert` `rotation` 15 at `end_of_attributes` → `<Rect x={40} y={2} rotation={15} />`.
  - `apply_keeps_comments_and_spacing`: a `{/* c */}` and odd indentation survive byte-for-byte outside the edited span.
  - `apply_overlap_is_error`.
- [ ] **Step 2: Run** `cargo test -p celesta-source-edit` — expect compile failure (crate empty).
- [ ] **Step 3: Implement.** `Cargo.toml` deps: `oxc_allocator`, `oxc_ast`, `oxc_parser`, `oxc_span` = `"0.154"`. Line/column → byte offset over the raw text (count `\n` only; `\r` stays part of the line). Find the `JSXOpeningElement` whose span start equals the offset with an `oxc_ast` visitor. `apply` sorts edits by offset, rejects overlaps, splices once; `Insert` writes `" {name}={value}"`.
- [ ] **Step 4: Run** `cargo test -p celesta-source-edit` — PASS.
- [ ] **Step 5: Commit** `feat(source-edit): locate JSX elements and apply span edits (#313)`.

### Task 2: Resolve literals, missing props, and identifiers

**Files:**
- Create: `crates/source-edit/src/resolve.rs`, `crates/source-edit/tests/resolve.rs`

**Interfaces:**
- Consumes: `ElementRef`, `parse` (Task 1).
- Produces:
  - `pub enum EditTarget { Literal { span: Span, value: f64 }, Keyframe { span: Span, value: f64, frame: f64 }, Missing { insert_at: u32, default: f64 }, Locked(LockReason) }` with `pub struct Span { pub start: u32, pub end: u32 }`.
  - `pub enum LockReason { NotPrimitive, Expression { source: String }, UnresolvedIdentifier { name: String }, SharedBinding { name: String, uses: usize }, BetweenKeyframes { previous: f64, next: f64 }, OutsideKeyframes, UnsupportedCall { callee: String }, OverriddenByParent, Spread, Repeated { count: u32 } }`
  - `pub struct ResolveContext { pub primitive: bool, pub local_frame: f64, pub received: Option<f64>, pub render_count: u32 }`
  - `pub fn resolve(text: &str, element: &ElementRef, prop: &str, ctx: &ResolveContext) -> EditTarget`
  - `impl EditTarget { pub fn to_edit(&self, prop: &str, value: f64) -> Option<Edit> }`
  - `pub fn default_for(prop: &str) -> f64`

- [ ] **Step 1: Write failing tests**, one per rule, in spec order (each builds a small component source and calls `resolve` with `primitive: true, render_count: 1` unless stated):
  - `not_primitive_locks` (`primitive: false`) → `NotPrimitive`.
  - `repeated_locks` (`render_count: 12`) → `Repeated { count: 12 }`.
  - `missing_inserts_default`: `<Rect width={1} />`, prop `x`, `received: None` → `Missing { insert_at: end_of_attributes, default: 0.0 }`; prop `scale` → default 1.
  - `missing_with_spread_locks`: `<Rect {...p} />`, prop `x` → `Spread`; `<Rect {...p} x={3} />` → `Literal`.
  - `literal` `x={120}` → `Literal { value: 120 }`; `x={-12}` → `Literal { value: -12 }` whose span covers `-12`.
  - `const_literal`: `const X = 40; … x={X}` → `Literal` on `40`.
  - `const_shared`: `const X = 40;` used twice → `SharedBinding { name: "X", uses: 2 }`.
  - `let_or_param_unresolved`: `let X = 4` and a function parameter → `UnresolvedIdentifier`.
  - `expression_locks`: `x={W / 2}` → `Expression { source: "W / 2" }`.
  - `overridden_by_parent`: `x={120}` with `received: Some(80.0)` → `OverriddenByParent`; `Missing` with `received: Some(5.0)` → `OverriddenByParent`.
- [ ] **Step 2: Run** `cargo test -p celesta-source-edit --test resolve` — FAIL.
- [ ] **Step 3: Implement** `resolve` with rules applied in the order the tests list (repeated before missing). Scope lookup: walk enclosing function bodies for a `const` declarator with that name; count references with a full-file identifier-reference visitor.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(source-edit): resolve literal, missing, and const props (#313)`.

### Task 3: Resolve `interpolate()` keyframes

**Files:**
- Modify: `crates/source-edit/src/resolve.rs`
- Test: `crates/source-edit/tests/resolve.rs`

**Interfaces:**
- Consumes/produces: the Task 2 types; no new public items.

- [ ] **Step 1: Write failing tests:**
  - `keyframe_hit`: `const frame = useCurrentFrame(); … x={interpolate(frame, [0, 30], [100, 400])}`, `local_frame: 30.0` → `Keyframe { value: 400, frame: 30 }` with span on `400`.
  - `keyframe_via_const`: `const x = interpolate(frame, [0, 30], [100, 400], { easing: Easings.easeOut }); … x={x}`, frame 0 → `Keyframe` on `100` (options ignored).
  - `keyframe_offset`: `interpolate(frame - 30, [0, 10], [0, 50])`, `local_frame: 40.0` → `Keyframe` on `50`.
  - `between`: frame 15 on `[0, 30]` → `BetweenKeyframes { previous: 0, next: 30 }`; with `frame - 30` and frame 35 → `{ previous: 30, next: 40 }` (reported in local frames, offset added back).
  - `outside`: frame 45 on `[0, 30]` → `OutsideKeyframes`.
  - `computed_range`: `inputRange` is an identifier → `Expression`.
  - `input_not_frame`: `interpolate(progress, …)` → `Expression`.
  - `spring_locks`: `x={spring({ frame, fps })}` → `UnsupportedCall { callee: "spring" }`.
  - `keyframe_overridden`: frame 30 hit but `received: Some(390.0)` → `OverriddenByParent`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the keyframe rule; `frame` must be a `const` bound to a `useCurrentFrame()` call in the same function; the offset form is `BinaryExpression` `-` with a numeric literal on the right.
- [ ] **Step 4: Run** `cargo test -p celesta-source-edit` — PASS.
- [ ] **Step 5: Commit** `feat(source-edit): resolve literal interpolate keyframes (#313)`.

### Task 4: Runtime — element kind, layer ids, local frame, received props, render count

**Files:**
- Modify: `packages/react/src/source-chain.ts`, `packages/react/src/render.ts:1669-1693`, `packages/react/src/components.ts` (mark primitives), `packages/react/src/internal.ts` (export `markPrimitive`), `packages/shapes/src/index.ts` (mark shapes), `packages/cli/src/cli.ts:296-302,487`
- Test: `packages/react/test/source-chain.test.mjs`, `packages/react/test/layer-source.test.mjs` (new)

**Interfaces:**
- Produces (JSON over the bridge, camelCase):
  ```ts
  interface LayerSourceEntry { name: string; file: string; line: number; column: number;
    kind: 'primitive' | 'component'; layerId?: string }
  interface LayerSourceReport { chain: LayerSourceEntry[]; localFrame: number;
    props: { x?: number; y?: number; rotation?: number; scale?: number; scaleX?: number; scaleY?: number };
    renderCount: number }
  ```
  CLI reply: `{ layerSource: { chain, localFrame, props, renderCount } }`, or `{ layerSource: { chain: null } }` when absent (unchanged shape for the missing case).
  - `markPrimitive(component: unknown): void` in `@celesta/react/internal` (a `WeakSet`; unwraps `forwardRef`/`memo` like `typeName`).

- [ ] **Step 1: Write failing tests:**
  - source-chain: an `Image` primitive element carries `kind: 'primitive'`; a user function named `Rect` carries `kind: 'component'`.
  - layer-source (mount a composition with `jsxDEV` positions through `render.ts`'s mounted API):
    - `localFrame` is 10 for a layer in `<Sequence from={20}>` at timeline frame 30.
    - `props` equals `{ x: 12, rotation: 5 }` for `<Rect x={12} rotation={5} width={1} height={1} />`.
    - `renderCount` is 3 for one `<Rect>` element inside `[0,1,2].map(...)`.
    - a chain entry for the enclosing `<Group>` element carries that group's `layerId`.
- [ ] **Step 2: Run** `pnpm --filter @celesta/react run build && pnpm --filter @celesta/react exec vitest run test/source-chain.test.mjs test/layer-source.test.mjs` — FAIL.
- [ ] **Step 3: Implement.** Mark `Group`, `Image`, `Text`, `Rect`, `Video`, `Mask` and every shape component. `localFrame`: nearest `CompositionRuntimeContext` provider on the fiber's `return` chain (`fiber.type._context === CompositionRuntimeContext`), then `runtimeFrame(value.time, value.fps, value.frameOffset)`. `layerId`: for each primitive entry, the first host descendant fiber's `stateNode` looked up in a reverse of the `layerNodes` map. `renderCount`: number of `layerNodes` whose innermost source equals this layer's. `props`: innermost primitive fiber's `memoizedProps`, finite numbers only.
- [ ] **Step 4: Run** the same command plus the full `pnpm --filter @celesta/react run test` and `pnpm --filter @celesta/cli run test` — PASS (including #306's export-equality test).
- [ ] **Step 5: Commit** `feat(react): report element kind, local frame, and received props in layerSource (#313)`.

### Task 5: Bridge — `LayerSourceReport`

**Files:**
- Modify: `crates/react-bridge/src/types.rs:30-42`, `crates/react-bridge/src/protocol.rs:133-145,204`, `crates/react-bridge/src/bridge.rs:550-561`, `crates/react-bridge/src/lib.rs:34`, `crates/editor/src/layer_select.rs:11-21` and its users (`background.rs`, `layer_panel.rs`, `preview.rs:277-320`, `tests.rs`)
- Test: `crates/react-bridge/src/tests.rs:433`

**Interfaces:**
- Produces:
  - `LayerSource` gains `pub kind: ElementKind` (`#[serde(rename_all = "lowercase")] enum ElementKind { Primitive, Component }`, default `Component` for older runtimes) and `pub layer_id: Option<String>`.
  - `pub struct LayerSourceReport { pub chain: Vec<LayerSource>, pub local_frame: f64, pub props: ReceivedProps, pub render_count: u32 }`, `pub struct ReceivedProps { pub x, y, rotation, scale, scale_x, scale_y: Option<f64> }`.
  - `ReactBridge::layer_source(time, id) -> Result<Option<LayerSourceReport>, ReactBridgeError>`.
  - `type LookupResult = Result<Option<LayerSourceReport>, String>`; `SourceLookup::Found(LayerSourceReport)`.

- [ ] **Step 1: Extend** `deserializes_layer_source_replies` with a reply carrying all new fields and one from an older runtime (no `kind`, no `localFrame`) that still parses (`local_frame` 0, `render_count` 1).
- [ ] **Step 2: Run** `cargo test -p celesta-react-bridge deserializes_layer_source` — FAIL.
- [ ] **Step 3: Implement** the types and thread them through the editor so it compiles unchanged in behavior (Layer section still reads `report.chain`).
- [ ] **Step 4: Run** `cargo test -p celesta-react-bridge -p celesta-editor` — PASS.
- [ ] **Step 5: Commit** `feat(react-bridge): carry the full layerSource report (#313)`.

### Task 6: `EditHistory` shared with props-file edits

**Files:**
- Create: `crates/editor/src/edit_history.rs`
- Modify: `crates/react-bridge/src/props_edit.rs:143` (make `replace_file` `pub` and re-export from `lib.rs`), `crates/editor/src/property_panel.rs:742-800` (record entries), `crates/editor/src/view.rs` (own `edit_history: EditHistory`, clear on entry change), key bindings where the view registers actions
- Test: `crates/editor/src/tests.rs`

**Interfaces:**
- Produces:
  - `pub(crate) struct FileEdit { pub path: PathBuf, pub before: String, pub after: String }`
  - `pub(crate) struct EditHistory` with `push(&mut self, edit: FileEdit)`, `undo(&mut self) -> Result<Option<PathBuf>, HistoryError>`, `redo(...)` same, `clear(&mut self)`; cap 100.
  - `HistoryError::ChangedOutside { path }` with display "The file changed outside Celesta".
  - `pub(crate) fn write_recorded(path: &Path, edit: impl FnOnce(&str) -> Result<String, String>) -> Result<FileEdit, String>` — reads (missing file reads as `""` only for props files, signalled by the caller), computes, writes atomically with `replace_file`.
  - Actions `Undo` / `Redo` bound to `cmd-z` / `cmd-shift-z` (`ctrl-…` off macOS) in the preview and property panel contexts.

- [ ] **Step 1: Write failing tests** (temp dir files):
  - `undo_restores_before_and_redo_reapplies`.
  - `undo_refuses_when_file_changed_outside` — returns `ChangedOutside`, drops that entry and older entries for the same path, keeps other paths' entries.
  - `push_clears_redo`, `cap_keeps_latest_100`.
  - `undo_after_failed_reload_restores_before` — push, leave the file as `after`, undo works regardless of reload state (history does not depend on reload results).
  - `property_commit_is_recorded` — `set_property` through `write_recorded` yields a `FileEdit` whose `after` parses to the new JSON.
- [ ] **Step 2: Run** `cargo test -p celesta-editor edit_history` — FAIL.
- [ ] **Step 3: Implement**; change `drain_property_commits` to call `write_recorded(&target, |text| …set the key…)` (factor `set_property`'s object edit into `pub fn set_property_text(text: &str, key, value) -> Result<String, PropsEditError>` in `props_edit.rs`; `set_property` keeps its signature by calling it). Undo/redo writes go through the same resample-`watched_mtime`-then-reload sequence as `finish_property_commit`.
- [ ] **Step 4: Run** `cargo test -p celesta-react-bridge -p celesta-editor` — PASS.
- [ ] **Step 5: Commit** `feat(editor): add an undo history shared by file edits (#313)`.

### Task 7: Worker — transform override and selected layer frame

**Files:**
- Create: `crates/gpu-renderer/src/layer_frame.rs` (export from `lib.rs`)
- Modify: `crates/editor/src/preview.rs:30-70,195-260`
- Test: `crates/gpu-renderer/src/layer_frame.rs` (unit tests), `crates/editor/src/tests.rs`

**Interfaces:**
- Produces:
  - `pub struct LayerFrame { pub transform: EvaluatedTransform, pub parent: [f64; 6], pub outline: [Point; 4] }` — `parent` maps the layer's parent space to scene pixels with the same `Affine` the renderer uses; `outline` is the leaf's quad, or for a `Group` the axis-aligned box of its descendants' hit regions.
  - `pub fn layer_frame(scene: &Scene, regions: &[HitRegion], id: &str) -> Option<LayerFrame>` — `None` when the id is absent, a parent has `rotation_x`/`rotation_y`/`perspective`, or the parent affine is degenerate.
  - `pub fn invert_affine(m: [f64; 6]) -> Option<[f64; 6]>`.
  - `PreviewRequest` gains `transform_override: Option<(String, EvaluatedTransform)>` and `frame_of: Option<String>`; `PreviewResult` gains `layer_frame: Option<(String, Option<LayerFrame>)>`.

- [ ] **Step 1: Write failing tests:** `layer_frame` for a rect inside a translated, a rotated, and a scaled group (parent matches expected entries within 1e-9); a parent with `rotation_x: 10` → `None`; zero-scale parent → `None`; group outline is the bounding box of two child regions. Editor test: a request with `transform_override` renders the overridden transform (assert the override is applied to the scene before `render_preview` via a pure helper `apply_override(scene: &mut Scene, id, transform) -> bool`).
- [ ] **Step 2: Run** `cargo test -p celesta-gpu-renderer layer_frame && cargo test -p celesta-editor override` — FAIL.
- [ ] **Step 3: Implement**; in the worker apply the override after `render_whole_react_scene` and before rendering, and compute `layer_frame` after rendering from `renderer.hit_regions()`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(preview): report the selected layer's frame and apply drag overrides (#313)`.

### Task 8: Transform state, Layer section rows, and the commit path

**Files:**
- Create: `crates/editor/src/transform_edit.rs` (state + commit), `crates/editor/src/transform_rows.rs` (Layer section UI)
- Modify: `crates/editor/src/layer_panel.rs` (render the Transform group under the source rows), `crates/editor/src/background.rs:38-45` (resolve on lookup result), `crates/editor/src/refresh.rs` (keep selection after own write), `crates/editor/Cargo.toml` (+ `celesta-source-edit`)
- Test: `crates/editor/src/tests.rs`

**Interfaces:**
- Consumes: `resolve`, `apply`, `EditTarget`, `LockReason` (Tasks 1–3); `LayerSourceReport` (Task 5); `write_recorded`, `EditHistory` (Task 6).
- Produces:
  - `pub(crate) enum TransformProp { X, Y, Rotation, Scale, ScaleX, ScaleY }` with `name() -> &'static str` (`"x"`, …, `"scaleX"`).
  - `pub(crate) struct TransformTargets { pub file: PathBuf, pub element: ElementRef, pub targets: Vec<(TransformProp, EditTarget)> }`
  - `pub(crate) fn resolve_targets(text: &str, report: &LayerSourceReport) -> Result<TransformTargets, String>` — picks the innermost chain entry, chooses `ScaleX/ScaleY` when either attribute exists else `Scale`.
  - `pub(crate) fn commit(path: &Path, expected: &TransformTargets, report: &LayerSourceReport, values: &[(TransformProp, f64)]) -> Result<FileEdit, CommitError>` — re-reads, re-resolves, compares kinds and spans with `expected`, then applies via `write_recorded`.
  - `CommitError::SourceChanged` → "The source changed while dragging"; `CommitError::Write(String)`.
  - `pub(crate) fn reason_text(reason: &LockReason) -> String` — the spec's texts verbatim, plus `Repeated` → "Rendered {count} times from this element".

- [ ] **Step 1: Write failing tests:**
  - `resolve_targets_prefers_scale_xy` and `resolve_targets_uniform_scale`.
  - `commit_writes_literal_and_inserts` (x literal + missing rotation in one commit, file content checked).
  - `commit_aborts_when_target_moved` — after resolving, prepend a line to the file; `commit` returns `SourceChanged` and the file is untouched.
  - `reason_texts_match_spec` for every `LockReason` variant.
  - `own_write_reload_keeps_selection` — a reload flagged as caused by an editor write keeps `selected_layer`; an external reload clears it.
- [ ] **Step 2: Run** `cargo test -p celesta-editor transform` — FAIL.
- [ ] **Step 3: Implement** state, resolution on lookup results (background executor), and the Transform rows per the spec's state table: numeric field committing on Enter/blur through `commit`, `diamond` filled/outline, `lock` + reason line, dimmed default for `Missing`, "Between keyframes at {previous} and {next}" with `chevron-left`/`chevron-right` buttons seeking the playhead to `timeline frame = previous|next + (timeline frame − local_frame)`. Errors render where lookup errors render.
- [ ] **Step 4: Run** `cargo test -p celesta-editor` — PASS.
- [ ] **Step 5: Commit** `feat(editor): edit layer transforms from the Layer section (#313)`.

### Task 9: Canvas handles and dragging

**Files:**
- Create: `crates/editor/src/transform_handles.rs` (pure geometry: handle positions, hit-testing handles, drag → values)
- Modify: `crates/editor/src/viewer.rs:97-110,663-760` (paint handles, route mouse down/move/up)
- Test: `crates/editor/src/tests.rs`

**Interfaces:**
- Consumes: `LayerFrame`, `invert_affine` (Task 7); `TransformTargets`, `commit` (Task 8).
- Produces:
  - `pub(crate) enum Handle { Move, Corner(u8), Edge(u8), Rotate }`
  - `pub(crate) fn handles(frame: &LayerFrame, uniform: bool) -> Vec<(Handle, Point)>` — no `Edge` when `uniform`.
  - `pub(crate) fn drag_values(frame: &LayerFrame, handle: Handle, start: Point, now: Point, shift: bool, editable: &[TransformProp]) -> Vec<(TransformProp, f64)>` — local delta through `invert_affine(frame.parent)`; locked axes unchanged; rotation snaps to 15° with `shift`; scaling about the anchor, uniform keeps aspect.

- [ ] **Step 1: Write failing tests** for `drag_values`: move inside a parent scaled by 2 halves the delta; move with `y` locked changes only `x`; rotate with shift snaps 37° → 30°; corner drag with uniform scale yields equal ratio; edge drag changes only `scaleX`.
- [ ] **Step 2: Run** `cargo test -p celesta-editor drag_values` — FAIL.
- [ ] **Step 3: Implement** geometry, then wire the viewer: mouse-down on a handle starts a drag (sets `transform_override` per mouse-move, shows the `x 120 → 184` label beside the outline), mouse-up calls `commit`, pushes the `FileEdit`, resamples `watched_mtime`, and requests a reload flagged as an own write; on `SourceChanged` clear the override and show the message. No editable target → dashed outline, not-allowed cursor, tooltip with the first reason. `layer_frame` `None` → "Can't drag inside a 3D-transformed or collapsed group".
- [ ] **Step 4: Run** `cargo test -p celesta-editor` — PASS.
- [ ] **Step 5: Commit** `feat(editor): drag layer transforms on the canvas (#313)`.

### Task 10: Parent selection, docs, and manual verification

**Files:**
- Modify: `crates/editor/src/layer_panel.rs` ("Select" button on chain rows whose entry is a primitive `Group` with `layer_id`), `crates/editor/src/viewer.rs` (group outline from `LayerFrame.outline`)
- Create: `docs/handoff/2026-10-19-canvas-transform-writeback.md`
- Modify: the React preview user docs page that #306 updated (find with `grep -rl "VISUAL" packages/website`)

- [ ] **Step 1: Write a failing test** `select_parent_group_sets_selection` (pressing Select on a chain row with `layer_id: Some("g")` sets `selected_layer` to `"g"` and sends `frame_of`).
- [ ] **Step 2: Implement** and run `cargo test -p celesta-editor` — PASS.
- [ ] **Step 3: Write docs**: handoff note (what changed, the `layerSource` additions, lock rules, known limits from the spec's non-goals); user docs on what can be dragged, the lock reasons, and undo.
- [ ] **Step 4: Manual check** with a fixture under `packages/cli/examples/` holding a literal, a missing prop, a keyframed `x`, a `<Stack>` child, a `.map` element, and an expression: drag, type, undo, redo, reload; confirm `git diff` touches only expected spans; take before/after screenshots of the same scene for the PR.
- [ ] **Step 5: Commit** `docs: canvas transform write-back handoff and user docs (#313)`.
