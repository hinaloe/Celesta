# Open a layer's source (2026-10-14)

Issue #306. In the editor's standalone React preview, clicking a layer
selects it (a 1px orange outline), the React Preview panel shows a Layer
section (ID, Source, Called from), and each row opens the position in the
editor `VISUAL` or `EDITOR` names. Export, `inspect`, and MCP are unchanged.
Design: `docs/superpowers/specs/2026-10-14-open-layer-source-design.md`.

## Runtime protocol

- `celesta-cli --source-locations` (`packages/cli/src/cli.ts`) builds the
  entry with esbuild's `jsxDev: true`, and the `shared-runtime` plugin
  resolves `react/jsx-dev-runtime` to `@celesta/react/jsx-dev-runtime`.
  Only the editor's preview bridge passes it. Without the flag the esbuild
  options are as before, and a test compares the frame scenes with and
  without it (`packages/cli/test/layer-source.test.mjs`). Celesta packages
  stay external, so their own JSX has no positions.
- `jsxDEV` (`packages/react/src/jsx-dev-runtime.ts`) builds the element with
  `jsx`/`jsxs` from `react/jsx-runtime`, so it works with production React,
  and records `{ fileName, lineNumber, columnNumber }` in a module-level
  `WeakMap` keyed by the element's `props` object. A props-keyed map was
  chosen because it changes nothing a component receives (spreading props
  copies no extra key or symbol) and works whether or not React froze the
  element. `sourceOfProps` is exported from `@celesta/react/internal`.
- A request `{ "layerSource": "<id>", "time", "preview" }` answers
  `{ "layerSource": { "chain": [...] } }`. `chain` is `null` when no layer in
  that frame has the id, `[]` when the layer exists but nothing on its chain
  has a position (a CLI started without the flag), and otherwise entries
  `{ name, file, line, column }` (absolute `file`, 1-based `line`/`column`),
  innermost first. The chain is wrapped in an object so the bridge's
  single-pass response parser can tell a missing layer from a message
  without the key.
