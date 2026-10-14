# Open Layer Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the standalone React preview, click a layer on the canvas to select it, see the JSX position that produced it and the elements around it, and open any of them in `VISUAL`/`EDITOR`.

**Architecture:** With `--source-locations` (editor preview only) the CLI bundles with `jsxDev`, routing `jsxDEV` to `@celesta/react/jsx-dev-runtime`, which records each element's source in a `WeakMap` keyed by its props. Host nodes keep their fiber, so a `layerSource` request walks `fiber.return` to build the chain. The GPU renderer optionally records each leaf layer's quad and clips; the editor hit-tests clicks against them, asks the bridge for the selected layer's chain, and launches the editor.

**Tech Stack:** TypeScript (React 18.3, react-reconciler 0.29, esbuild 0.28, vitest), Rust 2024 (wgpu, gpui-kit 0.6, serde, `shlex`).

**Spec:** `docs/superpowers/specs/2026-10-14-open-layer-source-design.md`

## Global Constraints

- Export, `inspect`, MCP, component schema loading and audio collection never pass `--source-locations` and never turn on hit-region recording; their bundles and scenes stay exactly as before.
- Without `--source-locations`, `loadEntry`'s esbuild options are unchanged (no `jsxDev`, `react/jsx-dev-runtime` still resolves to React's).
- Source positions are 1-based `line` and `column`; `file` is absolute (esbuild's `fileName` resolved against the entry's directory).
- `layerSource` response: `{ "layerSource": { "chain": LayerSourceEntry[] | null } }`, innermost first; `null` = no layer with that id in the frame; `[]` = layer exists, no positions.
- Editor lookup order: `VISUAL`, then `EDITOR`, empty counts as unset; then (macOS/Linux only) the login shell, once per session, 3 second timeout; then the OS default opener (`open` / `cmd /C start "" <file>` / `xdg-open`).
- UI: no gradients, no uppercase labels, radius 0, lucide icons (not glyph arrows).
- Build with FFmpeg 8: `PKG_CONFIG_PATH="$(brew --prefix ffmpeg@8)/lib/pkgconfig"` on macOS.
- After TS changes: `pnpm --dir packages/react run build` then `pnpm run build:runtime` before CLI or bridge tests.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Signing goes through 1Password; on "failed to fill whole buffer", ask the user to unlock it, never bypass signing.

## Review Focus

- A layer inside `<Static>` that the frame sends as a `staticRef` is still found by `layerSource`, and the next ordinary frame's statics (`seq`, references) are unaffected — pinned in Task 3.
- A component written in another file and imported by the entry yields that file's path, not the entry's — pinned in Task 3.
- A click on a layer inside a rotated, clipped group hits only inside the clip, and the topmost of overlapping layers wins — pinned in Task 5.
- `EDITOR="code -w"` or a quoted path with spaces (`"/Applications/Sublime Text.app/.../subl"`) is split into program and arguments correctly — pinned in Task 6.
- A login shell that prints banner text around the output, or hangs, still yields the editor or times out after 3 s without freezing the UI — pinned in Task 6.

---

### Task 1: JSX dev runtime that records positions

**Files:**
- Create: `packages/react/src/jsx-dev-runtime.ts`
- Modify: `packages/react/package.json` (`exports["./jsx-dev-runtime"]`), `packages/react/src/internal.ts`
- Test: `packages/react/test/jsx-dev-runtime.test.mjs`

**Interfaces:**
- Produces: `jsxDEV(type, props, key, isStaticChildren: boolean, source?: { fileName: string; lineNumber: number; columnNumber: number }, self?: unknown): ReactElement` and `Fragment`, exported from `@celesta/react/jsx-dev-runtime`.
- Produces: `interface SourcePosition { fileName: string; lineNumber: number; columnNumber: number }`; `sourceOfProps(props: unknown): SourcePosition | undefined` from `@celesta/react/internal`.

- [ ] **Step 1: Write the failing tests** (import from `../dist/jsx-dev-runtime.js` and `../dist/internal.js`, as the other tests import `dist`)

