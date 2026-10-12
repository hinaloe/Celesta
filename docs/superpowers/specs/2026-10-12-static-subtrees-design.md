# Static subtrees design

## Goal

A composition whose layers mostly stay the same from frame to frame still
pays for every layer on every frame: React re-renders it, the walk turns it
into layers, `JSON.stringify` writes it, and Rust parses it. Measured on an
Apple M4 with 100,000 still rects and 100 moving ones (production React):

| | Render and walk | `JSON.stringify` |
| --- | ---: | ---: |
| Without `React.memo` | 85–170 ms | 21–42 ms |
| With the still rects in a `React.memo` component | 26–37 ms | 21–22 ms |

Rust then spends about 50 ms parsing the 25 MB frame, and the GPU renderer
about 15 ms preparing it. With memo, React stops re-rendering the still
part, but the walk, the JSON, and the parse still repeat. Cloning 100,000
parsed layers in Rust takes 3 ms, against 50 ms to parse them.

`<Static>` marks a subtree as the same from frame to frame. Its layers are
walked, serialized, and parsed once and reused until its `deps` change or
React changes something inside it.

```tsx
import { Static } from '@celesta/react';

<Static deps={[theme, data]}>
  <Background />
  {labels.map((label) => <Label key={label.id} {...label} />)}
</Static>
<MovingParts />
```

Out of scope: caching a subtree's GPU work (drawing it once into a texture
changes how its blend modes meet the backdrop), and finding unchanged
subtrees without `<Static>`.

## React API (`@celesta/react`)

```ts
export interface StaticProps {
  /** The subtree is the same until one of these changes (`Object.is`). */
  deps?: readonly unknown[];
  children?: ReactNode;
}
export function Static(props: StaticProps): ReactElement;
```

- `<Static>` is `React.memo` with a comparison of `deps` alone, element by
  element with `Object.is`; `children` is not compared, since a parent that
  re-renders creates new child elements every frame. Without `deps` the
  subtree stays the same for as long as it is mounted. A `deps` array of a
  different length counts as changed.
- Components inside can still re-render when a context they read changes
  (`useCurrentFrame()` reads one). That is allowed and stays correct: any
  change React makes inside the subtree is detected, and the subtree is
  walked and sent again. It only stops being reused.
- In the scene, `<Static>` is one `Group` layer with the identity transform,
  opacity 1, normal blending, and no effects, whose layers are its
  children's. Its id is its tree path, like any unnamed layer. To move it,
  wrap it in a `<Group>`.
- `<Static>` cannot contain anything whose layers depend on the time: a
  `<Video>`, `<Audio>`, `<Sequence>`, `<FreezeFrame>`, `rawLayers`, project
  timeline elements, or any element registered with `registerHostElement`.
  The walk fails the frame with `<Static> cannot contain <Video>` (naming
  the host type). Rects, paths, text, images, `<Instances>`, `<Group>`
  (including clips and masks), and effects are allowed.
- `<Static>` may nest; an inner one is reused on its own, and an outer one
  that is reused carries the inner one's layers with it.

## Node side

### Change tracking (`packages/react/src/reconciler.ts`)

`HostNode` gains `parent: HostNode | null` and `changedAt: number`. One
module-level counter is incremented by every mutation:
`appendInitialChild`, `appendChild`, `insertBefore`, `removeChild`, their
container forms, `commitUpdate`, and `commitTextUpdate`. The mutated node
and its ancestors get `changedAt = counter`, stopping at the first ancestor
that already has it. `appendInitialChild`, `appendChild`, and
`insertBefore` set the child's `parent`; removing a child clears it.

### Walk (`packages/react/src/render.ts`)

- New host type `static`.
- Per `static` host node, the walk keeps
  `{ key, layers, walkedAt, lang, idPrefix, compact }`.
- The cache is used when the node's `changedAt <= walkedAt` and `lang`,
  `idPrefix`, and `compact` match the walk context. Otherwise the children
  are walked as usual (checking for forbidden host types), a new key from a
  counter shared by the mounted composition replaces the old one, and the
  old key joins the frame's dropped keys.
- When the frame was asked for with `statics` (see below), a `<Static>` is
  emitted as `{ id, transform, content: { type: 'staticRef', key } }` and
  its key joins the frame's referenced keys. Otherwise it is emitted as a
  `group` whose `layers` are the cached layers, so other callers (older
  bridges, `--inspect`, component resolution, direct `renderAt` calls) see
  the same scene as before.
