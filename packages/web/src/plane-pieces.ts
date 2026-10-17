/**
 * Draws a plane's canvas through its homography with Canvas 2D: the
 * projected quad split into triangles, each drawn by `drawImage` through an
 * affine map that strays at most `AFFINE_ERROR` target pixels from the
 * projection, filtered as `layer.wgsl`'s footprint filter is from halved
 * copies of the canvas and sub-pixel passes. `warp` draws only the band
 * along the near clip and what no such filter fits. DOM-free: it draws
 * through the `Surface` it is given.
 */
import { NEAR_W, boxOf, clipPolygon, corners, invert3, multiply3, project, warp } from './projection';
import type { Box, Matrix3 } from './projection';

/** The farthest an affine piece of a plane strays from where the plane projects, in target pixels. */
const AFFINE_ERROR = 0.5;
/**
 * How far a piece's filter may be wider or narrower than the GPU's at its
 * corners, as a ratio of the spreads' square roots, before it is split.
 */
const BLUR_RATIO = 1.35;
/** How far a piece's filter may be off the GPU's at its centre, likewise. */
const COPY_RATIO = 1.25;
/** What `filterRatio` grows spreads by, in target pixels squared: a spread of a quarter of a pixel. */
const SPREAD_SLACK = 0.25 ** 2;
/**
 * The width, in target pixels, of the band along the near clip that `warp`
 * draws, so the clip is a hard edge pixel by pixel there, as on the GPU.
 */
const NEAR_BAND = 3;
/** A piece no longer than this on the target, in pixels, is drawn as it is though its filter is off. */
const SMALLEST_PIECE = 8;
/** The most times a piece is halved; one still straying too far is warped. */
const MAX_SPLITS = 32;
/** The most times the canvas is halved along either axis. */
const MAX_LEVEL = 8;
/** The most taps the GPU's footprint filter takes along either side of a pixel, as `layer.wgsl`'s `footprint_taps`. */
const MAX_TAPS = 8;
/** How far each affine piece is drawn past its sides, in target pixels, over its neighbours. */
const OVERLAP = 1;
/**
 * How far past its polygons `warp` draws, in target pixels: over every pixel
 * an affine piece beside them reaches into, `OVERLAP` and its antialiasing.
 */
const WARP_REACH = 2;
/**
 * How far past its boundaries a band's canvas holds its content, in target
 * pixels (`planeBands`'s `seam`): the pixel `drawBand` grows its strip by and
 * that pixel's antialiasing, and, as the band's plane is drawn whole, room
 * for its pieces' `OVERLAP`, the pixel more a layered piece holds, and
 * `warp`'s reach where the canvas ends, and half a pixel's footprint.
 */
export const PLANE_SEAM = 1 + 1 + OVERLAP + 1 + WARP_REACH + 0.5;

/** The part of a plane a band holds: its `w` from `near` to `far`, `null` where unbounded. */
export type DepthRange = [number | null, number | null];

/**
 * The part of the target `box` where `toSource` (target pixels to a plane's
 * pixels) shows the plane's `w` within `depth`, grown by `by` target pixels:
 * a convex polygon, as `1/w` is affine in target pixels (`toSource`'s
 * bottom row). Empty when none of it is in `box`.
 */
export function bandStrip(toSource: Matrix3, [near, far]: DepthRange, box: Box, by: number): [number, number][] {
  const [g, h, i] = toSource[2];
  const q = ([x, y]: [number, number]) => g * x + h * y + i;
  const slack = by * Math.hypot(g, h);
  let strip = corners(box);
  if (far !== null) strip = clipPolygon(strip, p => q(p) - 1 / far + slack);
  if (near !== null) strip = clipPolygon(strip, p => 1 / near + slack - q(p));
  return strip.length >= 3 ? strip : [];
}

/**
 * Draws the band `depth` of a plane: the plane drawn whole from `source`,
 * the band's canvas, onto a layer of its own, which then replaces what is
 * on `target` within the band's strip grown by a pixel (`bandStrip`):
 * cleared there, then added, the clip's coverage blending it with what is
 * there. Clipping the plane's pieces at the band instead would leave slivers
 * along it that filter unlike their neighbours. The band's canvas holds its
 * content `PLANE_SEAM` pixels past the strip, so at a seam both bands are
 * right, and a pixel either draws, or both in part, is.
 */
