import assert from 'node:assert/strict';
import { test } from 'vitest';

import { resolveTimedRanges, timedRangeAt } from '../src/index.js';
import type { ResolveTimedRangesOptions, TimedItem } from '../src/index.js';

const what = '<CaptionTrack>';

test('ranges are half open and looked up on their boundary frames', () => {
  const ranges = resolveTimedRanges([
    { from: 0, durationInFrames: 30 },
    { from: 45, durationInFrames: 15 },
  ], { what });
  assert.deepEqual(ranges, [{ index: 0, from: 0, end: 30 }, { index: 1, from: 45, end: 60 }]);
  const at = (frame: number) => timedRangeAt(ranges, frame)?.index ?? null;
  assert.equal(at(-1), null);
  assert.equal(at(0), 0);
  assert.equal(at(29), 0);
  // The gap between them shows nothing.
  assert.equal(at(30), null);
  assert.equal(at(44), null);
  assert.equal(at(45), 1);
  assert.equal(at(60), null);
});

test('items are sorted by from, keeping list order for ties', () => {
  const ranges = resolveTimedRanges([
    { from: 60, durationInFrames: 10 },
    { from: 0, durationInFrames: 10 },
  ], { what });
  assert.deepEqual(ranges.map((range) => range.index), [1, 0]);
});

test('an open end lasts until the next item, or the end given', () => {
  const ranges = resolveTimedRanges([{ from: 0 }, { from: 40 }], { what, end: 90 });
  assert.deepEqual(ranges, [{ index: 0, from: 0, end: 40 }, { index: 1, from: 40, end: 90 }]);
  assert.throws(() => resolveTimedRanges([{ from: 0 }], { what }), /item 0 needs a `durationInFrames`; nothing follows it/);
  assert.throws(
    () => resolveTimedRanges([{ from: 10 }, { from: 10, durationInFrames: 5 }], { what }),
    /item 0 has no durationInFrames and starts on the same frame as item 1/,
  );
});

test('with an end, items outside it are errors', () => {
  const label = (index: number) => `page ${index}`;
  assert.throws(
    () => resolveTimedRanges([{ from: 0, durationInFrames: 100 }], { what: 'line "a"', end: 90, label }),
    /line "a": page 0 \(frames 0–100\) is outside frames 0–90/,
  );
  assert.throws(() => resolveTimedRanges([{ from: -5, durationInFrames: 10 }], { what, end: 90 }), /outside frames 0–90/);
  assert.throws(() => resolveTimedRanges([{ from: 90 }], { what, end: 90 }), /item 0 starts at frame 90, at or after the end/);
  // Without one, an item may start before 0, as a <Sequence> may.
  assert.deepEqual(resolveTimedRanges([{ from: -5, durationInFrames: 10 }], { what }), [{ index: 0, from: -5, end: 5 }]);
});

test('overlaps are errors unless the later item may cut the earlier one', () => {
  const items: TimedItem[] = [
    { from: 0, durationInFrames: 50 },
    { from: 30, durationInFrames: 30 },
    { from: 30, durationInFrames: 10 },
  ];
  assert.throws(
    () => resolveTimedRanges(items, { what, label: (index) => `cue ${index}` }),
    /<CaptionTrack>: cue 1 \(frames 30–60\) overlaps cue 0 \(frames 0–50\)/,
  );
  assert.deepEqual(resolveTimedRanges(items, { what, overlap: 'latest' }), [
    { index: 0, from: 0, end: 30 },
    { index: 2, from: 30, end: 40 },
  ]);
  // Touching is not overlapping.
  assert.equal(resolveTimedRanges([{ from: 0, durationInFrames: 30 }, { from: 30, durationInFrames: 30 }], { what }).length, 2);
});

test('bad frames and order are refused with the item named', () => {
  // Wrong on purpose: the checks are for data that comes in untyped.
  const bad = (items: unknown[], pattern: RegExp, options: Partial<ResolveTimedRangesOptions> = {}) =>
    assert.throws(() => resolveTimedRanges(items as TimedItem[], { what, ...options }), pattern);
  bad([{ from: 1.5, durationInFrames: 10 }], /item 0 needs a whole-number `from`, got 1.5/);
  bad([{ from: 0, durationInFrames: 0 }], /item 0 needs a whole-number `durationInFrames` of at least 1, got 0/);
  bad([{ from: 0, durationInFrames: Number.NaN }], /got NaN/);
  bad([null], /item 0 is not an object/);
  bad([{ from: 30, durationInFrames: 5 }, { from: 0, durationInFrames: 5 }], /item 1 starts at frame 0, before item 0 \(frame 30\); list them in order/, { ordered: true });
});
