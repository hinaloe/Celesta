# Triangles, polygons, stars, pies, and hearts (#296)

```tsx
import { Heart, Path, Pie, Polygon, Star, Triangle, starPath } from '@celesta/shapes';

<Pie x={960} y={540} anchorX={0.5} anchorY={0.5} radius={200} endAngle={sweep} fill="#4DD8C0" />
<Path x={300} y={300} commands={starPath({ radius: 80, points: 5, cornerRadius: 6 })} fill="#FFD84D" />
```

`<Triangle>`, `<Polygon>`, `<Star>`, `<Pie>`, and `<Heart>`
(`packages/shapes/src/index.ts`) each return one `<Path>`; there is no new
renderer primitive, so preview, export, CPU, GPU, and `@celesta/web` draw
them as any path. `trianglePath`, `polygonPath`, `starPath`, `piePath`, and
`heartPath` return the commands the components draw.

- Sizing follows `<Circle>`: polygons, stars, and pies take `radius` and a
  `2 * radius` square box; triangles and hearts take `width`/`height`. As
  for `<Rect>`/`<Ellipse>`, `x`/`y` place the box's anchor (the commands
  are shifted by `-anchor * size`, since a path layer has no anchor) and
  gradient `Paint`s are box-local. Generators measure from the box's
  top-left, so `<Path x y commands={starPath(o)}>` equals `<Star x y {...o}>`.
  Remotion's `@remotion/shapes` sizes shapes the same natural way (radius,
  inner/outer radius, side length) but returns an SVG string plus its
  bounding box; here the result is plain `PathCommand[]`, so it can be
  mapped over, or interpolated once path morphing (#298) lands.
- The stroke is centred on the outline, as for `<Path>`, not inset like
  `<Ellipse>`'s: an inset stroke cannot keep a star's mitred tips inside
  the box anyway, and centring keeps a component identical to its
  generator's commands drawn with `<Path>`.
- Angles are degrees clockwise from 12 o'clock (the same unit as
  `rotation`). Polygons and stars start at 12 o'clock. `<Pie>` runs from
  `startAngle` to `endAngle`, counter-clockwise when the end is smaller;
  equal angles return no commands (the component returns `null`) and a
  difference of 360° or more is a whole circle with no sides.
- `cornerRadius` replaces each corner with an arc tangent to both sides,
  drawn as cubics of at most a quarter turn (`k = 4/3 tan(θ/4)`, as for
  ellipses). An arc reaches at most halfway along either side, and its
  radius shrinks to fit. A pie's rim corners are circles of radius `r`
  centred `R - r` from the centre, touching the side `sqrt(R² - 2Rr)` out;
  `r` is capped at `3R/8` (so they stay in the outer half of each side,
  clear of the centre corner) and at `R·m/(1 + m)` with
  `m = sin(min(sweep/2, 90°))` (so the two never cross on the rim). Both
  caps shrink to 0 with the sweep, so an animated rounded pie has no jump.
  A reflex pie's centre corner is concave and rounds the same way as a
  star's inner corners. `<Heart>` has no corners to round.
- The heart is six cubics mirrored about the middle, with every control
  point inside the box and the curve touching its left, right, top, and
  bottom edges.
- `packages/cli/examples/with-more-shapes.tsx` shows every shape and
  generator; `packages/shapes/test/closed-shapes.test.mjs` tests the
  generators directly and the components through the CLI.
