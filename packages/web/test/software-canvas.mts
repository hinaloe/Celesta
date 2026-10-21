/**
 * Just enough of Canvas 2D, in software, to draw a plane as `drawPlane`
 * does: 8-bit premultiplied pixels; `drawImage` through any affine
 * transform with bilinear taps about texel centres, clamped to the image's
 * edges, as `imageSmoothingQuality = 'low'` draws; antialiased convex clips
 * and image edges, by the exact area they cover of each pixel (or 64
 * points of it for a clip of several polygons); and
 * `source-over`, `lighter`, and `copy` (which only replaces what the clip
 * covers, in part where it covers a pixel in part), and `fillRect` with
 * `destination-out`, rounded to 8 bits after each draw.
 */
import type { Surface } from '../src/plane-pieces';
import { standIn } from './stand-in.mjs';

type Point = [number, number];
type Polygon = Point[];
/** `[a, b, c]`: the half-plane where `a·x + b·y + c ≥ 0`. */
type HalfPlane = [number, number, number];
/** A 2D affine map in `DOMMatrix` order. */
type Affine = [number, number, number, number, number, number];
/** A clip: its polygons, and with several, which of them reach each pixel. */
type Region = Polygon[] & { index?: Map<number, number[]> };
/** Straight-alpha or premultiplied pixels, `width` × `height`. */
type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/** The convex `polygon` (device pixels) clipped to where `a·x + b·y + c ≥ 0`. */
function clipHalfPlane(polygon: Polygon, [a, b, c]: HalfPlane): Polygon {
  const out: Polygon = [];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const here = a * p[0] + b * p[1] + c, there = a * q[0] + b * q[1] + c;
    if (here >= 0) out.push(p);
    if ((here >= 0) !== (there >= 0)) {
      const t = here / (here - there);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  });
  return out;
}

const area = (polygon: Polygon) => {
  let doubled = 0;
  polygon.forEach(([x, y], i) => {
    const [u, v] = polygon[(i + 1) % polygon.length];
    doubled += x * v - u * y;
  });
  return Math.abs(doubled) / 2;
};

/** The half-planes inside the convex `polygon`, as `[a, b, c]` with `a·x + b·y + c ≥ 0` inside. */
function halfPlanes(polygon: Polygon): HalfPlane[] {
  let doubled = 0;
  polygon.forEach(([x, y], i) => {
    const [u, v] = polygon[(i + 1) % polygon.length];
    doubled += x * v - u * y;
  });
  const sign = Math.sign(doubled) || 1;
  return polygon.map(([px, py], i) => {
    const [qx, qy] = polygon[(i + 1) % polygon.length];
    const a = sign * (py - qy), b = sign * (qx - px);
    return [a, b, -(a * px + b * py)];
  });
}

const apply = ([a, b, c, d, e, f]: Affine, x: number, y: number): Point => [a * x + c * y + e, b * x + d * y + f];
const multiply = ([a1, b1, c1, d1, e1, f1]: Affine, [a2, b2, c2, d2, e2, f2]: Affine): Affine => [
  a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
];
const invert = ([a, b, c, d, e, f]: Affine): Affine => {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};

/** `Path2D`, for convex polygons of straight lines, filled as their union. */
export class SoftwarePath {
  polygons: Polygon[] = [];
  moveTo(x: number, y: number) { this.polygons.push([[x, y]]); }
  lineTo(x: number, y: number) { this.polygons.at(-1)!.push([x, y]); }
  closePath() {}
  addPath(path: SoftwarePath) { this.polygons.push(...path.polygons); }
}

export class SoftwareCanvas {
  context: SoftwareContext;
  private _width = 0;
  private _height = 0;
  /** Premultiplied RGBA. */
  data = new Uint8ClampedArray(0);

  constructor(width: number, height: number) {
    this.context = new SoftwareContext(this);
    this.resize(width, height);
  }

  resize(width: number, height: number) {
    this._width = width;
    this._height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  get width() { return this._width; }
  set width(value) { this.resize(value, this._height); }
  get height() { return this._height; }
  set height(value) { this.resize(this._width, value); }

  getContext() { return this.context; }
}

/** What `save` keeps and `restore` puts back. */
type State = Pick<SoftwareContext, 'globalAlpha' | 'globalCompositeOperation' | 'imageSmoothingEnabled' | 'imageSmoothingQuality' | 'transform' | 'clips'>;

class SoftwareContext implements Surface {
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'low';
  transform: Affine = [1, 0, 0, 1, 0, 0];
  clips: Region[] = [];
  stack: State[] = [];
  /** How many times each method was called. */
  calls: Record<string, number> = {};

