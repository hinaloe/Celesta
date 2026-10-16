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

/**
 * Whether `t` only turns about the Z axis and scales: no skew and no 3D
 * rotation, so `linear` is `Rz · S` and flat (its Z row and column are the
 * identity's).
 */
export const turnsFlat = (t: Transform) => !(t.skew?.x || t.skew?.y || t.rotationX || t.rotationY);

/**
 * `Rx · Ry · Rz · K · S`: everything but position and perspective. A flat
 * transform's is built directly, as it is for nearly every layer.
 */
export function linear(t: Transform): Matrix3 {
  if (turnsFlat(t)) {
    const [s, c] = t.rotation === 0 ? [0, 1] : [Math.sin(radians(t.rotation)), Math.cos(radians(t.rotation))];
    return [[c * t.scale.x, -s * t.scale.y, 0], [s * t.scale.x, c * t.scale.y, 0], [0, 0, 1]];
  }
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
 * `multiply3(orientation, linear(t))` for a flat `t` (see `turnsFlat`), in
 * fewer products; `orientation` itself when `t` neither turns nor scales.
 */
export function turnFlat(orientation: Matrix3, t: Transform): Matrix3 {
  if (t.rotation === 0 && t.scale.x === 1 && t.scale.y === 1) return orientation;
  const [[a, c], [b, d]] = linear(t);
  return orientation.map(([x, y, z]) => [x * a + y * b, x * c + y * d, z]);
}

/**
 * The map from the layer plane (relative to its anchor) to the parent's
 * plane, folding position and perspective into the linear part `l`.
 */
export function homography(t: Transform, l: Matrix3 = linear(t)): Matrix3 {
  const { x: px, y: py } = t.position;
  const d = perspectiveDistance(t);
  const inverse = d === null ? 0 : 1 / d;
  return [
    [l[0][0] - px * l[2][0] * inverse, l[0][1] - px * l[2][1] * inverse, px],
    [l[1][0] - py * l[2][0] * inverse, l[1][1] - py * l[2][1] * inverse, py],
    [-l[2][0] * inverse, -l[2][1] * inverse, 1],
  ];
}

/** Whether the transform needs a homography rather than an affine map; `l` is its `linear` part. */
export function isProjective(t: Transform, l: Matrix3 = linear(t)): boolean {
  const h = homography(t, l);
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
 * The convex polygon `polygon`, all of it in front of the viewer (see
 * `clipInFront`), clipped to the part `m` maps into `target`. Each side of
 * `target` is a half-plane in the plane too: `X/W ≥ left` is
 * `X − left·W ≥ 0` where `W > 0`, which is linear in the point, so the clip
 * is exact whether or not the plane's horizon shows.
 */
function clipToShown(m: Matrix3, polygon: [number, number][], [left, top, right, bottom]: Box): [number, number][] {
  const row = (r: number, [x, y]: [number, number]) => m[r][0] * x + m[r][1] * y + m[r][2];
  polygon = clipPolygon(polygon, p => row(0, p) - left * row(2, p));
  polygon = clipPolygon(polygon, p => row(1, p) - top * row(2, p));
  polygon = clipPolygon(polygon, p => right * row(2, p) - row(0, p));
  return clipPolygon(polygon, p => bottom * row(2, p) - row(1, p));
}

/**
 * The raster of a plane whose content covers `local` (layer-local units),
 * drawn through `forward` (layer-local units to `target`'s space) onto a
 * space `target` covers; `null` when nothing of it can show. Only the part in
 * front of the viewer that lands in `target` is rasterized, at the scale its
 * most magnified corner needs, rounded up as text raster scales are, and
 * lowered to keep the canvas within `maxSize` on either side and `maxArea`
 * pixels in all.
 */
export function planeRaster(forward: Matrix3, local: Box, target: Box, maxSize: number, maxArea = Infinity): PlaneRaster | null {
  const polygon = clipToShown(forward, clipInFront(forward, corners(local)), target);
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
  // Not `Math.hypot`, which is several times slower; the steps are small.
  const crossed = Math.ceil(Math.sqrt(dx * dx + dy * dy));
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
 * transparent texels past the source's edges. A pixel whose footprint
 * covers only transparent texels is skipped, and one whose taps all fall
 * inside the source reads them without bounds checks.
 */
export function warp(
  source: Uint8ClampedArray, sourceWidth: number, sourceHeight: number,
  target: Uint8ClampedArray, targetWidth: number, toSource: Matrix3, box: Box,
): void {
  const targetHeight = target.length / 4 / targetWidth;
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = toSource;
  const stride = sourceWidth * 4;
  const shown = occupiedTiles(source, sourceWidth, sourceHeight);
  const tileColumns = Math.ceil(sourceWidth / TILE) + 1;
  const left = Math.max(0, Math.floor(box[0])), top = Math.max(0, Math.floor(box[1]));
  const right = Math.min(targetWidth, Math.ceil(box[2])), bottom = Math.min(targetHeight, Math.ceil(box[3]));
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      // `project` and `jacobian` at the pixel's centre, inline: this runs
      // for every pixel a plane lands on.
      const cx = x + 0.5, cy = y + 0.5;
      const w = m20 * cx + m21 * cy + m22;
      if (!(w > 0) || 1 / w < NEAR_W) continue;
      const sx = (m00 * cx + m01 * cy + m02) / w, sy = (m10 * cx + m11 * cy + m12) / w;
      if (!(sx >= 0 && sy >= 0 && sx <= sourceWidth && sy <= sourceHeight)) continue;
      const xx = (m00 - sx * m20) / w, xy = (m10 - sy * m20) / w, yx = (m01 - sx * m21) / w, yy = (m11 - sy * m21) / w;
      const columns = taps(xx, xy), rows = taps(yx, yy);
      // The texels the taps can read: half the footprint either side of
      // the centre, the bilinear neighbours, and a texel more for rounding.
      const reachX = (Math.abs(xx) + Math.abs(yx)) / 2, reachY = (Math.abs(xy) + Math.abs(yy)) / 2;
      const x0 = Math.floor(sx - reachX - 0.5) - 1, x1 = Math.floor(sx + reachX - 0.5) + 2;
      const y0 = Math.floor(sy - reachY - 0.5) - 1, y1 = Math.floor(sy + reachY - 0.5) + 2;
      if (!(x1 >= 0 && y1 >= 0 && x0 < sourceWidth && y0 < sourceHeight)) continue;
      const tx0 = Math.max(0, x0) >> TILE_BITS, tx1 = (Math.min(sourceWidth - 1, x1) >> TILE_BITS) + 1;
      const ty0 = Math.max(0, y0) >> TILE_BITS, ty1 = (Math.min(sourceHeight - 1, y1) >> TILE_BITS) + 1;
      if (shown[ty1 * tileColumns + tx1] - shown[ty0 * tileColumns + tx1] - shown[ty1 * tileColumns + tx0] + shown[ty0 * tileColumns + tx0] === 0) continue;
      const inside = x0 >= 0 && y0 >= 0 && x1 < sourceWidth && y1 < sourceHeight;
      const offsetsX = TAP_OFFSETS[columns], offsetsY = TAP_OFFSETS[rows];
      // Premultiplied (0–255²) red, green, and blue, and alpha (0–255),
      // summed over the pixel's taps. Locals, not captured by a closure,
      // so they stay unboxed.
      let red = 0, green = 0, blue = 0, coverage = 0;
      for (let row = 0; row < rows; row++) {
        const v = offsetsY[row];
        for (let column = 0; column < columns; column++) {
          const u = offsetsX[column];
          // Bilinear, about the texel centres.
          const px = sx + u * xx + v * yx - 0.5, py = sy + u * xy + v * yy - 0.5;
          const fx0 = Math.floor(px), fy0 = Math.floor(py), fx = px - fx0, fy = py - fy0;
          const i = fy0 * stride + fx0 * 4, j = i + stride;
          if (!inside) {
            // Each texel past the source's edges is transparent.
            const left = fx0 >= 0 && fx0 < sourceWidth, right = fx0 + 1 >= 0 && fx0 + 1 < sourceWidth;
            const upper = fy0 >= 0 && fy0 < sourceHeight, lower = fy0 + 1 >= 0 && fy0 + 1 < sourceHeight;
            for (const [shown, k, weight] of [
              [left && upper, i, (1 - fx) * (1 - fy)],
              [right && upper, i + 4, fx * (1 - fy)],
              [left && lower, j, (1 - fx) * fy],
              [right && lower, j + 4, fx * fy],
            ] as const) {
              if (!shown) continue;
              const alpha = source[k + 3] * weight;
              red += source[k] * alpha;
              green += source[k + 1] * alpha;
              blue += source[k + 2] * alpha;
              coverage += alpha;
            }
            continue;
          }
          // The four texels, all in the source, in the order above.
          const a00 = source[i + 3] * ((1 - fx) * (1 - fy)), a10 = source[i + 7] * (fx * (1 - fy));
          const a01 = source[j + 3] * ((1 - fx) * fy), a11 = source[j + 7] * (fx * fy);
          red += source[i] * a00;
          green += source[i + 1] * a00;
          blue += source[i + 2] * a00;
          coverage += a00;
          red += source[i + 4] * a10;
          green += source[i + 5] * a10;
          blue += source[i + 6] * a10;
          coverage += a10;
          red += source[j] * a01;
          green += source[j + 1] * a01;
          blue += source[j + 2] * a01;
          coverage += a01;
          red += source[j + 4] * a11;
          green += source[j + 5] * a11;
          blue += source[j + 6] * a11;
          coverage += a11;
        }
      }
      const count = columns * rows;
      const sa = coverage / count / 255;
      if (!(sa > 0)) continue;
      const i = (y * targetWidth + x) * 4;
      const da = target[i + 3] / 255, kept = da * (1 - sa), out = sa + kept;
      const scale = count * 255 * 255;
      target[i] = (red / scale + target[i] / 255 * kept) / out * 255;
      target[i + 1] = (green / scale + target[i + 1] / 255 * kept) / out * 255;
      target[i + 2] = (blue / scale + target[i + 2] / 255 * kept) / out * 255;
      target[i + 3] = out * 255;
    }
  }
}

/** The side of the source tiles `warp` skips when nothing in them shows: 16 texels. */
const TILE_BITS = 4;
const TILE = 1 << TILE_BITS;

/**
 * Where each of `n` taps across a footprint sits, as a fraction of it from
 * its centre, for `n` from 1 to `MAX_TAPS`: `(k + 0.5) / n − 0.5`.
 */
const TAP_OFFSETS = Array.from({ length: MAX_TAPS + 1 }, (_, n) => Array.from({ length: n }, (_, k) => (k + 0.5) / n - 0.5));

/**
 * The summed-area table of which `TILE`×`TILE` tiles of `source` hold a
 * texel that is not transparent: entry `(ty, tx)` of a
 * `(rows + 1)×(columns + 1)` grid counts those above and left of it.
 */
function occupiedTiles(source: Uint8ClampedArray, width: number, height: number): Int32Array {
  const columns = Math.ceil(width / TILE), rows = Math.ceil(height / TILE);
  const table = new Int32Array((rows + 1) * (columns + 1));
  for (let ty = 0; ty < rows; ty++) {
    let row = 0;
    for (let tx = 0; tx < columns; tx++) {
      let occupied = 0;
      const right = Math.min(width, (tx + 1) * TILE);
      for (let y = ty * TILE, last = Math.min(height, y + TILE); y < last && !occupied; y++) {
        for (let i = (y * width + tx * TILE) * 4 + 3, end = (y * width + right) * 4; i < end; i += 4) {
          if (source[i]) {
            occupied = 1;
            break;
          }
        }
      }
      row += occupied;
      table[(ty + 1) * (columns + 1) + tx + 1] = table[ty * (columns + 1) + tx + 1] + row;
    }
  }
  return table;
}