function drawBand(target: Surface, source: Surface, toSource: Matrix3, box: Box, surface: (width: number, height: number) => Surface, depth: DepthRange): void {
  const strip = bandStrip(toSource, depth, box, 1);
  if (!strip.length) return;
  const [left, top, right, bottom] = box;
  const layer = surface(target.canvas.width, target.canvas.height);
  drawPlane(layer, source, toSource, box, surface);
  const path = new Path2D();
  strip.forEach(([x, y], k) => (k ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clip(path);
  target.globalCompositeOperation = 'destination-out';
  target.fillRect(left, top, right - left, bottom - top);
  target.globalCompositeOperation = 'lighter';
  target.drawImage(layer.canvas as never, 0, 0);
  target.restore();
  layer.canvas.width = 0;
}

/**
 * A triangle of a plane drawn by an affine map: its corners on the target;
 * the map from the source's pixels onto them, in `setTransform`'s order
 * `a, b, c, d, e, f`; the copy of the source it reads, halved `level[0]`
 * times across and `level[1]` times down; and its passes, `passes[0]`
 * across by `passes[1]` down (each 1, 2, or 4), evenly spaced along each
 * side of a target pixel with a spread (standard deviation) of `spread[0]`
 * and `spread[1]` target pixels.
 */
export type AffinePiece = {
  corners: [number, number][];
  transform: [number, number, number, number, number, number];
} & Filter;

/** A plane split into what draws through affine maps and what `warp` draws: see `planePieces`. */
export type PlanePieces = {
  affine: AffinePiece[];
  /** Convex polygons on the target that `warp` draws. */
  warped: [number, number][][];
  /** The whole target pixels `warp` draws, and the whole source pixels it reads; `null` when nothing is warped. */
  target: Box | null;
  source: Box | null;
};

/**
 * A point of a plane: in the source and on the target, its `w`, and the
 * steps in source pixels of a target pixel's sides there (`toSource`'s
 * Jacobian's columns, as `warp` takes them).
 */
type Vertex = { s: [number, number]; t: [number, number]; w: number; columns: [[number, number], [number, number]]; gpu?: Spread };

/** How a piece's filter matches the GPU's: the copy it reads and its passes, as `AffinePiece` has them. */
type Filter = { level: [number, number]; passes: [number, number]; spread: [number, number] };

/** How many passes a piece may take along either side of a pixel. */
const PASSES = [1, 2, 4];

/** The target offsets of `count` passes along a side with a spread of `spread` target pixels, evenly spaced. */
function passOffsets(count: number, spread: number): number[] {
  if (count === 1) return [0];
  const even = Math.sqrt((1 - 1 / (count * count)) / 12);
  return Array.from({ length: count }, (_, k) => ((k + 0.5) / count - 0.5) / even * spread);
}

/** A symmetric 2×2 matrix `[xx, xy, yy]`: the spread (covariance) of a filter, in pixels squared. */
type Spread = [number, number, number];

/**
 * The spread, along a side of a pixel stepping `step` source pixels, of the
 * GPU's footprint filter's taps (`layer.wgsl`'s `footprint_color`): `taps`
 * of them evenly across the side, as a fraction of it squared.
 */
function tapSpread(step: number): number {
  const crossed = Math.ceil(step);
  const taps = crossed > 1 ? Math.min(crossed, MAX_TAPS) : 1;
  return (1 - 1 / (taps * taps)) / 12;
}

/**
 * The spread of a bilinear tap, along an axis, on the copy of the source
 * halved `level` times along it: the box of `2^level` source pixels the
 * halvings average, then the tap's tent of a pixel of that copy. Only
 * halvings: each averages pairs of pixels, which cancels the finest detail,
 * where shrinking by another factor would alias it.
 */
const levelSpread = (level: number) => (3 * 4 ** level - 1) / 12;

/**
 * The least and the most that the spread `ours` is of `gpu` along any
 * direction: the roots of `det(ours − λ·gpu)`.
 */
function spreadRange([a0, a1, a2]: Spread, [b0, b1, b2]: Spread): [number, number] {
  const qa = b0 * b2 - b1 * b1, qb = -(a0 * b2 + a2 * b0 - 2 * a1 * b1), qc = a0 * a2 - a1 * a1;
  const root = Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc));
  return [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)];
}

/**
 * `J⁻¹ · diag(x, y) · J⁻ᵀ` at `v`: a spread of `x` across and `y` down the
 * source, in target pixels. The rows of `J⁻¹` are `(yy, −yx) / det` and
 * `(−xy, xx) / det`.
 */
function onTarget(v: Vertex, x: number, y: number): Spread {
  const [[xx, xy], [yx, yy]] = v.columns;
  const det = xx * yy - yx * xy, d2 = det * det;
  return [(yy * yy * x + yx * yx * y) / d2, -(yy * xy * x + yx * xx * y) / d2, (xy * xy * x + xx * xx * y) / d2];
}

