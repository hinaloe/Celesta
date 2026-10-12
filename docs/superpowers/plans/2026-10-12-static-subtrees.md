# Static Subtrees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `<Static deps>` subtrees be walked, serialized, and parsed once and reused across frames, so 100,000 still rects plus 100 moving ones round-trip React → Rust in ≤ 30 ms per frame after the first.

**Architecture:** The reconciler stamps every mutation on the mutated node and its ancestors. The walk caches a `static` host node's layers and reuses them while nothing inside changed; for frame requests that ask for it, it emits a `staticRef` layer and sends each definition until Rust acknowledges having decoded it. `ReactBridge` keeps the definitions and expands every `staticRef` into a `Group` before returning the scene, so renderers never see a reference.

**Tech Stack:** TypeScript (React 18 reconciler), Rust 2024 (serde, ts-rs), vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-static-subtrees-design.md`

## Global Constraints

- JSON: a reference is `{"type":"staticRef","key":7}`; a frame message adds `"seq": n`, `"statics": {"<key>": [layers]}` (omitted when empty) and `"droppedStatics": [keys]` (omitted when empty); a frame request adds `"statics": {"decoded": n}`.
- `deps` compare element by element with `Object.is`; a different length counts as changed; no `deps` means never changed while mounted.
- `<Static>` is a `group` layer: identity transform, opacity 1, normal blending, no effects, id = its tree path.
- Forbidden inside `<Static>`: host types `video`, `audio`, `sequence`, `freeze-frame`, `rawLayers`, and any type registered with `registerHostElement`; the error is `<Static> cannot contain <TYPE>`.
- Cache reuse requires `changedAt <= walkedAt` and equal `lang`, `idPrefix`, `compact`.
- Only frames requested with `statics` carry references; every other caller gets the children inline in the `group`.
- A frame carries a key's definition when it references the key and the definition was never sent or was first sent in a frame after `decoded`.
- A missing key fails with `ReactBridgeError::MissingStatic(key)` and resets the bridge's cache and `decoded` to 0.
- Renderers refuse `StaticRef`: GPU `UnsupportedContent { content: "static reference" }`, CPU `RenderError::UnresolvedStatic { layer }`.
- macOS builds need `PKG_CONFIG_PATH="$(brew --prefix ffmpeg@8)/lib/pkgconfig"`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A `<Static>` that unmounts and mounts again** (`{show && <Static>…}`): its key is dropped on unmount and a new key is defined on remount; no reference outlives its definition. Pinned in Task 3.
2. **A `<Static>` inside a `<Sequence>` that leaves and re-enters its window**: frames outside do not walk it, frames back inside still resolve its reference without resending. Pinned in Task 4.
3. **Seeking backwards with `deps` that follow the frame** (`deps={[Math.floor(frame / 30)]}`, frames 0, 40, 10, 40): every expanded scene equals the inline one. Pinned in Task 4.
4. **A frame that fails in Node after some `<Static>`s were re-walked**: the next successful frame still defines the new keys and drops the old ones. Pinned in Task 3.
5. **Component resolution and `--inspect` with a `<Static>`**: they get the children inline, never a reference. Pinned in Task 3.

---

### Task 1: `StaticRef` in the scene model and renderers

**Files:**
- Modify: `crates/composition/src/model.rs` (`LayerContent::StaticRef { key: u32 }` and its `LayerContentDef` mirror)
- Modify: `crates/renderer/src/layer.rs`, `crates/renderer/src/error.rs` (`RenderError::UnresolvedStatic { layer: String }`, Display `layer {layer} refers to a static subtree that was never expanded`)
- Modify: `crates/gpu-renderer/src/prepare.rs` (arm returning `UnsupportedContent { layer, content: "static reference" }`)
- Modify: every other exhaustive `LayerContent` match `cargo check --workspace --all-targets` reports (exporter `absolutize_layer_content`: no assets)
- Test: `crates/composition/src/tests.rs`, `crates/renderer/src/tests.rs`, `crates/gpu-renderer/src/tests.rs`

**Interfaces:**
- Produces: `celesta_composition::LayerContent::StaticRef { key: u32 }`; `celesta_renderer::RenderError::UnresolvedStatic { layer: String }`.

- [ ] **Step 1: Write the failing tests:** `static_ref_round_trips` (`{"type":"staticRef","key":7}` parses to `StaticRef { key: 7 }` and serializes back to the same JSON; add the variant to `every_tagged_variant_round_trips`); `cpu_refuses_a_static_ref` (error is `UnresolvedStatic { layer: "s" }`); `gpu_refuses_a_static_ref` (`UnsupportedContent { content: "static reference", .. }`).
- [ ] **Step 2: Run** `cargo test -p celesta-composition static_ref` — Expected: compile error, no variant `StaticRef`.
- [ ] **Step 3: Implement** the variant, mirror, error, and arms; regenerate bindings with `pnpm --dir packages/react run codegen`.
- [ ] **Step 4: Run** `cargo test -p celesta-composition -p celesta-renderer -p celesta-gpu-renderer --lib && cargo check --workspace --all-targets` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(composition): add a StaticRef layer for the React bridge`

