import assert from 'node:assert/strict';
import { test } from 'vitest';
import { canvasDrawsAlike, gradientPixels, sampleGradient } from '../src/gradients';
import type { Paint, Point } from '../src/types';

type Linear = Extract<Paint, { type: 'linear' }>;
type Radial = Extract<Paint, { type: 'radial' }>;

const linear = (stops: Linear['stops'], start: Point = { x: 0, y: 0 }, end: Point = { x: 10, y: 0 }): Linear => ({ type: 'linear', start, end, stops });

test('stops interpolate premultiplied, so a fade to transparent keeps its color', () => {
  // t = 0.45 between opaque #ff8000 and #00000000: interpolating straight
  // colors would give #8c4600 at that alpha.
  assert.deepEqual(sampleGradient(linear([{ offset: 0, color: '#ff8000' }, { offset: 1, color: '#00000000' }]), 4.5, 0), [255, 128, 0, 140]);
  assert.deepEqual(sampleGradient(linear([{ offset: 0, color: '#ff800000' }, { offset: 1, color: '#00000000' }]), 4.5, 0), [0, 0, 0, 0]);
});

test('stops are taken in offset order, those sharing one making a hard edge', () => {
  const paint = linear([
    { offset: 1, color: '#ffffff' }, { offset: 0.5, color: '#ff0000' }, { offset: 0.5, color: '#0000ff' }, { offset: 0, color: '#000000' },
  ]);
  assert.deepEqual(sampleGradient(paint, 4, 0), [204, 0, 0, 255]);
  assert.deepEqual(sampleGradient(paint, 5, 0), [0, 0, 255, 255]);
  assert.deepEqual(sampleGradient(paint, 7.5, 0), [128, 128, 255, 255]);
});

test('positions past the ends take the end stops, and a degenerate gradient its first', () => {
  const paint = linear([{ offset: 0.2, color: '#102030' }, { offset: 0.8, color: '#405060' }]);
  assert.deepEqual(sampleGradient(paint, -5, 3), [16, 32, 48, 255]);
  assert.deepEqual(sampleGradient(paint, 9.5, 0), [64, 80, 96, 255]);
  assert.deepEqual(sampleGradient(linear(paint.stops, { x: 3, y: 3 }, { x: 3, y: 3 }), 9, 0), [16, 32, 48, 255]);
  assert.deepEqual(sampleGradient({ type: 'radial', center: { x: 0, y: 0 }, radius: 0, stops: paint.stops }, 9, 0), [16, 32, 48, 255]);
  assert.deepEqual(sampleGradient(linear([]), 1, 1), [0, 0, 0, 0]);
});

test('a radial gradient runs from its centre to its radius', () => {
  const paint: Radial = { type: 'radial', center: { x: 0, y: 0 }, radius: 10, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] };
  assert.deepEqual(sampleGradient(paint, 2.5, 2.5), [90, 90, 90, 255]);
});

test('colors must be hex, as the native renderer requires', () => {
  assert.throws(() => sampleGradient(linear([{ offset: 0, color: 'red' }]), 0, 0), /Invalid color: red/);
  assert.throws(() => sampleGradient(linear([{ offset: 0, color: '#fff' }]), 0, 0), /Invalid color: #fff/);
});

test("Canvas's own gradient stands in only where it draws alike", () => {
  const opaque = [{ offset: 0, color: '#0b1d3a' }, { offset: 1, color: '#F4E3C1FF' }];
  assert.equal(canvasDrawsAlike(linear(opaque)), true);
  assert.equal(canvasDrawsAlike(linear([{ offset: 0, color: '#0b1d3a80' }, { offset: 1, color: '#f4e3c180' }])), true);
  assert.equal(canvasDrawsAlike(linear([...opaque, { offset: 0.5, color: '#ffd166c0' }])), false);
  assert.equal(canvasDrawsAlike(linear([...opaque, { offset: 1.5, color: '#ffd166' }])), false);
  assert.equal(canvasDrawsAlike(linear(opaque, { x: 3, y: 3 }, { x: 3, y: 3 })), false);
  assert.equal(canvasDrawsAlike({ type: 'radial', center: { x: 0, y: 0 }, radius: 0, stops: opaque }), false);
  assert.throws(() => canvasDrawsAlike(linear([{ offset: 0, color: 'red' }])), /Invalid color: red/);
});

test('pixels are sampled at their centres, mapped into the gradient through `toLocal`', () => {
  const paint = linear([{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }]);
  // Device pixels 2 to 5 of row 1, for a layer drawn at twice its size.
  const pixels = gradientPixels(paint, [0.5, 0, 0, 0.5, 0, 0], [2, 1, 5, 2]);
  assert.deepEqual(Array.from(pixels), [32, 32, 32, 255, 45, 45, 45, 255, 57, 57, 57, 255]);
  // Turned a quarter: local x runs up the device's rows from y = 10.
  const turned = gradientPixels(paint, [0, 1, -1, 0, 10, 0], [0, 3, 1, 4]);
  assert.deepEqual(Array.from(turned), [166, 166, 166, 255]);
});

test('the circle over the backdrop matches pixels the native renderer drew', () => {
  // A 100x100 scene: a vertical backdrop gradient, and over it an 80x80
  // circle at 10,10 with opacity 0.9 and a horizontal gradient through a
  // translucent middle stop. What `celesta-exporter --react` drew (GPU
  // renderer, Apple M5) at pixels away from the circle's edge.
  const backdrop = linear([{ offset: 0, color: '#0b1d3a' }, { offset: 0.5, color: '#2a9d8f' }, { offset: 1, color: '#f4e3c1' }], { x: 0, y: 0 }, { x: 0, y: 100 });
  const circle = linear([{ offset: 0, color: '#e63946' }, { offset: 0.5, color: '#ffd166c0' }, { offset: 1, color: '#4cc9f0' }], { x: 0, y: 0 }, { x: 80, y: 0 });
  const native: [number, number, number[]][] = [
    [20, 50, [205, 100, 87]], [30, 50, [198, 131, 96]], [40, 50, [192, 162, 106]], [60, 50, [157, 193, 145]],
    [70, 50, [128, 194, 174]], [80, 50, [100, 195, 203]], [70, 20, [124, 178, 163]], [30, 80, [224, 140, 103]],
  ];
  for (const [x, y, expected] of native) {
    const below = sampleGradient(backdrop, x + 0.5, y + 0.5);
    const above = sampleGradient(circle, x + 0.5 - 10, y + 0.5 - 10);
    const alpha = above[3] / 255 * 0.9;
    const drawn = [0, 1, 2].map(i => Math.round(above[i] * alpha + below[i] * (1 - alpha)));
    drawn.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= 1, `${x},${y}: ${drawn} is not ${expected}`));
  }
});
