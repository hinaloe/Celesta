import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertBrowserMixable, fadeGains } from '../src/audio-support.ts';

const base = { src: 'a.wav', sourceStart: 0, playbackRate: 1, volume: 1, muted: false, start: 0, duration: 1 };
const message = /Audio pitch and preservePitch are not supported by browser export yet\./;

test('plain clips, and preservePitch at rate 1, are mixable', () => {
  assertBrowserMixable(base);
  assertBrowserMixable({ ...base, preservePitch: true });
  assertBrowserMixable({ ...base, pitch: 0 });
});
test('pitch or preservePitch with a rate change is rejected', () => {
  assert.throws(() => assertBrowserMixable({ ...base, pitch: 2 }), message);
  assert.throws(() => assertBrowserMixable({ ...base, pitch: { type: 'keyframes', keyframes: [] } }), message);
  assert.throws(() => assertBrowserMixable({ ...base, playbackRate: 2, preservePitch: true }), message);
});
test('existing checks still apply', () => {
  assert.throws(() => assertBrowserMixable({ ...base, playbackRate: 0 }), /playback rate must be positive/);
  assert.throws(() => assertBrowserMixable({ ...base, volume: { type: 'keyframes', keyframes: [] } }), /Animated audio volume and playback rate are not supported by browser export yet\./);
});

/** A context whose gain nodes record their automation as `[method, value, time]`. */
const recording = {
  createGain() {
    const events = [];
    return {
      events,
      gain: {
        setValueAtTime: (value, time) => events.push(['set', value, time]),
        linearRampToValueAtTime: (value, time) => events.push(['ramp', value, time]),
      },
    };
  },
};

test('a clip without fades gets no fade gains', () => {
  assert.deepEqual(fadeGains(recording, base), []);
  assert.deepEqual(fadeGains(recording, { ...base, fadeIn: 0, fadeOut: 0 }), []);
});
test('fades ramp linearly at the edges of the clip, one gain each', () => {
  const gains = fadeGains(recording, { ...base, start: 2, duration: 10, fadeIn: 1.5, fadeOut: 3 });
  assert.deepEqual(gains.map((gain) => gain.events), [
    [['set', 0, 2], ['ramp', 1, 3.5]],
    [['set', 1, 9], ['ramp', 0, 12]],
  ]);
});
test('a fade under way at 0 starts from where it has got to', () => {
  const [fade] = fadeGains(recording, { ...base, start: -1, duration: 10, fadeIn: 4 });
  assert.deepEqual(fade.events, [['set', 0.25, 0], ['ramp', 1, 3]]);
});