`records the source for the element's props`: `const el = jsxDEV('rect', { width: 1 }, undefined, false, { fileName: 'a.tsx', lineNumber: 3, columnNumber: 7 })`; `assert.deepEqual(sourceOfProps(el.props), { fileName: 'a.tsx', lineNumber: 3, columnNumber: 7 })`.
`creates the same element as jsx`: compare `el.type`, `el.key`, `el.props` with `jsx('rect', { width: 1 })`; `isStaticChildren: true` with an array of children matches `jsxs`.
`adds no keys to props`: `assert.deepEqual(Object.keys(el.props), ['width'])` and `Object.getOwnPropertySymbols(el.props).length === 0`.
`records nothing without a source`: `sourceOfProps(jsxDEV('rect', {}, undefined, false).props) === undefined`; `sourceOfProps(null)` and `sourceOfProps(1)` are `undefined`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --dir packages/react run build && pnpm --dir packages/react exec vitest run test/jsx-dev-runtime.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `jsxDEV` with `react/jsx-runtime`'s `jsx`/`jsxs` chosen by `isStaticChildren`, recording into a module-level `WeakMap<object, SourcePosition>` keyed by `element.props`; `sourceOfProps` reads it (non-objects → `undefined`). Add the `./jsx-dev-runtime` subpath export (`types` + `default`, like `./internal`).

- [ ] **Step 4: Run to verify they pass** — same command, PASS.

- [ ] **Step 5: Commit** — `feat: record JSX positions in a dev runtime`

### Task 2: Source chains from host nodes

**Files:**
- Modify: `packages/react/src/reconciler.ts` (`HostNode`, `createInstance`, `commitUpdate`)
- Create: `packages/react/src/source-chain.ts`
- Modify: `packages/react/src/internal.ts`
- Test: `packages/react/test/source-chain.test.mjs`

**Interfaces:**
- Consumes: `sourceOfProps` (Task 1).
- Produces: `HostNode.fiber?: unknown` (set by `createInstance(type, props, root, hostContext, internalInstanceHandle)` and refreshed in `commitUpdate(..., internalInstanceHandle)`).
- Produces: `interface LayerSourceEntry { name: string; file: string; line: number; column: number }`; `sourceChain(node: HostNode, resolveFile: (fileName: string) => string): LayerSourceEntry[]`, exported from `@celesta/react/internal`.

- [ ] **Step 1: Write the failing tests** — mount trees with `createRoot`/`HostReconciler` (as `reconciler.test.mjs` does), building elements with `jsxDEV` and explicit sources.

`lists the nearest element first, then its ancestors`: `Title` (source `title.tsx:4:10`) renders `jsxDEV('rect', …, {title.tsx, 5, 3})`; root renders `jsxDEV(Title, {}, …, {entry.tsx, 9, 5})`. The rect host node's chain with `resolveFile = (f) => '/abs/' + f` is
```js
[{ name: 'rect', file: '/abs/title.tsx', line: 5, column: 3 },
 { name: 'Title', file: '/abs/entry.tsx', line: 9, column: 5 }]
```
`skips elements without a source`: an intermediate component created with plain `jsx` adds no entry.
`merges adjacent duplicates`: two consecutive fibers carrying the same file/line/column produce one entry.
`is empty without positions`: a tree built only with `jsx` → `[]`.
`survives updates that skip commitUpdate`: re-render with identical props; the chain is unchanged.
`names memo and forwardRef components`: `React.memo(Title)` and a `forwardRef` with `displayName` give `'Title'` and that `displayName`.

- [ ] **Step 2: Run to verify they fail** — `pnpm --dir packages/react run build && pnpm --dir packages/react exec vitest run test/source-chain.test.mjs`; FAIL.

- [ ] **Step 3: Implement.** Store the fiber on the node. `sourceChain` walks `fiber.return` from the node's fiber, reading `memoizedProps ?? pendingProps` through `sourceOfProps`. Name: string type as is; function → `displayName ?? name`; object (memo/forwardRef) → its `displayName`, else its inner `type`/`render` name; fallback `'Anonymous'`.

