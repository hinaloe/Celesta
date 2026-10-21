import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  getLength,
  getPointAtLength,
  getTangentAtLength,
  interpolatePath,
  measurePath,
  parseSvgPath,
  pointOnPath,
  tangentOnPath,
  toSvgPath,
} from '../src/index.js';
import type { PathCommand, PathPoint } from '../src/index.js';
import { commandOf } from './helpers.mjs';

function near(actual: number, expected: number, tolerance: number, message?: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} expected ${expected}, got ${actual}`);
}

function nearPoint(actual: PathPoint, [x, y]: [number, number], tolerance: number, message?: string) {
  near(actual.x, x, tolerance, `${message ?? ''} x:`);
  near(actual.y, y, tolerance, `${message ?? ''} y:`);
}

// y = x², x from 0 to 100 (scaled by 100): a quadratic whose arc length has a closed form.
const parabola: PathCommand[] = [
  { type: 'moveTo', x: 0, y: 0 },
  { type: 'quadTo', x1: 50, y1: 0, x: 100, y: 100 },
];
/** Arc length of y = x² from 0 to `x`, scaled by 100. */
const parabolaLength = (x: number) => (100 * (2 * x * Math.sqrt(1 + 4 * x * x) + Math.asinh(2 * x))) / 4;

// y = x³, x from 0 to 100 (scaled by 100), as a cubic.
const cubicCurve: PathCommand[] = [
  { type: 'moveTo', x: 0, y: 0 },
  { type: 'cubicTo', x1: 100 / 3, y1: 0, x2: 200 / 3, y2: 0, x: 100, y: 100 },
];

/** Simpson's rule with many steps, as an independent check of a curve's length. */
function simpson(f: (x: number) => number, a: number, b: number, n = 20000) {
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i += 1) {
    sum += f(a + i * h) * (i % 2 ? 4 : 2);
  }
  return (sum * h) / 3;
}

test('a quadratic curve is measured to its closed-form length', () => {
  near(getLength(parabola), parabolaLength(1), 1e-6);
});

test('a cubic curve is measured to its length', () => {
  const expected = 100 * simpson((x) => Math.sqrt(1 + 9 * x ** 4), 0, 1);
  near(getLength(cubicCurve), expected, 1e-6);
});

test('a point at a length on a curve is where that much of the curve ends', () => {
  for (const x of [0.1, 0.35, 0.6, 0.9]) {
    nearPoint(getPointAtLength(parabola, parabolaLength(x)), [100 * x, 100 * x * x], 1e-6, `x = ${x}`);
  }
});

test('a cubic with uneven speed still maps length to distance travelled', () => {
  // A straight cubic whose control points sit on its ends: slow at both ends, fast in the middle.
  const line: PathCommand[] = [
    { type: 'moveTo', x: 0, y: 0 },
    { type: 'cubicTo', x1: 0, y1: 0, x2: 30, y2: 0, x: 30, y: 0 },
  ];
  near(getLength(line), 30, 1e-9);
  for (const s of [1, 7.5, 15, 22.5, 29]) {
    nearPoint(getPointAtLength(line, s), [s, 0], 1e-6, `s = ${s}`);
  }
});

test('the tangent of a curve is its direction there, with the angle in degrees clockwise', () => {
  const x = 0.6;
  const tangent = getTangentAtLength(parabola, parabolaLength(x));
  const norm = Math.hypot(1, 2 * x);
  near(tangent.x, 1 / norm, 1e-6);
  near(tangent.y, (2 * x) / norm, 1e-6);
  near(tangent.angle, (Math.atan2(2 * x, 1) * 180) / Math.PI, 1e-4);
  // y grows downward on screen, so heading down is +90 degrees.
  const down = getTangentAtLength([{ type: 'moveTo', x: 0, y: 0 }, { type: 'lineTo', x: 0, y: 10 }], 5);
  assert.deepEqual(down, { x: 0, y: 1, angle: 90 });
});

test('a closed path counts its closing side, and a corner takes the side that starts there', () => {
  const square: PathCommand[] = [
    { type: 'moveTo', x: 0, y: 0 },
    { type: 'lineTo', x: 10, y: 0 },
    { type: 'lineTo', x: 10, y: 10 },
    { type: 'lineTo', x: 0, y: 10 },
    { type: 'close' },
  ];
  assert.equal(getLength(square), 40);
  nearPoint(getPointAtLength(square, 35), [0, 5], 1e-12);
  assert.equal(getTangentAtLength(square, 10).angle, 90);
  assert.equal(getTangentAtLength(square, 35).angle, -90);
  // The very end belongs to the last side.
  assert.equal(getTangentAtLength(square, 40).angle, -90);
});

test('lengths are clamped to the path, and moveTo jumps add no length', () => {
  const twoParts: PathCommand[] = [
    { type: 'moveTo', x: 0, y: 0 },
    { type: 'lineTo', x: 10, y: 0 },
    { type: 'moveTo', x: 100, y: 100 },
    { type: 'lineTo', x: 100, y: 110 },
  ];
  assert.equal(getLength(twoParts), 20);
  nearPoint(getPointAtLength(twoParts, 10), [100, 100], 0, 'the second subpath starts at 10:');
  nearPoint(getPointAtLength(twoParts, 15), [100, 105], 0);
  nearPoint(getPointAtLength(twoParts, -5), [0, 0], 0);
  nearPoint(getPointAtLength(twoParts, 99), [100, 110], 0);
  assert.throws(() => getPointAtLength(twoParts, NaN), /requires a number/);
});

test('zero-length segments and control points on an end point keep a direction', () => {
  const stub: PathCommand[] = [
    { type: 'moveTo', x: 0, y: 0 },
    { type: 'lineTo', x: 0, y: 0 },
    { type: 'lineTo', x: 10, y: 0 },
  ];
  assert.deepEqual(getTangentAtLength(stub, 0), { x: 1, y: 0, angle: 0 });
  const hooked: PathCommand[] = [
    { type: 'moveTo', x: 0, y: 0 },
    { type: 'cubicTo', x1: 0, y1: 0, x2: 0, y2: 0, x: 10, y: 10 },
  ];
  near(getTangentAtLength(hooked, 0).angle, 45, 1e-9);
  near(getTangentAtLength(hooked, getLength(hooked)).angle, 45, 1e-9);
  // A path that draws nothing has no length and points along +x.
  const dot: PathCommand[] = [{ type: 'moveTo', x: 3, y: 4 }];
  assert.equal(getLength(dot), 0);
  assert.deepEqual(getPointAtLength(dot, 1), { x: 3, y: 4 });
  assert.deepEqual(getTangentAtLength(dot, 1), { x: 1, y: 0, angle: 0 });
});

test('pointOnPath and tangentOnPath take a fraction of the length', () => {
  const measure = measurePath(cubicCurve);
  for (const t of [0, 0.25, 0.5, 1]) {
    assert.deepEqual(pointOnPath(cubicCurve, t), measure.getPointAtLength(measure.length * t));
    assert.deepEqual(tangentOnPath(cubicCurve, t), measure.getTangentAtLength(measure.length * t));
  }
  assert.deepEqual(pointOnPath(cubicCurve, 2), { x: 100, y: 100 });
  assert.equal(measurePath(cubicCurve), measure, 'the same commands are measured once');
});

const triangle: PathCommand[] = [
  { type: 'moveTo', x: 0, y: -100 },
  { type: 'lineTo', x: 87, y: 50 },
  { type: 'lineTo', x: -87, y: 50 },
  { type: 'close' },
];
const circle = parseSvgPath('M100 0A100 100 0 0 1 -100 0A100 100 0 0 1 100 0Z');

test('paths with different commands morph, matching their shapes at either end', () => {
  const middle = interpolatePath(triangle, circle, 0.5);
  assert.equal(middle[0].type, 'moveTo');
  assert.equal(middle[middle.length - 1].type, 'close');
  assert.ok(middle.slice(1, -1).every((c) => c.type === 'cubicTo'));
  assert.ok(middle.length - 2 >= circle.length - 2, `${middle.length} commands`);
  assert.deepEqual(interpolatePath(triangle, circle, 0), triangle);
  assert.deepEqual(interpolatePath(triangle, circle, 1), circle);
  // Just off either end, the in-between shape is the end shape.
  near(getLength(interpolatePath(triangle, circle, 1e-9)), getLength(triangle), 1e-5);
  near(getLength(interpolatePath(triangle, circle, 1 - 1e-9)), getLength(circle), 1e-5);
  // Halfway, every point is between the triangle and the circle.
  for (const t of [0, 0.2, 0.4, 0.6, 0.8]) {
    const { x, y } = pointOnPath(middle, t);
    const r = Math.hypot(x, y);
    assert.ok(r > 40 && r < 101, `radius ${r} at ${t}`);
  }
});

test('corners are matched by how far around the shape they are, so one shape stays itself', () => {
  // The same square, its left side drawn in two parts: halfway, still that square.
  const square = parseSvgPath('M0 0H10V10H0Z');
  const split = parseSvgPath('M0 0H10V10H0V2Z');
  const middle = interpolatePath(square, split, 0.5);
  near(getLength(middle), 40, 1e-9);
  for (let i = 0; i < 40; i += 1) {
    const { x, y } = pointOnPath(middle, i / 40);
    const onSide = Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(y), Math.abs(y - 10));
    assert.ok(onSide < 1e-9, `(${x}, ${y}) is off the square`);
  }
});

test('a closed shape morphs from the start nearest the other, without twisting', () => {
  // The same square, started from the opposite corner with an extra point:
  // matched start to start, halfway it would collapse through the middle.
  const square = parseSvgPath('M0 0H10V10H0Z');
  const rotated = parseSvgPath('M10 10H0V0H10V5Z');
  const middle = interpolatePath(square, rotated, 0.5);
  nearPoint(pointOnPath(middle, 0), [0, 0], 1e-9);
  assert.ok(getLength(middle) > 35, `length ${getLength(middle)}`);
});

test('paths with the same commands blend point by point, and t may overshoot', () => {
  const a: PathCommand[] = [{ type: 'moveTo', x: 0, y: 0 }, { type: 'lineTo', x: 10, y: 0 }];
  const b: PathCommand[] = [{ type: 'moveTo', x: 0, y: 10 }, { type: 'lineTo', x: 20, y: 10 }];
  assert.deepEqual(interpolatePath(a, b, 0.5), [{ type: 'moveTo', x: 0, y: 5 }, { type: 'lineTo', x: 15, y: 5 }]);
  assert.deepEqual(interpolatePath(a, b, 1.5)[1], { type: 'lineTo', x: 25, y: 15 });
});

test('a subpath with no partner grows from its own middle', () => {
  const one = parseSvgPath('M0 0H10V10H0Z');
  const two = parseSvgPath('M0 0H10V10H0Z M100 0H110V10H100Z');
  const start = interpolatePath(one, two, 1e-9);
  assert.equal(start.filter((c) => c.type === 'moveTo').length, 2);
  near(getLength(start), 40, 1e-6);
  nearPoint(pointOnPath(interpolatePath(one, two, 1e-9), 1), [105, 5], 1e-6);
  assert.throws(() => interpolatePath([], two, 0.5), /at least one command/);
});

test('SVG path data becomes absolute commands, with shorthands written out', () => {
  assert.deepEqual(parseSvgPath('m10 20 h5 v5 l-5 0 z l1 1'), [
    { type: 'moveTo', x: 10, y: 20 },
    { type: 'lineTo', x: 15, y: 20 },
    { type: 'lineTo', x: 15, y: 25 },
    { type: 'lineTo', x: 10, y: 25 },
    { type: 'close' },
    { type: 'moveTo', x: 10, y: 20 },
    { type: 'lineTo', x: 11, y: 21 },
  ]);
  // Numbers after M repeat as L; numbers may run together.
  assert.deepEqual(parseSvgPath('M0,0 10-5.5.5e1 1'), [
    { type: 'moveTo', x: 0, y: 0 },
    { type: 'lineTo', x: 10, y: -5.5 },
    { type: 'lineTo', x: 5, y: 1 },
  ]);
  // S and T mirror the previous control point; after another command they start from the current point.
  assert.deepEqual(parseSvgPath('M0 0C0 10 10 10 10 0S20-10 20 0Q25 5 30 0T40 0L50 0T60 0'), [
    { type: 'moveTo', x: 0, y: 0 },
    { type: 'cubicTo', x1: 0, y1: 10, x2: 10, y2: 10, x: 10, y: 0 },
    { type: 'cubicTo', x1: 10, y1: -10, x2: 20, y2: -10, x: 20, y: 0 },
    { type: 'quadTo', x1: 25, y1: 5, x: 30, y: 0 },
    { type: 'quadTo', x1: 35, y1: -5, x: 40, y: 0 },
    { type: 'lineTo', x: 50, y: 0 },
    { type: 'quadTo', x1: 50, y1: 0, x: 60, y: 0 },
  ]);
});

test('an SVG arc becomes cubic curves along the same ellipse', () => {
  // Sweep 1 turns clockwise on screen, so this half circle bulges upward.
  const half = parseSvgPath('M0 0A50 50 0 0 1 100 0');
  assert.ok(half.slice(1).every((c) => c.type === 'cubicTo'));
  assert.deepEqual(commandOf(half[half.length - 1], 'cubicTo').x, 100);
  assert.equal(half.length, 1 + 4);
  near(getLength(half), Math.PI * 50, 0.001);
  nearPoint(pointOnPath(half, 0.5), [50, -50], 0.001);
  // Flags may run into the next number; radii too small to reach are scaled up.
  const compact = parseSvgPath('M0 0a5 5 0 1010 0');
  nearPoint(pointOnPath(compact, 0.5), [5, 5], 0.01);
  const small = parseSvgPath('M0 0A1 1 0 0 0 10 0');
  near(getLength(small), Math.PI * 5, 0.01);
  // A rotated ellipse: rx 20 turned 90 degrees runs along y, so this half
  // turn goes clockwise from the top through ry 10 to the right.
  const rotated = parseSvgPath('M0 0A20 10 90 0 1 0 40');
  nearPoint(pointOnPath(rotated, 0.5), [10, 20], 0.01);
});

test('commands become SVG path data and back unchanged', () => {
  const commands: PathCommand[] = [
    { type: 'moveTo', x: 0.1, y: -2 },
    { type: 'lineTo', x: 1e-7, y: 3 },
    { type: 'quadTo', x1: 1, y1: 2, x: 3, y: 4 },
    { type: 'cubicTo', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
    { type: 'close' },
  ];
  const d = toSvgPath(commands);
  assert.equal(d, 'M0.1 -2L1e-7 3Q1 2 3 4C1 2 3 4 5 6Z');
  assert.deepEqual(parseSvgPath(d), commands);
});

test('malformed SVG path data is rejected with where it went wrong', () => {
  assert.throws(() => parseSvgPath('M0 0 X1 1'), /unknown command "X" at index 5/);
  assert.throws(() => parseSvgPath('10 10'), /expected a command/);
  assert.throws(() => parseSvgPath('M0'), /expected a number/);
  assert.throws(() => parseSvgPath('M0 0A1 1 0 2 0 5 5'), /arc flag/);
});
