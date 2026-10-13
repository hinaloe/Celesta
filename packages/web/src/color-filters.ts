import type { ColorFilter } from './types';

// Rec. 709 luma, as CSS `saturate()` and `grayscale()` use.
const LR = 0.2126, LG = 0.7152, LB = 0.0722;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function hexColor(color: string): [number, number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(color);
  if (!match) throw new Error(`Invalid tint color: ${color}`);
  return [match[1], match[2], match[3], match[4] ?? 'ff'].map(hex => parseInt(hex!, 16) / 255) as [number, number, number, number];
}

/** A filter's change to one straight color, in place: `rgb` 0–1, `u`/`v` the pixel's place in the content box. */
type Step = (rgb: number[], u: number, v: number) => void;

function step(filter: ColorFilter): Step {
  const saturate = (rgb: number[], amount: number) => {
    const luma = rgb[0] * LR + rgb[1] * LG + rgb[2] * LB;
    for (let i = 0; i < 3; i++) rgb[i] = luma + (rgb[i] - luma) * amount;
  };
  switch (filter.type) {
    case 'brightness': {
      const amount = Math.max(filter.amount, 0);
      return rgb => { for (let i = 0; i < 3; i++) rgb[i] *= amount; };
    }
    case 'contrast': {
      const amount = Math.max(filter.amount, 0);
      return rgb => { for (let i = 0; i < 3; i++) rgb[i] = (rgb[i] - 0.5) * amount + 0.5; };
    }
    case 'saturation': {
      const amount = Math.max(filter.amount, 0);
      return rgb => saturate(rgb, amount);
    }
    case 'grayscale': {
      const amount = 1 - clamp01(filter.amount);
      return rgb => saturate(rgb, amount);
    }
    case 'hue': {
      // CSS `hue-rotate()`.
      const angle = filter.degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
      const m = [
        LR + (1 - LR) * c - LR * s, LG - LG * c - LG * s, LB - LB * c + (1 - LB) * s,
        LR - LR * c + 0.143 * s, LG + (1 - LG) * c + 0.140 * s, LB - LB * c - 0.283 * s,
        LR - LR * c - (1 - LR) * s, LG - LG * c + LG * s, LB + (1 - LB) * c + LB * s,
      ];
      return rgb => {
        const [r, g, b] = rgb;
        rgb[0] = m[0] * r + m[1] * g + m[2] * b;
        rgb[1] = m[3] * r + m[4] * g + m[5] * b;
        rgb[2] = m[6] * r + m[7] * g + m[8] * b;
      };
    }
    case 'invert': {
      const amount = clamp01(filter.amount);
      return rgb => { for (let i = 0; i < 3; i++) rgb[i] += (1 - 2 * rgb[i]) * amount; };
    }
    case 'tint': {
      const [r, g, b, a] = hexColor(filter.color);
      const amount = clamp01(filter.amount) * a, color = [r, g, b];
      return rgb => { for (let i = 0; i < 3; i++) rgb[i] += (color[i] - rgb[i]) * amount; };
    }
    case 'vignette': {
      const amount = clamp01(filter.amount), softness = Math.max(filter.softness, 1e-4);
      return (rgb, u, v) => {
        // 0 at the content box's centre, 1 at its corners.
        const distance = Math.hypot(u - 0.5, v - 0.5) * Math.SQRT2;
        const t = clamp01((distance - filter.radius) / softness);
        const scale = 1 - amount * t * t * (3 - 2 * t);
        for (let i = 0; i < 3; i++) rgb[i] *= scale;
      };
    }
    default:
      throw new Error(`Unsupported filter: ${(filter as { type: string }).type}`);
  }
}

/**
 * Applies the built-in color `filters` in order to straight RGBA `pixels`
 * (`ImageData.data`) `width` pixels wide, as the GPU renderer's
 * `color_filter.wgsl` does: on the straight color, keeping alpha, each
 * clamping its result to 0–1. The content box a vignette follows is the box
 * of the pixels that are not transparent. Returns that box, or `null` when
 * every pixel is transparent.
 */
export function applyColorFilters(pixels: Uint8ClampedArray, width: number, filters: readonly ColorFilter[]): [number, number, number, number] | null {
  const height = pixels.length / 4 / width;
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x >= right) right = x + 1;
      if (y < top) top = y;
      if (y >= bottom) bottom = y + 1;
    }
  }
  if (right <= left) return null;
  const steps = filters.map(step);
  const rgb = [0, 0, 0];
  for (let y = top; y < bottom; y++) {
    const v = (y + 0.5 - top) / (bottom - top);
    for (let x = left; x < right; x++) {
      const at = (y * width + x) * 4;
      if (pixels[at + 3] === 0) continue;
      const u = (x + 0.5 - left) / (right - left);
      for (let i = 0; i < 3; i++) rgb[i] = pixels[at + i] / 255;
      for (const apply of steps) {
        apply(rgb, u, v);
        for (let i = 0; i < 3; i++) rgb[i] = clamp01(rgb[i]);
      }
      for (let i = 0; i < 3; i++) pixels[at + i] = Math.round(rgb[i] * 255);
    }
  }
  return [left, top, right, bottom];
}