/**
 * The spread of the GPU's filter at `v` in target pixels: its taps across
 * the footprint, each a tent of spread 1/6 each way in source pixels.
 */
function gpuSpread(v: Vertex): Spread {
  if (v.gpu) return v.gpu;
  const [[xx, xy], [yx, yy]] = v.columns;
  const [a, b, c] = onTarget(v, 1 / 6, 1 / 6);
  return v.gpu = [a + tapSpread(Math.sqrt(xx * xx + xy * xy)), b, c + tapSpread(Math.sqrt(yx * yx + yy * yy))];
}

/**
 * How far the spread `ours` (in target pixels) is from `gpu`'s, the larger
 * of the ratios either way along some direction. Where `ours` is wider,
 * both are grown by `SPREAD_SLACK` every way first: the eye does not see a
 * filter widen by a small part of a pixel, which a copy widens it by where
 * the source is minified across a pixel's footprint but not along it. A
 * narrower filter aliases, so that ratio has no slack.
 */
function spreadRatio(ours: Spread, gpu: Spread): number {
  const [low] = spreadRange(ours, gpu);
  const [, high] = spreadRange([ours[0] + SPREAD_SLACK, ours[1], ours[2] + SPREAD_SLACK], [gpu[0] + SPREAD_SLACK, gpu[1], gpu[2] + SPREAD_SLACK]);
  return low > 0 && high > 0 ? Math.max(high, 1 / low) : Infinity;
}

/** How far `filter`'s spread at `v` is from the GPU filter's (`spreadRatio`). The passes run along the target's axes. */
function filterRatio(v: Vertex, filter: Filter): number {
  const [a, b, c] = onTarget(v, levelSpread(filter.level[0]), levelSpread(filter.level[1]));
  return spreadRatio([a + filter.spread[0] ** 2, b, c + filter.spread[1] ** 2], gpuSpread(v));
}

/**
 * The filter at `v`, or `null` when none fits: a copy, and along each side
 * of the pixel no passes or as few (`PASSES`) as make up the GPU's taps'
 * spread along that side past the copy's while staying within two copy
 * pixels' reach of each other, or they would skip detail the copy keeps,
 * and alias it. Its spread must be within `COPY_RATIO` of the GPU's every
 * way (`filterRatio`). Of those, the one with the fewest passes, each a
 * `drawImage`, then the nearest.
 */
function filterAt(v: Vertex): Filter | null {
  const [[xx, xy], [yx, yy]] = v.columns;
  if (!(Number.isFinite(xx * yy - yx * xy) && xx * yy - yx * xy !== 0)) return null;
  const steps = [Math.sqrt(xx * xx + xy * xy), Math.sqrt(yx * yx + yy * yy)];
  const [tapsAcross, tapsDown] = steps.map(tapSpread);
  // The GPU's spread in source pixels along each axis, and in target pixels.
  const gpuX = xx * xx * tapsAcross + yx * yx * tapsDown + 1 / 6, gpuY = xy * xy * tapsAcross + yy * yy * tapsDown + 1 / 6;
  const [g0, g1, g2] = gpuSpread(v);
  // A source spread of 1 across, and of 1 down, in target pixels.
  const [x0, x1, x2] = onTarget(v, 1, 0), [y0, y1, y2] = onTarget(v, 0, 1);
  // Copies up to one halving past the GPU's spread along each axis.
  const most = (spread: number) => {
    let level = 0;
    while (level < MAX_LEVEL && levelSpread(level) < spread) level++;
    return level;
  };
  let best: Filter | null = null, bestScore = Infinity;
  for (let kx = 0, lastX = most(gpuX); kx <= lastX; kx++) {
    for (let ky = 0, lastY = most(gpuY); ky <= lastY; ky++) {
      const sx = levelSpread(kx), sy = levelSpread(ky);
      // The copy's spread in target pixels, and the passes' along each
      // side making up the GPU taps' spread past the copy's tent's.
      const c0 = sx * x0 + sy * y0, c1 = sx * x1 + sy * y1, c2 = sx * x2 + sy * y2;
      const wantedAcross = Math.sqrt(Math.max(0, tapsAcross - (sx - 1 / 6) * x0 - (sy - 1 / 6) * y0));
      const wantedDown = Math.sqrt(Math.max(0, tapsDown - (sx - 1 / 6) * x2 - (sy - 1 / 6) * y2));
      // Along each side: no passes, or the fewest whose neighbours are
      // within two copy pixels' reach of each other, in source pixels.
      // A copy pixel's reach along a side `(x, y)` is
      // `hypot(2^kx·x, 2^ky·y) / |(x, y)|` source pixels, and passes `apart`
      // target pixels are `apart · |(x, y)|` source pixels apart.
      const passes = (wanted: number, [x, y]: [number, number]) => {
        const reach = 2 * Math.hypot(2 ** kx * x, 2 ** ky * y);
        return PASSES.find(count => count > 1 && passApart(count) * wanted * (x * x + y * y) <= reach) ?? 0;
      };
      const across = passes(wantedAcross, v.columns[0]), down = passes(wantedDown, v.columns[1]);
      for (const countAcross of across ? [1, across] : [1]) {
        for (const countDown of down ? [1, down] : [1]) {
          const a = countAcross > 1 ? wantedAcross * wantedAcross : 0, d = countDown > 1 ? wantedDown * wantedDown : 0;
          const ratio = spreadRatio([c0 + a, c1, c2 + d], [g0, g1, g2]);
          // The fewest passes, then the nearest.
          const score = countAcross * countDown + Math.log(ratio);
          if (ratio <= COPY_RATIO ** 2 && score < bestScore) {
            best = { level: [kx, ky], passes: [countAcross, countDown], spread: [countAcross > 1 ? wantedAcross : 0, countDown > 1 ? wantedDown : 0] };
            bestScore = score;
          }
        }
      }
    }
  }
  return best;
}

