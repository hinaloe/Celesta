# Property editing design

Part 2 of `2026-10-23-editor-element-editing-overview-design.md`. Builds on
design 1 (header, impact line, kept selection).

## Goal

A selected element's props can be edited in the Properties tab, the way
Unity's Inspector edits a component: text content, font, colors, size,
corner radius, opacity, image source, not only the transform. On the canvas,
a box can be resized edge by edge, and rotation turns about the point the
handles suggest. Values computed from others are edited at their inputs.
Props written at a component's call site (`<PriceTag label="…" x={40}>`) are
editable when the element inside reads them.

## Non-goals

- Inserting keyframes, or editing values between keyframes (as today).
- `interpolateColor()`, `spring()`, easing, gradients (`Paint` objects), and
  `dash` arrays: shown read-only.
- Rich text (`<Span>` children) and editing text on the canvas. Text is
  edited in the Properties tab.
- Path geometry (`Path`, `Polyline`, `Line` points, `Arrow` ends).
- Expressions deeper than one level of inputs (see [Inputs](#inputs)).
- Changing a prop's form (turning `x={W / 2}` into a literal). A locked value
  stays locked.

## Typed edit values (`crates/source-edit`)

`EditTarget` holds an `f64` today. It becomes generic over a value:

```rust
pub enum EditValue {
    Number(f64),
    String(String),
    Bool(bool),
}

pub enum EditTarget {
    Literal { span: Span, value: EditValue },
    Keyframe { span: Span, value: f64, frame: f64 },
    Missing { insert_at: u32, default: Option<EditValue> },
    PassThrough { call_site: ElementRef, prop: String, target: Box<EditTarget> },
    Locked(LockReason),
}
```

Recognized literal forms, besides the numeric ones resolved today:

| Form | Value | Written back as |
| --- | --- | --- |
| `name="text"`, `name={'text'}`, `` name={`text`} `` (no `${}`) | String | the same quote style; a value with that quote or a newline becomes `{"…"}` with JSON escapes |
| `name` (bare) | Bool(true) | `name` for true, `name={false}` for false |
| `name={true}` / `name={false}` | Bool | `{true}` / `{false}` |
| Text children: one JSXText, or one `{'…'}` child | String | JSXText when it has no `{`, `}`, `<`, `>` and no leading or trailing whitespace; otherwise `{"…"}` |
| `style={{ fontSize: 48 }}` (object literal property) | per property | the property's value |

Colors are strings; the panel validates them (`#RRGGBB`, `#RRGGBBAA`, or a
`<Theme>` color name). A const binding (`const LABEL = 'Sale'`) resolves as
numbers do today, with the same `SharedBinding` lock. The same comparison with
the received value runs for every type (`OverriddenByParent`). Today the
runtime reports only the six transform numbers as received props; the report's
`props` becomes the received value of every prop in the primitive's property
table, as JSON (finite numbers, strings, booleans; other values omitted), plus
`children` when it is a string.

`Text`'s `fontFamily`, `fontSize`, `fontWeight`, and `color` are shorthand for
`style`, and `style` wins. A Text row edits `style={{ … }}`'s property when
`style` is an object literal that sets it, and the shorthand otherwise. When
`style` is not an object literal (`style={mono(20, C.paper)}`), those rows are
locked ("May be set by `style`").

### Non-primitive elements

`resolve` locks every prop of a `component` element (`NotPrimitive`). That
stays for the selected element's own props, and is lifted where a later rule
resolves on a component element on purpose: the call site of a pass-through,
the "Component" section below, and design 4's timing windows (`Sequence`,
`Series.Sequence`).

Text children that are a JSXText split across lines are taken as React
renders them (whitespace collapsed); writing replaces the whole child span.

### Pass-through to the call site

When a prop's value is an identifier bound by the enclosing component's
destructured parameter (`function PriceTag({ label, x = 0 })`), the resolver
continues at that component's call site.

**Owner call site rule.** The source chain walks parent fibers, so its next
entry is not always the call of the component that wrote the element (an
element passed as `children` reports the component it was passed to, and
`'wrapper'` entries sit in between). The call site is the nearest `component`
entry above the element whose `name` equals the name of the function that
encloses the element in its file (`function PriceTag`, `const PriceTag = …`,
through `memo`/`forwardRef`). No such entry, or an anonymous function, locks
the prop ("Can't find where `PriceTag` is called"). At that call site:

- the call site writes the prop as a literal → `PassThrough` wrapping that
  literal's target;
- the call site omits it and the parameter has a literal default → `PassThrough`
  wrapping `Missing` at the call site, with that default;
- otherwise the call site's own rules apply (expression, spread, …), and their
  lock is reported with the call site's position.

Renamed destructuring (`{ label: text }`) and one level of `props.label`
(a parameter named `props`, read as `props.label`) are followed; anything else
is `UnresolvedIdentifier` as today. One hop only: a call site that itself
passes a parameter through is locked as `PassThrough` of a parameter
("Comes from `<Card>`'s caller").

Pass-through edits change one call site, so they change only the instances
that call site produces. Design 1's impact line counts them that way.

### Multi-file edits (`crates/editor`)

With pass-through, one gesture can touch two files: a Center-mode rotation
writes `rotation` in the component's file and `x`/`y` at the call site. Today
a commit writes one file (`TransformTargets.file`). Commits and `EditHistory`
entries hold every file an edit touches:

```rust
struct HistoryEntry { files: Vec<FileEdit> }
```

- Writing: every file is written to a temp file first, then all are renamed;
  if any temp write fails, none is renamed.
- Undo and redo check every file against `after` (or `before`); if any file
  changed outside Celesta, the whole entry is refused and dropped with the
  entries older than it for those files.
- The watched mtimes of all files are resampled after the write, as today for
  one file.
- The resolver is re-run against every file at commit time, as the drag
  commit does today; if any target moved, the commit aborts with "The source
  changed while editing".

## Property tables (`packages/react`, `packages/shapes`)

The editor needs, per primitive, the props it can edit and their types. They
are declared next to the components, so they cannot drift from the props
types:

```ts
// packages/react/src/property-tables.ts
export const primitiveProperties = {
  Rect: {
    size: { width: 'width', height: 'height' },
    groups: {
      Transform: { x: num(0), y: num(0), rotation: num(0), scale: num(1), anchorX: num(0), anchorY: num(0), opacity: num(1, 0, 1) },
      Size: { width: num(), height: num(), cornerRadius: num(0) },
      Appearance: { fill: color(), stroke: color(), strokeWidth: num(0) },
    },
  },
  // Group, Image, Text, Video, and @celesta/shapes' Ellipse, Circle,
  // Triangle, Polygon, Star, Pie, Heart
} satisfies PropertyTables;
```

- Field types reuse `ComponentPropertyField` (`string`, `number`, `boolean`,
  `color`, `select`, `path`) plus `text` for children.
- `size` names the props that hold the box: `width`/`height`, `radius`
  (uniform), or `maxWidth` (width only, for `Text`). Primitives without one
  (`Group`) have no resize handles.
- `@celesta/shapes` registers its tables through the same internal entry it
  uses for `markPrimitive`.
- The runtime sends the tables in the ready message, beside the component
  schemas; `ReactMetadata` gains `primitive_properties`.
- A Vitest type test checks every key against the component's props type, so
  a renamed prop fails the build.

## Properties tab

Under design 1's header, one section per group of the selected primitive's
table, in the table's order. Each row uses the existing Transform row states
(Literal, Keyframe, Between keyframes, Missing with the default dimmed,
Locked with its reason) and a control by type:

| Type | Control |
| --- | --- |
| number | numeric field; drag on the label scrubs it |
| string | single-line field |
| text | multi-line field; commits on Cmd+Enter or blur |
| boolean | switch |
| color | swatch with picker, or a theme-name field |
| select | dropdown |
| path | field plus "Choose…", copying outside files in with `import_path` |

A pass-through row shows a small `corner-down-right` icon and the call site
("Set at `Price.tsx:18`"). Commits go through the existing resolve, apply,
write, and history path; one committed field is one history entry.

When the selected element is a component call's root (the chain's nearest
component entry exists), a "Component" section lists the props written at that
call site, typed from their literals, or from `registerComponent()`'s schema
when the component is registered. Props the component reads through to a
primitive are not repeated there.

