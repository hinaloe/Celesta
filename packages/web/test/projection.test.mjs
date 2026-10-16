import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IDENTITY3, effectScale, facesAway, homography, invert3, isProjective, linear, multiply3, perspectiveDistance,
  planeRaster, project, projectedBounds, stretchAt, tapCount, warp,
} from '../src/projection.ts';

// The values of `celesta_composition`'s and `celesta_gpu_renderer::plane`'s tests.
const close = (a, b) => a.flat().every((value, i) => Math.abs(value - b.flat()[i]) < 1e-9);
const transform = (extra = {}) => ({ position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, ...extra });
const SCREEN = [0, 0, 1920, 1080];

test('the default transform is the identity', () => {
  const t = transform();
  assert.ok(close(linear(t), IDENTITY3) && close(homography(t), IDENTITY3));
  assert.ok(!isProjective(t));
});

test('skew shears by the tangent', () => {
  assert.ok(close(linear(transform({ skew: { x: 45, y: 0 } })), [[1, 1, 0], [0, 1, 0], [0, 0, 1]]));
});

test('orthographic rotationY is affine', () => {
  const t = transform({ rotationY: 60 });
  assert.ok(close(homography(t), [[0.5, 0, 0], [0, 1, 0], [0, 0, 1]]));
  assert.ok(!isProjective(t));
});

test('a perspective rotationY turns the right edge away', () => {
  const t = transform({ position: { x: 10, y: 20 }, rotationY: 90, perspective: 1000 });
  const h = homography(t);
  assert.ok(Math.abs(h[2][0] - 0.001) < 1e-12 && Math.abs(h[2][1]) < 1e-12 && h[2][2] === 1);
  assert.ok(Math.abs(h[0][2] - 10) < 1e-12 && Math.abs(h[1][2] - 20) < 1e-12);
  assert.ok(isProjective(t));
  assert.ok(project(h, 100, 0)[2] > 1, 'farther');
});

test('a perspective distance must be finite and positive', () => {
  for (const [value, expected] of [[500, 500], [0, null], [-1, null], [NaN, null], [Infinity, null]]) {
    const t = transform({ perspective: value, rotationY: 30 });
    assert.equal(perspectiveDistance(t), expected);
    assert.equal(isProjective(t), expected !== null);
  }
  assert.equal(perspectiveDistance(transform({ rotationY: 30 })), null);
});

test('a skew of ninety degrees is not projective', () => {
  assert.ok(!isProjective(transform({ skew: { x: 90, y: 0 }, perspective: 500 })));
});

test('facing follows the accumulated orientation', () => {
  const ry = degrees => linear(transform({ rotationY: degrees }));
  assert.ok(!facesAway(IDENTITY3));
  assert.ok(!facesAway(linear(transform({ scale: { x: -1, y: 1 } }))));
  assert.ok(facesAway(ry(180)));
  assert.ok(!facesAway(ry(90)));
  assert.ok(!facesAway(multiply3(ry(100), ry(180))));
  assert.ok(facesAway(multiply3(ry(30), ry(180))));
});

test('stretch is null behind the viewer', () => {
  const h = [[1, 0, 0], [0, 1, 0], [0.01, 0, 1]];
  assert.ok(Math.abs(stretchAt(h, 0, 0) - 1) < 1e-9);
  assert.equal(stretchAt(h, -200, 0), null);
});

test('inverting a singular matrix gives null', () => {
  assert.equal(invert3([[1, 2, 0], [2, 4, 0], [0, 0, 1]]), null);
  assert.ok(close(multiply3(invert3([[2, 1, 3], [0, 1, 4], [0.5, 0, 1]]), [[2, 1, 3], [0, 1, 4], [0.5, 0, 1]]), IDENTITY3));
});

test('the projected bounds of an affine canvas are its box', () => {
  assert.deepEqual(projectedBounds(IDENTITY3, 10, 20), [-2, -2, 12, 22]);
});

test('the projected bounds drop what is behind the viewer', () => {
  const bounds = projectedBounds([[1, 0, 0], [0, 1, 0], [-0.01, 0, 1]], 200, 10);
  assert.ok(bounds.every(Number.isFinite), String(bounds));
  assert.equal(bounds[0], -2);
});

test('the plane raster of an unscaled layer', () => {
  assert.deepEqual(planeRaster(IDENTITY3, [0, 0, 100, 50], SCREEN, 8192), { scale: 1, left: 0, top: 0, width: 102, height: 52 });
});

test('the plane raster follows a scale', () => {
  const raster = planeRaster([[2, 0, 0], [0, 2, 0], [0, 0, 1]], [0, 0, 100, 50], SCREEN, 8192);
  assert.equal(raster.scale, 2);
  assert.equal(raster.width, 202);
});

