# Canvas tools (2026-10-24)

On the canvas, rotation and scale turn about the middle of the layer's box
by default, with a "Center" | "Pivot" toggle in the viewer's toolbar; the
pivot (the anchor point plus `origin`) is drawn as a cross that Alt-drags
the anchor without moving the layer; and a "Rect" | "Scale" toggle makes
the corner and edge handles resize the layer through its `size` props
(`width`/`height`, `radius`, or a `Text`'s `maxWidth`), keeping the
opposite edge where it is. Every drag that has to keep something still
moves `x`/`y` by one rule, and is still one history entry, in one or two
files.
Design: `docs/superpowers/specs/2026-10-23-editor-property-editing-design.md`
(section "Canvas": "Pivot" and "Resize"). This is part 2c; it builds on 2a
(`docs/handoff/2026-10-23-property-editing-engine.md`) and 2b
(`docs/handoff/2026-10-24-property-sections.md`), and 2d builds inline text
editing on it.
Plan: `docs/superpowers/plans/2026-10-24-editor-canvas-tools.md`.
User docs: `packages/website/content/{en,ja}/docs/01-(getting-started)/03-preview.md`
("Move layers on the canvas": "Turn about the center or the pivot",
"Resize with the Rect tool", "Move the anchor").

## What changed

- Canvas geometry (`crates/editor/src/canvas_geometry.rs`, new): a layer's
  own pixels (relative to its anchor point, as
  `EvaluatedTransform::homography` lays the plane out) and the maps around
  them, built with the renderer's own `EvaluatedTransform::linear` and
  `translation` (2D part), never re-derived. `layer_map(transform)` is the
  own-pixel → parent map; `pivot(transform)` is `layer_map` applied to
  `origin`, so the anchor point plus `origin`. `LocalBox { min, max }`
  (`size`, `center`, `at(fx, fy)`) is a box in own pixels;
  `local_box(frame)` measures the outline through the inverse maps,
  `anchor_box(frame)` measures `frame.anchor_box`; both are `None` when a
  map collapses or the renderer draws the layer through its homography
  (`perspective_distance().is_some() && is_projective()`).
  `with_anchor_box(frame, primitive, received)` sets the box the source
  element's anchor and size props refer to (see Decisions). `keep_fixed(after,
  fixed_local, fixed_parent)` is the one compensation rule. `apply` is
  shared with `transform_handles.rs`; `box_frame` builds test frames.
- Anchor box in the renderer (`crates/gpu-renderer/src/hit.rs`, `layer.rs`,
  `prepare.rs`, `layer_frame.rs`): `HitRegion.anchor_box` holds a text's
  layout box in scene pixels, in the order of `corners`
  (`PreparedLayer::anchor_box_corners`, from the texture's
  `anchor_origin`/`anchor_span`, mapped through the same `drawn_transform`
  as the quad; `quad_corners` now delegates to `quad_corners_between`). An
  anchor box that doesn't map to the scene through its planes is dropped,
  and the region stays without it. `LayerFrame.anchor_box` is the box the renderer anchors the layer in: the
  region's `anchor_box`, else its quad; `None` for a group, a path, and
  instances.
- Drag props keyed by prop name (`crates/editor/src/transform_handles.rs`,
  `transform_drag.rs`): `drag_values`, `prop_values`, `preview_values`,
  `handle_props`, `drag_label`, `shown_handles`, `TransformDrag.values` and
  `.editable`, and `DragState::Editable` carry `PropKey` (the six transform
  props, `anchorX`/`anchorY`, and the table's `size` props); `TransformProp`
  stays the six. `prop_changes` moves every key by the same delta from the
  received value (position, rotation, anchors, sizes) except scales, which
  move by the same ratio; a `Text`'s `maxWidth` is written as the new box
  width itself (`Resize::absolute`). `start_value` reads the transform for
  the six, `transform.anchor` for the anchors, and the anchor box for sizes
  (`Resize::start`).
- Center / Pivot (`transform_handles.rs`, `transform_drag.rs`, `view.rs`):
  `PivotMode { Center (default), Pivot }`. `turning_point` is the box
  center (`local_box`) in Center mode, else `pivot()`; `turn()` measures
  angles about it, and the Scale tool's ratios are measured from it.
  `drag_values` collects the props after the drag and, in Center mode,
  appends `x`/`y` from `keep_fixed`. `compensable(targets)`: both `x` and
  `y` resolve (through a pass-through too) to `Literal` or `Missing`.
  `pivot_fallback` / `pivot_used` / `PivotFallback { NotCompensable,
  Animated, NoFlatBox }` give the mode a drag uses; `TransformDrag` keeps it from the
  start, and `EditorView::shown_pivot_mode` gives the toggle's state.
  `EditorView.pivot_mode` is session state.
- The pivot cross and the anchor drag (`transform_handles.rs`,
  `transform_drag.rs`, `viewer.rs`): `Handle::Anchor`; `pivot_cross` (the
  scene position of `pivot()`); `anchor_handle` (the cross, when `x`, `y`,
  `anchorX`, `anchorY` are all in `editable` and the anchor box is known);
  `pressed_handle(.., alt)` takes the cross with Alt within reach, even over
  another handle, and is `handle_at` otherwise. `anchor_values` moves the
  anchor by the pointer's move in own pixels over the anchor box's size
  (unclamped) and keeps the box's top-left corner still. `drag_props` adds
  the anchors when both rows are `Literal` or `Missing` (not keyframes),
  `x`/`y` are compensable, no editable `rotation` or scale is a keyframe
  (the compensation turns and scales with them), and the anchor box is
  known; `anchor_reason` / `GROUP_ANCHOR` give the cross's
  tooltip. The viewer draws the cross at the pivot for every selected layer
  with a frame (one handle wide, accent color), with a hitbox that sets
  `OpenHand` while Alt is held, and redraws on `on_modifiers_changed`.
- The Rect tool (`transform_handles.rs`, `transform_drag.rs`, `view.rs`,
  `viewer.rs`): `ResizeTool { Rect (default), Scale }`; `SizeField { name,
  min, max, integer, absent, keyframed }`; `SizeProps { Box, Radius, Width }`;
  `Resize { props, compensable }`, the Rect tool resolved for a layer.
  `size_props(targets)` reads `table.size` and the fields' bounds, and needs
  every named prop `editable`; `resize_fallback` / `resize_used` /
  `ResizeFallback { NoSize, Locked, Uneditable, Pinned, Animated, NoBox }`
  mirror the pivot pair (`NoSize` also when a flat shape has no anchor box,
  its size unreported; `Pinned`/`Animated` when no corner or edge passes
  `resizes`, see `resizes_any`, tooltips "x or y can't move" / "Size is
  animated"); `shown_resize_tool` gives the toggle's state. `drag_values` gains
  `resize: Option<&Resize>` (`None` is the Scale tool) and sends corners
  and edges to `resize_values`; `shown_handles` and `handle_props` follow
  `resizes` / `resize_moves`. `handle_quad` puts the Rect tool's handles and
  stem on the anchor box, which the viewer then strokes as the selection
  outline; `TransformDrag::with_resize` attaches the tool and
  `with_primitive` the element's name, and `TransformDrag::anchored`
  rebuilds the anchor box of a running (or released, being written) drag
  from the values it draws (`received_now`), so the handles follow the box
  they resize and don't jump to the outline before the reload.
  `EditorView.resize_tool` is session state.
- Toolbar (`viewer.rs`): `pivot_toggle` and `resize_toggle`, two small
  outline `ButtonGroup`s before "Select layers", shown only in interactive
  mode of a React preview. Each button has its own `on_click`.

## Decisions

These differ from, or settle what the spec left open:

- **The pivot is the renderer's**: the anchor point plus `origin`, where
  `EvaluatedTransform::translation` puts the turning point. Pivot mode turns
  about it and the cross is drawn there. 2a measured angles and scale ratios
  about `transform.position`, which is the pivot only with a zero `origin`;
  2c fixes that in both modes.
- **One compensation rule** (`keep_fixed`): a fixed point in own pixels
  after the change and in parent space before it; the map built from the new
  props with the old position; `position' = position + (fixed_parent −
  M'(fixed_local'))`. Center rotation and scale keep the box center, a
  resize keeps the opposite edge's point (the pivot's coordinate along an
  axis it does not change), the anchor drag keeps the box's top-left corner.
  Skew and `origin` need no special case.
- **Compensations are computed from the values as written**
  (`as_written`, `format_number` parsed back): an anchor is written rounded
  to 0.01 and `x`/`y` are computed from that, and so are sizes and the
  Center-mode rotation and scale (which are therefore quantized to 0.01 in
  the preview too; Pivot-mode values are unchanged). The reloaded layer
  lands where the preview drew it.
- **Center needs compensable `x`/`y` and a flat box.** Without either the
  drag turns about the pivot. The toggle shows the mode used: "Pivot (x, y
  not editable)" for `NotCompensable` (tooltip "x or y is animated or
  locked"), plain "Pivot" with the tooltip "Rotation or scale is animated"
  for `Animated` (an editable `rotation`, `scale`, `scaleX`, or `scaleY` is
  a `Keyframe`: literal `x`/`y` would keep the center at that keyframe
  only), plain "Pivot" with the tooltip "No flat box to center on" for
  `NoFlatBox`; all muted and still clickable, and the stored choice stays
  Center for the next layer. Center uses the outline's box (`local_box`):
  a text's padding is symmetric horizontally, so its center is the layout
  box's there; vertically it differs by the glyph overflow of multi-line
  text. A
  running drag keeps the mode it started with.
- **The anchor box.** The anchor and the size props are fractions and
  lengths of one box, and both the anchor drag and the Rect tool measure
  that box, not the outline: for `Text` the layout box the renderer
  records (the texture quad is padded for strokes, left and right only on a
  single line); for `Image` and `Video` their quad; for `Rect`, `Ellipse`,
  `Triangle`, `Heart` (`width` × `height`) and `Circle`, `Polygon`, `Star`,
  `Pie` (`2 · radius`) from the received props and `anchorX`/`anchorY`
  (default 0), since a shape is drawn as a path and a dashed `Rect` as a
  group; `with_anchor_box` also sets `transform.anchor` to the props'
  anchor there, as a path layer's own anchor places nothing. A `Group` has
  none: the renderer places its children by its position alone, so its
  cross is inert with "A group's anchor has no effect". `Path`, `Line`,
  `Polyline`, `Arrow`, `Instances`, and a primitive with no renderer box
  have no anchor drag.
- **The anchor is not clamped**: an anchor outside the box is valid, and
  the cross follows the pointer by delta (it does not jump to it).
- **The Rect tool keeps the opposite edge regardless of Center/Pivot.**
  Resizing about the center (Unity's Alt) is not in 2c; the rotation stem
  and the Scale tool honor the toggle.
- **Hidden-handle rule, generalized**: a Rect-tool handle needs
  compensable `x`/`y` only when its kept edge is not at the anchor
  (`resize_moves`), not "left and top" by name: with `anchorX = 1` the left
  edge needs no compensation and stays, and with `anchorX = 0.5` both
  edges need it. A handle that moves the anchor point along an axis whose
  size is a keyframe is hidden too (literal `x`/`y` would keep the edge on
  that keyframe only); the handles that keep the anchor still resize it.
- **Which handles**: `SizeProps::Box` gets four corners and four edges
  (edges one axis, Shift on a corner projects onto the box's diagonal);
  `Radius` corners only, uniform; `Width` (`Text`) the left and right edges,
  whose kept point is the opposite edge at the pivot's own y. The pointer is
  taken through the full inverse of `layer_map` (scale included).
- **Bounds**: sizes clamp to the field's `min`/`max`, whole where
  `integer`, and never below one own pixel (radius 0.5), even where the
  field declares `min: 0` (shapes, `Rect`, `maxWidth`); no drag collapses or
  flips the box.
- **`maxWidth` is written in whole own pixels**: the renderer lays text out
  `ceil(maxWidth)` wide, and the compensation uses the rounded width. A set
  `maxWidth` is exactly the layout box's width; an absent one starts from
  the measured width and is inserted.
- **An absent box side is pinned.** On a `Box` whose other prop is
  `Missing` (an `Image` sized from its source's aspect), an edge drag also
  writes that side at its current box value, overridden from the first
  move, so the runtime's aspect rule does not change the axis not dragged.
  A drag that changes nothing writes nothing, pinned side included.
- **Rect-tool handles sit on the anchor box** (`handle_quad`), and a running
  resize's box follows its current values: a group's outline is its
  children's scene-axis box and a text's is padded, so the outline's
  corners are not the box's. The Scale tool and the Move hit test keep the
  outline.
- **Fallback to Scale**: no `table.size` ("No size to resize": `Group`,
  `Video`, and primitives without a table), a locked size row ("Height:
  Written as an expression: h * 2"), a size row that is neither locked nor
  writable ("Size can't be edited here"), or no flat box ("No flat box to
  resize"). The toggle shows "Scale", muted, with the reason as its
  tooltip; the stored choice stays Rect.
- **The preview overrides every prop a handle can change from the first
  move** (2a's rule), now including `x`/`y` for a Center rotation or scale,
  a compensating resize, and the anchor drag, and the size keys (whose start
  value is the anchor box, so none is dropped).
- **Toggles are session state**, default Center and Rect, not saved; no
  keyboard shortcuts.
- **Snapping**: rotation keeps 2a's Shift 15°; resize has only Shift-aspect.

## Known gaps

- A rotated group's Center box is approximate: its outline is the
  scene-axis box of its descendants, so `local_box` takes the box around
  that box mapped back.
- A layer's own 3D rotation (`rotationX`/`rotationY` without a projective
  perspective) is measured with the 2D part of `linear()`, so its box is
  the dropped-z box. Layers drawn through the homography have no box and
  fall back (Pivot, Scale, no anchor drag).
- A text's layout box is the rasterizer's whole-pixel box, so a text's
  implied anchor can be off by up to one raster pixel's fraction. A written
  `anchorX` stays exact, as the drag writes the received value plus the
  delta.
- The cross's lock tooltip shows on any hover, not only while Alt is held
  (the viewer has no window to read the modifiers from when it builds it).
- The Alt cursor over the cross updates through `on_modifiers_changed`; when
  the window does not have the focus it may wait for the next mouse move.
- A `rotation` or scale driven by an expression (`rotation={frame * 3}`) is
  `Locked`, not a `Keyframe`, so it does not trigger the `Animated`
  fallback: Center scaling on such a layer still writes literal `x`/`y`
  that keep the center on the current frame only.
- An absent side pinned by an edge drag is written at its current size
  without the field's clamp, and shows as unchanged in the drag's label
  (`height 75 → 75`): it is written, so the label is accurate, but it may
  read oddly.
- During a resize the drawn box (and its handles) is rebuilt from the
  drag's values and can trail the rendered layer by one move.
- Test coverage: the one-undo resize test runs at rotation 0, so it does
  not cover a compensated `y`; the skew compensation test is formula-level.
- Code nits: the box fold does not skip NaN; the test prop lists are
  `LazyLock` statics.
- The renderer's fallback for an anchor box that doesn't map (dropped, the
  region kept) has no test: no cheap scene puts only the anchor box behind
  a 3D plane's camera.
- `with_anchor_box` picks the layout by the innermost element's name
  (`primitive_of`), not by a registration.
- `drag_values` takes eight parameters (`#[allow(clippy::too_many_arguments)]`);
  folding `pivot` and `resize` into one tool argument is a follow-up.
