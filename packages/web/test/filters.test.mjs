import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyFilters } from '../src/filters.ts';

const applyColorFilters = (pixels, width, filters, content) =>
  applyFilters(pixels, width, filters, content ? { content } : {});

// What the GPU renderer drew for a #c06030 rect at 8,8 to 56,56 of a
// 64x64 scene, with each filter, at three pixels: the centre, near the
// top-left corner, and near the right edge (`tests/color_filter.rs` in
// `celesta-gpu-renderer`, Apple M4). Its quantizer dithers, so a pixel may
// differ from the exact value by 1.
const GPU = [
  [{ type: 'brightness', amount: 0.6 }, [115, 57, 28], [115, 58, 29], [115, 57, 28]],
  [{ type: 'brightness', amount: 1.8 }, [255, 172, 86], [255, 173, 87], [255, 172, 86]],
  [{ type: 'contrast', amount: 0.4 }, [153, 114, 95], [153, 115, 96], [153, 115, 95]],
  [{ type: 'contrast', amount: 1.6 }, [230, 77, 0], [231, 77, 0], [230, 77, 0]],
  [{ type: 'saturation', amount: 0 }, [113, 113, 113], [113, 113, 113], [113, 113, 113]],
  [{ type: 'saturation', amount: 1.7 }, [247, 84, 2], [247, 84, 3], [247, 84, 2]],
  [{ type: 'hue', degrees: 90 }, [48, 140, 33], [48, 140, 34], [48, 140, 34]],
  [{ type: 'hue', degrees: -200 }, [16, 138, 147], [17, 138, 147], [16, 138, 147]],
  [{ type: 'grayscale', amount: 1 }, [113, 113, 113], [113, 113, 113], [113, 113, 113]],
  [{ type: 'grayscale', amount: 0.3 }, [168, 101, 67], [168, 101, 68], [168, 101, 67]],
  [{ type: 'invert', amount: 1 }, [63, 159, 207], [63, 159, 207], [63, 159, 207]],
  [{ type: 'invert', amount: 0.25 }, [159, 111, 87], [160, 112, 88], [159, 111, 87]],
  [{ type: 'tint', color: '#2040ff', amount: 0.5 }, [112, 80, 151], [112, 80, 152], [112, 80, 151]],
  [{ type: 'tint', color: '#ff000080', amount: 1 }, [223, 47, 24], [224, 48, 24], [223, 47, 24]],
  [{ type: 'vignette', amount: 0.8, radius: 0, softness: 1 }, [191, 95, 48], [42, 21, 11], [83, 41, 21]],
  [{ type: 'vignette', amount: 0.7, radius: 0.2, softness: 0.4 }, [192, 96, 48], [58, 29, 15], [57, 28, 14]],
];

function rect(color = [0xc0, 0x60, 0x30, 255]) {
  const pixels = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 8; y < 56; y++) {
    for (let x = 8; x < 56; x++) pixels.set(color, (y * 64 + x) * 4);
  }
  return pixels;
}

const at = (pixels, x, y) => Array.from(pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));

test('each filter matches what the GPU renderer draws', () => {
  for (const [filter, ...expected] of GPU) {
    const pixels = rect();
    // What the layers cover, 2 pixels wider as the GPU reckons it.
    assert.deepEqual(applyColorFilters(pixels, 64, [filter]), [6, 6, 58, 58]);
    for (const [index, [x, y]] of [[32, 32], [9, 10], [50, 20]].entries()) {
      const actual = at(pixels, x, y);
      const near = actual.every((value, i) => Math.abs(value - [...expected[index], 255][i]) <= 1);
      assert.ok(near, `${JSON.stringify(filter)} at ${x},${y}: ${actual} is not within 1 of ${expected[index]}`);
    }
    assert.deepEqual(at(pixels, 2, 2), [0, 0, 0, 0], 'outside the layer');
  }
});

test('filters run in order, each clamping its result, and keep alpha', () => {
  const pixels = rect([0, 255, 0, 128]);
  applyColorFilters(pixels, 64, [{ type: 'brightness', amount: 4 }, { type: 'brightness', amount: 0.5 }]);
  assert.deepEqual(at(pixels, 20, 20), [0, 128, 0, 128]);
  const inverted = rect([0, 255, 0, 255]);
  applyColorFilters(inverted, 64, [{ type: 'invert', amount: 1 }, { type: 'grayscale', amount: 1 }]);
  assert.deepEqual(at(inverted, 20, 20), [73, 73, 73, 255]);
});

