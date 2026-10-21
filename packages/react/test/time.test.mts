import assert from 'node:assert/strict';
import { test } from 'vitest';

import { frameToTimecode, timecodeToFrame } from '../src/index.js';

test('timecodeToFrame converts timecodes to the nearest frame', () => {
  assert.equal(timecodeToFrame('00:00:30.123', 30), 904);
  assert.equal(timecodeToFrame('01:30.5', 24), 2172);
  assert.equal(timecodeToFrame('5', 60), 300);
});

test('timecodeToFrame rejects invalid input', () => {
  assert.throws(() => timecodeToFrame('00:00:30.1234', 30), /Invalid timecode/);
  assert.throws(() => timecodeToFrame('00:00:30', 0), /positive fps/);
});

test('frameToTimecode can leave the hours out', () => {
  assert.equal(frameToTimecode(30 * 3725 + 7, 30), '01:02:05:07');
  assert.equal(frameToTimecode(30 * 3725 + 7, 30, { hours: false }), '62:05:07');
  assert.equal(frameToTimecode(-4, 30, { hours: false }), '00:00:00');
});
