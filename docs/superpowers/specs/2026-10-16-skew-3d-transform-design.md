# Skew and 3D transform design (issue #300)

## Goal

A layer's transform has position, scale, rotation, and anchor only. It
cannot lean (skew), turn over like a card, or recede in depth. This adds
`skewX`/`skewY`, `rotationX`/`rotationY`, a `perspective` distance, and
`backfaceVisibility` to every layer and `Group`.

```tsx
// A card that turns over: the group turns, each face hides when it faces away.
<Group x={960} y={540} rotationY={angle} perspective={1200}>
  <Rect x={-200} y={-280} width={400} height={560} fill="#f4efe6" backfaceVisibility="hidden" />
  <Group rotationY={180} backfaceVisibility="hidden">
    <Rect x={-200} y={-280} width={400} height={560} fill="#1d3557" />
  </Group>
</Group>
```

Each layer is one plane. Children are flattened into their parent's plane
(CSS `transform-style: flat`); there is no depth sorting between children,
which keep painter's order. Depth sorting, per-particle 3D in `Instances`,
and a 3D `Camera` are out of scope.

## Scene model (`celesta-composition`)

```rust
pub struct EvaluatedTransform {
    pub position: Point,
    pub scale: Point,
    /// Clockwise rotation in degrees (about the Z axis).
    pub rotation: f64,
    pub anchor: Point,
    /// Degrees, as CSS `skew(x, y)`. Default (0, 0).
    pub skew: Point,
    /// Degrees about the X and Y axes, as CSS `rotateX()`/`rotateY()`.
    /// Default 0.
    pub rotation_x: f64,
    pub rotation_y: f64,
    /// Viewing distance in pixels for this layer's own 3D rotation, as CSS
    /// `perspective()`. `None` projects orthographically.
    pub perspective: Option<f64>,
    /// Default `Visible`.
    pub backface_visibility: BackfaceVisibility,
}

pub enum BackfaceVisibility { Visible, Hidden }
```

- JSON: `skew`, `rotationX`, `rotationY`, and `perspective` are omitted at
  their defaults; `EvaluatedTransform` already fills missing fields from
  `Default`, so existing scenes and compact React frames are unchanged.
  `backfaceVisibility` is omitted when `visible`. It lives in the transform
  rather than on `Layer` (as CSS `backface-visibility` only matters under a
  transform), which also keeps the many `Layer` literals in tests unchanged.
- A `perspective` that is not finite and positive is treated as `None` by
  the renderers.
- ts-rs exports `BackfaceVisibility`; `pnpm run codegen` regenerates
  `packages/react/src/generated/`, and `scene.ts` re-exports it.

### Matrix

In a layer's local units (after the anchor offset, as today), a point
`(x, y, 0, 1)` maps through

```
M = T(position) · P(perspective) · Rx(rotationX) · Ry(rotationY) · Rz(rotation) · K(skew) · S(scale)
```

- `Rz` is today's rotation: `[[cos, -sin], [sin, cos]]` in y-down
  coordinates, clockwise on screen.
- `K = [[1, tan(skew.x)], [tan(skew.y), 1]]`, CSS `skew()`.
- `Rx`, `Ry` are CSS `rotateX()`/`rotateY()`; Z points at the viewer, so a
  positive `rotationY` turns the right edge away.
- `P` sets `w = 1 - z / perspective`.

Dropping the Z row and column of `M` gives a 3x3 homography `H` from local
points to the parent's plane. Without a perspective, or when the 3D
rotations leave Z at 0, `H`'s bottom row is `(0, 0, 1)` and the transform is
affine: skew and orthographic 3D rotation are affine (`rotationY = θ` alone
is `scaleX(cos θ)`). Only a perspective with a 3D rotation makes a layer
projective.

A `Group` has no size, so it turns about its own origin, and the vanishing
point of its perspective is that origin; any other layer turns about its
anchor, which is also its vanishing point.

### Facing

`backfaceVisibility: 'hidden'` skips a layer, and its whole subtree for a
group, when its back faces the viewer. Facing is decided from the
accumulated 3D orientation, not from the flattened drawing matrix, so a
parent's 3D rotation counts (the card example above):

- Each layer's linear part `L = Rx · Ry · Rz · K · S` (3x3, no perspective or
  translation) accumulates as `O = O_parent · L`.
- The layer faces away when the Z component of its transformed normal,
  `cofactor_zz(O) / det(O)`, is negative. A mirror (`scaleX = -1`) leaves it
  positive, as in CSS; `rotationY = 180` makes it negative.
- Perspective does not take part. For planes far from their vanishing point
  this can differ from CSS, which tests the full matrix; within the scope
  (each plane projected about its own anchor) the two agree.

## Project files (`celesta-project`, `celesta-evaluator`)

- `Transform` gets `skew: Option<AnimatablePoint>`, `rotationX`,
  `rotationY`, and `perspective: Option<Animatable<f64>>`, evaluated like
  `rotation`.
- `Transform` also gets `backfaceVisibility: Option<BackfaceVisibility>`
  (not animated), copied onto the evaluated transform.
- Validation: the new numbers must be finite; `perspective`, when set, must
  be positive at every keyframe.

## React (`@celesta/react`)

`CommonProps` gets `skewX`, `skewY`, `rotationX`, `rotationY`,
`perspective`, and `backfaceVisibility`, documented with the matrix order,
the pivot, and the flattening rule. `extractTransform` reads them;
`compactTransform` leaves them out at their defaults. A non-positive or
non-finite `perspective` is left out (orthographic). `rawTransform` passes
them through. `Instances` keeps per-particle `x`/`y`/`rotation` only; the
layer's own new props apply to the layer as a whole.