test('a transparent layer has no content box and is left alone', () => {
  const pixels = new Uint8ClampedArray(16 * 4);
  assert.equal(applyColorFilters(pixels, 4, [{ type: 'invert', amount: 1 }]), null);
  assert.ok(pixels.every((value) => value === 0));
});

test('a vignette follows the content box it is given, not the pixels', () => {
  const vignette = [{ type: 'vignette', amount: 1, radius: 0.5, softness: 0 }];
  // The rect's pixels are 8..56; its shapes' box reaches to 104, so the
  // rect lies in the box's left half and its left edge is darkened.
  const pixels = rect([255, 255, 255, 255]);
  assert.deepEqual(applyColorFilters(pixels, 64, vignette, [8, 8, 104, 56]), [6, 6, 64, 58]);
  assert.deepEqual(at(pixels, 9, 32), [0, 0, 0, 255]);
  assert.deepEqual(at(pixels, 55, 32), [255, 255, 255, 255]);
  // By the pixels alone, both edges would be darkened alike.
  const alone = rect([255, 255, 255, 255]);
  applyColorFilters(alone, 64, vignette);
  assert.deepEqual(at(alone, 9, 32), at(alone, 54, 32));
});

// A test pattern the GPU renderer drew in a 48x48 scene, its content box
// 8..40, and what it drew with each stylize effect and the chroma key: raw
// premultiplied RGBA (`write_web_effect_fixtures` in `celesta-gpu-renderer`,
// Apple M4).
const FIXTURES = new URL('./fixtures/effects/', import.meta.url);
const EFFECTS = [
  ['pixelate', { type: 'pixelate', size: 6 }],
  ['halftone', { type: 'halftone', size: 6, angle: 30 }],
  ['chromatic-aberration', { type: 'chromaticAberration', offset: 3, angle: 20 }],
  ['wave', { type: 'wave', amplitude: 3, wavelength: 16, phase: 40, angle: 0 }],
  ['noise', { type: 'noise', amount: 0.3, seed: 0x10007, monochrome: false }],
  ['noise-monochrome', { type: 'noise', amount: 0.3, seed: 7, monochrome: true }],
  ['scanlines', { type: 'scanlines', amount: 0.6, spacing: 4, thickness: 0.5, offset: 1 }],
  ['zoom-blur', { type: 'zoomBlur', amount: 0.3, centerX: 0.4, centerY: 0.6 }],
  ['chroma-key', { type: 'chromaKey', color: '#00b140', tolerance: 0.2, softness: 0.1, spill: 0.5 }],
];

/** Straight RGBA, as `getImageData` gives, of premultiplied bytes. */
function straight(premultiplied) {
  const pixels = new Uint8ClampedArray(premultiplied.length);
  for (let at = 0; at < pixels.length; at += 4) {
    const alpha = premultiplied[at + 3];
    for (let i = 0; i < 3; i++) pixels[at + i] = alpha ? Math.round(premultiplied[at + i] * 255 / alpha) : 0;
    pixels[at + 3] = alpha;
  }
  return pixels;
}

test('each stylize effect and the chroma key match what the GPU renderer draws', () => {
  const source = readFileSync(new URL('source.rgba', FIXTURES));
  for (const [name, filter] of EFFECTS) {
    const pixels = straight(source);
    applyFilters(pixels, 48, [filter], { content: [8, 8, 40, 40] });
    const expected = readFileSync(new URL(`${name}.rgba`, FIXTURES));
    // Compared premultiplied, as the GPU stores them. The GPU's quantizer
    // dithers, and its canvases hold more than 8 bits between the drawing
    // and the filter, so a channel may differ by 2.
    let worst = 0, where = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      const alpha = pixels[at + 3];
      for (let i = 0; i < 4; i++) {
        const actual = i === 3 ? alpha : Math.round(pixels[at + i] * alpha / 255);
        const difference = Math.abs(actual - expected[at + i]);
        if (difference > worst) [worst, where] = [difference, at / 4];
      }
    }
    const [x, y] = [where % 48, Math.floor(where / 48)];
    assert.ok(worst <= 2, `${name}: ${worst} at ${x},${y}`);
  }
});
