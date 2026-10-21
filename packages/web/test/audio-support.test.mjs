import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild-wasm';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { automationEvents } from '../src/keyframes.ts';

// audio-support.ts imports keyframes.ts at run time, which node cannot
// resolve without an extension, so the module under test is bundled first.
const directory = mkdtempSync(fileURLToPath(new URL('../node_modules/.audio-support-test-', import.meta.url)));
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/audio-support.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const modulePath = join(directory, 'audio-support.mjs');
writeFileSync(modulePath, result.outputFiles[0].text);
const { assertBrowserMixable, fadeGains, scheduleClip } = await import(pathToFileURL(modulePath));
rmSync(directory, { recursive: true });

const base = { src: 'a.wav', sourceStart: 0, playbackRate: 1, volume: 1, muted: false, start: 0, duration: 1 };
const message = /Audio pitch and preservePitch are not supported by browser export yet\./;
const key = (time, value, easing) => ({ time: { value: Math.round(time * 1_000_000), timescale: 1_000_000 }, value, ...(easing ? { easing } : {}) });
const keys = (...list) => ({ type: 'keyframes', keyframes: list.map((entry) => key(...entry)) });

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
test('keyframed volume and rate are mixable', () => {
  assertBrowserMixable({ ...base, volume: keys([0, 0], [1, 1, 'linear']) });
  assertBrowserMixable({ ...base, playbackRate: keys([0, 1], [1, 2, 'linear']) });
  assert.throws(() => assertBrowserMixable({ ...base, playbackRate: 0 }), /playback rate must be positive/);
});
test('preservePitch with a keyframed rate is rejected', () => {
  assert.throws(() => assertBrowserMixable({ ...base, playbackRate: keys([0, 1], [1, 1, 'linear']), preservePitch: true }), message);
});

/**
 * A context whose params record their automation as `[method, value, time]`
 * and whose sources record their `start` / `stop` calls.
 */
function recording() {
  const param = (events) => ({
    setValueAtTime: (value, time) => events.push(['set', value, time]),
    linearRampToValueAtTime: (value, time) => events.push(['ramp', value, time]),
  });
  const context = {
    gains: [],
    sources: [],
    destination: { destination: true },
    createGain() {
      const events = [];
      const node = { events, gain: param(events), connect: (next) => next };
      context.gains.push(node);
      return node;
    },
    createBufferSource() {
      const events = [], calls = [];
      const node = {
        events, calls, buffer: null, loop: false, playbackRate: param(events),
        connect: (next) => next,
        start: (...args) => calls.push(['start', ...args]),
        stop: (...args) => calls.push(['stop', ...args]),
      };
      context.sources.push(node);
      return node;
    },
  };
  return context;
}
const recorded = (events) => events.map(({ kind, value, time }) => [kind, value, time]);
const buffer = { duration: 10 };

test('a clip without fades gets no fade gains', () => {
  assert.deepEqual(fadeGains(recording(), base), []);
  assert.deepEqual(fadeGains(recording(), { ...base, fadeIn: 0, fadeOut: 0 }), []);
});
test('fades ramp linearly at the edges of the clip, one gain each', () => {
  const gains = fadeGains(recording(), { ...base, start: 2, duration: 10, fadeIn: 1.5, fadeOut: 3 });
  assert.deepEqual(gains.map((gain) => gain.events), [
    [['set', 0, 2], ['ramp', 1, 3.5]],
    [['set', 1, 9], ['ramp', 0, 12]],
  ]);
});
test('a fade under way at 0 starts from where it has got to', () => {
  const [fade] = fadeGains(recording(), { ...base, start: -1, duration: 10, fadeIn: 4 });
  assert.deepEqual(fade.events, [['set', 0.25, 0], ['ramp', 1, 3]]);
});

test('scheduleClip starts with two arguments and stops at the clip end', () => {
  const clip = { ...base, start: 1, duration: 3, loop: true, playbackRate: keys([0, 1], [2, 2, 'linear']) };
  const context = recording();
  scheduleClip(context, clip, buffer, 10);
  assert.deepEqual(context.sources[0].calls, [['start', 1, 0], ['stop', 4]]);
  const short = recording();
  scheduleClip(short, clip, buffer, 2.5);
  assert.deepEqual(short.sources[0].calls, [['start', 1, 0], ['stop', 2.5]]);
});
test('scheduleClip schedules the rate and volume curves', () => {
  const clip = { ...base, start: 2, duration: 4, playbackRate: keys([0, 1], [1, 1.5, 'ease-in-out']), volume: keys([0, 0.5], [2, 20, 'linear']) };
  const context = recording();
  scheduleClip(context, clip, buffer, 10);
  assert.deepEqual(context.sources[0].events, recorded(automationEvents(clip.playbackRate, 2, 6)));
  assert.deepEqual(context.gains[0].events, recorded(automationEvents(clip.volume, 2, 6, { min: 0, max: 16 })));
});
test('a rate that overshoots below 0 is rejected', () => {
  const clip = { ...base, duration: 2, playbackRate: keys([0, 1], [1, 0.05, 'ease-out-back']) };
  assert.throws(() => scheduleClip(recording(), clip, buffer, 10), /playback rate must be positive/);
});
test('a clip after the end of the mix is not scheduled', () => {
  const context = recording();
  scheduleClip(context, { ...base, start: 5 }, buffer, 5);
  assert.equal(context.sources.length, 0);
});
