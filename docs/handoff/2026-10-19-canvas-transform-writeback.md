# Canvas transform write-back (2026-10-19)

Issue #313. In the editor's standalone React preview, a selected layer can be
moved, rotated, and scaled by dragging on the canvas or typing in the Layer
section's Transform rows. The result is written into the user's JSX, so a
reload reproduces it. Design:
`docs/superpowers/specs/2026-10-19-canvas-transform-writeback-design.md`.
User docs: `packages/website/content/{en,ja}/docs/01-(getting-started)/03-preview.md`.

## What changed

- `crates/source-edit` (no GPUI): parses TSX with oxc, finds the element at a
  `layerSource` position, resolves `x`, `y`, `rotation`, `scale`, `scaleX`,
  `scaleY` to `Literal`, `Keyframe`, `Missing`, or `Locked(reason)`, and
  applies edits as byte-span replacements on the original text. Nothing is
  re-printed, so formatting and comments survive.
- Runtime `layerSource` reply (`packages/react`, `packages/cli`,
  `celesta_react_bridge::LayerSource`): each chain entry gains `kind`
  (`primitive` or `component`, by type identity) and `layer_id`; the reply
  gains `localFrame` (what `useCurrentFrame()` returns at the layer),
  `props` (the transform values the innermost primitive received), and
  `renderCount` (layers in the frame sharing the innermost source position).
  Older runtimes omit them and read as `component`, frame 0, no props, 1.
- Preview worker: the request carries `frame_of` (the selected layer) and
  drag overrides; the reply carries `layer_frame` (the layer's transform, its
  parent's map to scene pixels, and an outline). For a Group the outline is
  the box around its descendants' hit regions
  (`crates/gpu-renderer/src/layer_frame.rs`).
- Editor: Transform rows in the Layer section (`transform_rows.rs`), canvas
  handles and drag (`transform_handles.rs`, `transform_drag.rs`, `viewer.rs`),
  resolution and commit (`transform_edit.rs`), reload that keeps the selection
  (`refresh.rs`), and one undo history shared with props-file edits
  (`edit_history.rs`; Cmd+Z, Cmd+Shift+Z).
- Parent selection: a chain row below Source whose entry is a primitive with a
  `layer_id` (a `<Group>`, `<Stack>`) has a Select button. It goes through
  `EditorView::select_layer`, the path a click uses (clear the old state,
  set `selected_layer`, look up the source, refresh with `frame_of`). A group
  has no hit region, so `viewer.rs` outlines it from `layer_frame.outline`
  when the selection has none (`layer_select::outline_quads`).

## Lock rules

A value is written only when the source states it: a numeric literal (with
unary `-`), a missing prop with a known default, a one-level `const` used once,
or a keyframe of `interpolate(frame, ...)` at the current local frame. Else the
field is read-only with a reason (`reason_text` in `transform_edit.rs`):
not primitive, expression, unresolved identifier, shared binding, between or
outside keyframes, unsupported call, overridden by a parent, spread, repeated,
syntax error, element not found. After resolving, the value is compared with
the prop the runtime received; a mismatch locks it as overridden by a parent.
The drag's end re-reads and re-resolves the file and aborts if any target
changed, and an undo refuses when the file no longer equals the entry's
`after`.

Out of scope (spec non-goals): size props, anchor, skew, 3D rotation, opacity,
props on user components, inserting keyframes, `spring()` and easings,
expressions, keyboard nudging, snapping, multi-selection, project layers.

## Decisions

- Files with syntax errors lock all props.
- An element rendered more than once (`.map`) is locked as Repeated.
- `useCurrentFrame` is found in any enclosing function.
- `const x = spring()` reports UnsupportedCall.
- `FileEdit.before` is `Option`: an undo of a created props file removes it.
- Undo/redo reloads keep the selection.
- The SourceChanged text is "The source changed during the edit".
- Reason texts have no backticks.
- Block-scoped shadowing is not modelled yet. This is a known limitation; the
  received-value check is the backstop.
- Motion-blur groups: only the first sample follows a drag.
- Select shows on any primitive chain entry with a layer id below Source, not
  only `Group` by name, so a `<Stack>` or `<SafeArea>` parent is selectable.

## Verifying by hand

`packages/cli/examples/canvas-transform.tsx` has a literal Rect, a Rect with no
`x`, a keyframed Text, a `<Stack>`, three `.map()` Rects, an `x={W / 2}`
expression, and a Group with two children. Open it with:

```sh
export PKG_CONFIG_PATH="$(brew --prefix ffmpeg@8)/lib/pkgconfig"
cargo run -p celesta-editor --release -- packages/cli/examples/canvas-transform.tsx
```

(after `pnpm install`, `pnpm --dir packages/react run codegen`, and
`pnpm run build:runtime`). Turn on Select layers (`V`), then drag, type, undo,
redo, and reload; `git diff` should touch only the changed spans. The fixture
is under `packages/cli/examples`, which `pnpm typecheck:examples` does not
cover; it was checked by copying it into a temporary `examples/<name>` project
with the `.celesta` support directory.
