// <MotionBlur> and <Trail>: children drawn again at moments near the frame.
// Run after `pnpm run build`.

import { expect, test } from 'vitest';
import * as React from 'react';

import {
  Audio,
  Composition,
  Group,
  MotionBlur,
  Rect,
  Sequence,
  Static,
  Trail,
  Video,
  useCurrentFrame,
} from '../dist/index.js';
import { mount } from '../dist/render.js';

const h = React.createElement;
const time = (frame) => ({ value: frame, timescale: 30 });
const at = (composition, frame, options) => composition.renderAt(time(frame), null, options);
const root = (durationInFrames, ...children) => () =>
  h(Composition, { width: 100, height: 100, fps: 30, durationInFrames }, ...children);

/** A rect at x = the frame, wherever it is drawn. */
function Mover() {
  return h(Rect, { id: 'mover', x: useCurrentFrame(), width: 1, height: 1, fill: '#ffffff' });
}

/** The x of the first layer in each sample of `layer`, by default the scene's first. */
const sampleXs = (scene, layer = scene.layers[0]) =>
  layer.content.layers.map((sample) => sample.content.layers[0].transform.position.x);

test('draws each sample at the middle of its part of a shutter centred on the frame', () => {
  const composition = mount(root(60, h(MotionBlur, { samples: 4 }, h(Mover))));
  const { scene } = at(composition, 12);
  const [layer] = scene.layers;
  expect(layer.content.type).toBe('group');
  expect(layer.content.motionBlur).toBe(true);
  // 180°: a quarter of a frame either side, in four parts.
  expect(sampleXs(scene)).toEqual([11.8125, 11.9375, 12.0625, 12.1875]);
});

test('reports the exact sample frame inside nested sequences', () => {
  const frames = [];
  function Probe() {
    frames.push(useCurrentFrame());
    return null;
  }
  const composition = mount(root(60, h(MotionBlur, { samples: 2, shutterAngle: 90 }, h(Sequence, { from: 10 }, h(Probe)))));
  frames.length = 0;
  at(composition, 12);
  // ±1/8 frame around frame 12, two frames into the sequence.
  expect(frames).toEqual([1.9375, 2.0625]);
});

test('a function child receives each sample frame, for props computed outside', () => {
  const composition = mount(root(60, h(MotionBlur, { samples: 2 },
    (frame) => h(Rect, { x: frame * 10, width: 1, height: 1 }))));
  expect(sampleXs(at(composition, 3).scene)).toEqual([28.75, 31.25]);
});

test('keeps samples within the enclosing window', () => {
  const composition = mount(root(30, h(Sequence, { from: 10, durationInFrames: 5 },
    h(MotionBlur, { samples: 2, shutterAngle: 360 }, h(Mover)))));
  // The sequence's frames 0 to 4 are composition frames 10 to 14.
  const blurOf = (scene) => scene.layers[0].content.layers[0];
  const first = at(composition, 10).scene;
  expect(sampleXs(first, blurOf(first))).toEqual([0, 0.25]);
  const last = at(composition, 14).scene;
  expect(sampleXs(last, blurOf(last))).toEqual([3.75, 4]);
});

test('one sample, or a closed shutter, draws a plain group at the frame', () => {
  for (const props of [{ samples: 1 }, { shutterAngle: 0 }]) {
    const { scene } = at(mount(root(60, h(MotionBlur, props, h(Mover)))), 12);
    expect(scene.layers[0].content.motionBlur).toBeUndefined();
    expect(scene.layers[0].content.layers[0].transform.position.x).toBe(12);
  }
});

test('a layer has the same id in every sample', () => {
  const composition = mount(root(60, h(MotionBlur, { samples: 3 }, h(Mover), h(Rect, { width: 1, height: 1 }))));
  const samples = at(composition, 5).scene.layers[0].content.layers;
  expect(samples.map((sample) => sample.id)).toEqual(['root.0.sample.0', 'root.0.sample.1', 'root.0.sample.2']);
  for (const sample of samples) {
    expect(sample.content.layers.map((layer) => layer.id)).toEqual(['mover', 'root.0.1']);
  }
});

test('the blurred layer takes the props of a group, applied to the average', () => {
  const composition = mount(root(60, h(MotionBlur, { id: 'blur', x: 5, opacity: 0.5, blendMode: 'screen', blur: 2 }, h(Mover))));
  const [layer] = at(composition, 5).scene.layers;
  expect(layer.id).toBe('blur');
  expect(layer.transform.position).toEqual({ x: 5, y: 0 });
  expect(layer.opacity).toBe(0.5);
  expect(layer.blendMode).toBe('screen');
  expect(layer.effects.blur).toBe(2);
});

