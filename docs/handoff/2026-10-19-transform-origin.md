# Transform origin (2026-10-19)

Issue #410. A `Group` turned about its own origin (top-left), and that point
was also its vanishing point, so turning a scene about the middle of the
screen needed two nested groups, which a transition's `present()` cannot
return. Every layer now takes an `origin`, and the built-in `flip` and
`cube` take an opt-in `perspective`.

## Model

- `EvaluatedTransform.origin: Point` (`crates/composition/src/model.rs`),
  default (0, 0) and omitted from JSON there; `Transform.origin` in project
  files is an animatable point, validated finite. React's props are
  `originX`/`originY`.
- It is an offset in the layer's own pixels from its anchor (from a group's,
  path's, or instances layer's own origin). The matrix becomes
  `T(position + origin) · P · L · T(−origin)`: the layer turns, scales,
  and skews about `position + origin`, which is also the perspective's
  vanishing point, and stays at `position` when `L` is the identity, so
  unlike the anchor it never moves the layer. It is exactly a group at
  `position + origin` holding a group at `−origin`.
- `EvaluatedTransform::homography()` folds the origin in, so every
  projective path (planes, hit tests, raster sizing) follows it unchanged.
  The affine paths build their translation from
  `EvaluatedTransform::translation(&linear)` (`position + origin − L·origin`)
  instead of `position`: `Affine::from_transform` and `prepare_visible_layer`
  in the GPU renderer, the CPU renderer's position-and-scale state, and the
  web renderer's `layerMatrix` and `projection.ts`'s `homography`/`translation`.
- `Layer` grew from 368 to 384 bytes (`layers_stay_small`).
- The MCP layer summary and `skills/celesta/scripts/inspect.mjs` print
  `origin (x, y)` when it is set.

## Transitions

- `TransitionSceneStyle` is `GroupProps`, so `present()` can return
  `{ originX: width / 2, originY: height / 2, rotationY, perspective }`.
- `flip({ perspective })` turns each scene about the series' centre with
  `rotationY` (or `rotationX` from the top or bottom), the `from` edge coming
  forward. `cube({ perspective })` turns both faces about the edge they
  share: each face's origin is on that edge, so both have the same
  vanishing point. The edge crosses the series so the gaps either side are
  in proportion to the faces' drawn widths. Without `perspective` both draw
  as before.
- `packages/cli/examples/with-3d-transition.tsx` shows a custom `tumble`,
  `flip({ perspective })`, and `cube({ perspective })`.

## Checks

- `celesta-composition`: an origin equals the nested groups, the vanishing
  point, the affine translation, and the JSON default.
- GPU: a group turned about its origin renders identically to the nested
  groups, projective and flat. CPU: a group scaled about its origin.
- Web: the projection math and the drawn matrix.
- React: `originX`/`originY` serialize as `origin`. Transitions: the 3D flip
  and cube styles.
