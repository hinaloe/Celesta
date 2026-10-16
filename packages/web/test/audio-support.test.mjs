import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertBrowserMixable } from '../src/audio-support.ts';

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