  constructor(readonly canvas: SoftwareCanvas) {}

  count(name: string) { this.calls[name] = (this.calls[name] ?? 0) + 1; }

  save() {
    this.count('save');
    const { globalAlpha, globalCompositeOperation, imageSmoothingEnabled, imageSmoothingQuality, transform, clips } = this;
    this.stack.push({ globalAlpha, globalCompositeOperation, imageSmoothingEnabled, imageSmoothingQuality, transform, clips });
  }

  restore() { Object.assign(this, this.stack.pop()); }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { this.transform = [a, b, c, d, e, f]; }

  /** Clips to `path`, a `SoftwarePath` (the tests' `Path2D`), under the current transform. */
  clip(path: Path2D) {
    this.count('clip');
    const polygons: Region = standIn<SoftwarePath>(path).polygons.map(polygon => polygon.map(([x, y]) => apply(this.transform, x, y)));
    // Which polygons reach each pixel, for a clip of several.
    if (polygons.length > 1) {
      const index = polygons.index = new Map<number, number[]>();
      polygons.forEach((polygon, i) => {
        const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
        for (let y = Math.floor(Math.min(...ys)); y < Math.ceil(Math.max(...ys)); y++) {
          for (let x = Math.floor(Math.min(...xs)); x < Math.ceil(Math.max(...xs)); x++) {
            const key = y * 65536 + x;
            index.set(key, [...(index.get(key) ?? []), i]);
          }
        }
      });
    }
    this.clips = [...this.clips, polygons];
  }

