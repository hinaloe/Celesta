import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IDENTITY3, effectScale, facesAway, homography, invert3, isProjective, linear, multiply3, perspectiveDistance,
  planeBands, planeRaster, project, projectedBounds, stretchAt, tapCount, translation, turnFlat, turnsFlat, warp,
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

// Equal entry for entry, a zero of either sign matching either.
const same = (a, b) => a.flat().every((value, i) => value === b.flat()[i]);
// Rotations and scales a flat layer takes, mirrors and zeros included.
const flatTransforms = [0, -0, 30, -45, 90, 180, 360, 1234.5].flatMap(rotation =>
  [[1, 1], [2, 0.5], [-1, 1], [0, 3]].map(([x, y]) => transform({ position: { x: 12, y: -7 }, scale: { x, y }, rotation })));

test('a flat linear part is the general one', () => {
  const r = degrees => degrees * Math.PI / 180;
  // `linear` the long way: Rx · Ry · Rz · K · S.
  const general = t => {
    const [sz, cz] = [Math.sin(r(t.rotation)), Math.cos(r(t.rotation))];
    let m = multiply3([[1, Math.tan(r(0)), 0], [Math.tan(r(0)), 1, 0], [0, 0, 1]], [[t.scale.x, 0, 0], [0, t.scale.y, 0], [0, 0, 1]]);
    m = multiply3([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], m);
    m = multiply3([[Math.cos(0), 0, Math.sin(0)], [0, 1, 0], [-Math.sin(0), 0, Math.cos(0)]], m);
    return multiply3([[1, 0, 0], [0, Math.cos(0), -Math.sin(0)], [0, Math.sin(0), Math.cos(0)]], m);
  };
  for (const t of flatTransforms) {
    assert.ok(turnsFlat(t));
    assert.ok(same(linear(t), general(t)), JSON.stringify(t));
  }
  assert.ok(!turnsFlat(transform({ rotationX: 1e-9 })));
});