- The toolbar's look (outline `ButtonGroup` in the ghost toolbar, radius 0)
  and whether `.text_color(muted)` overrides the gpui-kit `Button`'s
  variant color are not verified on screen; if it doesn't, the fallback
  label shows in the normal color.

## What 2d builds on

- `canvas_geometry`'s `layer_map`, `apply`, and `invert_affine` to map a
  text's `TextMetrics` (line starts, cluster edges and advances, in the
  layout box's own pixels) to the scene and back, through rotation, scale,
  skew, and `origin`, for the caret, the selection, and click hit tests.
- `anchor_box(frame)` for a `Text`: its layout box in own pixels
  (`HitRegion.anchor_box` / `LayerFrame.anchor_box` in the renderer), which
  the metrics are laid out in; the outline is padded and is not.
- `DragState` and the viewer's handle drawing, which 2d hides while
  editing.

## Verify by hand

In the editor, with **Select layers** on, on a scene of your own (the
feature tour has no editor-only content these tools supersede, so no
example changed):

- The toolbar shows "Center | Pivot" and "Rect | Scale" before **Select
  layers**, with Center and Rect selected; turning the mode off hides them.
- Rotate a `Rect` in Center mode: it turns about its middle, the label
  shows `rotation`, `x`, and `y`, and one undo restores it. Switch to
  Pivot: it turns about its top-left corner (the cross). Alt-drag the cross
  to the middle: nothing moves on screen, and `anchorX`, `anchorY`, `x`,
  `y` are written in one undo step. Rotate again in Pivot mode: it turns
  about the new anchor. With `originX={40}` set, Pivot mode turns about the
  cross 40 px to the right of the anchor.