/** How far apart `count` passes spreading 1 are, the step between neighbours (see `passOffsets`). */
const passApart = (count: number) => 1 / count / Math.sqrt((1 - 1 / (count * count)) / 12);

/**
 * Splits the plane `toSource` maps the target onto, a `sourceWidth` ×
 * `sourceHeight` canvas, into pieces drawn two ways, over the part of it
 * landing in the target's `box`. Triangles draw through an affine map
 * interpolating their corners, which strays at most `AFFINE_ERROR` target
 * pixels from the projection, with a filter (`filterAt`, the one at their
 * centre) within `BLUR_RATIO` of the GPU's at their corners: what
 * `drawImage` does, many times faster than `warp`. A band along the near
 * clip is left to `warp`, and so is a piece no filter fits. Each piece is
 * split across a side until it fits. Every corner is a projected source
 * point, and a homography keeps lines straight, so the pieces tile the
 * plane's image exactly.
 */
export function planePieces(toSource: Matrix3, sourceWidth: number, sourceHeight: number, box: Box): PlanePieces {
  const toParent = invert3(toSource);
  const affine: AffinePiece[] = [];
  const warped: [number, number][][] = [];
  const reads: Box[] = [];
  const pieces = (): PlanePieces => {
    const shown = boxOf(warped.flat());
    const read = boxOf(reads.flatMap(([l, t, r, b]) => [[l, t], [r, b]]));
    if (!shown || !read) return { affine, warped: [], target: null, source: null };
    const by = WARP_REACH + 1;
    const target: Box = [
      Math.max(box[0], Math.floor(shown[0] - by)), Math.max(box[1], Math.floor(shown[1] - by)),
      Math.min(box[2], Math.ceil(shown[2] + by)), Math.min(box[3], Math.ceil(shown[3] + by)),
    ];
    const source: Box = [
      Math.max(0, Math.floor(read[0])), Math.max(0, Math.floor(read[1])),
      Math.min(sourceWidth, Math.ceil(read[2])), Math.min(sourceHeight, Math.ceil(read[3])),
    ];
    return target[2] > target[0] && target[3] > target[1] && source[2] > source[0] && source[3] > source[1]
      ? { affine, warped, target, source }
      : { affine, warped: [], target: null, source: null };
  };
  const all = (): PlanePieces => {
    // Without a sane inverse, `warp` draws all of it.
    warped.push(corners(box));
    reads.push([0, 0, sourceWidth, sourceHeight]);
    return pieces();
  };
  if (!toParent) return all();
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = toSource;
  const vertex = (s: [number, number]): Vertex => {
    const [tx, ty, w] = project(toParent, s[0], s[1]);
    const ws = m20 * tx + m21 * ty + m22;
    const sx = (m00 * tx + m01 * ty + m02) / ws, sy = (m10 * tx + m11 * ty + m12) / ws;
    return { s, t: [tx, ty], w, columns: [[(m00 - sx * m20) / ws, (m10 - sy * m20) / ws], [(m01 - sx * m21) / ws, (m11 - sy * m21) / ws]] };
  };
  const leave = (vertices: Vertex[]) => {
    warped.push(vertices.map(v => v.t));
    // The footprints of the pixels `warp` draws, a pixel or so past the
    // polygon, generously: a footprint grows towards the horizon.
    for (const { s: [x, y], columns: [[xx, xy], [yx, yy]] } of vertices) {
      const rx = 4 * (Math.abs(xx) + Math.abs(yx)) + 3, ry = 4 * (Math.abs(xy) + Math.abs(yy)) + 3;
      reads.push(Number.isFinite(rx + ry) ? [x - rx, y - ry, x + rx, y + ry] : [0, 0, sourceWidth, sourceHeight]);
    }
  };
  const row = (r: number, [x, y]: [number, number]) => toParent[r][0] * x + toParent[r][1] * y + toParent[r][2];
  // What lands in the box, a little past it so no edge drawn shows.
  const [left, top, right, bottom] = [box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2];
  let polygon = clipPolygon(corners([0, 0, sourceWidth, sourceHeight]), p => row(2, p) - NEAR_W);
  polygon = clipPolygon(polygon, p => row(0, p) - left * row(2, p));
  polygon = clipPolygon(polygon, p => row(1, p) - top * row(2, p));
  polygon = clipPolygon(polygon, p => right * row(2, p) - row(0, p));
  polygon = clipPolygon(polygon, p => bottom * row(2, p) - row(1, p));
  if (polygon.length < 3) return pieces();
  // The near band: `toSource`'s `w` is `1 / NEAR_W` at the clip and changes
  // by `slope` per target pixel, so the band is `NEAR_BAND` pixels wide up
  // to the plane's `w` of `band`.
  const slope = Math.hypot(m20, m21);
  const band = 1 / (1 / NEAR_W - NEAR_BAND * slope);
  if (!(band > 0 && Number.isFinite(band))) return all();
  const near = clipPolygon(polygon, p => band - row(2, p));
  if (near.length >= 3) leave(near.map(vertex));
  const far = clipPolygon(polygon, p => row(2, p) - band).map(vertex);
  const stack: [Vertex, Vertex, Vertex, number][] = [];
  for (let i = 1; i + 1 < far.length; i++) stack.push([far[0], far[i], far[i + 1], 0]);
  const length = (p: Vertex, q: Vertex) => Math.hypot(q.t[0] - p.t[0], q.t[1] - p.t[1]);
  // The farthest an affine map strays along a side from where the plane
  // projects: `|√w_p − √w_q| / (√w_p + √w_q)` of its length, at the point
  // `√w_q / (√w_p + √w_q)` of the way.
  const stray = (p: Vertex, q: Vertex) => {
    const a = Math.sqrt(p.w), b = Math.sqrt(q.w);
    return Math.abs(a - b) / (a + b) * length(p, q);
  };
  // Whether `filter` spreads within `BLUR_RATIO` of the GPU's filter at `v` every way.
  const matches = (v: Vertex, filter: Filter) => filterRatio(v, filter) <= BLUR_RATIO ** 2;
  while (stack.length) {
    const [a, b, c, splits] = stack.pop()!;
    const area = (b.s[0] - a.s[0]) * (c.s[1] - a.s[1]) - (c.s[0] - a.s[0]) * (b.s[1] - a.s[1]);
    if (!(Math.abs(area) > 1e-9)) continue;
    const sides: [Vertex, Vertex, Vertex][] = [[a, b, c], [b, c, a], [c, a, b]];
    const strays = sides.map(([p, q]) => stray(p, q));
    const worst = strays.indexOf(Math.max(...strays));
    const centre = vertex([(a.s[0] + b.s[0] + c.s[0]) / 3, (a.s[1] + b.s[1] + c.s[1]) / 3]);
    const centreStray = Math.hypot(centre.t[0] - (a.t[0] + b.t[0] + c.t[0]) / 3, centre.t[1] - (a.t[1] + b.t[1] + c.t[1]) / 3);
    const straight = strays[worst] <= AFFINE_ERROR && centreStray <= AFFINE_ERROR;
    const filter = straight ? filterAt(centre) : null;
    if (straight && !filter) {
      // No copy and passes stand in for the GPU's filter here: warped exactly.
      leave([a, b, c]);
      continue;
    }
    const longest = sides.reduce((x, y) => (length(y[0], y[1]) > length(x[0], x[1]) ? y : x));
    const small = length(longest[0], longest[1]) <= SMALLEST_PIECE;
    if (filter && (small || [a, b, c].every(v => matches(v, filter)))) {
      const transform = affineMap(a, b, c);
      if (transform) affine.push({ corners: [a.t, b.t, c.t], transform, ...filter });
      else leave([a, b, c]);
      continue;
    }
    if (splits >= MAX_SPLITS) {
      leave([a, b, c]);
      continue;
    }
    const [p, q, r] = straight ? longest : sides[worst];
    const m = vertex([(p.s[0] + q.s[0]) / 2, (p.s[1] + q.s[1]) / 2]);
    stack.push([p, m, r, splits + 1], [m, q, r, splits + 1]);
  }
  return pieces();
}

