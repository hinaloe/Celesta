import { expect, test } from 'vitest';
import React from 'react';

import { Assets, Audio, Composition, FreezeFrame, Sequence, Video, frameKeyframes, useCurrentFrame } from '../dist/index.js';
import { mount } from '../dist/render.js';

const h = React.createElement;
const at = (composition, frame) => composition.renderAt({ value: frame, timescale: 30 }, null);
const root = (durationInFrames, ...children) => () =>
  h(Composition, { width: 100, height: 100, fps: 30, durationInFrames }, ...children);

test('a bare <Video> plays its soundtrack across the composition by default', () => {
  const composition = mount(root(60, h(Video, { src: './clip.mp4' })));
  expect(at(composition, 0).audio).toEqual([
    { src: './clip.mp4', sourceStart: 0, playbackRate: 1, volume: 1, muted: false, start: 0, duration: 2 },
  ]);
});

test('<Video> volume, muted, startFrom and playbackRate reach its audio clip', () => {
  const volume = frameKeyframes([{ frame: 0, value: 0 }, { frame: 15, value: 1 }], { fps: 30 });
  const composition = mount(root(30,
    h(Video, { src: './loud.mp4', startFrom: 1, playbackRate: 2, volume }),
    h(Video, { src: './quiet.mp4', muted: true })));
  expect(at(composition, 0).audio).toEqual([
    { src: './loud.mp4', sourceStart: 1, playbackRate: 2, volume, muted: false, start: 0, duration: 1 },
    { src: './quiet.mp4', sourceStart: 0, playbackRate: 1, volume: 1, muted: true, start: 0, duration: 1 },
  ]);
});

test('<Video> sound follows the same sequence rules as <Audio> and stays in sync with its picture', () => {
  const tree = (Media) => root(120,
    h(Sequence, { from: 30, durationInFrames: 60 },
      h(Sequence, { from: -15 }, h(Media, { src: './clip.mp4', startFrom: 1, playbackRate: 2 }))));
  const video = mount(tree(Video));
  const audio = mount(tree(Audio));
  for (const frame of [0, 30, 45, 89, 90]) {
    expect(at(video, frame).audio, `frame ${frame}`).toEqual(at(audio, frame).audio);
  }
  // The head is clipped by half a second, so sound and picture both start
  // one second (0.5 s at 2x) into the source after `startFrom`.
  const [clip] = at(video, 30).audio;
  expect(clip).toMatchObject({ sourceStart: 2, start: 1, duration: 2 });
  const layer = at(video, 30).scene.layers[0].content.layers[0].content.layers[0];
  expect(layer.content.timing.sourceTimeSeconds).toBe(clip.sourceStart);
});

test('<Video> collected by the audio-only sweep matches per-frame rendering', () => {
  function Late() {
    return useCurrentFrame() >= 10 ? h(Video, { src: './late.mp4', volume: 0.5 }) : null;
  }
  const Root = root(20, h(Late), h(Sequence, { from: 5, durationInFrames: 5 }, h(Video, { src: './short.mp4' })));
  const reference = mount(Root);
  const expected = Array.from({ length: 20 }, (_, frame) => at(reference, frame).audio).flat();
  expect(expected.length).toBeGreaterThan(0);
  expect(mount(Root).collectAudio()).toEqual(expected);
});

test('<Video> inside <FreezeFrame> or <Assets> makes no sound', () => {
  const Root = root(10,
    h(FreezeFrame, { frame: 3 }, h(Video, { src: './frozen.mp4' })),
    h(Assets, null, h(Video, { src: './reference.mp4' })));
  expect(at(mount(Root), 0).audio).toEqual([]);
  expect(mount(Root).collectAudio()).toEqual([]);
});

test('loop reaches the picture and the sound of <Video>, and the sound of <Audio>', () => {
  const composition = mount(root(30,
    h(Video, { src: './clip.mp4', loop: true }),
    h(Audio, { src: './music.wav', loop: true }),
    h(Audio, { src: './voice.wav' })));
  const frame = at(composition, 15);
  expect(frame.scene.layers[0].content.timing.loop).toBe(true);
  expect(frame.audio.map((clip) => clip.loop)).toEqual([true, true, undefined]);
  expect(mount(root(30, h(Video, { src: './clip.mp4' }))).renderAt({ value: 0, timescale: 30 }, null)
    .scene.layers[0].content.timing).not.toHaveProperty('loop');
});
