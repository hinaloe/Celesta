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

test('clips without ducking report neither key', () => {
  const [clip] = collect(h(Audio, { src: './plain.wav' }));
  assert.ok(!('duckGroup' in clip) && !('duck' in clip));
});