### Task 2: Static cache in `ReactBridge`

**Files:**
- Create: `crates/react-bridge/src/statics.rs`
- Modify: `crates/react-bridge/src/protocol.rs` (`Request.statics`, `RawResponse`/`Response::Ok` fields), `crates/react-bridge/src/bridge.rs` (`ReactBridge.statics`, frame requests, `decode_response`), `crates/react-bridge/src/error.rs`, `crates/react-bridge/src/lib.rs`
- Test: `crates/react-bridge/src/tests.rs`

**Interfaces:**
- Consumes: Task 1's `LayerContent::StaticRef`.
- Produces:
  - `pub(crate) struct StaticCache` with `fn decoded(&self) -> u64` and `fn apply(&mut self, seq: Option<u64>, defined: HashMap<u32, Vec<Layer>>, dropped: Vec<u32>, scene: &mut Scene) -> Result<(), ReactBridgeError>`.
  - `#[derive(Serialize)] pub(crate) struct StaticsRequest { pub(crate) decoded: u64 }`; `Request.statics: Option<StaticsRequest>` (skipped when `None`), set by `submit_frame` and `evaluate_past_end` from `self.statics.decoded()`, `None` for component resolution.
  - `Response::Ok` gains `seq: Option<u64>`, `statics: HashMap<u32, Vec<Layer>>` (default empty), `dropped_statics: Vec<u32>` (default empty; JSON `droppedStatics`).
  - `ReactBridgeError::MissingStatic(u32)`, Display `the React runtime referred to static subtree {key}, which this bridge does not have`.

- [ ] **Step 1: Write the failing tests** on `StaticCache` alone (no Node):
  - `expands_static_refs_at_every_depth`: a scene with a `StaticRef { key: 1 }` at the top, one inside a `Group`, and one inside a `GroupMask`'s layers, applied with `defined = {1: [rect]}`, has each replaced by a layer with the same id and transform whose content is `Group { layers: [rect], clip: None, mask: None }`, and `decoded() == seq`.
  - `keeps_definitions_between_frames`: a second `apply` with no definitions resolves key 1 again.
  - `drops_keys_after_expanding`: `dropped = [1]` in the frame that also references 1 still expands it; a later reference fails with `MissingStatic(1)`.
  - `a_missing_key_resets_the_cache`: after `MissingStatic`, `decoded() == 0` and an earlier key is gone.
  - `frame_requests_report_what_was_decoded`: `serde_json::to_string(&Request { statics: Some(StaticsRequest { decoded: 3 }), .. })` contains `"statics":{"decoded":3}`, and a request with `None` has no `statics` key.
