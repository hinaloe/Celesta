/**
 * 3×3 matrix math for planar transforms, as `celesta_composition`'s
 * `projection.rs`, and the geometry of projective planes and their warp, as
 * `celesta_gpu_renderer`'s `plane.rs` and `layer.wgsl`. DOM-free.
 */
import type { Transform } from './types';

/** A row-major 3×3 matrix acting on column vectors `(x, y, 1)`. */
export type Matrix3 = number[][];
/** Left, top, right, bottom. */
export type Box = [number, number, number, number];
/**
 * How a plane's content is rasterized: `scale` plane pixels per local unit,
 * the local box from `left`, `top` drawn onto a `width`×`height` canvas with
 * a 1-pixel transparent margin round it.
 */
export type PlaneRaster = { scale: number; left: number; top: number; width: number; height: number };

export const IDENTITY3: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * The nearest a point may come to the viewer and still be drawn: points with
 * `w` below it are behind the viewer, or so close they would fill the screen.
 */
export const NEAR_W = 1 / 16;

/** Entries smaller than this are noise, not a projective part or an orientation. */
const EPSILON = 1e-12;
/** The range of plane raster scales, as for text: `2^-6` to `2^6`. */
const MIN_SCALE = 1 / 64;
const MAX_SCALE = 64;
/** The most taps a pixel's footprint takes along either axis. */
const MAX_TAPS = 8;

const radians = (degrees: number) => degrees * Math.PI / 180;

export function multiply3(a: Matrix3, b: Matrix3): Matrix3 {
  return [0, 1, 2].map(r => [0, 1, 2].map(c => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]));
}

