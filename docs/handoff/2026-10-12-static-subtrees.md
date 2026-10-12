# Static subtrees (2026-10-12)

`<Static deps>` marks content that stays the same from frame to frame. Its
layers are walked, serialized and parsed once and reused until `deps`
change or React changes something inside it. 100,000 still rects inside it
cost 6.6 ms a frame from React to Rust, against 84.6 ms in a `React.memo`
component; see [`docs/performance/static-subtrees.md`](../performance/static-subtrees.md).
Design: [`docs/superpowers/specs/2026-10-12-static-subtrees-design.md`](../superpowers/specs/2026-10-12-static-subtrees-design.md).

## Pieces

- **`Static`** (`packages/react/src/components.ts`): `React.memo` of a
  component that renders host `static`, compared by `deps` only
  (`Object.is` per element; no `deps` means never changed).
- **Change tracking** (`packages/react/src/reconciler.ts`): every
  `HostNode` has `parent` and `changedAt`. Each mutation (append, insert,
  remove, `commitUpdate`) increments one counter (`hostRevision()`) and
  stamps the node and its ancestors, stopping at the first ancestor that
  already has the stamp.
- **Walk cache** (`packages/react/src/static.ts`, `staticLayer` in
  `render.ts`): one `StaticSubtrees` per mounted composition. A `<Static>`
  is reused while `changedAt <= walkedAt` and its tree path, `lang`, id
  prefix and compactness are unchanged; otherwise it is walked again under
  a new key and the old key is dropped. A definition holds nested
  `<Static>`s' layers inline, never references. Entries whose host node
  left the tree are dropped after each frame. Walking a `<Static>`'s
  children throws `<Static> cannot contain <TYPE>` for `video`, `audio`,
  `sequence`, `freeze-frame`, `rawLayers` and registered host elements.
- **Protocol:** a frame request may send `"statics": {"decoded": n}`.
  Then each `<Static>` is a `{"type":"staticRef","key":k}` layer, and the
  response adds `seq`, `statics` (a list of `{key, layers}` for every
  referenced key not yet known to be decoded) and `droppedStatics`.
  Without the request field, `<Static>` is a plain `group` with its layers
  (`--inspect`, component resolution, direct `renderAt` calls).
- **Bridge** (`crates/react-bridge/src/statics.rs`): `ReactBridge` keeps the
  definitions, replaces every `StaticRef` (in groups and masks too) with a
  `Group` of a copy of the cached layers in `decode_response`, drops keys,
  and records `seq`, which the next frame request sends as `decoded`.
  An unknown key fails with `ReactBridgeError::MissingStatic` and empties
  the cache, so the runtime sends every definition again.
- **`LayerContent::StaticRef`** only exists between Node and the bridge;
  the GPU renderer refuses it with `UnsupportedContent`, the CPU renderer
  with `RenderError::UnresolvedStatic`.

## Why acknowledgements rather than "the previous frame"

Frames can be requested out of order (seeking) and the exporter pipelines
them (Node renders frame N + 1 while Rust decodes N). A definition first
sent in frame `s` keeps being sent until a request reports `decoded >= s`.
A frame that is received but never decoded only causes a resend.

## Not done

- Caching a `<Static>`'s GPU work (drawing it once into a texture would
  change how blend modes inside it meet the backdrop).
- Finding unchanged subtrees without `<Static>`.
- `Group.layers` stays a `Vec`, so each frame copies the cached layers
  (about 3 ms for 100,000); sharing them would need an `Arc` in the scene
  model.
