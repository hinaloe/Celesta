import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as React from 'react';

import { Audio, Composition, Video } from '../src/index.js';
import type { AudioDuck } from '../src/index.js';
import { mount } from '../src/render.js';

const h = React.createElement;

function collect(children: React.ReactNode) {
  const Root = () => h(Composition, { width: 16, height: 16, fps: 10, durationInFrames: 10 }, children);
  return mount(Root).collectAudio();
}

test('<Audio> and <Video> report their duck group and duck unchanged', () => {
  const duck: AudioDuck = { under: ['voice', 'sfx'], to: { db: -12 }, attack: 0.2 };
  const clips = collect([
    h(Audio, { key: 'bed', src: './bed.wav', duck }),
    h(Audio, { key: 'voice', src: './voice.wav', duckGroup: 'voice' }),
    h(Video, { key: 'game', src: './game.mp4', duckGroup: 'game', duck: { under: 'voice' } }),
  ]);
  const by = (src: string) => clips.find((clip) => clip.src === src)!;
  assert.deepEqual(by('./bed.wav').duck, duck);
  assert.equal(by('./bed.wav').duckGroup, undefined);
  assert.equal(by('./voice.wav').duckGroup, 'voice');
  assert.equal(by('./game.mp4').duckGroup, 'game');
  assert.deepEqual(by('./game.mp4').duck, { under: 'voice' });
});

test('values JSON cannot carry are rejected with the field', () => {
  // Deliberately outside what AudioDuck accepts, as untyped code can pass.
  const bad = (duck: unknown) => () => collect(h(Audio, { src: './bed.wav', duck: duck as AudioDuck }));
  assert.throws(bad({ under: 'voice', to: Number.NaN }), /<Audio> duck\.to must be a finite multiplier or \{ db \}/);
  assert.throws(bad({ under: 'voice', to: { db: -Infinity } }), /<Audio> duck\.to must be a finite multiplier or \{ db \}/);
  assert.throws(bad({ under: 'voice', attack: Infinity }), /<Audio> duck\.attack must be a finite number of seconds/);
  assert.throws(bad({ under: 'voice', holdGap: '1' }), /<Audio> duck\.holdGap must be a finite number of seconds/);
  assert.throws(bad({ under: 5 }), /<Audio> duck\.under must be a group name or a list of them/);
  assert.throws(bad('voice'), /<Audio> duck must be an object/);
  assert.throws(() => collect(h(Audio, { src: './v.wav', duckGroup: 5 as unknown as string })), /<Audio> duckGroup must be a string/);
});

test('clips without ducking report neither key', () => {
  const [clip] = collect(h(Audio, { src: './plain.wav' }));
  assert.ok(!('duckGroup' in clip) && !('duck' in clip));
});