function determinant3(m: Matrix3): number {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

/** The inverse, or `null` when `m` is singular or the result is not finite. */
export function invert3(m: Matrix3): Matrix3 | null {
  const det = determinant3(m);
  if (det === 0 || !Number.isFinite(det)) return null;
  const cofactor = (r: number, c: number) => {
    const [r0, r1] = [(r + 1) % 3, (r + 2) % 3];
    const [c0, c1] = [(c + 1) % 3, (c + 2) % 3];
    return m[r0][c0] * m[r1][c1] - m[r0][c1] * m[r1][c0];
  };
  const out = [0, 1, 2].map(r => [0, 1, 2].map(c => cofactor(c, r) / det));
  return out.flat().every(Number.isFinite) ? out : null;
}

/** Maps `(x, y)` through `m`, returning `[X/W, Y/W, W]`. */
export function project(m: Matrix3, x: number, y: number): [number, number, number] {
  const w = m[2][0] * x + m[2][1] * y + m[2][2];
  return [(m[0][0] * x + m[0][1] * y + m[0][2]) / w, (m[1][0] * x + m[1][1] * y + m[1][2]) / w, w];
}

/**
 * The Jacobian of `(x, y) ↦ (X/W, Y/W)` at a point `project` placed at
 * `px, py` with `w`: its columns, the steps along x and along y.
 */
function jacobian(m: Matrix3, px: number, py: number, w: number): [number, number, number, number] {
  // d(X/W)/dv = (X_v − (X/W)·W_v) / W
  return [(m[0][0] - px * m[2][0]) / w, (m[1][0] - py * m[2][0]) / w, (m[0][1] - px * m[2][1]) / w, (m[1][1] - py * m[2][1]) / w];
}

/**
 * The largest singular value of the Jacobian of `(x, y) ↦ (X/W, Y/W)`: how
 * much the map stretches the plane at that point in its worst direction.
 * `null` where the point is at or behind the viewer (`W ≤ 0`) or the value is
 * not finite.
 */
export function stretchAt(m: Matrix3, x: number, y: number): number | null {
  const [px, py, w] = project(m, x, y);
  if (!(w > 0) || !Number.isFinite(w)) return null;
  const [a, c, b, d] = jacobian(m, px, py, w);
  const frobenius = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  const discriminant = Math.max(0, frobenius * frobenius - 4 * det * det);
  const stretch = Math.sqrt((frobenius + Math.sqrt(discriminant)) / 2);
  return Number.isFinite(stretch) ? stretch : null;
}

/**
 * Whether the layer's back faces the viewer, given its accumulated linear
 * orientation (parent orientations times its own `linear`). Compares the
 * sign of the z-axis cofactor against the determinant, so a mirroring scale
 * alone does not flip it; edge-on counts as front.
 */
export function facesAway(orientation: Matrix3): boolean {
  const o = orientation;
  const det = determinant3(o);
  if (!Number.isFinite(det) || Math.abs(det) <= EPSILON) return false;
  return (o[0][0] * o[1][1] - o[0][1] * o[1][0]) / det < 0;
}

/**
 * The perspective distance, or `null` for an orthographic transform: a value
 * that is not finite and positive means no perspective.
 */
export function perspectiveDistance(t: Transform): number | null {
  const d = t.perspective;
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null;
}

/** `Rx · Ry · Rz · K · S`: everything but position and perspective. */
export function linear(t: Transform): Matrix3 {
  const trig = (degrees: number) => [Math.sin(radians(degrees)), Math.cos(radians(degrees))];
  const [sx, cx] = trig(t.rotationX ?? 0), [sy, cy] = trig(t.rotationY ?? 0), [sz, cz] = trig(t.rotation);
  const skew = t.skew ?? { x: 0, y: 0 };
  let m: Matrix3 = multiply3(
    [[1, Math.tan(radians(skew.x)), 0], [Math.tan(radians(skew.y)), 1, 0], [0, 0, 1]],
    [[t.scale.x, 0, 0], [0, t.scale.y, 0], [0, 0, 1]],
  );
  m = multiply3([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], m);
  m = multiply3([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], m);
  return multiply3([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], m);
}

/**
 * The map from the layer plane (relative to its anchor) to the parent's
 * plane, folding position and perspective into the linear part.
 */
export function homography(t: Transform): Matrix3 {
  const l = linear(t);
  const { x: px, y: py } = t.position;
  const d = perspectiveDistance(t);
  const inverse = d === null ? 0 : 1 / d;
  return [
    [l[0][0] - px * l[2][0] * inverse, l[0][1] - px * l[2][1] * inverse, px],
    [l[1][0] - py * l[2][0] * inverse, l[1][1] - py * l[2][1] * inverse, py],
    [-l[2][0] * inverse, -l[2][1] * inverse, 1],
  ];
}

/** Whether the transform needs a homography rather than an affine map. */
export function isProjective(t: Transform): boolean {
  const h = homography(t);
  return h.flat().every(Number.isFinite) && Math.abs(h[2][0]) + Math.abs(h[2][1]) > EPSILON;
}

/**
 * Sutherland–Hodgman: the convex polygon `corners` clipped to where the
 * affine function `inside` is at least 0.
 */
function clipPolygon(corners: [number, number][], inside: (point: [number, number]) => number): [number, number][] {
  const clipped: [number, number][] = [];
  corners.forEach((current, index) => {
    const next = corners[(index + 1) % corners.length];
    const here = inside(current), there = inside(next);
    if (here >= 0) clipped.push(current);
    if ((here >= 0) !== (there >= 0)) {
      const t = here / (here - there);
      clipped.push([current[0] + t * (next[0] - current[0]), current[1] + t * (next[1] - current[1])]);
    }
  });
  return clipped;
}

/** The convex polygon `corners` clipped to the part `m` maps to `w ≥ NEAR_W`. */
export function clipInFront(m: Matrix3, corners: [number, number][]): [number, number][] {
  return clipPolygon(corners, ([x, y]) => m[2][0] * x + m[2][1] * y + m[2][2] - NEAR_W);
}

/** The corners of `box`, in order around it. */
export function corners([left, top, right, bottom]: Box): [number, number][] {
  return [[left, top], [right, top], [right, bottom], [left, bottom]];
}

/** The box of `points`; `null` without any. */
export function boxOf(points: [number, number][]): Box | null {
  if (!points.length) return null;
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * The box of where `m` maps the part of the canvas `(0, 0, width, height)`
 * in front of the viewer, grown by 2 pixels; `null` when none of it is.
 */
export function projectedBounds(m: Matrix3, width: number, height: number): Box | null {
  const box = boxOf(clipInFront(m, corners([0, 0, width, height])).map(([x, y]) => {
    const [px, py] = project(m, x, y);
    return [px, py];
  }));
  return box && [box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2];
}

/** `scale` rounded up to an eighth of an octave, as text raster scales are. */
function roundUpToEighthOctave(scale: number): number {
  const STEPS_PER_OCTAVE = 8;
  const steps = Math.log2(scale) * STEPS_PER_OCTAVE;
  const nearest = Math.round(steps);
  return 2 ** ((Math.abs(steps - nearest) < 1e-3 ? nearest : Math.ceil(steps)) / STEPS_PER_OCTAVE);
}

/**
 * The raster of a plane whose content covers `local` (layer-local units),
 * drawn through `forward` (layer-local units to `target`'s space) onto a
 * space `target` covers; `null` when nothing of it can show. Only the part in
 * front of the viewer, and (when the whole of `target` is) the part `target`
 * can show, is rasterized, at the scale its most magnified corner needs,
 * rounded up as text raster scales are, and lowered to keep the canvas within
 * `maxSize` on either side and `maxArea` pixels in all.
 */
export function planeRaster(forward: Matrix3, local: Box, target: Box, maxSize: number, maxArea = Infinity): PlaneRaster | null {
  let polygon = clipInFront(forward, corners(local));
  // Where `target`'s corners come from in the plane; when one is at or
  // behind the plane's horizon, the part shown is unbounded on that side.
  const inverse = invert3(forward);
  const shown = inverse && corners(target).map(([x, y]) => project(inverse, x, y));
  const shownBox = shown && shown.every(([, , w]) => w > 0) ? boxOf(shown.map(([x, y]) => [x, y])) : null;
  if (shownBox) {
    const [left, top, right, bottom] = shownBox;
    polygon = clipPolygon(polygon, ([x]) => x - left);
    polygon = clipPolygon(polygon, ([, y]) => y - top);
    polygon = clipPolygon(polygon, ([x]) => right - x);
    polygon = clipPolygon(polygon, ([, y]) => bottom - y);
  }
  const stretches = polygon.map(([x, y]) => stretchAt(forward, x, y)).filter((value): value is number => value !== null);
  if (!stretches.length) return null;
  const box = boxOf(polygon);
  if (!box) return null;
  const [left, top, right, bottom] = box;
  const width = right - left, height = bottom - top;
  if (!(Number.isFinite(width) && Number.isFinite(height))) return null;
  let scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, roundUpToEighthOctave(Math.max(...stretches))));
  const side = (extent: number, scale: number) => Math.ceil(extent * scale) + 2;
  if (side(width, scale) > maxSize || side(height, scale) > maxSize) scale = (maxSize - 2) / Math.max(width, height);
  // A plane reaching to the horizon would otherwise fill the largest canvas:
  // the largest scale whose canvas, with its margin and the rounding up,
  // fits `maxArea`, a root of `(width·s + 3)(height·s + 3) = maxArea`.
  if (side(width, scale) * side(height, scale) > maxArea) {
    const a = width * height, b = 3 * (width + height), c = 9 - maxArea;
    const lowered = a > 0 ? (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a) : -c / b;
    if (Number.isFinite(lowered) && lowered > 0) scale = Math.min(scale, lowered);
  }
  // Rounding can leave the lowered scale a hair over the limit.
  return { scale, left, top, width: Math.min(side(width, scale), maxSize), height: Math.min(side(height, scale), maxSize) };
}