- [ ] **Step 4: Run to verify they pass**, then the whole package: `pnpm --dir packages/react test` PASS.

- [ ] **Step 5: Commit** — `feat: build layer source chains from host fibers`

### Task 3: CLI `--source-locations` and the `layerSource` request

**Files:**
- Modify: `packages/react/src/render.ts` (`WalkContext`, `rootWalkContext`, `buildLayer`, `staticLayer`, `childSequenceContext`, `childFreezeContext`, `mount`), `packages/react/src/internal.ts` (`MountedComposition` type)
- Modify: `packages/cli/src/cli.ts` (`main` option parsing and request loop, `loadEntry`, `writeLine`)
- Test: `packages/cli/test/layer-source.test.mjs`

**Interfaces:**
- Consumes: `sourceChain`, `LayerSourceEntry` (Task 2).
- Produces: `WalkContext.layerNodes: Map<string, HostNode> | null` (copied by every context constructor); `MountedComposition.layerSource(time: Time, id: string, resolveFile: (fileName: string) => string, options?: { preview?: boolean }): LayerSourceEntry[] | null`.
- Produces: CLI option `--source-locations`; request `{ layerSource: string, time: Time, preview?: boolean }`; response `{ layerSource: { chain: LayerSourceEntry[] | null } }`.

- [ ] **Step 1: Write the failing tests** — spawn `bin/celesta-react-render.js` like `preview.test.mjs`, with a temp dir holding `entry.tsx` and `title.tsx` (`export function Title() { return <Rect …/> }` on a known line), the entry rendering `<Title />`, a `<Static><Rect/></Static>`, and a `<Text>`.

`finds the JSX of a layer in another file`: with `--source-locations`, `{ layerSource: <the Title rect's id>, time, preview: true }` → `chain[0]` is `{ name: 'Rect', file: <abs title.tsx>, line, column }` and a later entry is `{ name: 'Title', file: <abs entry.tsx>, … }`.
`finds layers inside <Static>`: first send a frame request with `statics: { decoded: 0 }` (so the static is cached and later referenced), then `layerSource` for the static rect's id → non-empty chain; a following frame with `statics: { decoded: <seq> }` answers with `seq` = previous + 1 and a `staticRef` for the same key.
`answers null for unknown ids`: `chain === null`.
`answers [] without --source-locations`: same entry, no flag → `chain` is `[]`.
`does not change scenes`: frames 0..2 requested with and without the flag (and `preview: true` both times) give deep-equal `scene` objects.
`rejects unknown options`: `--source-location` (typo) exits 1 with the usage line, which now lists `[--source-locations]`.

- [ ] **Step 2: Run to verify they fail** — `pnpm run build:runtime && pnpm --dir packages/cli exec vitest run test/layer-source.test.mjs`; FAIL.

- [ ] **Step 3: Implement.**
  - `render.ts`: `buildLayer` and `staticLayer` do `context.layerNodes?.set(id, node)`; `layerSource` renders the tree for `time` (as `renderFrame` does, including the font re-render), walks with `rootWalkContext(..., statics = null)` and a fresh `layerNodes` map, skips `staticSubtrees.sweep`, and returns `sourceChain(node, resolveFile)` or `null`.
  - `cli.ts`: accept `--source-locations`; when set, `loadEntry` passes `jsxDev: true` and the `shared-runtime` plugin resolves `react/jsx-dev-runtime` to `require.resolve('@celesta/react/jsx-dev-runtime')`. `resolveFile = (f) => path.resolve(path.dirname(entryPath), f)`. In the loop, a request with a string `layerSource` is answered with `{ layerSource: { chain } }`; add that shape to `writeLine`'s union.

- [ ] **Step 4: Run to verify they pass**, then `pnpm run test:runtime` PASS.

- [ ] **Step 5: Commit** — `feat: answer layerSource requests with JSX positions`

### Task 4: Bridge spawn option and `layer_source`

