# Properties sections (2026-10-24)

The Properties tab edits every prop a Celesta primitive declares, not only
its transform: one section per group of the primitive's property table
(Transform, then Size and Appearance for a `Rect`, Text and Layout for a
`Text`, Source and Size for an `Image`, …), a row per prop, and a control
per type (number, string, multi-line text, switch, menu, color, file). A
number row scrubs from its label, previewed through the runtime like a
canvas drag. A value computed from others lists its inputs as editable
sub-rows, a component call's own props get a "Component" section, and
`Text`'s font rows edit `style` when `style` sets them.
Design: `docs/superpowers/specs/2026-10-23-editor-property-editing-design.md`
(sections "Property tables", "Properties tab", "Inputs", and the `Text`
shorthand paragraph). This is part 2b; it builds on 2a
(`docs/handoff/2026-10-23-property-editing-engine.md`), and 2c–2d build the
canvas tools and inline text editing on it.
Plan: `docs/superpowers/plans/2026-10-24-editor-property-sections.md`.
User docs: `packages/website/content/{en,ja}/docs/01-(getting-started)/03-preview.md`
("Edit properties", and the lock reasons under "Move layers on the canvas").

## What changed

- Property tables (`packages/react/src/property-tables.ts`,
  `components.ts`, `internal.ts`; `packages/shapes/src/index.ts`;
  `packages/cli/src/cli.ts`): `propertyTable<XProps>({ size, groups })`
  declares, per primitive, its groups of `PrimitivePropertyField`s (`num`,
  `str`, `text`, `bool`, `color`, `select`, `path`) and the props that hold
  its box (`size`). Each table is typed with that primitive's own props, so
  a renamed prop fails `tsc -b`. `@celesta/react` registers `Group`,
  `Image`, `Text`, `Rect`, `Video` and `@celesta/shapes` registers `Ellipse`,
  `Circle`, `Triangle`, `Polygon`, `Star`, `Pie`, `Heart`, beside their
  `markPrimitive` loops. `listPrimitiveProperties()` turns them into ordered
  arrays (`WirePropertyTable`), and the ready message always carries them as
  `primitiveProperties`. `Path`, `Line`, `Polyline`, `Arrow`, and `Mask`
  have no table.
- Tables through the bridge (`crates/react-bridge/src/types.rs`,
  `protocol.rs`, `bridge.rs`; `crates/editor/src/preview.rs`, `source.rs`,
  `refresh.rs`, `view.rs`): `PrimitivePropertyTable { size, groups:
  Vec<PrimitivePropertyGroup { name, fields: Vec<PrimitivePropertyRow> }> }`
  keeps the declared order end to end; only the outer map
  (`ReactCompositionMetadata.primitive_properties`) is keyed by name.
  `apply_property_outcome` replaces the tables on a successful reload and
  keeps them on a failed one, as it does the project schema;
  `EditorView::primitive_table(name)` reads them.
