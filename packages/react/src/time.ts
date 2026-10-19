// Shared exact-time helpers. `Time` is the generated `{ value, timescale }`
// rational from celesta_composition; seconds are converted at a microsecond
// timescale — comfortably finer than any frame rate or audio clock — so
// trimming and sequence offsets are not visibly quantized.

import type { Time } from './scene';

export const SECONDS_TIMESCALE = 1_000_000;

export function secondsToTime(seconds: number): Time {
  return { value: Math.round(seconds * SECONDS_TIMESCALE), timescale: SECONDS_TIMESCALE };
}

export function secondsFromTime(time: Time): number {
  return time.value / time.timescale;
}

/**
 * How far apart two times may be and still be the same window edge. Each
 * `<Sequence>` rounds the time it shifts to a microsecond, so frame 10 at
 * 30 fps is 0.333333 s inside one, and nested ones add up the error.
 */
const EDGE_TOLERANCE_SECONDS = 10 / SECONDS_TIMESCALE;

/** Whether `seconds` is before the window edge `edgeSeconds`; see `EDGE_TOLERANCE_SECONDS`. */
export function isBefore(seconds: number, edgeSeconds: number): boolean {
  return seconds < edgeSeconds - EDGE_TOLERANCE_SECONDS;
}

/**
 * Whether a window ending at `endSec` (composition seconds) ends together
 * with the composition. Half a frame of slack absorbs rounding in summed
 * sequence offsets.
 */
export function endsWithComposition(endSec: number, compositionEndSec: number, fps: number): boolean {
  return Math.abs(endSec - compositionEndSec) < 0.5 / fps;
}

/** Converts a `HH:MM:SS(.mmm)`, `MM:SS(.mmm)`, or `SS(.mmm)` timecode to a frame. */
export function timecodeToFrame(timecode: string, fps: number): number {
  const trimmed = timecode.trim();
  if (!/^\d+(?::\d+){0,2}(?:\.\d{1,3})?$/.test(trimmed)) {
    throw new Error(`Invalid timecode: ${timecode}`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('timecodeToFrame() requires a positive fps');
  }

  const seconds = trimmed
    .split(':')
    .reduce((total, component) => total * 60 + Number(component), 0);
  return Math.round(seconds * fps);
}

/**
 * Formats a frame as an `HH:MM:SS:FF` timecode, where `FF` counts frames
 * within the second. Negative frames are formatted as frame 0.
 */
export function frameToTimecode(frame: number, fps: number): string {
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error('frameToTimecode() requires a positive integer fps');
  }
  const whole = Math.max(0, Math.floor(frame));
  const seconds = Math.floor(whole / fps);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(whole % fps)}`;
}