test('the plane raster covers the nearest corner', () => {
  const forward = homography(transform({ position: { x: 500, y: 500 }, rotationY: 60, perspective: 1000 }));
  const raster = planeRaster(forward, [-100, -100, 100, 100], SCREEN, 8192);
  for (const [x, y] of [[-100, -100], [100, -100], [100, 100], [-100, 100]]) {
    const stretch = stretchAt(forward, x, y);
    assert.ok(raster.scale >= stretch, `${raster.scale} < ${stretch}`);
  }
  const steps = Math.log2(raster.scale) * 8;
  assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, String(steps));
});

test('the plane raster is limited to the visible part', () => {
  const raster = planeRaster(IDENTITY3, [-1e6, -1e6, 1e6, 1e6], SCREEN, 8192);
  assert.deepEqual([raster.width, raster.height], [1922, 1082]);
});

test('the plane raster stays within the size limit', () => {
  const raster = planeRaster(IDENTITY3, [0, 0, 10000, 10], [0, 0, 20000, 20000], 8192);
  assert.ok(raster.width <= 8192, String(raster.width));
  assert.ok(raster.scale < 1, String(raster.scale));
});

test('the plane raster stays within the area limit', () => {
  const raster = planeRaster(IDENTITY3, [0, 0, 1000, 1000], [0, 0, 2000, 2000], 8192, 4 * 100 * 100);
  const area = raster.width * raster.height;
  assert.ok(area <= 4 * 100 * 100, String(area));
  assert.ok(raster.scale < 1, String(raster.scale));
  assert.ok(area > 3 * 100 * 100, `the scale is lowered no more than needed: ${area}`);
});

test('the effect scale is one for a flat plane', () => {
  assert.equal(effectScale(IDENTITY3, { scale: 1, left: 0, top: 0, width: 10, height: 10 }), 1);
});

test('the effect scale follows the raster against the projection', () => {
  // Rasterized 25% finer than the layer is drawn, so a plane pixel is 80%
  // of an output pixel.
  assert.equal(effectScale([[2, 0, 0], [0, 2, 0], [0, 0, 1]], { scale: 2.5, left: 0, top: 0, width: 10, height: 10 }), 1.25);
});

const filled = (width, height, rgba) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
  return pixels;
};

test('warping through a scale fills the target', () => {
  const source = filled(4, 4, [255, 0, 0, 255]);
  const target = new Uint8ClampedArray(8 * 8 * 4);
  // Scale(2) onto the target, so the target maps back through Scale(1/2).
  warp(source, 4, 4, target, 8, invert3([[2, 0, 0], [0, 2, 0], [0, 0, 1]]), [0, 0, 8, 8]);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const [r, g, b, a] = target.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4);
      assert.deepEqual([r, g, b], [255, 0, 0], `${x}, ${y}`);
      // The edges are antialiased against the transparent texels past the source.
      const inner = x > 0 && x < 7 && y > 0 && y < 7;
      assert.ok(inner ? a === 255 : a > 0, `${x}, ${y}: ${a}`);
    }
  }
});

test('warping leaves what is behind or too near the viewer as it was', () => {
  // The plane is at w = 0.02 + 0.1·x: nearer than 1/16 for x < 0.425,
  // which lands left of 6.8 on the target; the target past 10 comes from
  // behind the viewer.
  const forward = [[1, 0, 0], [0, 1, 0], [0.1, 0, 0.02]];
  const toSource = invert3(forward);
  const source = filled(8, 8, [255, 0, 0, 255]);
  const target = filled(12, 1, [0, 0, 255, 255]);
  warp(source, 8, 8, target, 12, toSource, [0, 0, 12, 1]);
  const changed = Array.from({ length: 12 }, (_, x) => target[x * 4 + 2] !== 255);
  assert.deepEqual(changed, [false, false, false, false, false, false, false, true, true, true, false, false]);
  for (let x = 0; x < 12; x++) {
    const w = project(toSource, x + 0.5, 0.5)[2];
    if (!changed[x]) assert.ok(!(w > 0) || 1 / w < 1 / 16, `${x}: ${w}`);
  }
});

test('warping averages the footprint of a minified pixel', () => {
  // One opaque column of eight: a single tap at the pixel's centre would
  // miss it.
  const source = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < 8; y++) source.set([255, 255, 255, 255], y * 8 * 4);
  const target = new Uint8ClampedArray(4);
  warp(source, 8, 8, target, 1, [[8, 0, 0], [0, 8, 0], [0, 0, 1]], [0, 0, 1, 1]);
  assert.deepEqual(Array.from(target), [255, 255, 255, 32]);
});

test('a minified pixel takes a tap per texel it covers, up to 8 by 8', () => {
  assert.deepEqual(tapCount([[8, 0, 0], [0, 8, 0], [0, 0, 1]], 0.5, 0.5), [8, 8]);
  assert.deepEqual(tapCount([[20, 0, 0], [0, 0.5, 0], [0, 0, 1]], 0.5, 0.5), [8, 1]);
  assert.deepEqual(tapCount(IDENTITY3, 0.5, 0.5), [1, 1]);
});