- `renderAt(time, project, options)` gains
  `options.statics?: { decoded: number }` and returns, besides `scene` and
  `audio`, `statics?: { seq: number; defined: Record<number, Layer[]>;
  dropped: number[] }`.

### Which definitions a frame carries (`packages/cli/src/cli.ts`)

- Every frame answered with `statics` gets the next `seq` (1, 2, …).
- The walk records, per key, the `seq` of the first frame that carried its
  definition. A frame carries the definition of every key it references
  whose definition was never sent, or was first sent in a frame after
  `decoded`.
- `decoded` is the last `seq` Rust has finished decoding, sent with each
  frame request. Frames that Rust received but never decoded therefore only
  cause a definition to be sent again.
- The frame message adds `"seq": n`, `"statics": { "<key>": [layers] }`
  (left out when empty), and `"droppedStatics": [keys]` (left out when
  empty).

## Wire and scene model

### Request

`Request` (Rust → Node) gains `statics: Option<StaticsRequest>`, sent only
by frame requests: `{ "statics": { "decoded": n } }`.

### Scene model (`celesta-composition`)

```rust
LayerContent::StaticRef { key: u32 }
```

JSON `{"type":"staticRef","key":7}`, deserialized through the tagged
mirror like the other variants. It only travels inside the bridge: a
`Scene` returned by `ReactBridge` never contains it. A renderer that meets
one fails: the GPU renderer with `UnsupportedContent { content: "static
reference" }`, the CPU renderer with a new `RenderError::UnresolvedStatic {
layer }`.

### Bridge (`celesta-react-bridge`)

`ReactBridge` keeps `statics: HashMap<u32, Vec<Layer>>` and `decoded: u64`
(0 at spawn). Decoding a frame response (`scene_at`,
`scene_at_with_project`, `evaluate_at`, `evaluate_past_end`,
`decode_frame`):

1. inserts every definition in `statics`;
2. replaces each `StaticRef { key }` layer, in the scene's layers, group
   children, and mask layers at any depth, with the same layer whose
   content is `Group { layers: statics[key].clone(), clip: None, mask: None }`;
3. removes every key in `droppedStatics`;
4. sets `decoded` to the message's `seq`.

A key that is not in the cache fails the frame with
`ReactBridgeError::MissingStatic(key)` and resets `decoded` to 0 and the
cache to empty, so the next request makes Node send every definition
again.

## Errors

| Condition | Where | Error |
| --- | --- | --- |
| A time-dependent element inside `<Static>` | walk | frame error `<Static> cannot contain <…>` |
| A referenced key missing from the cache | bridge | `ReactBridgeError::MissingStatic(key)`; cache reset |
| A `StaticRef` reaching a renderer | renderers | `UnsupportedContent` (GPU), `UnresolvedStatic` (CPU) |

## Testing

- **React:**
  - With `statics`, the first frame defines the key; a later frame whose
    `decoded` covers that definition only references it; one whose
    `decoded` does not, defines it again.
  - Changing `deps` gives a new key and drops the old one.
  - A component inside that calls `useCurrentFrame()` gives a new key on
    every frame, with the right layers.
  - A different `lang` above it gives a new key.
  - Without `statics`, the scene has the children inline in a `group`.
  - Each forbidden host type fails the frame with its name.
  - Nested `<Static>`s.
- **Rust (`react-bridge` unit tests):** definitions and references expand
  at the top level, in groups, and in masks; dropped keys are removed; a
  missing key fails with `MissingStatic` and resets `decoded` and the
  cache.
- **Node integration:** for an entry with a still `<Static>`, a changing
  one, and moving layers outside, every frame's expanded `Scene` equals
  the scene of the same entry with `<Static>` replaced by a fragment, both
  through `scene_at` and through `submit_frame`/`receive_frame`/
  `decode_frame`.

## Benchmarks and done criteria

A React entry `crates/react-bridge/examples/static-100k.tsx`: 100,000 still
rects in one `<Static>` and 100 moving rects outside. On the Apple M4:

- `protocol-bench` from the second frame on: **≤ 30 ms** per frame (about
  110 ms today with the still rects in a `React.memo` component).
- The first frame: no more than 10% slower than the same entry without
  `<Static>`.
- NEBULA, SPECTRA, and reel `protocol-bench` and `celesta-bench` within
  noise, and the last frame of each `celesta-bench` workload
  byte-identical.

## Documentation

- `docs/handoff/2026-10-12-static-subtrees.md`
- `docs/performance/static-subtrees.md`: the measurements above, before and
  after.
- `skills/celesta/references/performance.md` and `react-core.md`: when to
  wrap content in `<Static>`, `deps`, and what it cannot contain.