test('turning an orientation through a flat layer is the general product', () => {
  const orientation = linear(transform({ rotationX: 30, rotationY: -60, rotation: 10, skew: { x: 5, y: 0 } }));
  for (const t of flatTransforms) {
    for (const o of [IDENTITY3, orientation]) assert.ok(same(turnFlat(o, t), multiply3(o, linear(t))), JSON.stringify(t));
  }
  // The identity's leaves the orientation itself.
  assert.equal(turnFlat(orientation, transform()), orientation);
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

test('an origin is a nested group moved back', () => {
  const origin = { x: 960, y: 540 };
  for (const [perspective, rotationY, rotation, scale] of [[2000, 40, 0, 1], [undefined, 0, 30, 1.5], [800, -70, 10, 0.5]]) {
    const turn = { rotationY, rotation, scale: { x: scale, y: scale }, ...(perspective ? { perspective } : {}) };
    const t = transform({ position: { x: 12, y: -7 }, origin, ...turn });
    const outer = transform({ position: { x: 972, y: 533 }, ...turn });
    const inner = transform({ position: { x: -960, y: -540 } });
    assert.ok(close(homography(t), multiply3(homography(outer), homography(inner))), JSON.stringify(t));
    const [x, y] = project(homography(t), origin.x, origin.y);
    assert.ok(Math.abs(x - 972) < 1e-9 && Math.abs(y - 533) < 1e-9);
  }
});

test('the translation is the affine homography offset', () => {
  const t = transform({ position: { x: 5, y: 6 }, origin: { x: 100, y: 50 }, rotation: 90, scale: { x: 2, y: 1 } });
  const h = homography(t);
  const { x, y } = translation(t, linear(t));
  assert.ok(Math.abs(x - h[0][2]) < 1e-9 && Math.abs(y - h[1][2]) < 1e-9);
  const still = transform({ position: { x: 5, y: 6 }, origin: { x: 100, y: 50 } });
  assert.deepEqual(translation(still, linear(still)), still.position);
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

// The example's floor, whose horizon shows: the screen's top corners map behind it.
const floor = () => homography(transform({ position: { x: 960, y: 800 }, anchor: { x: 0, y: 0 }, rotationX: 60, perspective: 900 }));

test('the plane raster of a floor is scaled by what shows of its near edge', () => {
  // The near corners are far off either side of the screen.
  const forward = floor();
  const raster = planeRaster(forward, [-900, -750, 900, 294], SCREEN, 8192);
  for (let i = -64; i <= 64; i++) {
    const x = i * 900 / 64;
    const screenX = project(forward, x, 294)[0];
    if (screenX < 0 || screenX > 1920) continue;
    const stretch = stretchAt(forward, x, 294);
    assert.ok(raster.scale >= stretch, `${raster.scale} < ${stretch}`);
  }
  const offScreen = stretchAt(forward, 900, 294);
  assert.ok(raster.scale < offScreen, `${raster.scale} >= ${offScreen}`);
});

test('the plane raster of a floor past the screen bottom is scaled by the bottom', () => {
  // The near part runs off the bottom of the screen and then behind the
  // viewer; what shows ends at the screen's bottom edge.
  const forward = floor();
  const raster = planeRaster(forward, [-900, -750, 900, 1500], SCREEN, 8192);
  const inverse = invert3(forward);
  const bottom = Math.max(...[0, 1920].map(x => {
    const [lx, ly] = project(inverse, x, 1080);
    return stretchAt(forward, lx, ly);
  }));
  assert.equal(raster.scale, 2 ** (Math.ceil(Math.log2(bottom) * 8) / 8));
  assert.ok(raster.width < 8192 && raster.height < 8192, JSON.stringify(raster));
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

test('warping skips footprints over transparent texels only, and reads texels at the edges', () => {
  // Shown texels only at a corner and in the middle of a 64×64 source,
  // minified 4× so each pixel's footprint spans 4×4 texels.
  const source = new Uint8ClampedArray(64 * 64 * 4);
  for (const [x, y] of [[0, 0], [41, 41]]) source.set([255, 0, 0, 255], (y * 64 + x) * 4);
  const target = filled(16, 16, [0, 0, 255, 255]);
  warp(source, 64, 64, target, 16, [[4, 0, 0], [0, 4, 0], [0, 0, 1]], [0, 0, 16, 16]);
  const at = (x, y) => [...target.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  assert.ok(at(0, 0)[0] > 0, `the corner texel shows: ${at(0, 0)}`);
  assert.ok(at(10, 10)[0] > 0, `the middle texel shows: ${at(10, 10)}`);
  assert.deepEqual(at(5, 5), [0, 0, 255, 255], 'nothing drawn over transparent texels');
});

// The crawl of `celesta_gpu_renderer::plane`'s band tests: a column 20000
// tall receding from near the screen's bottom.
const crawl = homography(transform({ position: { x: 960, y: 900 }, rotationX: 70, perspective: 800, anchor: { x: 0, y: 0 } }));
const CRAWL = [-600, -19724, 600, 276];
const SCENE_AREA = 1920 * 1080;
const crawlBands = maxArea => planeBands(crawl, CRAWL, SCREEN, 16384, maxArea, 0, true);

test('an uncapped plane is one band, its raster planeRaster\'s', () => {
  const forward = homography(transform({ position: { x: 960, y: 800 }, rotationX: 60, perspective: 900 }));
  const local = [-900, -750, 900, 294];
  assert.deepEqual(planeBands(forward, local, SCREEN, 8192, Infinity, 0, true), [{ raster: planeRaster(forward, local, SCREEN, 8192), near: null, far: null }]);
});

test('a capped crawl is split into eight bands, as on the GPU', () => {
  const bands = crawlBands(4 * SCENE_AREA);
  assert.equal(bands.length, 8);
  assert.ok(Math.abs(bands[0].raster.scale - 2.378) < 1e-3, `${bands[0].raster.scale}`);
  assert.ok(Math.abs(bands[7].raster.scale - 0.068) < 1e-3, `${bands[7].raster.scale}`);
  assert.equal(bands[0].near, null);
  assert.equal(bands[7].far, null);
  assert.ok(planeRaster(crawl, CRAWL, SCREEN, 16384, 4 * SCENE_AREA).scale < 0.6);
});

test('bands share their boundaries, in equal steps of w', () => {
  const bands = crawlBands(4 * SCENE_AREA);
  for (let k = 0; k + 1 < bands.length; k++) assert.equal(bands[k].far, bands[k + 1].near);
  const ratios = bands.slice(1, 7).map(band => band.far / band.near);
  for (const ratio of ratios) assert.ok(Math.abs(ratio - ratios[0]) < 1e-9);
  assert.ok(Math.abs(bands[1].near / ratios[0] - 0.6758) < 1e-3);
});

test('bands stay within the budget, and unbandable planes stay one canvas', () => {
  const bands = crawlBands(1_000_000);
  const area = bands.reduce((sum, band) => sum + band.raster.width * band.raster.height, 0);
  assert.ok(area <= 1_000_000, `${area}`);
  assert.ok(bands[0].raster.scale > planeRaster(crawl, CRAWL, SCREEN, 16384, 1_000_000).scale);
  assert.deepEqual(planeBands(crawl, CRAWL, SCREEN, 16384, 4 * SCENE_AREA, 0, false), [{ raster: planeRaster(crawl, CRAWL, SCREEN, 16384, 4 * SCENE_AREA), near: null, far: null }]);
});

test('a wider seam widens the bands\' overlap but not their boundaries or scales', () => {
  const tight = crawlBands(4 * SCENE_AREA);
  const wide = planeBands(crawl, CRAWL, SCREEN, 16384, 4 * SCENE_AREA, 0, true, 5.5);
  assert.deepEqual(wide.map(({ near, far, raster }) => [near, far, raster.scale]), tight.map(({ near, far, raster }) => [near, far, raster.scale]));
  assert.ok(wide[1].raster.height > tight[1].raster.height, `${wide[1].raster.height} vs ${tight[1].raster.height}`);
});
