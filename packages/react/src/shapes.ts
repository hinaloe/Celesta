import * as React from 'react';

import { Group, Rect } from './components';
import type { BlendMode } from './scene';

export type LineCap = 'butt' | 'round';

/** A point as `[x, y]`, in the parent's coordinates. */
export type PolylinePoint = readonly [number, number];

interface StrokeProps {
  /** Hex color of the line. Defaults to white. */
  stroke?: string;
  /** Thickness in pixels. Defaults to 2. */
  strokeWidth?: number;
  /** `'butt'` ends exactly at the points; `'round'` (default) adds half-disc caps. */
  cap?: LineCap;
  opacity?: number;
  blendMode?: BlendMode;
  id?: string;
}

export interface LineProps extends StrokeProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function strokeWidthOf(value: number | undefined, component: string): number {
  const width = value ?? 2;
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`<${component}> requires a positive \`strokeWidth\``);
  }
  return width;
}

/** A straight line segment between two points, drawn as a rotated `Rect`. */
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
  const length = Math.hypot(x2 - x1, y2 - y1);
  const capLength = cap === 'round' ? width / 2 : 0;
  const total = length + capLength * 2;
  if (!(total > 0)) {
    return null;
  }
  return React.createElement(Rect, {
    ...props,
    x: x1,
    y: y1,
    width: total,
    height: width,
    // Pivot on the first point, which sits `capLength` in from the rect's left edge.
    anchorX: capLength / total,
    anchorY: 0.5,
    rotation: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
    cornerRadius: cap === 'round' ? width / 2 : undefined,
    fill: stroke,
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

export interface PolylineProps extends StrokeProps {
  points: readonly PolylinePoint[];
  /**
   * How much of the path to draw, 0–1 of its length from the first point.
   * Animate it for a line that draws itself on. Defaults to 1.
   */
  progress?: number;
}

/**
 * Connected line segments through `points`, such as a line chart or a route.
 * With round caps (the default) the joints are rounded too.
 */
export function Polyline({
  points,
  progress = 1,
  stroke,
  strokeWidth,
  cap = 'round',
  opacity,
  blendMode,
  id,
}: PolylineProps): ReturnType<typeof React.createElement> {
  const width = strokeWidthOf(strokeWidth, 'Polyline');
  const lengths = segmentLengths(points);
  let remaining = lengths.reduce((sum, n) => sum + n, 0) * Math.min(1, Math.max(0, progress));
  const segments: React.ReactElement[] = [];
  for (let i = 0; i < lengths.length && remaining > 0; i += 1) {
    const u = Math.min(1, remaining / lengths[i]);
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    segments.push(
      React.createElement(Line, {
        key: i,
        x1,
        y1,
        x2: x1 + (x2 - x1) * u,
        y2: y1 + (y2 - y1) * u,
        stroke,
        strokeWidth: width,
        cap,
      }),
    );
    remaining -= lengths[i];
  }
  return React.createElement(Group, { id, opacity, blendMode }, segments);
}
