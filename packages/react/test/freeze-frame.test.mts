// <FreezeFrame> cycles: a film that freezes a frame where it plays itself.

import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import * as React from 'react';
import type { ComponentType, ReactElement } from 'react';

import { Composition, FreezeFrame, Rect, useCurrentFrame } from '../src/index.js';
import type { Layer, Time } from '../src/index.js';
import { mount } from '../src/render.js';

import { childrenOf } from './helpers.mjs';

const h = React.createElement;
const at = (frame: number): Time => ({ value: frame, timescale: 30 });
const film = (Body: ComponentType) => () =>
  h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 90 }, h(Body));
const rect = (x: number) => h(Rect, { x, width: 1, height: 1, fill: '#ffffff' });

test('a film that freezes a frame where it plays itself names the cycle', () => {
  function Film(): ReactElement {
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
  const Still = ({ depth }: { depth: number }): ReactElement => h(FreezeFrame, { frame: 10 + depth * 1e-9 }, h(Still, { depth: depth + 1 }));
  expect(() => mount(film(() => h(Still, { depth: 0 }))).renderAt(at(0), null)).toThrow(
    /frame 10 > frame 10\.000000001\)$/,
  );
});

test('other children at the same frame are not a cycle', () => {
  const Body = () => h(FreezeFrame, { frame: 10 }, rect(0), h(FreezeFrame, { frame: 10 }, rect(1)));
  const [outer] = mount(film(Body)).renderAt(at(0), null).scene.layers;
  assert.equal(childrenOf(childrenOf(outer)[1])[0].transform.position.x, 1);
});

test('nesting past the limit names the chain', () => {
  // Each level freezes the next frame, so no frame repeats.
  function Film(): ReactElement {
    const frame = useCurrentFrame();
    return h(FreezeFrame, { frame: frame + 1 }, h(Film));
  }
  expect(() => mount(film(Film)).renderAt(at(0), null)).toThrow(
    /^<FreezeFrame frame=\{17\}> is nested more than 16 deep \(frame 1 > frame 2 > .* > frame 17\)$/,
  );
});

test('nesting at other frames below the limit draws as before', () => {
  function Film({ depth }: { depth: number }): ReactElement {
    const frame = useCurrentFrame();
    return h(
      React.Fragment,
      null,
      rect(frame),
      depth < 16 ? h(FreezeFrame, { frame: frame + 1 }, h(Film, { depth: depth + 1 })) : null,
    );
  }
  const { scene } = mount(film(() => h(Film, { depth: 0 }))).renderAt(at(0), null);
  let layers: Layer[] | undefined = scene.layers;
  for (let depth = 0; depth <= 16; depth += 1) {
    assert.ok(layers);
    assert.equal(layers[0].transform.position.x, depth);
    layers = layers[1] && childrenOf(layers[1]);
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