- [ ] **Step 2: Run** `cargo test -p celesta-react-bridge --lib statics` — Expected: compile error, no `StaticCache`.
- [ ] **Step 3: Implement** `statics.rs`; call `apply` in `decode_response` for `Response::Ok`, before returning it. Apply definitions, then expand, then drop, then set `decoded` to `seq` when present.
- [ ] **Step 4: Run** `cargo test -p celesta-react-bridge --lib` — Expected: PASS (existing tests too).
- [ ] **Step 5: Commit** — `feat(react-bridge): expand static subtree references`

### Task 3: `<Static>` in `@celesta/react` and the CLI

**Files:**
- Modify: `packages/react/src/reconciler.ts` (`HostNode.parent`, `HostNode.changedAt`, a module counter stamped by every mutation)
- Create: `packages/react/src/static.ts` (the walk cache: entries, keys, sent seqs, dropped keys)
- Modify: `packages/react/src/render.ts` (`'static'` host type, walk, `renderAt` option and result), `packages/react/src/components.ts` (`Static`, `StaticProps`), `packages/react/src/index.ts`, `packages/react/src/browser.ts`
- Modify: `packages/cli/src/cli.ts` (send `statics` to `renderAt` when the request has it; write `seq`, `statics`, `droppedStatics`)
- Test: `packages/react/test/static.test.mjs`, `packages/cli/test/static.test.mjs`

**Interfaces:**
- Consumes: the JSON contract in Global Constraints.
- Produces:
  - `export function Static(props: StaticProps): ReturnType<typeof React.createElement>`, `StaticProps = { deps?: readonly unknown[]; children?: ReactNode }`, a `React.memo` of a component creating host `'static'`, compared by `deps` only.
  - `HostNode.parent: HostNode | null`, `HostNode.changedAt: number`; `export function hostRevision(): number` (the counter's current value).
  - `renderAt(time, project, options?: { openEnd?; compact?; statics?: { decoded: number } }): { scene; audio; statics?: { seq: number; defined: Record<number, Layer[]>; dropped: number[] } }` — `statics` present exactly when requested.

- [ ] **Step 1: Write the failing tests** in `packages/react/test/static.test.mjs`, rendering with `mount(...).renderAt` from `dist` (as `flat-strings.test.mjs` does):
  - `references a still subtree once its definition is decoded`: frame 1 with `{ statics: { decoded: 0 } }` → layer content `{type:'staticRef', key: k}`, `statics.defined[k]` deep-equals the inline layers, `seq === 1`; frame 2 with `decoded: 0` → defines `k` again; frame 3 with `decoded: 2` → `defined` is `{}` and the reference is still `k`.
  - `changing deps gives a new key and drops the old one`.
  - `a component reading the frame inside is walked again each frame`: layers in `defined` match the frame, keys differ per frame, previous keys dropped.
  - `a different lang above gives a new key`.
  - `without statics the children are inline`: content `{type:'group', layers:[…]}`.
  - `forbidden elements fail the frame`: for each of `Video`, `Audio`, `Sequence`, `FreezeFrame`, a registered host element, the error matches `/<Static> cannot contain <(video|audio|sequence|freeze-frame|…)>/`.
  - `nested statics`.
  - Review Focus 1: `an unmounted static drops its key; remounting defines a new one`.
  - Review Focus 4: a frame that throws after a `deps` change, then a good frame: the good frame defines the new key and drops the old one.
  - Review Focus 5: `createResolver().resolve` of a registered component containing `<Static>` returns inline layers.
  In `packages/cli/test/static.test.mjs`, spawn the CLI as `compact-transforms.test.mjs` does with two requests `{"time":…,"compactTransforms":true,"statics":{"decoded":0}}` and `{… "decoded":1}`: line 1 has `seq: 1` and `statics`, line 2 has `seq: 2`, no `statics` key, and the same reference; a request without `statics` has no `seq`.
- [ ] **Step 2: Run** `pnpm --dir packages/react run build && pnpm --dir packages/react exec vitest run test/static.test.mjs` — Expected: FAIL (`Static` is not exported).
- [ ] **Step 3: Implement.** Reconciler: stamp `changedAt = ++counter` on the node and walk `parent` upward until an ancestor already has that value; set/clear `parent` in the append/insert/remove hooks (container children have `parent = null`). Walk: on `'static'`, reuse when `node.changedAt <= entry.walkedAt` and the context keys match; otherwise walk the children through a context flag that makes `walkNode` throw `<Static> cannot contain <TYPE>` for a forbidden type, give the entry a new key from the mounted composition's counter, and queue the old key as dropped. Keys of entries whose host node is no longer reachable after a walk are dropped too. Queued drops and the per-key first-sent seq live in `static.ts` and survive a frame that throws.
- [ ] **Step 4: Run** `pnpm run build:runtime && pnpm --dir packages/react exec vitest run && pnpm --dir packages/cli exec vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(react): reuse <Static> subtrees across frames`

### Task 4: End-to-end equivalence through the bridge

**Files:**
- Create: `packages/cli/examples/with-static.tsx` (a still `<Static>`, one with `deps={[Math.floor(frame / 30)]}`, one inside a `<Sequence from={20} durationInFrames={20}>`, and moving rects outside) and `packages/cli/examples/with-static-inline.tsx` (the same with every `<Static>` replaced by a fragment)
- Test: `crates/react-bridge/tests/node_integration.rs`

**Interfaces:**
- Consumes: Tasks 2 and 3.

- [ ] **Step 1: Write the tests:**
  - `static_subtrees_expand_to_the_inline_scene_when_node_is_available`: for frames 0, 10, 25, 45, 25, 40, 10, 40 (Review Focus 2 and 3), `scene_at` on `with-static.tsx` equals `scene_at` on `with-static-inline.tsx` once each scene is reduced to its list of non-group layers in painter's order with ids cleared (a `<Static>` adds a group level and a path segment to its children's ids; nothing else may differ).
  - `pipelined_static_frames_match_serial_ones_when_node_is_available`: frames 0..60 through `submit_frame`/`receive_frame`/`decode_frame` with frame N + 1 submitted before N is decoded equal `scene_at` of the same frames.
