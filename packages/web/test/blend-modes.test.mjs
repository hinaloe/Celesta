import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLEND_MODES, blendColor, blendPixels, coveredBox } from '../src/blend-modes.ts';

const close = (a, b) => Math.abs(a - b) < 1e-9;
const mix = (mode, backdrop, source) => blendColor(mode, [backdrop, backdrop, backdrop], [source, source, source])[0];

test('every mode the native renderers know, in camelCase', () => {
  assert.deepEqual([...BLEND_MODES].sort(), [
    'add', 'color', 'colorBurn', 'colorDodge', 'darken', 'difference', 'exclusion', 'hardLight',
    'hue', 'lighten', 'luminosity', 'multiply', 'normal', 'overlay', 'saturation', 'screen', 'softLight',
  ]);
  assert.throws(() => blendColor('color-dodge', [0, 0, 0], [0, 0, 0]), /Unsupported blend mode: color-dodge/);
});

test('separable modes follow the spec formulas', () => {
  // The values of `celesta_composition`'s `separable_modes_follow_the_spec_formulas`.
  const cases = [
    ['multiply', 0.5, 0.5, 0.25], ['screen', 0.5, 0.5, 0.75],
    ['overlay', 0.25, 0.5, 0.25], ['overlay', 0.75, 0.5, 0.75],
    ['add', 0.7, 0.6, 1], ['difference', 0.3, 0.8, 0.5],
    ['darken', 0.3, 0.6, 0.3], ['lighten', 0.3, 0.6, 0.6],
    ['colorDodge', 0.25, 0.5, 0.5], ['colorDodge', 0.75, 0.5, 1],
    ['colorDodge', 0, 1, 0], ['colorDodge', 0.4, 1, 1],
    ['colorBurn', 0.75, 0.5, 0.5], ['colorBurn', 0.25, 0.5, 0],
    ['colorBurn', 1, 0, 1], ['colorBurn', 0.4, 0, 0],
    ['hardLight', 0.5, 0.25, 0.25], ['hardLight', 0.5, 0.75, 0.75],
    ['softLight', 0.5, 0, 0.25], ['softLight', 0.25, 0.75, 0.375], ['softLight', 0.64, 1, 0.8],
    ['exclusion', 0.5, 0.5, 0.5], ['exclusion', 0.25, 1, 0.75],
  ];
  for (const [mode, backdrop, source, expected] of cases) {
    const actual = mix(mode, backdrop, source);
    assert.ok(close(actual, expected), `${mode}(${backdrop}, ${source}) = ${actual}, expected ${expected}`);
  }
});

test('non-separable modes follow the spec formulas', () => {
  const gray = [0.5, 0.5, 0.5], red = [1, 0, 0];
  const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
  const near = (a, b) => a.every((value, i) => close(value, b[i]));
  const k = 0.5 - 0.3 * 0.5 / 0.7;
  assert.ok(near(blendColor('color', gray, red), [1, k, k]));
  assert.ok(near(blendColor('hue', gray, red), gray));
  assert.ok(near(blendColor('saturation', gray, red), gray));
  assert.ok(near(blendColor('luminosity', gray, red), [0.3, 0.3, 0.3]));
  const orange = [0.8, 0.4, 0.2];
  const l = lum(orange);
  const lifted = [0, 0, 0.6].map(c => c + l - 0.066);
  assert.ok(near(blendColor('hue', orange, [0, 0, 1]), lifted.map(c => l + (c - l) * (1 - l) / (lifted[2] - l))));
});

test('blended pixels match the native renderers', () => {
  // `celesta_renderer`'s `blends_each_mode_with_the_backdrop`: an opaque
  // (100, 200, 250) over an opaque (200, 100, 50).
  const expected = {
    normal: [100, 200, 250], multiply: [78, 78, 49], screen: [222, 222, 251], overlay: [188, 157, 98],
    add: [255, 255, 255], difference: [100, 100, 200], darken: [100, 100, 50], lighten: [200, 200, 250],
    exclusion: [143, 143, 202], luminosity: [251, 151, 101],
  };
  for (const [mode, color] of Object.entries(expected)) {
    const source = Uint8ClampedArray.from([100, 200, 250, 255]);
    blendPixels(mode, source, 1, Uint8ClampedArray.from([200, 100, 50, 255]), [0, 0, 1, 1]);
    assert.deepEqual([...source], [...color, 255], mode);
  }
});

test('blending mixes by the backdrop\'s alpha and only inside the box', () => {
  // Two rows of two; the box is the right column.
  const source = Uint8ClampedArray.from([
    10, 20, 30, 255, 100, 200, 250, 128,
    10, 20, 30, 255, 100, 200, 250, 0,
  ]);
  const backdrop = Uint8ClampedArray.from([200, 100, 50, 0, 0, 0, 0, 0]);
  blendPixels('difference', source, 2, backdrop, [1, 0, 2, 2]);
  // Over nothing the source keeps its color, and its alpha is untouched.
  assert.deepEqual([...source.slice(4, 8)], [100, 200, 250, 128]);
  const half = Uint8ClampedArray.from([100, 200, 250, 255]);
  blendPixels('difference', half, 1, Uint8ClampedArray.from([200, 100, 50, 128]), [0, 0, 1, 1]);
  // (1 - ab) * Cs + ab * |Cb - Cs| with ab = 128 / 255.
  const ab = 128 / 255;
  assert.deepEqual([...half], [100, 200, 250].map((cs, i) => Math.round((1 - ab) * cs + ab * Math.abs([200, 100, 50][i] - cs))).concat(255));
  assert.deepEqual([...source.slice(0, 4)], [10, 20, 30, 255], 'outside the box');
});

test('the covered box spans the pixels with alpha', () => {
  const pixels = new Uint8ClampedArray(4 * 3 * 4);
  assert.equal(coveredBox(pixels, 4, 3), null);
  pixels[(1 * 4 + 1) * 4 + 3] = 1;
  pixels[(2 * 4 + 2) * 4 + 3] = 255;
  assert.deepEqual(coveredBox(pixels, 4, 3), [1, 1, 3, 3]);
});
