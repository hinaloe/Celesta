// <Static>: a subtree walked once and reused until its deps change or React
// changes something inside it.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as React from 'react';
import type { ComponentType, ReactElement } from 'react';

import {
  Audio,
  Composition,
  FreezeFrame,
  Group,
  Rect,
  Sequence,
  Static,
  Video,
  useCurrentFrame,
} from '../src/index.js';
import { createResolver, mount } from '../src/render.js';
import { registerHostElement, shaderEffect, shaderSource } from '../src/internal.js';
import { registerComponent } from '../src/registry.js';
import type { Layer, Time } from '../src/index.js';
import type { StaticsFrame } from '../src/static.js';

import { childrenOf, contentOf } from './helpers.mjs';

const h = React.createElement;
const at = (frame: number): Time => ({ value: frame, timescale: 30 });
const film = (Body: ComponentType) => () =>
  h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 90 }, h(Body));
const rect = (x: number) => h(Rect, { x, width: 1, height: 1, fill: '#ffffff' });
/** The layers a frame defines for `key`, if it does. */
const defined = (statics: StaticsFrame | undefined, key: number) =>
  statics?.defined.find((definition) => definition.key === key)?.layers;
/** The key a static reference layer refers to. */
const keyOf = (layer: Layer | undefined) => contentOf(layer, 'staticRef').key;

test('references a still subtree once its definition is decoded', () => {
  const mounted = mount(film(() => h(Static, null, rect(1), rect(2))));
  const first = mounted.renderAt(at(0), null, { statics: { decoded: 0 } });
  const [layer] = first.scene.layers;
  assert.equal(layer.content.type, 'staticRef');
  const key = layer.content.key;
  assert.equal(first.statics?.seq, 1);
  assert.deepEqual(defined(first.statics, key)?.map((child) => child.transform.position), [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ]);
  // Node renders ahead of Rust: frame 1 is not decoded yet, so frame 2
  // carries the definition again.
  const second = mounted.renderAt(at(1), null, { statics: { decoded: 0 } });
  assert.equal(second.statics?.seq, 2);
  assert.deepEqual(second.scene.layers[0].content, { type: 'staticRef', key });
  assert.ok(defined(second.statics, key));
  const third = mounted.renderAt(at(2), null, { statics: { decoded: 2 } });
  assert.deepEqual(third.scene.layers[0].content, { type: 'staticRef', key });
  assert.deepEqual(third.statics?.defined, []);
  assert.deepEqual(third.statics?.dropped, []);
});

test('changing deps gives a new key and drops the old one', () => {
  const mounted = mount(film(() => {
    const frame = useCurrentFrame();
    const chapter = Math.floor(frame / 30);
    return h(Static, { deps: [chapter] }, rect(chapter));
  }));
  const first = mounted.renderAt(at(0), null, { statics: { decoded: 0 } });
  const before = keyOf(first.scene.layers[0]);
  const same = mounted.renderAt(at(10), null, { statics: { decoded: 1 } });
  assert.equal(keyOf(same.scene.layers[0]), before);
  const after = mounted.renderAt(at(30), null, { statics: { decoded: 2 } });
  const next = keyOf(after.scene.layers[0]);
  assert.notEqual(next, before);
  assert.deepEqual(after.statics?.dropped, [before]);
  assert.deepEqual(defined(after.statics, next)?.[0].transform.position, { x: 1, y: 0 });
});

test('a component reading the frame inside is walked again each frame', () => {
  const Moving = () => rect(useCurrentFrame());
  const mounted = mount(film(() => h(Static, null, h(Moving))));
  const keys: number[] = [];
  for (const frame of [0, 1, 2]) {
    const { scene, statics } = mounted.renderAt(at(frame), null, { statics: { decoded: frame } });
    const key = keyOf(scene.layers[0]);
    assert.deepEqual(defined(statics, key)?.[0].transform.position, { x: frame, y: 0 });
    if (keys.length > 0) assert.deepEqual(statics?.dropped, [keys.at(-1)]);
    keys.push(key);
  }
  assert.equal(new Set(keys).size, 3);
});

test('a different lang above gives a new key', () => {
  const mounted = mount(film(() => {
    const frame = useCurrentFrame();
    return h(Group, { lang: frame === 0 ? 'en' : 'ja' }, h(Static, null, rect(0)));
  }));
  type Frame = ReturnType<typeof mounted.renderAt>;
  const keyIn = (result: Frame) => keyOf(childrenOf(result.scene.layers[0])[0]);
  const en = mounted.renderAt(at(0), null, { statics: { decoded: 0 } });
  const ja = mounted.renderAt(at(1), null, { statics: { decoded: 1 } });
  assert.notEqual(keyIn(en), keyIn(ja));
});

test('a static that moves in the tree gets new ids and a new key', () => {
  const mounted = mount(film(() => {
    const frame = useCurrentFrame();
    return h(React.Fragment, null, frame > 0 ? rect(9) : null, h(Static, { key: 's' }, rect(0)));
  }));
  const first = mounted.renderAt(at(0), null, { statics: { decoded: 0 } });
  const moved = mounted.renderAt(at(1), null, { statics: { decoded: 1 } });
  const ref = moved.scene.layers[1];
  assert.notEqual(keyOf(ref), keyOf(first.scene.layers[0]));
  assert.equal(defined(moved.statics, keyOf(ref))?.[0].id, `${ref.id}.0`);
});

test('without statics the children are inline', () => {
  const mounted = mount(film(() => h(Static, null, rect(1))));
  for (const frame of [0, 1]) {
    const result = mounted.renderAt(at(frame), null);
    const [layer] = result.scene.layers;
    assert.equal(layer.content.type, 'group');
    assert.deepEqual(layer.content.layers[0].transform.position, { x: 1, y: 0 });
    assert.equal(result.statics, undefined);
  }
});