test('a <Video> shows the frame\'s picture in every sample', () => {
  const tree = (Wrapper, props) =>
    root(60, h(Wrapper, props, h(Sequence, { from: 10 }, h(Video, { src: './clip.mp4', startFrom: 1 }))));
  const [plainSequence] = at(mount(tree(Group, null)), 20).scene.layers[0].content.layers;
  const [plain] = plainSequence.content.layers;
  for (const [Wrapper, props] of [[MotionBlur, { samples: 4 }], [Trail, { copies: 2 }]]) {
    const samples = at(mount(tree(Wrapper, props)), 20).scene.layers[0].content.layers;
    const sequences = samples.map((sample) => sample.content.type === 'group' && sample.content.layers[0].content.type === 'group'
      ? sample.content.layers[0]
      : sample);
    for (const sequence of sequences) {
      const [video] = sequence.content.layers;
      // The very values the unblurred video has, which the decoder matches
      // to the frame it already decoded.
      expect(video.id).toBe(plain.id);
      expect(video.content.timing).toEqual(plain.content.timing);
    }
  }
});

test('audio inside plays once', () => {
  const tree = (Wrapper) => root(60, h(Wrapper, null, h(Audio, { src: './a.wav' }), h(Video, { src: './v.mp4' })));
  for (const Wrapper of [MotionBlur, Trail]) {
    const blurred = mount(tree(Wrapper));
    const plain = mount(tree(Group));
    expect(at(blurred, 20).audio, Wrapper.name).toEqual(at(plain, 20).audio);
    expect(blurred.collectAudio(), Wrapper.name).toEqual(plain.collectAudio());
  }
});

test('the same frame is the same whatever was drawn before it', () => {
  const composition = mount(root(60, h(MotionBlur, null, h(Mover)), h(Trail, null, h(Mover))));
  const first = JSON.stringify(at(composition, 30).scene);
  at(composition, 7);
  at(composition, 59);
  expect(JSON.stringify(at(composition, 30).scene)).toBe(first);
});

test('compact frames leave the sample groups\' defaults out', () => {
  const composition = mount(root(60, h(MotionBlur, { samples: 2 }, h(Mover))));
  const [sample] = at(composition, 5, { compact: true }).scene.layers[0].content.layers;
  expect(sample.transform).toEqual({ anchor: { x: 0, y: 0 } });
  expect(sample.opacity).toBeUndefined();
});

test('a trail draws older, fainter copies beneath the children', () => {
  const composition = mount(root(60, h(Trail, { copies: 3, lagInFrames: 2, trailOpacity: 0.6 }, h(Mover))));
  const layers = at(composition, 10).scene.layers[0].content.layers;
  expect(layers.map((layer) => layer.content.type === 'group' ? layer.content.layers[0].transform.position.x : layer.transform.position.x))
    .toEqual([4, 6, 8, 10]);
  for (const [index, opacity] of [0.2, 0.4, 0.6].entries()) {
    expect(layers[index].opacity).toBeCloseTo(opacity, 12);
  }
  expect(layers[3].id).toBe('mover');
  expect(at(composition, 10).scene.layers[0].content.motionBlur).toBeUndefined();
});

test('a trail draws no copy from before its window began', () => {
  const composition = mount(root(60, h(Sequence, { from: 20 }, h(Trail, { copies: 3, lagInFrames: 2 }, h(Mover)))));
  const layers = at(composition, 23).scene.layers[0].content.layers[0].content.layers;
  // Sequence frame 3: copies at 1 and -1 (dropped) and -3 (dropped).
  expect(layers.length).toBe(2);
  expect(layers[0].content.layers[0].transform.position.x).toBe(1);
});

test('refuses values out of range', () => {
  for (const [Component, props, message] of [
    [MotionBlur, { samples: 0 }, /samples must be a whole number from 1 to 64/],
    [MotionBlur, { samples: 2.5 }, /samples must be a whole number/],
    [MotionBlur, { shutterAngle: 721 }, /shutterAngle must be a finite number from 0 to 720/],
    [Trail, { copies: -1 }, /copies must be a whole number from 0 to 64/],
    [Trail, { lagInFrames: 0 }, /lagInFrames must be a positive finite number/],
    [Trail, { trailOpacity: 2 }, /trailOpacity must be a finite number from 0 to 1/],
  ]) {
    expect(() => at(mount(root(60, h(Component, props, h(Mover)))), 0)).toThrow(message);
  }
});

test('<Static> cannot hold a motion blur or a trail', () => {
  for (const Component of [MotionBlur, Trail]) {
    expect(() => at(mount(root(60, h(Static, null, h(Component, null, h(Mover))))), 0)).toThrow(/<Static> cannot contain/);
  }
});
