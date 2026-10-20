// <FreezeFrame> cycles: a film that freezes a frame where it plays itself.
// Run after `pnpm run build`.

import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import * as React from 'react';

import { Composition, FreezeFrame, Rect, useCurrentFrame } from '../dist/index.js';
import { mount } from '../dist/render.js';

const h = React.createElement;
const at = (frame) => ({ value: frame, timescale: 30 });
const film = (Body) => () =>
  h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 90 }, h(Body));
const rect = (x) => h(Rect, { x, width: 1, height: 1, fill: '#ffffff' });

test('a film that freezes a frame where it plays itself names the cycle', () => {
  function Film() {
    const frame = useCurrentFrame();
    return h(
      React.Fragment,
      null,
      rect(0),
      frame >= 30 ? h(FreezeFrame, { id: 'thumb', frame: 45 }, h(Film)) : null,
    );
  }
  const mounted = mount(film(Film));
  assert.equal(mounted.renderAt(at(0), null).scene.layers.length, 1);
  expect(() => mounted.renderAt(at(30), null)).toThrow(
    '<FreezeFrame frame={45}> draws itself: it is inside a <FreezeFrame> at the same frame ' +
      '(frame 45 (id "thumb") > frame 45 (id "thumb"))',
  );
});

test('frames that round to the same time are the same frame', () => {
  const Body = () => h(FreezeFrame, { frame: 10 }, h(FreezeFrame, { frame: 10 + 1e-9 }, rect(0)));
  expect(() => mount(film(Body)).renderAt(at(0), null)).toThrow(/frame 10 > frame 10\.000000001\)$/);
});

test('nesting past the limit names the chain', () => {
  // Each level freezes the next frame, so no frame repeats.
  function Film() {
    const frame = useCurrentFrame();
    return h(FreezeFrame, { frame: frame + 1 }, h(Film));
  }
  expect(() => mount(film(Film)).renderAt(at(0), null)).toThrow(
    /^<FreezeFrame frame=\{17\}> is nested more than 16 deep \(frame 1 > frame 2 > .* > frame 17\)$/,
  );
});

test('nesting at other frames below the limit draws as before', () => {
  function Film({ depth }) {
    const frame = useCurrentFrame();
    return h(
      React.Fragment,
      null,
      rect(frame),
      depth < 16 ? h(FreezeFrame, { frame: frame + 1 }, h(Film, { depth: depth + 1 })) : null,
    );
  }
  const { scene } = mount(film(() => h(Film, { depth: 0 }))).renderAt(at(0), null);
  let layers = scene.layers;
  for (let depth = 0; depth <= 16; depth += 1) {
    assert.equal(layers[0].transform.position.x, depth);
    layers = layers[1]?.content.layers;
  }
  assert.equal(layers, undefined);
});

test('the same frame in sibling <FreezeFrame>s is not a cycle', () => {
  const Body = () =>
    h(
      React.Fragment,
      null,
      h(FreezeFrame, { frame: 10 }, rect(0)),
      h(FreezeFrame, { frame: 10 }, h(FreezeFrame, { frame: 20 }, rect(1))),
    );
  assert.equal(mount(film(Body)).renderAt(at(0), null).scene.layers.length, 2);
});