/** The map from a plane's local units to its canvas pixels: `Translate(1 − left·scale, 1 − top·scale) · Scale(scale)`. */
export function toPlane(raster: PlaneRaster): Matrix3 {
  return [[raster.scale, 0, 1 - raster.left * raster.scale], [0, raster.scale, 1 - raster.top * raster.scale], [0, 0, 1]];
}

/**
 * How much larger than its output size an effect's pixels are drawn on the
 * plane `raster` rasterizes, measured at the layer's origin: a blur of `r`
 * plane pixels spreads `r · effectScale` output pixels, so effects scaled by
 * it come out the size they would without the plane.
 */
export function effectScale(forward: Matrix3, raster: PlaneRaster): number {
  const stretch = stretchAt(forward, 0, 0);
  return raster.scale * (stretch === null ? 1 : 1 / stretch);
}

/** How many taps across `d` (a pixel's step in source pixels) the footprint filter takes: one per pixel crossed, 1 to 8. */
function taps(dx: number, dy: number): number {
  const crossed = Math.ceil(Math.hypot(dx, dy));
  // Also 1 for a step that is not finite.
  return crossed > 1 ? Math.min(crossed, MAX_TAPS) : 1;
}

/**
 * How many taps the footprint of the target pixel at `x, y` takes across and
 * down, from `toSource`'s Jacobian there: one per source pixel each of its
 * sides crosses, 1 to 8.
 */