- Hold Alt over the cross: the cursor becomes an open hand.
- Resize a rotated `Rect` from its left edge: `width`, `x`, `y` change and
  the right edge stays on screen; from its right edge only `width` changes.
  Shift on a corner keeps the aspect. Drag an edge through the opposite
  one: the box stops at 1 px and does not flip.
- Resize a `Circle` (or `Star`) from a corner: corner handles only,
  `radius` changes, the opposite corner stays.
- Drag a `Text`'s right edge: `maxWidth` is written in whole pixels,
  starting from `maxWidth` when set and from the longest line's width when
  absent (then inserted), and the text wraps; the left
  edge keeps the right one. Its handles sit on the text, not on the padded
  outline of a stroked text.
- Select a dashed `Rect` and rotate it 45°: the Rect-tool handles sit on its
  own corners, not on the scene-axis box; drag a corner outward and both
  sides grow.
- Select an `Image` with only `width` written: an edge drag writes `height`
  too, at its current value, and the other side does not change.
- Rotate a layer whose `x` is set at a component call, in Center mode: the
  rotation is written on the element and `x` at the call (two files; `y`
  goes to the call only if it is set there too, else to the element), and
  one undo restores both.
- On a keyframe frame, drag the right edge of a `Rect` with
  `width={interpolate(frame, [0, 30], [100, 200])}`: only the matching
  output entry changes.