- [ ] **Step 2: Run** `cargo test -p celesta-react-bridge --test node_integration static` — Expected: PASS (Tasks 2–3 already implement it; a failure is a bug in them, debugged there).
- [ ] **Step 3: Commit** — `test(react-bridge): check static subtrees against inline scenes`

### Task 5: Benchmark, done criteria, and documentation

**Files:**
- Create: `crates/react-bridge/examples/static-100k.tsx` (100,000 still rects in one `<Static>`, 100 moving rects outside) and `static-100k-memo.tsx` (the same still rects in a `React.memo` component instead)
- Create: `docs/performance/static-subtrees.md`, `docs/handoff/2026-10-12-static-subtrees.md`
- Modify: `skills/celesta/references/performance.md`, `skills/celesta/references/react-core.md`

- [ ] **Step 1: Measure** `protocol-bench` on both entries (120 frames from frame 1, so the first frame is excluded) and the first frame alone; alternate the two entries. Expected: `static-100k` median ≤ 30 ms; first frame ≤ 1.1 × the memo entry's.
- [ ] **Step 2: Check regressions** with `celesta-bench run --frames 30 --dump` (all nine workloads) and `protocol-bench` on NEBULA, SPECTRA, reel against the base branch built in a separate worktree, alternating. Expected: within noise; PNGs byte-identical.
- [ ] **Step 3: If a target is missed,** profile and report the miss before changing anything.
- [ ] **Step 4: Write the docs**: measurements before/after; when to use `<Static>`, `deps`, what it cannot contain, and that components reading the frame inside defeat it.
- [ ] **Step 5: Run** `cargo test --workspace && pnpm run test:runtime` — Expected: PASS. **Commit** — `docs: document <Static>`