  /**
   * How much of the pixel at `x, y` lies inside `quad` and every clip: the
   * exact area while each clip is one convex polygon, otherwise the share
   * of 8 × 8 points.
   */
  coverage(x: number, y: number, quad?: Polygon) {
    const regions: Region[] = quad ? [[quad], ...this.clips] : this.clips;
    const corners: Polygon = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    if (regions.every(region => region.length === 1)) {
      const planes = regions.flatMap(([polygon]) => halfPlanes(polygon));
      if (planes.every(([a, b, c]) => corners.every(([px, py]) => a * px + b * py + c >= 0))) return 1;
      let piece = corners;
      for (const plane of planes) {
        piece = clipHalfPlane(piece, plane);
        if (piece.length < 3) return 0;
      }
      return area(piece);
    }
    const unions = regions.map(region => (region.index ? (region.index.get(y * 65536 + x) ?? []).map(i => region[i]) : region).map(halfPlanes));
    if (unions.some(union => !union.length)) return 0;
    // Inside one polygon of each, the whole pixel is.
    if (unions.every(union => union.some(planes => planes.every(([a, b, c]) => corners.every(([px, py]) => a * px + b * py + c >= 0))))) return 1;
    let inside = 0;
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        const px = x + (i + 0.5) / 8, py = y + (j + 0.5) / 8;
        if (unions.every(union => union.some(planes => planes.every(([a, b, c]) => a * px + b * py + c >= 0)))) inside++;
      }
    }
    return inside / 64;
  }

  /** The pixels the clips can reach within `x0, y0, x1, y1`. */
  bounds(x0: number, y0: number, x1: number, y1: number) {
    for (const region of this.clips) {
      const points = region.flat();
      x0 = Math.max(x0, Math.floor(Math.min(...points.map(p => p[0])))), x1 = Math.min(x1, Math.ceil(Math.max(...points.map(p => p[0]))));
      y0 = Math.max(y0, Math.floor(Math.min(...points.map(p => p[1])))), y1 = Math.min(y1, Math.ceil(Math.max(...points.map(p => p[1]))));
    }
    return [x0, y0, x1, y1];
  }

  /** Only to clear, with `destination-out`. */
  fillRect(x: number, y: number, width: number, height: number) {
    if (this.globalCompositeOperation !== 'destination-out') throw new Error(`fillRect with ${this.globalCompositeOperation} is not emulated`);
    const rect = ([[x, y], [x + width, y], [x + width, y + height], [x, y + height]] satisfies Polygon).map(([px, py]) => apply(this.transform, px, py));
    const [x0, y0, x1, y1] = this.bounds(
      Math.max(0, Math.floor(Math.min(...rect.map(p => p[0])))), Math.max(0, Math.floor(Math.min(...rect.map(p => p[1])))),
      Math.min(this.canvas.width, Math.ceil(Math.max(...rect.map(p => p[0])))), Math.min(this.canvas.height, Math.ceil(Math.max(...rect.map(p => p[1])))),
    );
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const kept = 1 - this.coverage(px, py, rect) * this.globalAlpha, i = (py * this.canvas.width + px) * 4;
        for (let channel = 0; channel < 4; channel++) this.canvas.data[i + channel] = Math.round(this.canvas.data[i + channel] * kept);
      }
    }
  }

  drawImage(image: SoftwareCanvas, dx: number, dy: number, dw = image.width, dh = image.height) {
    this.count('drawImage');
    if (this.imageSmoothingQuality !== 'low' || !this.imageSmoothingEnabled) throw new Error('only bilinear taps are emulated');
    const toDevice = multiply(this.transform, [dw / image.width, 0, 0, dh / image.height, dx, dy]);
    const toImage = invert(toDevice);
    const quad = ([[0, 0], [image.width, 0], [image.width, image.height], [0, image.height]] satisfies Polygon).map(([x, y]) => apply(toDevice, x, y));
    const mode = this.globalCompositeOperation;
    if (!['source-over', 'lighter', 'copy'].includes(mode)) throw new Error(`${mode} is not emulated`);
    const { width, height, data } = this.canvas;
    // `copy` clears what the clip shows past the image too.
    const [x0, y0, x1, y1] = mode === 'copy' ? this.bounds(0, 0, width, height) : this.bounds(
      Math.max(0, Math.floor(Math.min(...quad.map(p => p[0])))), Math.max(0, Math.floor(Math.min(...quad.map(p => p[1])))),
      Math.min(width, Math.ceil(Math.max(...quad.map(p => p[0])))), Math.min(height, Math.ceil(Math.max(...quad.map(p => p[1])))),
    );
    const source = image.data, sw = image.width, sh = image.height;
    const texel = (x: number, y: number, channel: number) => source[((Math.min(sh - 1, Math.max(0, y)) * sw) + Math.min(sw - 1, Math.max(0, x))) * 4 + channel];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const clipped = this.coverage(x, y), both = clipped > 0 ? this.coverage(x, y, quad) : 0;
        if (!(clipped > 0)) continue;
        const [u, v] = apply(toImage, x + 0.5, y + 0.5);
        const px = u - 0.5, py = v - 0.5, fx0 = Math.floor(px), fy0 = Math.floor(py), fx = px - fx0, fy = py - fy0;
        const i = (y * width + x) * 4;
        const value = [0, 1, 2, 3].map(channel => both * this.globalAlpha * (
          texel(fx0, fy0, channel) * (1 - fx) * (1 - fy) + texel(fx0 + 1, fy0, channel) * fx * (1 - fy)
          + texel(fx0, fy0 + 1, channel) * (1 - fx) * fy + texel(fx0 + 1, fy0 + 1, channel) * fx * fy));
        // What of the pixel underneath stays.
        const kept = mode === 'lighter' ? 1 : mode === 'copy' ? 1 - clipped : 1 - value[3] / 255;
        for (let channel = 0; channel < 4; channel++) data[i + channel] = Math.round(value[channel] + data[i + channel] * kept);
      }
    }
  }

  /** Straight alpha, as Canvas returns it. */
  getImageData(x: number, y: number, width: number, height: number): Pixels {
    this.count('getImageData');
    const out = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const i = ((y + row) * this.canvas.width + x + column) * 4, j = (row * width + column) * 4;
        const a = this.canvas.data[i + 3];
        for (let channel = 0; channel < 3; channel++) out[j + channel] = a ? Math.round(this.canvas.data[i + channel] * 255 / a) : 0;
        out[j + 3] = a;
      }
    }
    return { data: out, width, height };
  }

  createImageData(width: number, height: number): Pixels { return { data: new Uint8ClampedArray(width * height * 4), width, height }; }

  putImageData(image: Pixels, x: number, y: number) {
    this.count('putImageData');
    for (let row = 0; row < image.height; row++) {
      for (let column = 0; column < image.width; column++) {
        const i = ((y + row) * this.canvas.width + x + column) * 4, j = (row * image.width + column) * 4;
        const a = image.data[j + 3];
        for (let channel = 0; channel < 3; channel++) this.canvas.data[i + channel] = Math.round(image.data[j + channel] * a / 255);
        this.canvas.data[i + 3] = a;
      }
    }
  }
}

/** A software canvas's context, `width` × `height`, holding the straight-alpha `pixels` when given. */
export function surface(width: number, height: number, pixels?: Uint8ClampedArray) {
  const context = new SoftwareCanvas(width, height).getContext();
  if (pixels) context.putImageData({ data: pixels, width, height }, 0, 0);
  return context;
}