**Files:**
- Modify: `crates/react-bridge/src/bridge.rs` (`spawn_with_properties` → delegates to `spawn_with_options`), `crates/react-bridge/src/protocol.rs` (`Response`, `RawResponse`, `TryFrom`), `crates/react-bridge/src/types.rs`, `crates/react-bridge/src/lib.rs`
- Test: `crates/react-bridge/src/tests.rs`

**Interfaces:**
- Consumes: CLI option and request/response from Task 3.
- Produces: `#[derive(Clone, Copy, Debug, Default)] pub struct SpawnOptions { pub source_locations: bool }`; `ReactBridge::spawn_with_options(node, cli_script, entry, properties: &PropertyInputs, options: SpawnOptions) -> Result<Self, ReactBridgeError>`.
- Produces: `#[derive(Clone, Debug, PartialEq, Eq, Deserialize)] pub struct LayerSource { pub name: String, pub file: PathBuf, pub line: u32, pub column: u32 }`; `ReactBridge::layer_source(&mut self, time: Time, id: &str) -> Result<Option<Vec<LayerSource>>, ReactBridgeError>` (sends `preview: self.preview`).
- Produces: `Response::LayerSource { chain: Option<Vec<LayerSource>> }`; every existing exhaustive `match` on `Response` treats it as `UnexpectedResponse`.

- [ ] **Step 1: Write the failing tests** next to the existing live-bridge tests (same skip-when-runtime-missing guard): write a temp `entry.tsx` + `title.tsx` as in Task 3, spawn with `SpawnOptions { source_locations: true }`, `set_preview(true)`, take a layer id from `scene_at(ZERO)`, then

```rust
let chain = bridge.layer_source(Time::ZERO, &id)?.expect("layer is in the frame");
assert_eq!(chain[0].name, "Rect");
assert_eq!(chain[0].file, dir.join("title.tsx"));
assert_eq!((chain[0].line, chain[0].column), (EXPECTED_LINE, EXPECTED_COLUMN));
assert_eq!(bridge.layer_source(Time::ZERO, "nope")?, None);
```
and a unit test that `RawResponse` `{"layerSource":{"chain":null}}` decodes to `Response::LayerSource { chain: None }`.

- [ ] **Step 2: Run to verify they fail** — `cargo test -p celesta-react-bridge layer_source`; FAIL (does not compile).

- [ ] **Step 3: Implement.** `spawn_with_options` appends `--source-locations` when set; `layer_source` goes through `request_response` (so text measurements during the render are answered). `RawResponse.layer_source: Option<LayerSourceReply>` with `struct LayerSourceReply { chain: Option<Vec<LayerSource>> }`, checked before `error` in `TryFrom`. Export `SpawnOptions`, `LayerSource`.

- [ ] **Step 4: Run to verify they pass** — `cargo test -p celesta-react-bridge` PASS; `cargo clippy -p celesta-react-bridge --all-targets -- -D warnings` clean.

- [ ] **Step 5: Commit** — `feat(react-bridge): look up a layer's source`

### Task 5: Hit regions in the GPU renderer

**Files:**
- Create: `crates/gpu-renderer/src/hit.rs`
- Modify: `crates/gpu-renderer/src/renderer.rs` (fields, `set_record_hit_regions`, `hit_regions`), `crates/gpu-renderer/src/prepare.rs` (`prepare_draws`, `prepare_layer` leaf arms, `place_texts`, `place_paths`), `crates/gpu-renderer/src/layer.rs` (`PreparedLayer::corners`), `crates/gpu-renderer/src/transform.rs` (`ClipEntry` → `HitClip`), `crates/gpu-renderer/src/lib.rs`
- Test: `crates/gpu-renderer/src/tests.rs` (renderer-backed), `crates/gpu-renderer/src/hit.rs` (`#[cfg(test)]` geometry)