- Source queries (`crates/source-edit/src/attributes.rs`, `resolve.rs`):
  `text_style_path` says which path a `Text` shorthand row edits
  (`style.<key>` or the shorthand) or locks it `StyleMaySet` ("May be set by
  `style`"); `written_attributes` lists a call's attribute names in source
  order without spreads, `key`, `ref`, and namespaced names;
  `resolve_call_site_prop` resolves a prop written at a component's call
  without comparing it to a received value (the runtime reports none for a
  component's own props).
- Inputs at the call site (`crates/source-edit/src/inputs.rs`,
  `pass_through.rs`, `scope.rs`): `resolve_inputs` takes the call site and
  resolves an input that is a parameter of the enclosing component as a
  `PassThrough`, with 2a's parameter rules in one place
  (`resolve_parameter`). The expression the inputs are read from is the span
  `resolve` locked on, recorded where it locks (`Gather::lock_expression`)
  instead of re-derived (`locked_span` is gone). Names bound inside the
  expression hide reads only in their own function body, reads of one name
  inside the expression count as one place for `SharedBinding`, and only a
  callee or tag that is a name or a static chain of names (`f`,
  `Math.max`) is skipped (`fns[i](x)` lists `fns` and `i`).
- Element targets keyed by prop (`crates/editor/src/element_edit.rs`, was
  `transform_edit.rs`): `PropKey` is `Prop(table key)`, `Input { row, name
  }`, or `CallSite(name)`. A `Target` holds the file, the resolved `path`
  (`fontSize`, `style.fontSize`, `children`), the `EditTarget`, the call
  site, and, on an `Expression`-locked row, its inputs. `resolve_targets`
  resolves every table row in order (`scaleX`/`scaleY` in `scale`'s place
  when either is written; the transform props alone without a table), locks
  a literal of another kind than its field as `Expression`, lists inputs,
  and fills `ElementTargets.component` (`ComponentTargets`) when the owner
  call site is found. `commit_files` writes typed `EditValue`s for any key
  and re-resolves rows, inputs, and component props against every file it
  read. `TransformProp::received` is gone (`received_number` reads the
  received props); `ElementEdit` (was `TransformEdit`) records written
  values of any type; `commit_element` (was `commit_transform`) takes
  `(PropKey, EditValue)` pairs.
- Component section (`element_edit.rs`): the attributes written at the
  owner call site, minus `children` and any `param` a row or input already
  passes through to, typed from their literal (number, string, boolean) or,
  when `registerComponent()` registered the tag, from its schema
  (`type_component_props`, `apply_component_schema`), which locks a value of
  another kind and gives a number its range.
- Shared controls (`crates/editor/src/property_controls.rs`):
  `ControlKind`, `ControlEvent`, `Control`, `build_control`, and
  `render_control` build and draw the text, multi-line text, switch, select,
  color, and path controls for both the project Properties panel
  (`property_panel.rs`, `property_panel_view.rs`) and the element rows. The
  project panel keeps its own `Value` commit flow.
- Rows (`crates/editor/src/element_rows.rs`, `element_rows_view.rs`,
  `layer_panel.rs`; `transform_rows.rs` is gone): one `inspector_section`
  per table group, a row per target with its control, the keyframe and lock
  icons, "Set at `<file>`:`<line>`", the lock reason or keyframe jumps, and
  the row's message; inputs indented under their row; then "Component ·
  `<Tag>`" with the call's "Set at" line and its rows. `row_text` picks the
  value or the dimmed placeholder, `parse_row_value` the typed value or the
  message. A typed field commits on Enter or blur; a switch, a menu choice, a
  picked color (when the picker closes), and "Choose…" commit at once; each
  commit is one `commit_element` call and one history entry. The label
  column (`LABEL_WIDTH`) is 84 px, shared with the header rows.
- Label scrub (`element_rows.rs`, `element_rows_view.rs`,
  `transform_drag.rs`): dragging an editable number row's label changes it
  by `scrub_value` (the field's `step` per pixel, else 0.01 for a field
  with `max` ≤ 1, else 1; Shift ×10; clamped to `min`/`max`), sends
  each frame with a prop override at the row's write position, and writes
  once on release. `override_sites` returns a site per editable `PropKey`,
  at the row's resolved path, so drags and scrubs share it.
- `style.<key>` overrides (`packages/react/src/jsx-dev-runtime.ts`): an
  override whose prop is `style.fontSize` sets that key in a copy of the
  element's `style` (a new object when none is written), at most one copy per
  element, and never mutates the written props.
- One temp writer (`crates/react-bridge/src/props_edit.rs`,
  `crates/editor/src/edit_history.rs`): `celesta_react_bridge::write_temp`
  writes `.<name>.tmp-<pid>` beside the file; `replace_file` and the
  multi-file history both use it.

## Decisions

These differ from, or settle what the spec left open:

- **Table fields are their own type.** `PrimitivePropertyField` has
  `ComponentPropertyField`'s types plus `text`, no `label` (the row label is
  the key in words: `cornerRadius` → "Corner radius", `children` → "Text",
  `src` → "Source"), and an optional default.
- **`Text` shorthands map to `style.fontFamily`, `style.fontSize`,
  `style.fontWeight`, and `style.fill`** (`color` fills `fill`). The row
  edits the `style` property when the object's own properties set it, and the
  shorthand otherwise, inserting `fontSize={48}` beside a `style` that does
  not set it. It locks `StyleMaySet` when `style` is not an object literal,
  when a spread in the object may set the key (`{ fontSize: 48, ...base }`;
  `{ ...base, fontSize: 48 }` edits the object), and when the element has a
  spread with no `style` written after it (`rest.style` may win).
- **No `style`-only rows.** The `Text` table carries only props with a
  shorthand, so 2a's `NoStyleObject` lock never shows here.
- **Colors** accept `#RRGGBB`, `#RRGGBBAA`, or a theme color name
  (`^[A-Za-z][A-Za-z0-9_-]*$`) written as typed; the picker shows no color
  for a name.
- **A literal of another kind than its field locks as `Expression`** with
  its source (`anchorY="baseline"` on the Anchor Y row), for table rows and
  for schema-typed Component props alike.
- **Placeholder of an absent prop:** the source's default (a parameter's),
  else the received value, else the table's default. A scale axis written
  on the element shows the received `scale`; a pass-through to a `Missing`
  with a default shows that default.
