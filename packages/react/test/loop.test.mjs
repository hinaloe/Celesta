import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as React from 'react';

import { Audio, Composition, Loop, Sequence, Text, Video, useCurrentFrame, useCurrentTime, useVideoConfig } from '../dist/index.js';
import { mount } from '../dist/render.js';

const h = React.createElement;
const at = (composition, frame, options) => composition.renderAt({ value: frame, timescale: 30 }, null, options);
const texts = (layers) => layers.flatMap((layer) =>
  layer.content.type === 'text' ? [layer.content.text] : texts(layer.content.layers ?? []),
);
const videos = (layers) => layers.flatMap((layer) =>
  layer.content.type === 'video' ? [layer.content] : videos(layer.content.layers ?? []),
);
// The Rust bridge keeps one clip per distinct report.
const distinct = (clips) => [...new Map(clips.map((clip) => [JSON.stringify(clip), clip])).values()];

function Clock() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return h(Text, null, `${frame}/${durationInFrames}`);
}

test('children see one clock that restarts every cycle, and nothing outside the loop', () => {
  const composition = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 120 },
    h(Loop, { from: 10, durationInFrames: 30, times: 2.5 }, h(Clock)),
  ));
  const expected = (frame) => frame < 10 || frame >= 85 ? [] : [`${(frame - 10) % 30}/30`];
  const frames = Array.from({ length: 120 }, (_, frame) => frame);
  for (const frame of frames) {
    assert.deepEqual(texts(at(composition, frame).scene.layers), expected(frame), `frame ${frame}`);
  }
  // Scrubbing in any order gives the same frames.
  for (const frame of [84, 9, 40, 39, 85, 70, 10, 0, 69]) {
    assert.deepEqual(texts(at(composition, frame).scene.layers), expected(frame), `scrubbed to ${frame}`);
  }
});

test('without times, a loop repeats until its enclosing window ends', () => {
  const composition = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 120 },
    h(Sequence, { from: 20, durationInFrames: 50 }, h(Loop, { durationInFrames: 20 }, h(Clock))),
  ));
  for (const frame of [19, 20, 39, 40, 59, 60, 69, 70]) {
    const shown = frame >= 20 && frame < 70 ? [`${(frame - 20) % 20}/20`] : [];
    assert.deepEqual(texts(at(composition, frame).scene.layers), shown, `frame ${frame}`);
  }
});

test('a fractional period starts each cycle at its exact time', () => {
  const times = [];
  function Seconds() {
    const time = useCurrentTime();
    times.push(time.value / time.timescale);
    return null;
  }
  const composition = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 30 },
    h(Loop, { durationInFrames: 7.5 }, h(Seconds)),
  ));
  times.length = 0;
  for (const frame of [7, 8, 15, 22, 23]) at(composition, frame);
  // Cycles start at frames 0, 7.5, 15, and 22.5.
  const expected = [7 / 30, 0.5 / 30, 0, 7 / 30, 0.5 / 30];
  assert.equal(times.length, expected.length);
  times.forEach((seconds, index) => assert.ok(Math.abs(seconds - expected[index]) < 1e-6, `${seconds} at ${index}`));
});

test('video restarts with every cycle', () => {
  const composition = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 90 },
    h(Loop, { durationInFrames: 30 }, h(Video, { src: 'clip.mp4', startFrom: 2 })),
  ));
  for (const frame of [0, 15, 29, 30, 45, 60, 89]) {
    const [video] = videos(at(composition, frame).scene.layers);
    assert.ok(Math.abs(video.timing.sourceTimeSeconds - (2 + (frame % 30) / 30)) < 1e-6, `frame ${frame}`);
  }
});

test('each cycle plays its audio as a clip of its own, the last one cut short', () => {
  const composition = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 120 },
    h(Loop, { from: 15, durationInFrames: 30, times: 2.5 }, h(Audio, { src: 'bgm.wav', startFrom: 1 })),
  ));
  const clip = (start, duration) => ({ src: 'bgm.wav', sourceStart: 1, playbackRate: 1, volume: 1, muted: false, start, duration });
  assert.deepEqual(distinct(composition.collectAudio()), [clip(0.5, 1), clip(1.5, 1), clip(2.5, 0.5)]);
  // A single frame reports the clip of the cycle it is in.
  assert.deepEqual(at(composition, 80).audio, [clip(2.5, 0.5)]);
});

test('sequences inside open and close against each cycle', () => {
  const composition = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 120 },
    h(Loop, { durationInFrames: 40 },
      h(Sequence, { from: 10, durationInFrames: 10 }, h(Clock)),
      h(Loop, { durationInFrames: 15 }, h(Text, null, 'inner')),
    ),
  ));
  for (const frame of [0, 10, 19, 20, 50, 59, 60, 90, 99, 100]) {
    const cycle = frame % 40;
    const shown = cycle >= 10 && cycle < 20 ? [`${cycle - 10}/10`, 'inner'] : ['inner'];
    assert.deepEqual(texts(at(composition, frame).scene.layers), shown, `frame ${frame}`);
  }
  // The inner loop's last cycle in each outer cycle is cut at 40.
  const audio = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 80 },
    h(Loop, { durationInFrames: 40 }, h(Loop, { durationInFrames: 15 }, h(Audio, { src: 'tick.wav' }))),
  )).collectAudio();
  assert.deepEqual(distinct(audio).map((clip) => [clip.start * 30, clip.duration * 30].map(Math.round)), [
    [0, 15], [15, 15], [30, 10], [40, 15], [55, 15], [70, 10],
  ]);
});

test('a loop running to the end continues past it with openEnd', () => {
  const composition = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 60 },
    h(Loop, { durationInFrames: 30 }, h(Clock)),
  ));
  assert.deepEqual(texts(at(composition, 60, { openEnd: true }).scene.layers), texts(at(composition, 0).scene.layers));
  assert.deepEqual(texts(at(composition, 61, { openEnd: true }).scene.layers), texts(at(composition, 1).scene.layers));
});

test('a loop rejects periods and counts it cannot repeat', () => {
  for (const props of [{}, { durationInFrames: 0 }, { durationInFrames: -5 }, { durationInFrames: Infinity }, { durationInFrames: NaN }]) {
    assert.throws(() => mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 10 },
      h(Loop, props, h(Clock)))), /positive finite `durationInFrames`/, JSON.stringify(props));
  }
  for (const times of [0, -1, NaN]) {
    assert.throws(() => mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 10 },
      h(Loop, { durationInFrames: 5, times }, h(Clock)))), /`times` must be a positive number/, String(times));
  }
  // Infinite times is the same as none.
  const composition = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 10 },
    h(Loop, { durationInFrames: 5, times: Infinity }, h(Clock))));
  assert.deepEqual(texts(at(composition, 7).scene.layers), ['2/5']);
});