/** The affine map taking the source corners of a triangle to its target corners, as `setTransform` takes it; `null` when it is degenerate. */
function affineMap(a: Vertex, b: Vertex, c: Vertex): AffinePiece['transform'] | null {
  const s1x = b.s[0] - a.s[0], s1y = b.s[1] - a.s[1], s2x = c.s[0] - a.s[0], s2y = c.s[1] - a.s[1];
  const t1x = b.t[0] - a.t[0], t1y = b.t[1] - a.t[1], t2x = c.t[0] - a.t[0], t2y = c.t[1] - a.t[1];
  const det = s1x * s2y - s2x * s1y;
  // The target sides times the inverse of the source sides.
  const ma = (t1x * s2y - t2x * s1y) / det, mc = (t2x * s1x - t1x * s2x) / det;
  const mb = (t1y * s2y - t2y * s1y) / det, md = (t2y * s1x - t1y * s2x) / det;
  const e = a.t[0] - ma * a.s[0] - mc * a.s[1], f = a.t[1] - mb * a.s[0] - md * a.s[1];
  const transform: AffinePiece['transform'] = [ma, mb, mc, md, e, f];
  return transform.every(Number.isFinite) ? transform : null;
}

/**
 * The convex polygon of the points within `by` of `corners` along each axis:
 * their sum with a square, which grows a sliver by `by` and no more.
 */
