import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild-wasm';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { SoftwarePath, surface } from './software-canvas.mjs';

const directory = mkdtempSync(fileURLToPath(new URL('../node_modules/.plane-test-', import.meta.url)));
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/plane-pieces.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const modulePath = join(directory, 'plane-pieces.mjs');
writeFileSync(modulePath, result.outputFiles[0].text);
const { drawPlane, planePieces } = await import(pathToFileURL(modulePath));
rmSync(directory, { recursive: true });
const { NEAR_W, homography, invert3, multiply3, planeRaster, project, projectedBounds, toPlane, warp } = await import('../src/projection.ts');
globalThis.Path2D = SoftwarePath;

const WIDTH = 200, HEIGHT = 140;

/** A pseudo-random sequence from `seed`, so a failure repeats. */
function randomFrom(seed) {
  return (low, high) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return low + (high - low) * seed / 2147483648;
  };
}

/**
 * A plane as `SceneCanvas` draws one: the raster of `local` (layer units)
 * through `transform`, and the map from target pixels to its pixels.
 */
function plane(transform, local, width = WIDTH, height = HEIGHT) {
  const forward = homography({ scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 }, ...transform });
  const raster = planeRaster(forward, local, [0, 0, width, height], 8192, 4 * width * height);
  if (!raster) return null;
  const toSource = multiply3(toPlane(raster), invert3(forward));
  const lands = projectedBounds(invert3(toSource), raster.width, raster.height);
  if (!lands) return null;
  const box = [Math.max(0, Math.floor(lands[0])), Math.max(0, Math.floor(lands[1])), Math.min(width, Math.ceil(lands[2])), Math.min(height, Math.ceil(lands[3]))];
  return box[2] > box[0] && box[3] > box[1] ? { raster, toSource, box } : null;
}

/** Random planes turned every way, in perspective, most of them landing on the target. */
function randomPlanes(count, seed) {
  const range = randomFrom(seed);
  const planes = [];
  while (planes.length < count) {
    const transform = {
      position: { x: range(50, 150), y: range(30, 110) }, scale: { x: range(0.5, 1.5), y: range(0.5, 1.5) }, rotation: range(-180, 180),
      rotationX: range(-75, 75), rotationY: range(-75, 75), perspective: range(150, 1500),
    };
    const found = plane(transform, [-range(30, 250), -range(30, 250), range(30, 250), range(30, 250)]);
    if (found) planes.push(found);
  }
  return planes;
}

/**
 * Straight-alpha pixels for `raster`, a transparent pixel round them as a
 * plane's canvas has: `color(x, y)` in the layer's units, `[r, g, b, a]`.
 */
function content(raster, color) {
  const pixels = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let y = 1; y < raster.height - 1; y++) {
    for (let x = 1; x < raster.width - 1; x++) {
      pixels.set(color((x - 0.5) / raster.scale + raster.left, (y - 0.5) / raster.scale + raster.top), (y * raster.width + x) * 4);
    }
  }
  return pixels;
}

/** Smooth colors and coverage, as in a photo or a soft shape. */
const smooth = (x, y) => [
  128 + 100 * Math.sin(x * 0.05), 128 + 100 * Math.sin(y * 0.04 + 1), 128 + 100 * Math.sin((x + y) * 0.03),
  255 * Math.min(1, Math.max(0, 0.6 + 0.5 * Math.sin(x * 0.03) * Math.cos(y * 0.035))),
];

/** `drawPlane` onto a transparent software canvas the target's size, read back. */
function drawn({ raster, toSource, box }, pixels, width = WIDTH, height = HEIGHT) {
  const target = surface(width, height);
  drawPlane(target, surface(raster.width, raster.height, pixels), toSource, box, (w, h) => surface(w, h));
  return target.getImageData(0, 0, width, height).data;
}

/** `warp` over the whole target: what the GPU renderer draws. */
function warped({ raster, toSource }, pixels, width = WIDTH, height = HEIGHT) {
  const target = new Uint8ClampedArray(width * height * 4);
  warp(pixels, raster.width, raster.height, target, width, toSource, [0, 0, width, height]);
  return target;
}

