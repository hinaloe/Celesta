import { expect, test } from 'vitest';
import React from 'react';

import { Audio, Composition, Font, Group, Sequence, useCurrentFrame, useTextMetrics } from '../src/index.js';
import { mount } from '../src/render.js';
import { setTextMeasurer } from '../src/text-measure.js';
import type { MeasureTextRequest } from '../src/text-measure.js';

const h = React.createElement;

test('audio collection preserves every report, font-dependent hooks, state and subsequent renders', () => {
  const measured: MeasureTextRequest[] = [];
  setTextMeasurer(async () => { throw new Error('unexpected async measurement'); }, (request) => {
    measured.push(request);
    const width = request.text.length * (request.fonts.length ? 20 : 10);
    return { width, height: 0, ascent: 0, descent: 0, lineHeight: 0, capHeight: 0, xHeight: 0, lines: 1, glyphs: [] };
  });
  function Sound() {
    const frame = useCurrentFrame();
    const [src, setSrc] = React.useState('state.wav');
    if (frame === 6 && src === 'state.wav') setSrc('updated.wav');
    const metrics = useTextMetrics('x'.repeat(frame % 4 + 1));
    return metrics.width > 30 ? h(Audio, { src, volume: frame / 10 }) : null;
  }
  const Root = () => {
    const frame = useCurrentFrame();
    return h(Composition, { width: 100, height: 100, fps: 30, durationInFrames: 30 },
      h(Group, null,
        h(Audio, { src: 'same.wav' }), h(Audio, { src: 'same.wav' }),
        frame === 17 && h(Audio, { src: 'one-frame.wav' }),
        h(Sequence, { from: 5, durationInFrames: 20 },
          h(Sequence, { from: -3 }, h(Sound)))),
      frame >= 15 && h(Font, { src: './font.ttf' }));
  };
  const reference = mount(Root);
  const batched = mount(Root);
  for (let pass = 0; pass < 2; pass++) {
    measured.length = 0;
    const expected = Array.from({ length: 30 }, (_, frame) =>
      reference.renderAt({ value: frame, timescale: 30 }, null).audio).flat();
    const expectedMeasurements = [...measured];
    measured.length = 0;
    const actual = batched.collectAudio();
    expect(actual).toEqual(expected);
    expect(measured).toEqual(expectedMeasurements);
    expect(actual.filter(({ src }) => src === 'same.wav')).toHaveLength(60);
    expect(actual.filter(({ src }) => src === 'one-frame.wav')).toHaveLength(1);
    // Volume identifies Sound's local frame. Both paths could remount on
    // every frame and still agree, so also check the state transition itself.
    expect(actual.find(({ volume }) => volume === 0.3)?.src).toBe('state.wav');
    expect(actual.find(({ volume }) => volume === 0.7)?.src).toBe('updated.wav');
  }
  expect(batched.renderAt({ value: 0, timescale: 30 }, null)).toEqual(
    reference.renderAt({ value: 0, timescale: 30 }, null));
});

test('audio collection skips visual layer construction but propagates render failures', () => {
  const Root = () => h(Composition, { width: 100, height: 100, fps: 30, durationInFrames: 3 },
    // A visual prop that throws if the layer builder accesses it.
    h('rect', { shadow: { color: '#000000', get blur() { throw new Error('visual layer was built'); } } }),
    h(Audio, { src: 'voice.wav' }));
  expect(mount(Root).collectAudio()).toHaveLength(3);
  expect(() => mount(Root).renderAt({ value: 0, timescale: 30 }, null)).toThrow(/visual layer was built/);
  function Broken() {
    if (useCurrentFrame() === 2) throw new Error('late audio render failure');
    return null;
  }
  expect(() => mount(() => h(Composition,
    { width: 100, height: 100, fps: 30, durationInFrames: 3 }, h(Broken))).collectAudio())
    .toThrow(/late audio render failure/);
});