function grown(corners: [number, number][], by: number): [number, number][] {
  const points = corners.flatMap(([x, y]) => [[x - by, y - by], [x + by, y - by], [x + by, y + by], [x - by, y + by]] as [number, number][]);
  points.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  // Andrew's monotone chain.
  const cross = (o: [number, number], p: [number, number], q: [number, number]) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const half = (ordered: [number, number][]) => {
    const chain: [number, number][] = [];
    for (const point of ordered) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(points), ...half([...points].reverse())];
}

/** Marks in `mask`, a `width` × `height` grid of pixels, those whose centres lie within `reach` of the convex `polygon`. */
function cover(mask: Uint8Array, width: number, height: number, polygon: [number, number][], reach: number): void {
  let doubled = 0;
  polygon.forEach(([px, py], i) => {
    const [qx, qy] = polygon[(i + 1) % polygon.length];
    doubled += px * qy - qx * py;
  });
  if (!(Math.abs(doubled) > 0)) return;
  const sign = Math.sign(doubled);
  // Each side as `a·x + b·y + c ≥ 0` inside, moved out by `reach`.
  const sides = polygon.map(([px, py], i) => {
    const [qx, qy] = polygon[(i + 1) % polygon.length];
    const a = sign * (py - qy), b = sign * (qx - px);
    return [a, b, -(a * px + b * py) + reach * Math.hypot(a, b)];
  });
  const shown = boxOf(polygon)!;
  const x0 = Math.max(0, Math.floor(shown[0] - reach)), x1 = Math.min(width, Math.ceil(shown[2] + reach));
  const y0 = Math.max(0, Math.floor(shown[1] - reach)), y1 = Math.min(height, Math.ceil(shown[3] + reach));
  for (let y = y0; y < y1; y++) {
    const cy = y + 0.5;
    let low = x0 + 0.5, high = x1 - 0.5;
    for (const [a, b, c] of sides) {
      const rest = b * cy + c;
      if (a > 0) low = Math.max(low, -rest / a);
      else if (a < 0) high = Math.min(high, -rest / a);
      else if (rest < 0) high = -Infinity;
    }
    for (let x = Math.max(x0, Math.ceil(low - 0.5)), end = Math.min(x1 - 1, Math.floor(high - 0.5)); x <= end; x++) mask[y * width + x] = 1;
  }
}

/**
 * Draws what `pieces` leaves to `warp` onto `target`, which holds the
 * target's pixels in `pieces.target`, replacing what is there: the warp is
 * exact, and its pixels include those the affine pieces beside it reach
 * into, and those past the near clip, where nothing draws.
 * `source` holds the source's pixels in `pieces.source`.
 */
