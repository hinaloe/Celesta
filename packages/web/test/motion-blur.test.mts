import assert from 'node:assert/strict';
import { test } from 'vitest';
import { SampleAverage } from '../src/motion-blur';

/** The average of one-pixel samples, each straight-alpha RGBA. */
function average(...samples: number[][]) {
  const sum = new SampleAverage(4);
  for (const sample of samples) sum.add(new Uint8ClampedArray(sample));
  const pixels = new Uint8ClampedArray(4);
  sum.write(pixels);
  return [...pixels];
}

// The same cases as `celesta-renderer`'s `motion_blur_tests.rs`, before the
// average is drawn onto the scene.

test('a pixel drawn in half the samples keeps its color at half its alpha', () => {
  assert.deepEqual(average([255, 0, 0, 255], [0, 0, 0, 0]), [255, 0, 0, 128]);
});

test('what every sample draws is drawn as it is', () => {
  assert.deepEqual(average([255, 0, 0, 255], [255, 0, 0, 255]), [255, 0, 0, 255]);
});

test('samples average their colors', () => {
  assert.deepEqual(average([255, 0, 0, 255], [0, 0, 255, 255]), [128, 0, 128, 255]);
});

test('samples average premultiplied colors', () => {
  // Half-transparent white and opaque black: a quarter white at three
  // quarters alpha, a third gray once straight, not mid-gray.
  assert.deepEqual(average([255, 255, 255, 128], [0, 0, 0, 255]), [85, 85, 85, 192]);
});

test('a pixel no sample draws stays transparent', () => {
  assert.deepEqual(average([0, 0, 0, 0], [0, 0, 0, 0]), [0, 0, 0, 0]);
});
