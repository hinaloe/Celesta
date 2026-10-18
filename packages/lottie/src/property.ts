// Values of Lottie properties at a frame: keyframes eased with their Bézier
// handles, positions moved along their spatial curves, and paths morphed
// vertex by vertex. Fractional frames interpolate, so any frame of the
// composition maps to one exact value.

import type {
  LottieBezier,
  LottieEasing,
  LottieKeyframe,
  LottieProperty,
  LottieShapeProperty,
  LottieSplitPosition,
  LottieValue,
} from './types';

function isKeyframes<T>(k: T | LottieKeyframe<T>[]): k is LottieKeyframe<T>[] {
  return Array.isArray(k) && k.length > 0 && typeof k[0] === 'object' && k[0] !== null && 't' in k[0];
}

/** Whether `prop` changes over time. */
export function isAnimated(prop: LottieProperty<unknown> | undefined): boolean {
  return prop !== undefined && isKeyframes(prop.k);
}

/** `x` of the cubic Bézier with handles `(x1, _)`, `(x2, _)` from 0 to 1, at `u`. */
function bezierAt(a: number, b: number, u: number): number {
  const v = 1 - u;
  return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u;
}

/** The eased progress of a CSS-style `cubic-bezier(x1, y1, x2, y2)` at `t`. */
export function cubicEase(x1: number, y1: number, x2: number, y2: number, t: number): number {
  if (t <= 0 || t >= 1) {
    return t <= 0 ? 0 : 1;
  }
  if (x1 === y1 && x2 === y2) {
    return t;
  }
  // Newton's method, falling back to bisection where the slope is flat.
  let u = t;
  for (let i = 0; i < 8; i += 1) {
    const error = bezierAt(x1, x2, u) - t;
    if (Math.abs(error) < 1e-7) {
      return bezierAt(y1, y2, u);
    }
    const v = 1 - u;
    const slope = 3 * v * v * x1 + 6 * v * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(slope) < 1e-6) {
      break;
    }
    u -= error / slope;
  }
  let lo = 0;
  let hi = 1;
  u = t;
  for (let i = 0; i < 40; i += 1) {
    const x = bezierAt(x1, x2, u);
    if (Math.abs(x - t) < 1e-7) {
      break;
    }
    if (x < t) {
      lo = u;
    } else {
      hi = u;
    }
    u = (lo + hi) / 2;
  }
  return bezierAt(y1, y2, u);
}

function component(value: number | number[] | undefined, dimension: number, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'number') {
    return value;
  }
  return value[dimension] ?? value[0] ?? fallback;
}

/** The eased progress in dimension `dimension` between a keyframe and the next. */
function eased(out: LottieEasing | undefined, into: LottieEasing | undefined, dimension: number, t: number): number {
  if (out === undefined || into === undefined) {
    return t;
  }
  return cubicEase(
    component(out.x, dimension, 0),
    component(out.y, dimension, 0),
    component(into.x, dimension, 1),
    component(into.y, dimension, 1),
    t,
  );
}

interface Span<T> {
  start: T;
  end: T;
  /** The keyframe the span starts at, for its easing and tangents. */
  from: LottieKeyframe<T>;
  /** Linear progress from `start` to `end`, 0–1. */
  t: number;
}

/** The two values `frame` lies between, or the one it holds at. */
function spanAt<T>(keyframes: LottieKeyframe<T>[], frame: number): T | Span<T> {
  const first = keyframes[0];
  if (frame < first.t || keyframes.length === 1) {
    return (first.s ?? first.e) as T;
  }
  for (let n = 0; n < keyframes.length - 1; n += 1) {
    const from = keyframes[n];
    const next = keyframes[n + 1];
    if (frame >= next.t) {
      continue;
    }
    const start = (from.s ?? keyframes[n - 1]?.e) as T;
    const end = (from.e ?? next.s ?? start) as T;
    if (from.h === 1 || next.t <= from.t) {
      return start;
    }
    return { start, end, from, t: (frame - from.t) / (next.t - from.t) };
  }
  const last = keyframes[keyframes.length - 1];
  return (last.s ?? keyframes[keyframes.length - 2].e ?? keyframes[keyframes.length - 2].s) as T;
}

function isSpan<T>(value: T | Span<T>): value is Span<T> {
  return typeof value === 'object' && value !== null && 'from' in value && 't' in value && 'start' in value;
}

function asArray(value: number | number[] | undefined): number[] {
  if (value === undefined) {
    return [];
  }
  return typeof value === 'number' ? [value] : value;
}