export function warpPieces(source: Uint8ClampedArray, target: Uint8ClampedArray, toSource: Matrix3, pieces: PlanePieces): void {
  if (!pieces.target || !pieces.source) return;
  const [left, top, right, bottom] = pieces.target, [sourceLeft, sourceTop, sourceRight, sourceBottom] = pieces.source;
  const width = right - left, height = bottom - top;
  const mask = new Uint8Array(width * height);
  for (const polygon of pieces.warped) cover(mask, width, height, polygon.map(([x, y]) => [x - left, y - top]), WARP_REACH);
  for (let i = 0; i < mask.length; i++) if (mask[i]) target.fill(0, i * 4, i * 4 + 4);
  const shifted = multiply3(multiply3([[1, 0, -sourceLeft], [0, 1, -sourceTop], [0, 0, 1]], toSource), [[1, 0, left], [0, 1, top], [0, 0, 1]]);
  warp(source, sourceRight - sourceLeft, sourceBottom - sourceTop, target, width, shifted, [0, 0, width, height], mask);
}

/** What `drawPlane` draws with: the part of `CanvasRenderingContext2D` it uses. */
export interface Surface {
  readonly canvas: { width: number; height: number };
  globalAlpha: number;
  globalCompositeOperation: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clip(path: Path2D): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: never, dx: number, dy: number, dw?: number, dh?: number): void;
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
  createImageData(width: number, height: number): { data: Uint8ClampedArray };
  putImageData(image: never, x: number, y: number): void;
}

/** A copy of the source, a source pixel `scale` of its pixels along each axis, drawn `offset` of them in from its top left. */
type Level = { surface: Surface; offset: [number, number]; scale: [number, number] };

/**
 * Draws `source`, a plane's canvas, onto `target`, which is transparent,
 * where `toSource` (from target pixels to source pixels) projects it inside
 * `box`, as `warp` and the GPU's footprint filter do: see `planePieces`.
 * `surface` makes a canvas of a size. With `depth`, only that band of the
 * plane is drawn, onto a target other bands may have drawn onto already
 * (see `drawBand`).
 */