test('forbidden elements fail the frame', () => {
  registerHostElement('static-test-host', { content: () => ({ type: 'group', layers: [] }) });
  const forbidden: [string, ReactElement][] = [
    ['video', h(Video, { src: './a.mp4' })],
    ['audio', h(Audio, { src: './a.wav' })],
    ['sequence', h(Sequence, { from: 0, durationInFrames: 10 }, rect(0))],
    ['freeze-frame', h(FreezeFrame, { frame: 0 }, rect(0))],
    ['static-test-host', h('static-test-host')],
  ];
  for (const [type, element] of forbidden) {
    const mounted = mount(film(() => h(Static, null, element)));
    assert.throws(
      () => mounted.renderAt(at(0), null, { statics: { decoded: 0 } }),
      new RegExp(`<Static> cannot contain <${type}>`),
      type,
    );
  }
});

test('nested statics are defined inline in their parent', () => {
  const mounted = mount(film(() => h(Static, null, rect(0), h(Static, null, rect(1)))));
  const { scene, statics } = mounted.renderAt(at(0), null, { statics: { decoded: 0 } });
  const outer = defined(statics, keyOf(scene.layers[0]));
  assert.ok(outer);
  assert.equal(outer[1].content.type, 'group');
  assert.deepEqual(childrenOf(outer[1])[0].transform.position, { x: 1, y: 0 });
});

test('an unmounted static drops its key; remounting defines a new one', () => {
  const mounted = mount(film(() => {
    const frame = useCurrentFrame();
    return frame === 1 ? null : h(Static, null, rect(0));
  }));
  const first = mounted.renderAt(at(0), null, { statics: { decoded: 0 } });
  const key = keyOf(first.scene.layers[0]);
  const gone = mounted.renderAt(at(1), null, { statics: { decoded: 1 } });
  assert.deepEqual(gone.statics?.dropped, [key]);
  const back = mounted.renderAt(at(2), null, { statics: { decoded: 2 } });
  const again = keyOf(back.scene.layers[0]);
  assert.notEqual(again, key);
  assert.ok(defined(back.statics, again));
});

test('a frame that fails after a static was walked again still defines and drops it later', () => {
  const mounted = mount(film(() => {
    const frame = useCurrentFrame();
    return h(
      React.Fragment,
      null,
      h(Static, { deps: [frame >= 1] }, rect(frame >= 1 ? 1 : 0)),
      h(Static, { deps: [frame === 1] }, frame === 1 ? h(Video, { src: './a.mp4' }) : rect(5)),
    );
  }));
  const first = mounted.renderAt(at(0), null, { statics: { decoded: 0 } });
  const old = keyOf(first.scene.layers[0]);
  assert.throws(() => mounted.renderAt(at(1), null, { statics: { decoded: 1 } }), /<Static> cannot contain <video>/);
  const good = mounted.renderAt(at(2), null, { statics: { decoded: 1 } });
  const key = keyOf(good.scene.layers[0]);
  assert.notEqual(key, old);
  assert.ok(defined(good.statics, key));
  assert.ok(good.statics?.dropped.includes(old));
});

test('component resolution gets the children inline', () => {
  registerComponent('StaticTestResolution', () => h(Static, null, rect(3)));
  const [layers] = createResolver().resolve([{ component: 'StaticTestResolution', props: {} }]).components;
  assert.ok(layers);
  assert.equal(layers[0].content.type, 'group');
  assert.deepEqual(childrenOf(layers[0])[0].transform.position, { x: 3, y: 0 });
});

test('definitions are a list of keys and layers', () => {
  // An object keyed by numbers holds them as indexed elements, which send
  // the whole frame's JSON.stringify down V8's slow path (twice the time
  // for 100,000 layers).
  const mounted = mount(film(() => h(Static, null, rect(1))));
  const { scene, statics } = mounted.renderAt(at(0), null, { statics: { decoded: 0 } });
  assert.ok(Array.isArray(statics?.defined));
  assert.deepEqual(statics?.defined.map((definition) => definition.key), [keyOf(scene.layers[0])]);
});

test('custom shaders inside a reused static stay listed in the scene', () => {
  const tint = shaderSource({
    name: 'static-tint',
    wgsl: 'fn effect(input: EffectInput) -> vec4f { return source_at(input.position); }',
    params: [],
  });
  const mounted = mount(film(() => h(Static, null, h(Rect, { width: 1, height: 1, shader: shaderEffect(tint, [], 0) }))));
  for (const frame of [0, 1, 2]) {
    const { scene } = mounted.renderAt(at(frame), null, { statics: { decoded: frame } });
    assert.deepEqual(scene.shaders?.map((shader) => shader.id), [tint.id], `frame ${frame}`);
  }
  const inline = mount(film(() => h(Static, null, h(Rect, { width: 1, height: 1, shader: shaderEffect(tint, [], 0) }))));
  for (const frame of [0, 1]) {
    assert.equal(inline.renderAt(at(frame), null).scene.shaders?.length, 1, `inline frame ${frame}`);
  }
});

test('groups inside a static do not make it rebuild every frame', () => {
  // <Group> reads the frame's runtime context, so React renders it again on
  // every frame even inside the memoized <Static>; its props stay the same.
  const mounted = mount(film(() => h(Static, null, h(Group, { x: 1 }, rect(2)))));
  const keys = [0, 1, 2].map((frame) =>
    keyOf(mounted.renderAt(at(frame), null, { statics: { decoded: frame } }).scene.layers[0]));
  assert.deepEqual(keys, [keys[0], keys[0], keys[0]]);
});