/** A point `fraction` of the way along the cubic from `p0` to `p3`, by arc length. */
function alongCurve(p0: number[], p1: number[], p2: number[], p3: number[], fraction: number): number[] {
  const samples = 150;
  const points: number[][] = [];
  const lengths = [0];
  for (let i = 0; i <= samples; i += 1) {
    const u = i / samples;
    const v = 1 - u;
    const point = p0.map((_, d) =>
      v * v * v * p0[d] + 3 * v * v * u * p1[d] + 3 * v * u * u * p2[d] + u * u * u * p3[d]);
    if (i > 0) {
      const previous = points[i - 1];
      lengths.push(lengths[i - 1] + Math.hypot(...point.map((value, d) => value - previous[d])));
    }
    points.push(point);
  }
  const total = lengths[samples];
  if (!(total > 0)) {
    return p0.map((value, d) => value + (p3[d] - value) * fraction);
  }
  const target = Math.min(1, Math.max(0, fraction)) * total;
  let i = 1;
  while (i < samples && lengths[i] < target) {
    i += 1;
  }
  const segment = lengths[i] - lengths[i - 1];
  const local = segment > 0 ? (target - lengths[i - 1]) / segment : 0;
  return points[i - 1].map((value, d) => value + (points[i][d] - value) * local);
}

/** The value of a number or vector property at `frame`, always as an array. */
export function vectorAt(prop: LottieValue | undefined, frame: number, fallback: number[] = [0]): number[] {
  if (prop === undefined) {
    return fallback;
  }
  if (!isKeyframes(prop.k)) {
    const value = asArray(prop.k as number | number[]);
    return value.length > 0 ? value : fallback;
  }
  const span = spanAt(prop.k, frame);
  if (!isSpan(span)) {
    const value = asArray(span);
    return value.length > 0 ? value : fallback;
  }
  const start = asArray(span.start);
  const end = asArray(span.end);
  const { from, t } = span;
  const spatial = from.to !== undefined && from.ti !== undefined && start.length >= 2
    && (from.to.some(v => v !== 0) || from.ti.some(v => v !== 0));
  if (spatial) {
    const fraction = eased(from.o, from.i, 0, t);
    const p1 = start.map((value, d) => value + (from.to![d] ?? 0));
    const p2 = end.map((value, d) => value + (from.ti![d] ?? 0));
    return alongCurve(start, p1, p2, end, fraction);
  }
  return start.map((value, d) => {
    const target = end[d] ?? value;
    return value + (target - value) * eased(from.o, from.i, d, t);
  });
}

/** The value of a scalar property at `frame`. */
export function scalarAt(prop: LottieValue | undefined, frame: number, fallback: number): number {
  return vectorAt(prop, frame, [fallback])[0] ?? fallback;
}

/** A position property, which may come as separate `x` and `y` properties. */
export function positionAt(prop: LottieValue | LottieSplitPosition | undefined, frame: number): [number, number] {
  if (prop !== undefined && 's' in prop && prop.s === true) {
    return [scalarAt(prop.x, frame, 0), scalarAt(prop.y, frame, 0)];
  }
  const [x = 0, y = 0] = vectorAt(prop as LottieValue | undefined, frame, [0, 0]);
  return [x, y];
}

function bezierOf(value: LottieBezier | LottieBezier[] | undefined): LottieBezier | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const emptyPath: LottieBezier = { c: false, v: [], i: [], o: [] };

/** A path property at `frame`, its vertices morphed between keyframes. */
export function bezierAtFrame(prop: LottieShapeProperty | undefined, frame: number): LottieBezier {
  if (prop === undefined) {
    return emptyPath;
  }
  if (!isKeyframes(prop.k)) {
    return bezierOf(prop.k as LottieBezier | LottieBezier[]) ?? emptyPath;
  }
  const span = spanAt(prop.k, frame);
  if (!isSpan(span)) {
    return bezierOf(span) ?? emptyPath;
  }
  const start = bezierOf(span.start) ?? emptyPath;
  const end = bezierOf(span.end) ?? start;
  if (end.v.length !== start.v.length) {
    return start;
  }
  const t = eased(span.from.o, span.from.i, 0, span.t);
  const mix = (a: number[][], b: number[][]) =>
    a.map((point, n) => point.map((value, d) => value + ((b[n]?.[d] ?? value) - value) * t));
  return { c: start.c, v: mix(start.v, end.v), i: mix(start.i, end.i), o: mix(start.o, end.o) };
}