- **Number ranges:** a typed value outside `min`/`max` is refused ("Enter a
  number from 0 to 1"; "of at least {min}" or "of at most {max}" when only
  one bound is set); a scrub clamps.
- **Impact scoping and "Can't move" stay transform-only.** `written_at` and
  `locked_summary` look at `x`, `y`, `rotation`, `scale`, `scaleX`, and
  `scaleY`, so the impact line is the one 2a shipped; editing `fill` written
  on the element changes every instance even when the line is scoped to one
  call.
- **No table** (a primitive without one): the Transform section from the
  transform props, as 2a.
- **Path rows** write `import_path(entry_dir, entry_dir, chosen)`; "None"
  writes `""` over a written path and nothing for a `Missing` one.
- **Scrubs** preview like a drag, write once on release, and do nothing on
  Escape or a release without movement, or with the value back where it
  started. Input rows, locked rows, and keyframe rows do not scrub;
  Component number rows do, overriding the attribute at the call site.
- **Scrub steps are declared by the fields.** A number field may declare
  `step` (`num(1, { step: 0.01 })`; a component schema's `step` for a
  Component row): the tables declare 0.01 for `scale`, `anchorX`, and
  `anchorY` in every Transform group and for `Video`'s `playbackRate` and
  `volume`, unbounded ratios and fractions where 1 per pixel is unusable.
  Without a step, a field with `max` ≤ 1 steps 0.01 and any other 1. The
  transform rows without a table give `scale`, `scaleX`, and `scaleY` a
  field with step 0.01.