**Interfaces:**
- Produces: `#[derive(Clone, Debug, PartialEq)] pub struct HitRegion { pub layer_id: String, pub corners: [Point; 4], pub clips: Vec<HitClip> }`; `#[derive(Clone, Copy, Debug, PartialEq)] pub struct HitClip { inverse: [f32; 6], half: [f32; 2], radius: f32 }` with `pub fn contains(&self, point: Point) -> bool`; `pub fn hit_test(regions: &[HitRegion], point: Point) -> Option<&str>`.
- Produces: `GpuRenderer::set_record_hit_regions(&mut self, record: bool)` (default off) and `GpuRenderer::hit_regions(&self) -> &[HitRegion]` (last `prepare_draws`, painter's order; empty when off).

- [ ] **Step 1: Write the failing tests**

Geometry (`hit.rs`): a square region `(10,10)-(20,20)` hits `(15,15)`, misses `(25,15)`; the same square rotated 45° about its centre hits `(15, 9)` (inside the diamond's top tip) and misses `(11, 11)`; two overlapping regions → the later one's id; a region with a clip whose `inverse`/`half` describe `(10,10)-(15,20)` misses `(17,15)`; empty slice → `None`.
Renderer (`tests.rs`, skip without an adapter like neighbours): with recording on, a scene of
- rect `"a"` 10×10 at (5,5) → one region, corners `(5,5),(15,5),(15,15),(5,15)` within 0.01;
- a group translated (100,0) holding rect `"b"` → corners shifted by 100;
- text `"t"` rotated 90° → corners form a rotated rectangle (|corner[1] − corner[0]| along y);
- a group with `clip` holding rect `"c"` → `clips.len() == 1` and `hit_test` misses outside the clip;
- a zero-opacity rect `"z"` → no region;
order is `["a", "b", "t", "c"]`. With recording off, `hit_regions()` is empty.

- [ ] **Step 2: Run to verify they fail** — `cargo test -p celesta-gpu-renderer hit`; FAIL.

- [ ] **Step 3: Implement.** While recording, each leaf (`Layer` pushed directly, `Instances` via its `bounds()` box, `PendingText`, `PendingPath`) records `(item index at push time, layer id, clip index)`; the final corners come from `PreparedLayer::corners()` (the quad `write_instance` draws, without margins; a path's `shape` box) once `place_texts`/`place_paths` produced the layer. Dropped paths record nothing. Sort by the recorded item index before storing, so the order is painter's order. Flatten each clip index's chain of `ClipEntry`s into `HitClip`s (a rounded corner tests against `radius`).

- [ ] **Step 4: Run to verify they pass** — `cargo test -p celesta-gpu-renderer` PASS; clippy clean.

- [ ] **Step 5: Commit** — `feat(gpu-renderer): record layer hit regions on request`

### Task 6: Launching the editor

**Files:**
- Create: `crates/editor/src/editor_launch.rs`
- Modify: `crates/editor/Cargo.toml` (`shlex = "1"`), `crates/editor/src/main.rs` (`mod editor_launch;`)
- Test: `crates/editor/src/tests.rs`

**Interfaces:**
- Consumes: `celesta_react_bridge::LayerSource` (Task 4).
- Produces: `pub(crate) struct Invocation { pub(crate) program: String, pub(crate) args: Vec<String> }`; `pub(crate) enum LaunchError { TerminalEditor(String), Unparsable(String), Spawn(String) }` with `Display` = the panel copy below.
- Produces: `editor_value(env: impl Fn(&str) -> Option<String>) -> Option<String>`; `parse_login_shell_output(output: &str) -> Option<String>`; `editor_invocation(value: &str, source: &LayerSource) -> Result<Invocation, LaunchError>`; `default_opener(file: &Path) -> Invocation`; `open_source(source: &LayerSource, cwd: &Path) -> Result<(), LaunchError>` (blocking; call it on a background executor).

- [ ] **Step 1: Write the failing tests**

`editor_value`: `VISUAL` wins over `EDITOR`; `VISUAL=""` falls back to `EDITOR`; both unset/empty → `None`.
`editor_invocation` for `file = /p/a.tsx, line 12, column 5`:
```rust
("code", ["--goto", "/p/a.tsx:12:5"]), ("code -n", ["-n", "--goto", "/p/a.tsx:12:5"]),
("cursor"|"windsurf"|"codium"|"code-insiders", ["--goto", …]),
("zed"|"subl"|"sublime_text", ["/p/a.tsx:12:5"]),
("idea", ["--line", "12", "--column", "5", "/p/a.tsx"]),
("mate", ["--line", "12", "/p/a.tsx"]),
("emacs", ["+12", "/p/a.tsx"]), ("gedit", ["+12", "/p/a.tsx"]),
("'/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl'", program with spaces, ["/p/a.tsx:12:5"]),
("C:\\Tools\\Code.exe" matched case-insensitively without extension → --goto),
```
`vim`, `nvim`, `nano`, `hx`, `emacs -nw`, `emacsclient -t` → `Err(TerminalEditor(name))`; an unbalanced quote → `Err(Unparsable)`.
`parse_login_shell_output`: text before/after the markers is ignored; `"…MARK…\0code…MARK…"` (empty VISUAL) → `Some("code")`; no markers → `None`.
`default_opener` per `cfg(target_os)`: macOS `open /p/a.tsx`; Windows `cmd /C start "" /p/a.tsx`; Linux `xdg-open /p/a.tsx`.
`LaunchError::TerminalEditor("vim")` displays `VISUAL/EDITOR is a terminal editor (vim); set VISUAL to a graphical editor`.

- [ ] **Step 2: Run to verify they fail** — `cargo test -p celesta-editor editor_launch`; FAIL.

- [ ] **Step 3: Implement.** Word splitting with `shlex::split`; match the program's file stem lower-cased. The login shell (unix only) runs `$SHELL -lic 'printf "\n__CELESTA_EDITOR__%s\0%s__CELESTA_EDITOR__\n" "$VISUAL" "$EDITOR"'` with null stdin, killed after 3 s; the result (including "none") is cached in a `OnceLock`. `open_source` spawns detached with null stdio and `cwd`, and reaps the child on a thread.

- [ ] **Step 4: Run to verify they pass** — `cargo test -p celesta-editor` PASS; clippy clean.

- [ ] **Step 5: Commit** — `feat(editor): open source positions in VISUAL or EDITOR`

### Task 7: Selecting layers in the React preview

**Files:**
- Create: `crates/editor/src/layer_select.rs` (pure state + mapping), `crates/editor/src/layer_panel.rs` (Layer section UI)
- Modify: `crates/editor/src/preview.rs` (`PreviewRequest.source_of`, `PreviewResult.{hit_regions, layer_source}`, worker loop, `ensure_react_bridge` → `spawn_with_options` with `source_locations: true`), `crates/editor/src/refresh.rs` (`refresh_preview`, reload clears selection), `crates/editor/src/background.rs` (store results), `crates/editor/src/view.rs` (fields), `crates/editor/src/viewer.rs` (mouse-down, outline overlay, shared `letterbox`), `crates/editor/src/panels.rs` (`react_preview_panel` adds the section), `crates/editor/src/main.rs`
- Test: `crates/editor/src/tests.rs`

**Interfaces:**
- Consumes: `HitRegion`, `hit_test`, `set_record_hit_regions`, `hit_regions` (Task 5); `layer_source`, `LayerSource`, `SpawnOptions` (Task 4); `open_source`, `LaunchError` (Task 6).
- Produces: `letterbox(bounds: Bounds<Pixels>, frame: (f32, f32)) -> Option<(f32, f32, f32)>` (left, top, scale), used by `paint_safe_areas` too; `scene_point(bounds, frame, position: Point<Pixels>) -> Option<celesta_composition::Point>` (`None` outside the frame).
- Produces: `pub(crate) enum SourceLookup { Pending, NotInFrame, NoPosition, Found(Vec<LayerSource>), Failed(String) }`; `PreviewResult.layer_source: Option<(String, Result<Option<Vec<LayerSource>>, String>)>`; `fn source_lookup(result) -> SourceLookup`.
- Produces: `EditorView` fields `selected_layer: Option<String>`, `hit_regions: Vec<HitRegion>`, `source_lookup: Option<SourceLookup>`, `viewer_bounds: Rc<Cell<Option<Bounds<Pixels>>>>`, `launch_error: Option<String>`.

- [ ] **Step 1: Write the failing tests** (pure functions only)

`letterbox`: 1920×1080 frame in a 960×960 area at origin (0,0) → `(0.0, 210.0, 0.5)`; zero-size frame → `None`.
`scene_point`: click at (480, 480) in that area → `(960, 540)`; click at (480, 100) (in the letterbox bar) → `None`.
`source_lookup`: `Ok(None)` → `NotInFrame`; `Ok(Some(vec![]))` → `NoPosition`; `Ok(Some(chain))` → `Found(chain)`; `Err(e)` → `Failed(e)`.
`display_path`: a file inside the entry's directory shows relative (`components/title.tsx:12:5`), one outside shows absolute.

- [ ] **Step 2: Run to verify they fail** — `cargo test -p celesta-editor layer_select`; FAIL.

- [ ] **Step 3: Implement the worker side.** Recording is on only for `ReactPreviewMode::WholeScene`; the worker clones `renderer.hit_regions()` into the result and, when `source_of` is set and the bridge is alive, calls `layer_source(scene.time, id)`. `refresh_preview` sets `source_of = selected_layer` only when `!self.playing` and in React preview.

- [ ] **Step 4: Implement the view side.** In `poll_background_work`, accepted results replace `hit_regions` and, when present, `source_lookup`. Mouse-down (left) on the canvas area: `scene_point` → `hit_test` → set or clear `selected_layer`, set `source_lookup = Some(Pending)` on a hit, `refresh_preview()`, `cx.notify()`. The overlay canvas records its bounds into `viewer_bounds` and strokes the selected region's four corners (mapped through `letterbox`) as a closed 1px path in `cx.theme().accent`; nothing when the id is absent. `request_react_reload` clears the selection and lookup.

- [ ] **Step 5: Implement the Layer section** in `react_preview_panel`, below the facts: rows `ID`, `Source`, then a `Called from` section with one row per remaining entry; each source row is a ghost button (`lucide` external-link icon) labelled `<name>  <display_path>:<line>:<column>` that runs `open_source` on `cx.background_executor()` and stores a `LaunchError` in `launch_error` (shown in `danger` color under the rows). States: `Pending` → "Looking up source…", `NotInFrame` → "Not in this frame", `NoPosition` → "No source position", `Failed(e)` → `e`.

- [ ] **Step 6: Run the checks** — `cargo test -p celesta-editor` PASS; `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`, `git diff --check` clean.

- [ ] **Step 7: Verify in the app** — `cargo run -p celesta-editor -- <tmp>/entry.tsx` with a component in a second file: click layers (outline follows, chain shown, playback keeps the last chain, scrubbing while paused updates it); open with `EDITOR=code`, `EDITOR=zed`, `EDITOR=vim` (message), and none set (default app). Take before/after screenshots of the same frame.

- [ ] **Step 8: Commit** — `feat(editor): select React preview layers and open their source`

### Task 8: Documentation

**Files:**
- Create: `docs/handoff/2026-10-14-open-layer-source.md`
- Modify: `packages/website/content/en/docs/01-(getting-started)/03-preview.md`, `packages/website/content/ja/docs/01-(getting-started)/03-preview.md`, `HANDOFF.md` (React runtime constraints: one sentence on `--source-locations` and the handoff link)

- [ ] **Step 1: Write the handoff note** — protocol (`--source-locations`, `layerSource` shape), why props-keyed `WeakMap` and fiber `return` (not owner), the `<Static>` re-walk, hit-region recording, editor resolution order and argument table, the checks actually run and any skipped (GPU/live bridge), and the manual results.
- [ ] **Step 2: Add a "Find a layer's source" section** to both preview pages (same content, each language): click to select, the chain, `VISUAL`/`EDITOR` and the fallback, terminal editors not supported.
- [ ] **Step 3: Check** — `pnpm --dir packages/website run build` (or the site's test script) passes; `git diff --check` clean.
- [ ] **Step 4: Commit** — `docs: describe opening a layer's source`
