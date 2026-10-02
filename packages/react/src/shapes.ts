import * as React from 'react';

import type { CommonProps } from './components';
import type { LineCap, LineJoin, Paint, PathCommand } from './scene';

export type { LineCap, LineJoin, PathCommand };

/** A point as `[x, y]`, in the path's own coordinates. */
export type PolylinePoint = readonly [number, number];

/**
 * Transform and compositing props of a path. There is no `anchorX`/`anchorY`:
 * a path's coordinates already have their own origin, which `x`/`y` place
 * and `scale`/`rotation` turn about.
 */
type PathLayerProps = Omit<CommonProps, 'anchorX' | 'anchorY'>;

interface StrokeProps extends PathLayerProps {
  /** Hex color (`"#RRGGBB"` or `"#RRGGBBAA"`) or a gradient `Paint` of the stroke. */
  stroke?: string | Paint;
  /** Thickness in pixels. Defaults to 2. */
  strokeWidth?: number;
  /** How open ends finish: `'butt'` ends exactly at the end point, `'round'` adds a half disc, `'square'` half a square. */
  cap?: LineCap;
  /** How corners are drawn: `'miter'` (sharp), `'round'`, or `'bevel'` (cut off). */
  join?: LineJoin;
  /**
   * The longest a miter join may be, as a multiple of `strokeWidth`, before
   * it is drawn as a bevel instead. Defaults to 4, like SVG.
   */
  miterLimit?: number;
}

export interface PathProps extends StrokeProps {
  /**
   * Absolute path commands, like SVG's `M`/`L`/`Q`/`C`/`Z`:
   * `{ type: 'moveTo', x, y }`, `{ type: 'lineTo', x, y }`,
   * `{ type: 'quadTo', x1, y1, x, y }`,
   * `{ type: 'cubicTo', x1, y1, x2, y2, x, y }`, and `{ type: 'close' }`.
   * Use `points` instead for straight segments.
   */
  commands?: readonly PathCommand[];
  /** Straight segments through these points; ignored when `commands` is set. */
  points?: readonly PolylinePoint[];
  /** Joins the last of `points` back to the first, without a seam. */
  closed?: boolean;
  /**
   * Fills the inside of the path (non-zero rule), as a hex color or a
   * `Paint` in the path's own coordinates. Omit for no fill.
   */
  fill?: string | Paint;
}

export interface LineProps extends StrokeProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PolylineProps extends StrokeProps {
  points: readonly PolylinePoint[];
  /** Joins the last point back to the first, without a seam. */
  closed?: boolean;
  /**
   * How much of the path to draw, 0–1 of its length from the first point.
   * Animate it for a line that draws itself on. Defaults to 1.
   */
  progress?: number;
}

function strokeWidthOf(value: number | undefined, component: string): number {
  const width = value ?? 2;
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`<${component}> requires a positive \`strokeWidth\``);
  }
  return width;
}

/** `moveTo` the first point and `lineTo` each of the others. */
function commandsThrough(points: readonly PolylinePoint[], closed: boolean): PathCommand[] {
  const commands: PathCommand[] = points.map(([x, y], i) =>
    i === 0 ? { type: 'moveTo', x, y } : { type: 'lineTo', x, y },
  );
  if (closed && commands.length > 0) {
    commands.push({ type: 'close' });
  }
  return commands;
}

/**
 * A vector shape: lines and Bézier curves, stroked and/or filled as one layer
 * however many segments it has. Overlapping parts of a translucent stroke
 * are painted once, and the shape stays sharp at any `scale`. Coordinates
 * are in the path's own pixels; `x`/`y` move their origin.
 */
export function Path({
  commands,
  points,
  closed = false,
  stroke,
  strokeWidth,
  ...props
}: PathProps): ReturnType<typeof React.createElement> {
  if (commands === undefined && points === undefined) {
    throw new Error('<Path> requires `commands` or `points`');
  }
  return React.createElement('path', {
    ...props,
    commands: commands ?? commandsThrough(points ?? [], closed),
    stroke,
    ...(stroke === undefined ? {} : { strokeWidth: strokeWidthOf(strokeWidth, 'Path') }),
  });
}

/** A straight line segment between two points. */
export function Line({
  x1,
  y1,
  x2,
  y2,
  stroke = '#FFFFFF',
  strokeWidth,
  cap = 'round',
  ...props
}: LineProps): ReturnType<typeof React.createElement> | null {
  const width = strokeWidthOf(strokeWidth, 'Line');
  if (cap === 'butt' && x1 === x2 && y1 === y2) {
    return null;
  }
  return React.createElement(Path, {
    ...props,
    points: [
      [x1, y1],
      [x2, y2],
    ],
    stroke,
    strokeWidth: width,
    cap,
  });
}

function segmentLengths(points: readonly PolylinePoint[]): number[] {
  return points.slice(1).map(([x, y], i) => Math.hypot(x - points[i][0], y - points[i][1]));
}

/**
 * The point `t` (0–1) of the way along a polyline, measured by length. Use it
 * to put a marker or a label on the tip of a `<Polyline>` that is drawing on.
 */
export function pointOnPolyline(points: readonly PolylinePoint[], t: number): [number, number] {
  if (points.length === 0) {
    throw new Error('pointOnPolyline() requires at least one point');
  }
  const lengths = segmentLengths(points);
  let remaining = lengths.reduce((sum, n) => sum + n, 0) * Math.min(1, Math.max(0, t));
  for (let i = 0; i < lengths.length; i += 1) {
    if (remaining <= lengths[i]) {
      const u = lengths[i] === 0 ? 0 : remaining / lengths[i];
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      return [x1 + (x2 - x1) * u, y1 + (y2 - y1) * u];
    }
    remaining -= lengths[i];
  }
  const [x, y] = points[points.length - 1];
  return [x, y];
}

/** The first `progress` (0–1) of a polyline, by length. */
function polylinePrefix(points: readonly PolylinePoint[], progress: number): PolylinePoint[] {
  const lengths = segmentLengths(points);
  let remaining = lengths.reduce((sum, n) => sum + n, 0) * Math.min(1, Math.max(0, progress));
  const prefix: PolylinePoint[] = points.slice(0, 1);
  for (let i = 0; i < lengths.length && remaining > 0; i += 1) {
    const u = Math.min(1, remaining / lengths[i]);
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    prefix.push([x1 + (x2 - x1) * u, y1 + (y2 - y1) * u]);
    remaining -= lengths[i];
  }
  return prefix.length > 1 ? prefix : [];
}

/**
 * Connected line segments through `points`, such as a line chart or a route,
 * drawn as one `<Path>`. With round caps (the default) the corners are
 * rounded too, unless `join` says otherwise.
 */
export function Polyline({
  points,
  closed = false,
  progress = 1,
  stroke = '#FFFFFF',
  strokeWidth,
  cap = 'round',
  join,
  ...props
}: PolylineProps): ReturnType<typeof React.createElement> {
  const width = strokeWidthOf(strokeWidth, 'Polyline');
  const whole = progress >= 1;
  const drawn = whole
    ? points
    : polylinePrefix(closed && points.length > 0 ? [...points, points[0]] : points, progress);
  return React.createElement(Path, {
    ...props,
    points: drawn,
    closed: closed && whole,
    stroke,
    strokeWidth: width,
    cap,
    join: join ?? (cap === 'round' ? 'round' : 'miter'),
  });
}