- **Where a scrub starts, and the focus.** A scrub on a row with no value
  starts from the placeholder the row shows (the source's default, else the
  received value, else the table's default), and from 0 only when there is
  none. A scrub and a canvas drag end each other without writing, and
  neither starts while a released one is still being written. Pressing a
  label moves the keyboard focus to the editor, so `⌘ Z` right after a scrub
  undoes it (a row's text field takes `⌘ Z` as its own undo), unless another
  row holds typed text: that field keeps the focus and its text, neither
  lost nor submitted (`scrub_takes_focus`).
- **Component section:** the attributes at the owner call site in source
  order, without `key`, `ref`, spreads, `children`, and the props a row
  above shows with "Set at"; locked rows for anything but a literal. It is
  hidden when nothing is left. Its rows show no received value or table
  default as a placeholder.
- **The call-site file is read whenever the owner call site is found**, for
  the Component section, so it is in `files`: a commit of any row is refused
  with "The source changed while editing" when the call's props moved
  meanwhile.
- **Inputs are not checked against received values.** The runtime reports
  the expression's result, not its inputs, so an input whose value is
  `interpolate(frame, …)` locks `FrameUncertain`.
- **Self-closing `<Text />` stays locked.** `TextProps.children` is
  required, so `<Text />` does not type-check; the 2a handoff's "2b opens
  the tag" is withdrawn.
- **The multi-line text control is `Control::Textarea`** (gpui-base's
  `InputState` is single-line only): Enter submits, Shift+Enter breaks the
  line, it grows from one to six lines.
- **Each row parses on its own**, about twenty parses per selection on the
  background executor; parses are not cached.

2a carry-overs closed: inputs that are parameters resolve at the call site;
the lambda, one-place, and callee gaps in `resolve_inputs`; the scale-axis
placeholder of a parameter default (`({ sx = 3 }) => <Rect scale={2}
scaleX={sx} />` shows 3); the duplicated readers (`TransformProp::received`,
`locked_span`); and the temp writer `edit_history.rs` copied.

## Known gaps

- A row that passes through to an expression at the call site
  (`<Tag x={a + b} />`) lists no inputs: inputs are read from the element's
  own expression.
- A change to the registered component schemas alone re-types the Component
  section only on the next resolution (the next selection or reload).
- The commit's stale check replays the resolved rows' keys, so a switch
  between `scale` and `scaleX` in the source is caught only when a span
  moves; the write still lands on the target it resolved.
- The multi-line control is about 12 px taller than the small single-line
  rows (gpui-component 0.6.6's `Textarea` has no size API); its label is
  top-aligned.
- 2a's `useMemo` limitation applies to scrubs as to drags: an element cached
  with `useMemo` at an override's position follows the first frame only.
- Pressing Enter in another row's focused field during a scrub commits that
  field, and the scrub's release then fails as unavailable ("Select the
  layer again").

## What 2c–2d build on

- 2c (Pivot, Resize): the tables' `size` (`width`/`height`, `radius`, or
  `maxWidth` for `Text`) names the props the resize handles change;
  `PropKey` and `commit_element` write any of them with the transform in
  one history entry; `override_sites` previews any `PropKey`, so a resize
  drag can override `width` as a move overrides `x`.
- 2d (inline text editing): the `children` row's target and its `text`
  field, `Control::Textarea`'s Enter / Shift+Enter handling as the model for
  the canvas editor, and the shared controls for anything 2d adds to the
  tab.

## Verify by hand

In the editor, on a scene of your own (the feature tour has no editor-only
content these rows supersede, so no example changed):

- Select a `Rect`: Transform, Size, and Appearance sections show. Pick a new
  fill with the picker; the file gets `fill="#…"` when the picker closes.
  Drag the Corner radius label: the preview follows before release, Shift
  moves faster, and one write happens on release. Escape mid-drag writes
  nothing.
- Type into a field without pressing Enter, then drag another number row's
  label: the field keeps the focus and its text, and the ↔ cursor stays for
  the whole scrub, even when the pointer leaves the label.
- Commit a field with Enter, then drag a number row's label and press `⌘ Z`
  right after releasing: the scrub's write is undone without clicking the
  preview first. Drag the Anchor X label: 10 px moves it by 0.1.
- Select a `Text`: in the Text row, Shift+Enter breaks the line without
  committing; Enter commits. With `style={{ fontSize: 40 }}` on it, change Font size:
  the object's `fontSize` changes, not a new attribute.
- Select an element whose `width` is computed
  (`width={textWidth + padding * 2}`): the row is locked and lists
  `textWidth` and `padding`; edit `padding` (at the call site when it is a
  prop of the component, with its "Set at" line).
- Select a layer inside a component called as
  `<PriceTag label="Sale" />`: the "Component · PriceTag" section lists
  `label`; edit it, and only the call site changes.
- Undo each of the above: each is one step and restores the file it wrote
  byte for byte.
