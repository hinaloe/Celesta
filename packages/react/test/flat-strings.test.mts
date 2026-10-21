// Every string in a rendered scene is flat. V8's JSON.stringify fast path
// gives up on a whole frame at the first ConsString or SlicedString, which
// made one `FRAME ${n}` text send NEBULA frames 2.8x slower.

import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { test } from 'vitest';
import * as React from 'react';
import type { ReactElement } from 'react';

import { Composition, Group, Image, Instances, Rect, Text } from '../src/index.js';
import { createResolver, mount } from '../src/render.js';
import { shaderEffect, shaderSource } from '../src/internal.js';
import { registerComponent } from '../src/registry.js';

v8.setFlagsFromString('--allow-natives-syntax');
// V8 natives, which only code compiled after the flag is set can call; typed by hand.
const sameMap = new Function('a', 'b', 'return %HaveSameMap(a, b)') as (a: unknown, b: unknown) => boolean;
const internalized = new Function('value', 'return %IsInternalizedString(value)') as (value: unknown) => boolean;
const sequential = [JSON.parse('"a string long enough to be cons"'), JSON.parse('"a string long enough to be cons あ"')];
const flat = (value: string) => internalized(value) || sequential.some((reference) => sameMap(value, reference));

function nonFlatStrings(value: unknown, found: string[] = []) {
  if (typeof value === 'string') {
    if (!flat(value)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) nonFlatStrings(item, found);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) nonFlatStrings(item, found);
  }
  return found;
}

const h = React.createElement;

test('the check catches a string built by a template literal', () => {
  const frame = String(Math.floor(Math.random() * 1000)).padStart(4, '0');
  assert.deepEqual(nonFlatStrings({ text: `FRAME ${frame} / 600` }).length, 1);
});

test('a frame has no cons or sliced strings in ids, text, colors, asset paths, or shaders', () => {
  const nest = (depth: number, child: ReactElement): ReactElement => (depth === 0 ? child : h(Group, null, nest(depth - 1, child)));
  const Scene = () => {
    const frame = String(Math.floor(Math.random() * 1000)).padStart(4, '0');
    const shader = shaderSource({
      name: `ripple-${frame}-shader`,
      wgsl: `fn effect(input: EffectInput) -> vec4f { return vec4f(${frame}.0); }`,
      params: [{ name: `amount_${frame}_value`, type: 'f32' }],
    });
    return h(
      Composition,
      { width: 10, height: 10, fps: 30, durationInFrames: 30 },
      nest(
        6,
        h(
          React.Fragment,
          null,
          h(Text, null, `FRAME ${frame} / 600`),
          h(Rect, { id: `authored-${frame}-rect`, width: 1, height: 1, fill: `rgba(${frame}, 0, 0, 0.5)` }),
          h(Image, { src: `images/frame-${frame}.png`.slice(0, 20) }),
          h(Rect, { width: 1, height: 1, shader: shaderEffect(shader, [1], 0) }),
          // Columns over 1 MiB, which Node's Buffer#toString returns as
          // external strings.
          h(Instances, {
            count: 300_000,
            x: new Float32Array(300_000).fill(Number(frame)),
            y: new Float32Array(300_000),
            rotation: new Float32Array(300_000),
            color: new Uint8Array(1_200_000),
            width: 1,
            height: 1,
          }),
        ),
      ),
    );
  };
  const { scene } = mount(Scene).renderAt({ value: 0, timescale: 30 }, null);
  assert.deepEqual(nonFlatStrings(scene), []);
});

test('a component resolution has no cons or sliced strings in its layers or shaders', () => {
  const frame = String(Math.floor(Math.random() * 1000)).padStart(4, '0');
  const shader = shaderSource({
    name: `ripple-${frame}-shader`,
    wgsl: `fn effect(input: EffectInput) -> vec4f { return vec4f(${frame}.0); }`,
    params: [{ name: `amount_${frame}_value`, type: 'f32' }],
  });
  registerComponent('FlatStringsResolution', () => h(
    React.Fragment,
    null,
    h(Text, null, `FRAME ${frame} / 600`),
    h(Rect, { id: `authored-${frame}-rect`, width: 1, height: 1, shader: shaderEffect(shader, [1], 0) }),
  ));
  const resolutions = createResolver().resolve([{ component: 'FlatStringsResolution', props: {} }]);
  assert.equal(resolutions.shaders?.length, 1);
  assert.deepEqual(nonFlatStrings(resolutions), []);
});