- Select a layer with keyframed `x`: the toggle reads "Pivot (x, y not
  editable)", muted, with Pivot selected; the left and top edges (and the
  corners touching them) are hidden while the right and bottom ones resize;
  the cross is not Alt-draggable. Select a plain layer: Center shows again.
- Select a stroked `Text` with the Rect tool: the selection outline is drawn
  on its layout box, through the handles; with Scale it is the padded quad
  again. A `Rect` anchored at its middle with keyframed `x`: "Scale" is
  selected and muted, tooltip "x or y can't move".
- Select a layer with keyframed `rotation`, in Center mode: the toggle reads
  "Pivot", muted, with the tooltip "Rotation or scale is animated", and the
  rotation handle turns it about the pivot (the cross), writing `rotation`
  only. On a `Rect` with keyframed `width` anchored at its top-left, the
  left edge and the left corners are hidden; the right edge still resizes.
- Select a `Group`: "Scale" is selected and muted, its tooltip reads "No
  size to resize", and the 2a scale handles show; hover over the cross:
  "A group's anchor has no effect", and Alt-drag does nothing. A `Rect` with
  `height={h * 2}` reads "Height: Written as an expression: h * 2".
- Select a `Text` with `anchorY="baseline"`: the cross is drawn, Alt-drag
  does nothing, and its tooltip reads `Anchor Y: Written as an expression:
  "baseline"`.
- Alt-drag the cross of a stroked `Text` to the middle of its text:
  `anchorX` lands near 0.5 of the text's width (not of the padded quad),
  and the text does not move. Alt-drag the cross of a stroked `Ellipse` or
  `Circle`: the shape stays put, and after the reload it is exactly where
  the preview drew it.
- Hover the Pivot button on a layer turned in 3D in its own perspective
  (`rotationY={30} perspective={800}`): "No flat box to center on", and
  "Scale" is selected with "No flat box to resize".
- Undo each of the above: each is one step and restores the files it wrote
  byte for byte.
