import { Rect, useTextMetrics } from '@celesta/react';
import { textStyle } from './Label';
import { C } from '../constants';

// A block caret one monospace cell wide.
export function Caret({ x, size, visible }: { x: number; size: number; visible: boolean }) {
  const cell = useTextMetrics('M', textStyle('mono', size)).width;
  return visible ? <Rect x={x} y={-size * 0.55} width={cell} height={size * 1.1} fill={C.mint} /> : null;
}