/** The largest difference of a pixel's premultiplied channels, 0 to 255. */
function difference(a, b, i) {
  let most = Math.abs(a[i + 3] - b[i + 3]);
  for (let channel = 0; channel < 3; channel++) most = Math.max(most, Math.abs(a[i + channel] * a[i + 3] - b[i + channel] * b[i + 3]) / 255);
  return most;
}

/**
 * Whether the plane covers the target pixel at `x, y` and those within
 * `margin` of it, in front of the near clip unless `near` is false: the GPU
 * cuts a plane's outline off where pixel centres leave its canvas, and the
 * affine pieces antialias it, so that ring of pixels differs by design.
 */
function inside({ raster, toSource }, x, y, near = true, margin = 1.5) {
  return [[-margin, -margin], [margin, -margin], [-margin, margin], [margin, margin]].every(([dx, dy]) => {
    const [sx, sy, w] = project(toSource, x + 0.5 + dx, y + 0.5 + dy);
    return (!near || (w > 0 && 1 / w >= NEAR_W)) && sx >= 0 && sy >= 0 && sx <= raster.width && sy <= raster.height;
  });
}

/** The differences between `drawPlane` and `warp` over the plane's inside, sorted. */
function differences(planes, color) {
  const all = [];
  for (const found of planes) {
    const pixels = content(found.raster, color);
    const ours = drawn(found, pixels), gpu = warped(found, pixels);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = (y * WIDTH + x) * 4;
        if ((ours[i + 3] || gpu[i + 3]) && inside(found, x, y)) all.push(difference(ours, gpu, i));
      }
    }
  }
  return all.sort((a, b) => a - b);
}

const quantile = (sorted, q) => sorted[Math.floor(q * (sorted.length - 1))];
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

test('affine pieces stray at most half a pixel from the projection', () => {
  const range = randomFrom(7);
  let farthest = 0, pieces = 0;
  for (const { raster, toSource, box } of randomPlanes(40, 1)) {
    const toParent = invert3(toSource);
    for (const { corners: [p, q, r], transform: [a, b, c, d, e, f] } of planePieces(toSource, raster.width, raster.height, box).affine) {
      pieces++;
      const det = a * d - b * c;
      for (let i = 0; i < 20; i++) {
        let u = range(0, 1), v = range(0, 1);
        if (u + v > 1) [u, v] = [1 - u, 1 - v];
        const tx = p[0] + u * (q[0] - p[0]) + v * (r[0] - p[0]), ty = p[1] + u * (q[1] - p[1]) + v * (r[1] - p[1]);
        // The source point the piece draws there, and where the plane puts it.
        const sx = (d * (tx - e) - c * (ty - f)) / det, sy = (a * (ty - f) - b * (tx - e)) / det;
        const [px, py] = project(toParent, sx, sy);
        farthest = Math.max(farthest, Math.hypot(px - tx, py - ty));
      }
    }
  }
  assert.ok(pieces > 1000, `${pieces} pieces`);
  assert.ok(farthest <= 0.5 + 1e-9, `strays ${farthest} pixels`);
});

test('the pieces tile what the plane shows of the target', () => {
  const area = polygon => Math.abs(polygon.reduce((sum, [x, y], i) => {
    const [u, v] = polygon[(i + 1) % polygon.length];
    return sum + x * v - u * y;
  }, 0)) / 2;
  for (const found of randomPlanes(20, 2)) {
    const { raster, toSource, box } = found;
    const pieces = planePieces(toSource, raster.width, raster.height, box);
    const covered = pieces.affine.reduce((sum, piece) => sum + area(piece.corners), 0) + pieces.warped.reduce((sum, polygon) => sum + area(polygon), 0);
    // What shows: pixel centres in front of the near clip mapping into the
    // canvas, inside the box grown by 2, at a sixteenth of a pixel.
    let shown = 0;
    for (let y = box[1] - 2; y < box[3] + 2; y += 1 / 16) {
      for (let x = box[0] - 2; x < box[2] + 2; x += 1 / 16) {
        const [sx, sy, w] = project(toSource, x, y);
        if (w > 0 && 1 / w >= NEAR_W && sx >= 0 && sy >= 0 && sx <= raster.width && sy <= raster.height) shown++;
      }
    }
    shown /= 256;
    assert.ok(Math.abs(covered - shown) <= 0.01 * shown + 2, `${covered} covered, ${shown} shown`);
  }
});