export function drawPlane(target: Surface, source: Surface, toSource: Matrix3, box: Box, surface: (width: number, height: number) => Surface, depth?: DepthRange): void {
  if (depth) {
    drawBand(target, source, toSource, box, surface, depth);
    return;
  }
  const pieces = planePieces(toSource, source.canvas.width, source.canvas.height, box);
  // Each copy draws the one before it at half the size along an axis, a
  // pixel in, so a bilinear tap at each new pixel's centre averages a pair
  // of pixels, and the copy keeps a transparent pixel round it as the source
  // does.
  const levels = new Map<string, Level>([['0,0', { surface: source, offset: [0, 0], scale: [1, 1] }]]);
  const level = (kx: number, ky: number): Level => {
    const key = `${kx},${ky}`;
    let found = levels.get(key);
    if (found) return found;
    const down = ky > 0;
    const from = down ? level(kx, ky - 1) : level(kx - 1, ky);
    const { width, height } = from.surface.canvas;
    const copy = surface(down ? width : Math.ceil(width / 2) + 2, down ? Math.ceil(height / 2) + 2 : height);
    copy.imageSmoothingEnabled = true;
    copy.imageSmoothingQuality = 'low';
    copy.drawImage(from.surface.canvas as never, down ? 0 : 1, down ? 1 : 0, down ? width : width / 2, down ? height / 2 : height);
    const [ox, oy] = from.offset, [sx, sy] = from.scale;
    found = { surface: copy, offset: down ? [ox, oy / 2 + 1] : [ox / 2 + 1, oy], scale: down ? [sx, sy / 2] : [sx / 2, sy] };
    levels.set(key, found);
    return found;
  };
  // Draws `piece` onto `layer` moved by `dx, dy`, through `outline`, sampling at `X + (u, v)`.
  const draw = (layer: Surface, piece: AffinePiece, outline: Path2D, dx: number, dy: number, u: number, v: number) => {
    const { transform: [a, b, c, d, e, f], level: [kx, ky] } = piece;
    const copy = level(kx, ky);
    // From the copy's pixels: back to the source's, then the piece's map.
    const [sx, sy] = copy.scale, [ox, oy] = copy.offset;
    const ca = a / sx, cb = b / sx, cc = c / sy, cd = d / sy;
    layer.save();
    layer.clip(outline);
    // Sampling at `X + (u, v)` is drawing moved by `−(u, v)`.
    layer.setTransform(ca, cb, cc, cd, e - ca * ox - cc * oy + dx - u, f - cb * ox - cd * oy + dy - v);
    layer.drawImage(copy.surface.canvas as never, 0, 0);
    layer.restore();
  };
  const outline = (corners: [number, number][], dx: number, dy: number) => {
    const path = new Path2D();
    corners.forEach(([x, y], i) => (i ? path.lineTo(x + dx, y + dy) : path.moveTo(x + dx, y + dy)));
    path.closePath();
    return path;
  };
  const begin = (layer: Surface) => {
    layer.save();
    layer.globalCompositeOperation = 'copy';
    layer.imageSmoothingEnabled = true;
    layer.imageSmoothingQuality = 'low';
  };
  // The pieces overlap by `OVERLAP` and replace what is under them
  // (`copy`): near its sides a piece samples nearly what its neighbour does,
  // so a pixel is right whichever draws it, or both in part. Adding pieces
  // whose antialiased sides cover complementary parts of a pixel would
  // leave seams wherever a browser's coverage is not exact. So pieces with
  // passes, grouped by how many, draw each pass onto a layer of its own
  // over their box, and the layers' average replaces what the group
  // covers: cleared inside the group's outline, then added, the clip's
  // coverage blending it with what is there. Then the pieces without
  // passes draw.
  const groups = new Map<string, AffinePiece[]>();
  for (const piece of pieces.affine) {
    const key = piece.passes.join('x');
    const group = groups.get(key);
    if (group) group.push(piece);
    else groups.set(key, [piece]);
  }
  const single = groups.get('1x1') ?? [];
  groups.delete('1x1');
  for (const group of groups.values()) {
    const [across, down] = group[0].passes;
    // The layers hold each piece a pixel past what the group replaces, so
    // they are whole where the group's antialiased outline blends them.
    const outlines = group.map(piece => grown(piece.corners, OVERLAP));
    const layered = group.map(piece => grown(piece.corners, OVERLAP + 1));
    const shown = boxOf(layered.flat())!;
    const left = Math.max(box[0], Math.floor(shown[0]) - 1), top = Math.max(box[1], Math.floor(shown[1]) - 1);
    const right = Math.min(box[2], Math.ceil(shown[2]) + 1), bottom = Math.min(box[3], Math.ceil(shown[3]) + 1);
    if (!(right > left && bottom > top)) continue;
    const layers = Array.from({ length: across * down }, () => surface(right - left, bottom - top));
    layers.forEach(begin);
    group.forEach((piece, index) => {
      const path = outline(layered[index], -left, -top);
      const us = passOffsets(across, piece.spread[0]), vs = passOffsets(down, piece.spread[1]);
      layers.forEach((layer, pass) => draw(layer, piece, path, -left, -top, us[pass % across], vs[Math.floor(pass / across)]));
    });
    for (const layer of layers) layer.restore();
    // The layers' average, by halves: adding each at `1 / n` would round
    // every layer's share to 8 bits, and on a flat color the same way each
    // time, off by up to `n / 2` levels; halving and adding pairs leaves
    // under two.
    for (let apart = 1; apart < layers.length; apart *= 2) {
      for (let i = 0; i + apart < layers.length; i += 2 * apart) {
        const [into, from] = [layers[i], layers[i + apart]];
        into.save();
        into.globalAlpha = 0.5;
        // Every premultiplied channel times `1 − 0.5`.
        into.globalCompositeOperation = 'destination-out';
        into.fillRect(0, 0, right - left, bottom - top);
        into.globalCompositeOperation = 'lighter';
        into.drawImage(from.canvas as never, 0, 0);
        into.restore();
        from.canvas.width = 0;
      }
    }
    const union = new Path2D();
    for (const corners of outlines) union.addPath(outline(corners, 0, 0));
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clip(union);
    target.globalCompositeOperation = 'destination-out';
    target.fillRect(left, top, right - left, bottom - top);
    target.globalCompositeOperation = 'lighter';
    target.drawImage(layers[0].canvas as never, left, top);
    target.restore();
    layers[0].canvas.width = 0;
  }
  begin(target);
  for (const piece of single) draw(target, piece, outline(grown(piece.corners, OVERLAP), 0, 0), 0, 0, 0, 0);
  target.restore();
  for (const [key, { surface }] of levels) if (key !== '0,0') surface.canvas.width = 0;
  if (!pieces.target || !pieces.source) return;
  const [warpLeft, warpTop, warpRight, warpBottom] = pieces.target, [sourceLeft, sourceTop, sourceRight, sourceBottom] = pieces.source;
  const pixels = source.getImageData(sourceLeft, sourceTop, sourceRight - sourceLeft, sourceBottom - sourceTop).data;
  const [width, height] = [warpRight - warpLeft, warpBottom - warpTop];
  const image = pieces.affine.length ? target.getImageData(warpLeft, warpTop, width, height) : target.createImageData(width, height);
  warpPieces(pixels, image.data, toSource, pieces);
  target.putImageData(image as never, warpLeft, warpTop);
}