## Inputs

A prop whose value is an expression (`width={textWidth + padding * 2}`) is
still locked, and the row gains its inputs: each identifier in the expression
is resolved with the same rules (const, parameter pass-through), and those that
resolve to an editable target are listed under the row as editable sub-rows
("padding  16"). Identifiers that do not resolve are listed read-only with
their reason. One level only: an input that is itself an expression is not
expanded.

On the canvas, an axis whose size or position prop is locked has no handle for
that axis, as today. This is what keeps a label frame sized to its text from
being stretched.

## Canvas

### Pivot

Rotation and scale today turn about the layer's anchor (`x`/`y`), which is the
top-left corner for most primitives. They now turn about the center of the
layer's box by default, as the handles suggest:

- A viewer toolbar toggle, "Center" (default) / "Pivot", like Unity's. In
  Pivot mode they turn about the anchor, as today.
- In Center mode a rotation or scale also moves `x`/`y` so the box's center
  stays put: the anchor `p` becomes `c + R(Δθ)·(p − c)` for rotation, and
  `c + (p − c)·s` for scale, in parent space. Both writes are one edit.
- When `x` or `y` is locked or a keyframe, Center mode cannot keep the center
  (a keyframe would move at one keyframe only, and the element would orbit
  between them), so that drag uses the anchor, and the toggle shows
  "Pivot (x, y not editable)". The same applies to every compensation below:
  the left/top edge resize and the anchor drag need `x`/`y` targets that are
  `Literal` or `Missing` (directly or through pass-through).
