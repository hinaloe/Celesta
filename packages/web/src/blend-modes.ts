import type { Layer } from './types';

export type BlendMode = NonNullable<Layer['blendMode']>;
type RGB = [number, number, number];
type Mix = (backdrop: number, source: number) => number;

const screen: Mix = (b, s) => b + s - b * s;
const hardLight: Mix = (b, s) => s <= 0.5 ? b * 2 * s : screen(b, 2 * s - 1);
const colorDodge: Mix = (b, s) => b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s));
const colorBurn: Mix = (b, s) => b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
const softLight: Mix = (b, s) => {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
};

const separable: Partial<Record<BlendMode, Mix>> = {
  normal: (_, s) => s,
  multiply: (b, s) => b * s,
  screen,
  overlay: (b, s) => hardLight(s, b),
  add: (b, s) => Math.min(1, b + s),
  difference: (b, s) => Math.abs(b - s),
  darken: Math.min,
  lighten: Math.max,
  colorDodge,
  colorBurn,
  hardLight,
  softLight,
  exclusion: (b, s) => b + s - 2 * b * s,
};

// The spec's luminosity weights, not Rec. 709.
const lum = ([r, g, b]: RGB) => 0.3 * r + 0.59 * g + 0.11 * b;
const sat = (c: RGB) => Math.max(...c) - Math.min(...c);

function clipColor(color: RGB): RGB {
  const l = lum(color), n = Math.min(...color), x = Math.max(...color);
  let c = color;
  if (n < 0 && l > n) c = c.map(v => l + (v - l) * l / (l - n)) as RGB;
  if (x > 1 && x > l) c = c.map(v => l + (v - l) * (1 - l) / (x - l)) as RGB;
  return c.map(v => Math.min(1, Math.max(0, v))) as RGB;
}

function setLum(color: RGB, l: number): RGB {
  const d = l - lum(color);
  return clipColor(color.map(v => v + d) as RGB);
}

// The largest channel becomes `s`, the smallest 0, the middle one in between.
function setSat(color: RGB, s: number): RGB {
  const n = Math.min(...color), x = Math.max(...color);
  return x > n ? color.map(v => (v - n) * s / (x - n)) as RGB : [0, 0, 0];
}

const nonSeparable: Partial<Record<BlendMode, (b: RGB, s: RGB) => RGB>> = {
  hue: (b, s) => setLum(setSat(s, sat(b)), lum(b)),
  saturation: (b, s) => setLum(setSat(b, sat(s)), lum(b)),
  color: (b, s) => setLum(s, lum(b)),
  luminosity: (b, s) => setLum(b, lum(s)),
};

export const BLEND_MODES = [...Object.keys(separable), ...Object.keys(nonSeparable)] as BlendMode[];

/**
 * The W3C Compositing and Blending `B(Cb, Cs)` of non-premultiplied colors
 * in 0–1, as `celesta_composition::BlendMode::blend` computes it.
 */
export function blendColor(mode: BlendMode, backdrop: RGB, source: RGB): RGB {
  const mix = separable[mode];
  if (mix) return [0, 1, 2].map(i => mix(backdrop[i], source[i])) as RGB;
  const whole = nonSeparable[mode];
  if (!whole) throw new Error(`Unsupported blend mode: ${mode}`);
  return whole(backdrop, source);
}

/**
 * Replaces each color of `source` (straight RGBA, `width` pixels a row) in
 * the box `[left, top, right, bottom)` with `(1 - ab) * Cs + ab * B(Cb, Cs)`
 * against the same pixel of `backdrop`, which holds just that box. Drawn
 * source-over at the layer's opacity, the source then composites as the
 * spec's blending does.
 */
export function blendPixels(
  mode: BlendMode, source: Uint8ClampedArray, width: number,
  backdrop: Uint8ClampedArray, [left, top, right, bottom]: [number, number, number, number],
): void {
  const boxWidth = right - left;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const s = (y * width + x) * 4;
      if (source[s + 3] === 0) continue;
      const b = ((y - top) * boxWidth + (x - left)) * 4;
      const ab = backdrop[b + 3] / 255;
      if (ab === 0) continue;
      const cs: RGB = [source[s] / 255, source[s + 1] / 255, source[s + 2] / 255];
      const blended = blendColor(mode, [backdrop[b] / 255, backdrop[b + 1] / 255, backdrop[b + 2] / 255], cs);
      for (let i = 0; i < 3; i++) source[s + i] = Math.round(((1 - ab) * cs[i] + ab * blended[i]) * 255);
    }
  }
}

/** The box `[left, top, right, bottom)` of the pixels with any alpha, or null. */
export function coveredBox(pixels: Uint8ClampedArray, width: number, height: number): [number, number, number, number] | null {
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x >= right) right = x + 1;
      if (y < top) top = y;
      bottom = y + 1;
    }
  }
  return right > left ? [left, top, right, bottom] : null;
}