test('drawn through Canvas 2D, a plane is what the warp draws, within 8-bit rounding and the half-pixel stray', () => {
  const all = differences(randomPlanes(12, 3), smooth);
  assert.ok(all.length > 50_000, `${all.length} pixels`);
  assert.ok(mean(all) < 2, `mean ${mean(all)}`);
  assert.ok(quantile(all, 0.99) <= 6, `99th percentile ${quantile(all, 0.99)}`);
  assert.ok(all.at(-1) <= 24, `largest ${all.at(-1)}`);
});

test('a minified plane averages each pixel\'s footprint as the GPU does, without aliasing', () => {
  // A floor tilted far back, of stripes a texel apart: a single tap per
  // pixel would read them in moiré, the GPU's footprint filter reads them
  // nearly grey. Ours should stray from grey no more than the GPU's.
  const found = plane({ position: { x: 100, y: 100 }, rotationX: 75, perspective: 300 }, [-400, -1200, 400, 40]);
  const stripes = content(found.raster, (x, y) => (Math.floor(y * found.raster.scale) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const ours = drawn(found, stripes), gpu = warped(found, stripes);
  const m = found.toSource;
  let pixels = 0, oursStray = 0, gpuStray = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      // Where a pixel steps over 1.5 texels down the stripes.
      const [sx, sy, w] = project(m, x + 0.5, y + 0.5);
      if (!gpu[i + 3] || !inside(found, x, y) || Math.hypot((m[0][1] - sx * m[2][1]) / w, (m[1][1] - sy * m[2][1]) / w) < 1.5) continue;
      pixels++;
      oursStray += Math.abs(ours[i] - 127.5);
      gpuStray += Math.abs(gpu[i] - 127.5);
    }
  }
  assert.ok(pixels > 3000, `${pixels} pixels`);
  assert.ok(oursStray / pixels <= gpuStray / pixels + 3, `ours stray ${oursStray / pixels} from grey, the GPU's ${gpuStray / pixels}`);
});

test('nothing draws past the near clip, and the band along it is warped as the GPU draws it', () => {
  // A wall turned nearly edge-on close to the viewer: at its near clip it
  // is 16 times magnified, and its near clip still lands on the target.
  const found = plane({ position: { x: 140, y: 70 }, rotationY: 75, perspective: 30 }, [-80, -50, 80, 50]);
  const { raster, toSource, box } = found;
  const pieces = planePieces(toSource, raster.width, raster.height, box);
  assert.ok(pieces.warped.length > 0 && pieces.affine.length > 0);
  const pixels = content(raster, smooth);
  const ours = drawn(found, pixels), gpu = warped(found, pixels);
  // `toSource`'s `w` is 16 at the near clip and changes by `slope` a pixel.
  const slope = Math.hypot(toSource[2][0], toSource[2][1]);
  let clipped = 0, band = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const [, , w] = project(toSource, x + 0.5, y + 0.5);
      if (!(w > 0) || 1 / w < NEAR_W) {
        clipped++;
        assert.equal(ours[i + 3], 0, `${x}, ${y} is past the near clip`);
      } else if (w > 1 / NEAR_W - 2 * slope && inside(found, x, y, false)) {
        band++;
        assert.ok(difference(ours, gpu, i) <= 1, `${x}, ${y}: ${ours.slice(i, i + 4)} vs ${gpu.slice(i, i + 4)}`);
      }
    }
  }
  assert.ok(clipped > 1000 && band > 100, `${clipped} clipped, ${band} in the band`);
});

test('the pieces of a solid plane leave no seams or bands', () => {
  for (const found of randomPlanes(6, 4)) {
    const pixels = content(found.raster, () => [43, 58, 85, 255]);
    const ours = drawn(found, pixels), gpu = warped(found, pixels);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = (y * WIDTH + x) * 4;
        // A seam would show as a line missing much of its coverage, and
        // passes rounded one by one as bands of another color. Near the
        // outline, the filters read the transparent pixels past it a little
        // differently.
        if (inside(found, x, y, true, 3)) assert.ok(difference(ours, gpu, i) <= 2, `${x}, ${y}: ${ours.slice(i, i + 4)} vs ${gpu.slice(i, i + 4)}`);
      }
    }
  }
});
