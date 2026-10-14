# Open a layer's source design

Issue: [mika-f/Celesta#306](https://github.com/mika-f/Celesta/issues/306)

## Goal

Finding where an element in the React preview is written takes a search
through the source. In the standalone React preview, clicking a layer on
the canvas should select it, show the JSX position (file, line, column)
that produced it and the positions of the components it sits in, and open
any of them in the user's text editor with one click. The editor is the
one `VISUAL` or `EDITOR` names, not an app setting.

Export, inspect, and the MCP server must produce the same output as
before.

## Non-goals

- Selecting layers of a loaded project or of resolved component clips.
  Only the standalone React preview (`ReactPreviewMode::WholeScene`) has
  layer selection.
- A layer tree or list panel. Selection is by clicking the canvas.
- Pixel-accurate picking. A layer is hit anywhere inside its drawn quad,
  including transparent pixels of an image or the gaps between glyphs.
- React's owner chain. "Called from" is the chain of ancestor elements
  in the rendered tree (see [Source chain](#source-chain)).
- Running terminal editors (vim, nano, …) in a terminal window.
- An editor setting in the app.
- Moving or editing layers on the canvas (#313).

## Overview

```text
editor click ─> scene point ─> hit regions (GPU renderer) ─> layer id
layer id + frame time ─> preview worker ─> bridge `layerSource` ─> CLI
CLI: re-walk frame, layer id -> host node -> fiber -> source chain
editor: Layer section in the React Preview panel ─> open in VISUAL/EDITOR
```

## Recording JSX positions (runtime)

### Bundling

The CLI gains a `--source-locations` flag. Only the editor's preview
bridge passes it; export, `inspect`, component schema loading, audio
collection, and the MCP server do not.

With the flag, `loadEntry` builds with `jsxDev: true`, so esbuild calls
`jsxDEV(type, props, key, isStaticChildren, source, self)` with
`source = { fileName, lineNumber, columnNumber }` for every JSX element in
the user's own files. The `shared-runtime` plugin resolves
`react/jsx-dev-runtime` to `@celesta/react/jsx-dev-runtime` (a new
subpath export) instead of React's. Celesta packages stay external and are
compiled with the ordinary runtime, so their internal JSX has no
positions. Without the flag the esbuild options are unchanged.

`fileName` is the path esbuild reports, resolved against the entry's
directory to an absolute path before it is stored.

### `@celesta/react/jsx-dev-runtime`

Exports `jsxDEV` and `Fragment`. `jsxDEV` creates the element with
`react/jsx-runtime`'s `jsx` / `jsxs` (chosen by `isStaticChildren`), so it
works with production React, then records the source in a module-level
`WeakMap<object, SourcePosition>` keyed by the element's `props` object.
Keying by the props object needs no change to the props a component
receives (spreading them copies nothing extra) and works whether or not
React froze the element. Elements without a source (`source` undefined)
record nothing.

`@celesta/react/internal` exports `sourceOfProps(props)` to read the map.

### Host nodes keep their fiber

`createInstance` and `commitUpdate` receive the fiber
(`internalInstanceHandle`); the reconciler stores it on the `HostNode` as
`fiber`. `prepareUpdate` can skip `commitUpdate`, so the stored fiber may
be the alternate of the current one; both have the same `return` chain of
element types and source-bearing props, which is all the lookup reads.

### Source chain

For a host node, walk `fiber.return` from its fiber up to the root. Each
fiber whose `memoizedProps` (or `pendingProps` when not yet committed)
has a recorded source contributes one entry:

```ts
interface LayerSourceEntry {
  /** The element's type: a component's displayName or name, or the host type. */
  name: string;
  file: string;
  line: number;   // 1-based
  column: number; // 1-based
}
```

The chain is innermost first: the first entry is the JSX element nearest
the layer (for a `<Rect>` written in `Title.tsx`, that `<Rect>`), and
later entries are the elements around it (`<Title>` in the entry,
`<Sequence>`, `<Composition>`). Because the walk follows the rendered
tree, an element passed as `children` lists the wrapper's own elements
between it and the wrapper's call site. Adjacent entries with the same
file, line, and column are merged.

### The `layerSource` request

A request `{ "layerSource": "<layer id>", "time": <Time>, "preview": true }`
renders the frame at `time` like a frame request, then walks it again
with the `<Static>` cache disabled and a `Map<layerId, HostNode>` that
`buildLayer` fills, so layers inside `<Static>` subtrees are found too.
The response is

```json
{ "layerSource": [ { "name": "Rect", "file": "/abs/Title.tsx", "line": 12, "column": 5 }, ... ] }
```

or `{ "layerSource": null }` when no layer in that frame has the id, and
`{ "layerSource": [] }` when the layer exists but no element on its chain
has a position (for example the CLI was started without
`--source-locations`). The re-walk does not touch the `<Static>` cache or
the statics sequence numbers, and its scene is discarded.

## Bridge (Rust)

- `ReactBridge::set_source_locations(true)`-style spawn option, mapped to
  the CLI's `--source-locations` argument. The editor's
  `ensure_react_bridge` enables it.
- `ReactBridge::layer_source(time, id) -> Result<Option<Vec<LayerSource>>,
  ReactBridgeError>`, with `LayerSource { name, file: PathBuf, line,
  column }`.
- `Response`/`RawResponse` gain the `layerSource` key.

## Hit regions (GPU renderer)

`GpuRenderer::set_record_hit_regions(bool)` (off by default). When on,
`prepare_draws` records, for every leaf layer it prepares (texture, rect,
path, instances), a `HitRegion { layer_id: String, corners: [Point; 4],
clip: Option<…> }` in scene pixels, in painter's order, from the same
quad `PreparedLayer::shape` uses and the clip in effect. Groups, masks,
and effect canvases record nothing themselves; their leaves are recorded
with the transforms the renderer already composes for them. Layers with
nothing to draw (zero opacity, fully clipped, empty paths) are not
recorded. `GpuRenderer::hit_regions()` returns the last frame's regions,
like `font_fallbacks()`.

A pure function `hit_test(regions, point) -> Option<&str>` returns the id
of the last region whose quad contains the point and whose clip (if any)
contains it.

Only the editor's preview worker enables recording, and only in
`WholeScene` mode. Export and every other renderer user never record.

## Editor

### Selection

- The preview worker sends the frame's hit regions with each
  `PreviewResult` when recording is on.
- A mouse-down on the preview image, while in `WholeScene` mode, maps the
  position to scene pixels through the viewer's fit (the same mapping the
  safe-area overlay uses) and hit-tests the latest regions. A hit selects
  that layer id; a miss clears the selection.
- The selection persists across frames by id. The selected layer's quad
  is drawn over the preview as a 1px outline in the theme's accent color,
  in the same overlay pass as the safe areas. When the current frame's
  regions have no such id, no outline is drawn.
- Reloading the composition clears the selection.

### Source lookup

`PreviewRequest` gains `source_of: Option<String>`. The view sets it to
the selected id when the selection changes, and when the displayed frame
changes while playback is stopped. The worker, after evaluating the
frame, calls `layer_source(scene.time, id)` and returns the result in
`PreviewResult`. During playback no lookups are sent; the panel keeps the
last result. Results for an older generation are ignored as other preview
results are.

### Layer section

The React Preview panel shows a "Layer" section below the composition
facts while a layer is selected:

- **ID** — the layer id.
- **Source** — `<name>` and `file:line:column`, the file shown relative
  to the entry's directory when it is inside it. The row is a button
  that opens the position in the editor.
- **Called from** — the rest of the chain, one button row each, in the
  same format.
- States: "Looking up source…" while a lookup is pending, "Not in this
  frame" when the lookup returned `null`, "No source position" when the
  chain is empty, and the lookup error otherwise.

Rows follow the existing inspector styles (no uppercase labels, radius 0,
lucide icons).

## Opening the editor

A new editor module resolves and runs the editor command.

### Resolving the command

1. `VISUAL`, then `EDITOR`, from the process environment; empty values
   count as unset.
2. If both are unset, on macOS and Linux run the login shell once
   (`$SHELL -lic` printing both variables, with a 3 second timeout) and
   cache what it prints for the rest of the session. The lookup runs on
   a background thread, the first time an open is requested.
3. Otherwise, no editor.

The value is split into a program and its arguments with shell word
rules (so `code -n` and quoted paths work).

### Arguments by editor

Matched on the program's file name without extension, case-insensitive:

| Program | Arguments appended |
| --- | --- |
| `code`, `code-insiders`, `codium`, `cursor`, `windsurf` | `--goto file:line:column` |
| `zed`, `subl`, `sublime_text` | `file:line:column` |
| `idea`, `webstorm`, `phpstorm`, `pycharm`, `goland`, `clion`, `rider`, `rustrover`, `fleet` | `--line line --column column file` |
| `mate` | `--line line file` |
| any other | `+line file` |

Terminal-only editors — `vi`, `vim`, `nvim`, `nano`, `pico`, `micro`,
`hx`, `helix`, `kak`, `ed`, and `emacs` or `emacsclient` with `-nw`, `-t`,
or `--tty` — are not launched: the panel shows "VISUAL/EDITOR is a
terminal editor (<name>); set VISUAL to a graphical editor". `emacs` and
`emacsclient` without those flags take the `+line file` row.

The process is spawned detached with null stdin/stdout/stderr and the
entry's directory as working directory; a thread waits on it so it does
not linger as a zombie. A spawn error is shown in the Layer section.

### No editor

With no editor, the file opens with the OS default application, without
a position: `open <file>` on macOS, `cmd /C start "" <file>` on Windows,
`xdg-open <file>` on Linux.

## Not affecting export

- Exporter, `inspect`, and MCP do not pass `--source-locations`, so their
  esbuild options and therefore bundles are unchanged.
- Hit regions are recorded only when the editor's preview turns
  recording on.
- A test renders a fixture with and without `--source-locations` and
  checks that the frame scenes are equal.

## Testing

TypeScript (`packages/react`, `packages/cli`):

- `jsxDEV` records the source for its props object and returns an element
  equal to `jsx`'s; a component receiving the props sees no extra keys.
- The source chain for a primitive inside a component written in another
  file lists the primitive, then the component's call site, innermost
  first; merged duplicates; `[]` without positions.
- `layerSource` finds layers inside `<Static>` and does not disturb a
  following frame's statics references; unknown ids return `null`.
- A CLI test bundles a fixture with and without `--source-locations` and
  compares scenes.

Rust:

- Command resolution and argument building as pure functions over a
  given environment map: precedence, empty values, word splitting, every
  table row, terminal editors, the default-opener fallback per OS.
- `hit_test` geometry: rotated quads, clips, painter's order, misses.
- GPU renderer: recorded regions for a rect, a rotated text layer, a
  layer in a translated group, and a clipped layer match their expected
  corners; nothing recorded when recording is off.
- A live bridge test (skipped without the built runtime) asks for a
  layer's source in `packages/cli/examples/` and checks the file and
  line.

Manual: in the editor, click layers in a fixture whose components live in
a separate file, check the outline, the chain, and opening with `code`,
`zed`, unset `EDITOR` (default app), and a terminal editor (message).
Screenshots of the preview before and after selection go in the PR.

## Documentation

- A handoff note `docs/handoff/2026-10-14-open-layer-source.md`.
- The user docs on the React preview describe selecting a layer and how
  `VISUAL`/`EDITOR` choose the editor.
