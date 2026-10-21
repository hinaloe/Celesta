import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateAnimated, integrateAnimated } from '../src/keyframes.ts';

// The same cases `crates/composition/tests/keyframe_fixture.rs` pins the
// native evaluator to, so the two cannot drift apart.
const fixture = JSON.parse(readFileSync(new URL('../../../crates/composition/tests/fixtures/keyframe-evaluation.json', import.meta.url), 'utf8'));

test('every fixture sample matches the Rust evaluator', () => {
  for (const { name, animation, samples } of fixture.cases) {
    for (const { time, value, integral } of samples) {
      const seconds = time.value / time.timescale;
      const at = `${name} @ ${seconds}`;
      assert.ok(Math.abs(evaluateAnimated(animation, seconds) - value) <= 1e-9, `${at}: value ${evaluateAnimated(animation, seconds)}, expected ${value}`);
      assert.ok(Math.abs(integrateAnimated(animation, seconds) - integral) <= 1e-9, `${at}: integral ${integrateAnimated(animation, seconds)}, expected ${integral}`);
    }
  }
});
test('empty keyframes throw', () => {
  assert.throws(() => evaluateAnimated({ type: 'keyframes', keyframes: [] }, 0), /animation has no keyframes/);
  assert.throws(() => integrateAnimated({ type: 'keyframes', keyframes: [] }, 0), /animation has no keyframes/);
});
test('an unknown easing throws', () => {
  const animation = { type: 'keyframes', keyframes: [{ time: { value: 0, timescale: 1 }, value: 0 }, { time: { value: 1, timescale: 1 }, value: 1, easing: 'wobble' }] };
  assert.throws(() => evaluateAnimated(animation, 0.5), /unknown easing: wobble/);
});