- `MountedComposition.layerSource` (`packages/react/src/render.ts`) renders
  the frame like a frame request (component state advances as for any frame
  request), then walks it again with the `<Static>` cache off and a
  `Map<layerId, HostNode>` that `buildLayer` and `staticLayer` fill, so
  layers inside `<Static>` subtrees are found. The re-walk touches neither
  the static cache nor its sequence numbers (a test checks that the next
  frame's references are unchanged), and its scene is discarded. It renders
  with no project frame, as `collectAudio` does, so a composition whose hooks
  require project layers would error on a lookup.

## Why the fiber's `return`, not the owner

Host nodes keep the fiber `createInstance`/`commitUpdate` receive
(`HostNode.fiber`). `sourceChain` (`packages/react/src/source-chain.ts`) walks
`fiber.return` and takes every fiber whose `memoizedProps` (or
`pendingProps`) has a recorded source. That is the chain of ancestor
elements in the rendered tree, nearest first: for a `<Rect>` written in
`Title.tsx` it is the `<Rect>`, then the `<Title>` call site, then
`<Sequence>`, `<Composition>`. React's owner chain would list only who
created an element, so an element passed as `children` would skip the
wrapper between it and its parent; the issue wants the position of every
element around the layer. Adjacent entries at the same file, line, and
column are merged, and a component's name is its `displayName`, its
`name`, or the wrapped `memo`/`forwardRef` component's. Limitation:
`prepareUpdate` can skip `commitUpdate`, so the stored fiber may be the
alternate of the current one. Both have the same `return` chain of element
types and sources, but if an ancestor's source changed while the host's
props stayed equal, the chain could lag until the node is recreated (a
rebuild remounts, so it matters only under HMR-style edits).

## Bridge

`ReactBridge::spawn_with_options(.., SpawnOptions { source_locations })`
adds the flag (`spawn_with_properties` keeps the old behaviour), and
`ReactBridge::layer_source(time, id) -> Result<Option<Vec<LayerSource>>,
ReactBridgeError>` sends the request using the bridge's preview setting
(`set_preview`), so the frame is the one the preview shows
(`crates/react-bridge/src/bridge.rs`, `types.rs`). `ensure_react_bridge` in
`crates/editor/src/preview.rs` passes `source_locations: true` for every
bridge it spawns, project mode included, which never asks for sources; the
runtime then records positions it does not use there.

## Hit regions (GPU renderer)

`GpuRenderer::set_record_hit_regions(true)` makes `prepare_draws` record, for
every leaf layer it prepares (texture, rect, path, instances), a
`HitRegion { layer_id, corners, clips }` in scene pixels, in painter's
order, from the quad `PreparedLayer::shape` uses; `hit_regions()` returns the
last frame's (`crates/gpu-renderer/src/hit.rs`, `prepare.rs`). `clips` is a
list of every clip the layer is drawn through, innermost first. `hit_test`
returns the last region whose quad and clips contain the point; a quad
without area hits nothing. Groups, masks, and effect canvases record nothing
themselves, and layers with nothing to draw (zero opacity, fully clipped,
empty paths) are skipped. Recording is off by default and only the editor's
preview worker turns it on, in `WholeScene` mode, so export is untouched. A
layer is hit anywhere in its quad, including transparent pixels and the gaps
between glyphs.

## Editor

- Selection (`crates/editor/src/layer_select.rs`, `viewer.rs`): a left
  mouse-down on the canvas in the React preview maps the position to scene
  pixels through the viewer's letterbox (the safe-area overlay shares it),
  hit-tests the latest regions, and selects the id or clears the selection.
  The selection persists across frames by id and is cleared on reload. The
  outline strokes each region of the selected id; it uses
  `celesta_editor_theme::accent()` (`#ffa13b`, as the playhead), not
  `cx.theme().accent`, which is `neutral-800` in the dark theme and would be
  nearly invisible over the preview. The overlay canvas is now always
  present, since it records the viewer's bounds.
- Lookup (`preview.rs`, `refresh.rs`, `background.rs`): `PreviewRequest.
  source_of` carries the selected id when the selection changes and when the
  shown frame changes while playback is stopped; the worker calls
  `layer_source(scene.time, id)` after evaluating the frame and returns it
  in `PreviewResult`. During playback no lookups are sent except while the
  lookup is still pending, so a layer picked during playback gets its
  answer; the panel then keeps the last result. Results for an earlier
  generation or selection are dropped. Clicking the layer that is already
  selected sends no new lookup.
- Panel (`layer_panel.rs`): the Layer section sits below the composition
  facts. States: "Looking up source…", "Not in this frame", "No source
  position", the lookup error. Each row is a ghost button with the
  `ExternalLink` icon, `<name>  <path>:<line>:<column>` (relative to the
  entry's directory when inside it), and a tooltip with the absolute
  position. A launch error is shown below the rows.

## Opening the editor

`crates/editor/src/editor_launch.rs`. Resolution order: `VISUAL`, then
`EDITOR` from the process environment (empty counts as unset); then, on
macOS and Linux only, the login shell once (`$SHELL -lic`, 3 second timeout,
cached for the session including "none", on a background thread the first
time an open is requested). The shell prints both variables between
`__CELESTA_EDITOR__` markers and the reader stops at the closing marker, not
at EOF, because a daemon an rc file starts can keep the pipe open after the
shell exits. With no editor, the file opens in the OS default application
without a position: `open`, `cmd /C start "" <file>`, or `xdg-open`.

The value is split with shell word rules (`shlex`; on Windows backslashes
are escaped first so paths survive). The program's file name without
extension, lowercased, picks the arguments appended after the user's own:

| Program | Arguments |
| --- | --- |
| `code`, `code-insiders`, `codium`, `cursor`, `windsurf` | `--goto file:line:column` |
| `zed`, `subl`, `sublime_text` | `file:line:column` |
| `idea`, `webstorm`, `phpstorm`, `pycharm`, `goland`, `clion`, `rider`, `rustrover`, `fleet` | `--line line --column column file` |
| `mate` | `--line line file` |
| any other | `+line file` |

Terminal editors (`vi`, `vim`, `nvim`, `nano`, `pico`, `micro`, `hx`,
`helix`, `kak`, `ed`, and `emacs`/`emacsclient` with `-nw`, `-t`, or
`--tty`) are not launched; the panel shows "VISUAL/EDITOR is a terminal
editor (<name>); set VISUAL to a graphical editor". The process is spawned
detached with null stdio, the entry's directory as working directory
(`CREATE_NO_WINDOW` on Windows), and a thread reaps it. A spawn error is
shown in the Layer section. Windows `.cmd` shims (a bare `code`) may fail to
spawn, because `Command` does not resolve them; this is untested.

## Checks run

Per task; all pass unless noted.

- Task 1 (`jsxDEV`): `pnpm --dir packages/react test` (94 tests).
- Task 2 (`sourceChain`): the same suite, 100 tests.
- Task 3 (CLI and `layerSource`): `pnpm run test:runtime` (react 100, cli 84),
  including the six `layer-source.test.mjs` tests.
- Task 4 (bridge): `cargo test -p celesta-react-bridge` (79 unit, 34
  integration). The live test, which asks for a layer's source in
  `packages/cli/examples/` and checks the file and line, ran against the
  built runtime and did not skip.
- Task 5 (hit regions): `CELESTA_REQUIRE_GPU=1 cargo test -p
  celesta-gpu-renderer` (145 tests, none skipped).
- Task 6 (`editor_launch`): `cargo test -p celesta-editor`, with the
  precedence, word splitting, argument table, terminal editor, default-opener,
  and login-shell parsing cases as pure functions.
- Task 7 (selection): `cargo test -p celesta-editor` (88 tests), including
  the letterbox, scene-point, display-path, and lookup-state cases.
- `cargo check --workspace --all-targets` and `cargo fmt` pass. The
  website's `pnpm run check` (no issues; the OGP image warnings are on every
  page) and `pnpm test` (57 tests) pass with the new user docs.

## Known gaps

- Clippy (0.1.99) is red on HEAD, independently of this change: lints in
  `celesta-budoux`, `celesta-gpu-renderer`, and `crates/editor/src/
  helpers.rs:18` (`chunks_exact_to_as_chunks`). The new code is clean with
  `cargo clippy --no-deps` (the editor crate with that one lint allowed).
- Manual GUI check: an agent ran the editor on a two-file demo and the
  preview rendered with the source-locations bridge. Clicking layers and
  opening editors was not exercised, since no input automation was
  available. Still to check by hand: the outline, the chain, and opening with
  `code`, `zed`, unset `EDITOR` (default app), and a terminal editor
  (message). Before/after screenshots belong in the PR.
- Windows: `.cmd` shim launching (above) and the default-opener `cmd /C
  start` are untested.
- Project mode (`ResolveComponents`) bridges also get `--source-locations`,
  though nothing there asks for sources.