## GPU renderer

### Affine layers

`Affine::from_transform` builds the top-left 2x2 of `L` plus the
translation, so skew and orthographic 3D rotation take the existing path:
rects, paths, text raster scale, clips, hit regions, and instancing work as
they do for a non-uniform scale. A layer edge-on to the viewer is
degenerate and draws nothing, as now.

`LayerState` also carries `O` (for facing) and whether a projective
ancestor's plane is being drawn into.

### Projective layers

A projective layer is drawn through a canvas in its own plane, as browsers
composite 3D transforms:

1. **Raster frame.** Its content is prepared with a base transform
   `Scale(s) · Translate(-origin)` in place of the parent's, onto a canvas
   in local units. Clips of the layer's own group work in that frame as
   today; ancestors' clips apply when the canvas is drawn.
2. **Raster scale.** The content is prepared twice. The first pass, in
   local units, only measures its bounds (text is measured without being
   rasterized) and is then rolled back. The bounds are clipped to the
   half-plane `w ≥ 1/16` (the part in front of the viewer, and not so close
   it fills the screen) and to the part of the plane the parent's canvas can
   show. `s` is the largest stretch of the parent-to-target transform times
   `H` at the clipped polygon's corners, rounded up to an eighth of an octave
   as text raster scales are, so the nearest, most magnified part keeps one
   texel per output pixel and text and paths stay sharp. `s` is lowered so
   that the canvas stays within the device's maximum texture dimension. The
   second pass prepares the content for real at `s`.
3. **Projected draw.** The canvas draws onto its parent as one layer with
   the layer's opacity and blend mode, like an isolated group's canvas. The
   vertex shader writes clip-space `(x·w, y·w, 0.5·w, w)`, so the rasterizer
   interpolates the texture coordinates with perspective correction and
   clips away the part behind the viewer.
4. **Filtering.** GPU canvases have no mips, and a projection minifies
   unevenly and anisotropically, so the fragment shader averages a grid of
   bilinear taps spanning the pixel's footprint in the canvas (from the
   texture coordinates' screen derivatives), up to 8 by 8, so the far side
   minifies without aliasing.
5. **Every projective layer goes through a canvas**, a texture leaf (image,
   video, PSD, text) included; one path for every content type.
6. **Effect sizes inside a plane.** A blur, shadow, or glow inside a
   projective layer is measured in output pixels as it would be without the
   3D part, so it does not jump as `s` changes: its sizes are multiplied by
   `s` over the largest stretch at the layer's origin (where the plane's
   pixels are `s` per local unit and the output's that stretch).

A projective group is isolated (as CSS transforms make a stacking context):
its children's blend modes blend within it. Effects (`blur`, `shadow`,
`glow`, filters) on a projective layer still apply in output pixels after
the projection, as they do today after any transform. A projective layer
inside a projective layer nests canvases.

### Hit testing

A projective canvas is a hit region of its own: the pointer maps through the
inverse homography (rejecting `w ≤ 0`) into the raster frame, where the
children's hit regions are tested as today.

## CPU reference renderer

It already refuses rotation. It also refuses a nonzero skew, `rotationX`, or
`rotationY` with a new `RenderError::UnsupportedTransform { layer, property }`.
`perspective` alone changes nothing (no 3D rotation) and is accepted.
Without 3D rotation nothing faces away, so `backfaceVisibility` needs no
handling.

## Web renderer (`@celesta/web`)

`scene-canvas.ts` mirrors the GPU renderer:

- `Transform` gets the new fields, `backfaceVisibility` included.
- Affine layers multiply the 2x2 of `L` into the `DOMMatrix`.
- Facing is computed from the accumulated `O` as above.
- A projective layer draws its content into an offscreen canvas in the raster
  frame (scale chosen as above), then into the parent through the inverse
  homography, pixel by pixel over the projected bounding box, averaging
  bilinear taps over each pixel's footprint as the GPU shader does. The math and the
  warp live in a new DOM-free `projection.ts`.

## Other consumers

- `celesta-mcp`'s layer summary describes skew, 3D rotation, perspective, and
  hidden backfaces.
- The website reference (en, ja) documents the new props; a handoff note
  `docs/handoff/2026-10-16-skew-3d-transform.md` records the model and the
  checks.

## Example

`packages/cli/examples/with-3d-transform.tsx`: a card that turns over with
text and a path on both faces, cards leaning with `skewX`, and a row of
tiles tilted back with `rotationX` and a perspective, so sharpness at the
near and far edges can be checked.

## Testing

- `celesta-composition`: JSON round trip and defaults of the new fields;
  the matrix and facing math (identity, skew, `rotationY` 180 vs
  `scaleX` -1, accumulation through a parent).
- `celesta-project`/`celesta-evaluator`: reading, validation, animation.
- GPU pixel tests: skew of a rect and text; orthographic `rotationY` equal to
  the matching `scaleX`; a projective rect's corners at the projected
  positions; a projective text layer staying sharp (edge contrast near the
  near edge); hidden backfaces in a flipped group; nested projective groups;
  a clip inside and outside a projective group; a layer partly behind the
  viewer; hit testing through a projection.
- CPU renderer: the new refusals.
- `@celesta/web`: the matrix, facing, and inverse-homography warp live in a
  React- and DOM-free `projection.ts` with node tests on plain pixel
  arrays (the corners of a warped square, the far edge's tap count, pixels
  behind the viewer left untouched); `scene-canvas.test.mjs` checks that
  hidden backfaces are skipped and a projective layer goes through an
  offscreen canvas. The card example is also checked by eye in the website
  playground against the GPU export.
- React: prop extraction and compaction.
- Before/after screenshots of the example scene for the PR (AGENTS.md).