export function tapCount(toSource: Matrix3, x: number, y: number): [number, number] {
  const [px, py, w] = project(toSource, x, y);
  const [xx, xy, yx, yy] = jacobian(toSource, px, py, w);
  return [taps(xx, xy), taps(yx, yy)];
}

/**
 * Composites the straight-alpha `source` onto the straight-alpha `target`
 * source-over at each pixel of `box` whose centre `toSource` maps into the
 * source, as `layer.wgsl` draws a plane's canvas: `toSource` is the exact
 * inverse of the plane's map onto the target, so the plane's own `w` at the
 * source point is `1 / W`, and a pixel nearer the viewer than `NEAR_W` (or
 * behind it) is left as it was. Each pixel averages an `nx × ny` grid of
 * premultiplied bilinear taps over its footprint (`tapCount`), with
 * transparent texels past the source's edges.
 */
export function warp(
  source: Uint8ClampedArray, sourceWidth: number, sourceHeight: number,
  target: Uint8ClampedArray, targetWidth: number, toSource: Matrix3, box: Box,
): void {
  const targetHeight = target.length / 4 / targetWidth;
  const m = toSource;
  const color = [0, 0, 0, 0];
  // Adds the premultiplied texel at `x, y` (none past the edges) times `weight`.
  const texel = (x: number, y: number, weight: number) => {
    if (x < 0 || y < 0 || x >= sourceWidth || y >= sourceHeight || weight === 0) return;
    const i = (y * sourceWidth + x) * 4, alpha = source[i + 3] * weight;
    color[0] += source[i] * alpha;
    color[1] += source[i + 1] * alpha;
    color[2] += source[i + 2] * alpha;
    color[3] += alpha;
  };
  const left = Math.max(0, Math.floor(box[0])), top = Math.max(0, Math.floor(box[1]));
  const right = Math.min(targetWidth, Math.ceil(box[2])), bottom = Math.min(targetHeight, Math.ceil(box[3]));
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const [sx, sy, w] = project(m, x + 0.5, y + 0.5);
      if (!(w > 0) || 1 / w < NEAR_W) continue;
      if (!(sx >= 0 && sy >= 0 && sx <= sourceWidth && sy <= sourceHeight)) continue;
      const [xx, xy, yx, yy] = jacobian(m, sx, sy, w);
      const columns = taps(xx, xy), rows = taps(yx, yy);
      color.fill(0);
      for (let row = 0; row < rows; row++) {
        const v = (row + 0.5) / rows - 0.5;
        for (let column = 0; column < columns; column++) {
          const u = (column + 0.5) / columns - 0.5;
          // Bilinear, about the texel centres.
          const px = sx + u * xx + v * yx - 0.5, py = sy + u * xy + v * yy - 0.5;
          const cx = Math.floor(px), cy = Math.floor(py), fx = px - cx, fy = py - cy;
          texel(cx, cy, (1 - fx) * (1 - fy));
          texel(cx + 1, cy, fx * (1 - fy));
          texel(cx, cy + 1, (1 - fx) * fy);
          texel(cx + 1, cy + 1, fx * fy);
        }
      }
      const count = columns * rows;
      // Premultiplied (0–255²) and covering (0–255) sums of `count` taps.
      const sa = color[3] / count / 255;
      if (!(sa > 0)) continue;
      const i = (y * targetWidth + x) * 4;
      const da = target[i + 3] / 255, out = sa + da * (1 - sa);
      for (let channel = 0; channel < 3; channel++) {
        const premultiplied = color[channel] / count / 255 / 255;
        target[i + channel] = (premultiplied + target[i + channel] / 255 * da * (1 - sa)) / out * 255;
      }
      target[i + 3] = out * 255;
    }
  }
}