- The anchor is always drawn as a small cross. Dragging the cross with Alt
  moves the anchor: it writes `anchorX`/`anchorY` (0–1 of the box) and moves
  `x`/`y` by the opposite offset so nothing moves on screen. `anchorY="baseline"`
  on `Text` is locked.

### Resize

Handles depend on a viewer toolbar tool, "Rect" (default) or "Scale":

- **Rect**: corner and edge handles change the `size` props. Dragging a left or
  top edge also moves `x`/`y` so the opposite edge stays (through the anchor and
  rotation). Shift keeps the aspect. `radius` primitives get corner handles only
  and resize uniformly; `Text` gets left and right edge handles changing
  `maxWidth`. A primitive without `size` props, or whose `size` props are
  locked, falls back to Scale.
- **Scale**: today's scale handles.

Rotation keeps its stem handle in both tools.

## Testing

Rust (`crates/source-edit`):

- Every literal form in the table, for read and write, including quote
  choice, escapes, JSXText rules, bare booleans, and `style` object
  properties.
- Pass-through: literal at the call site, missing with a default, renamed
  destructuring, `props.label`, a second hop locked, a spread at the call site;
  the owner call site found past a `'wrapper'` entry and past a component the
  element was passed to as `children`.
- `Text` shorthand versus a literal `style` object, and a non-literal
  `style` locking the shorthand rows.
- Inputs: an expression with one resolvable and one unresolvable identifier.

Rust (`crates/editor`):

- Multi-file history: undo restores both files; an outside change to one
  refuses the entry; a failed temp write renames nothing.
- Center-mode rotation and scale keep the center for a rotated, scaled parent;
  `x` as a keyframe falls back to the anchor.
- Anchor drag keeps the screen position.
- Edge resize with anchor 0 and 0.5, rotated.

TypeScript (Vitest):

- Property tables type test for every primitive.
- Tables reach the ready message.
- Received props carry strings, booleans, and string `children`.

Manual, with before/after screenshots of the same scene: edit a `Text`'s
content and font size, a `Rect`'s fill and corner radius, resize a `Rect` from
its left edge, rotate a `Rect` in Center mode, and edit a prop passed at a
component's call site.

## Documentation

- The React preview user docs: the Properties sections, pass-through rows,
  inputs, the Center/Pivot toggle, the Rect/Scale tools.
- A handoff note.
