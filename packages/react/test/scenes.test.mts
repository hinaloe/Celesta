import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as React from 'react';

import { Composition, Scenes, Sequence, Text, defineScenes, sceneAt, useScene } from '../src/index.js';
import type { Layer, SceneList, SceneState } from '../src/index.js';
import { mount } from '../src/render.js';
import type { MountedComposition } from '../src/render.js';

const h = React.createElement;
const at = (composition: MountedComposition, frame: number) => composition.renderAt({ value: frame, timescale: 30 }, null);
const texts = (layers: Layer[]): string[] => layers.flatMap((layer) =>
  layer.content.type === 'text' ? [layer.content.text] : texts(layer.content.type === 'group' ? layer.content.layers : []),
);
const label = (state: SceneState | null) => (state ? `${state.id}:${state.frame}:${state.progress.toFixed(2)}` : 'none');

test('defineScenes places scenes like Series and keeps empty ones in the list', () => {
  const list = defineScenes([
    { id: 'a', name: 'Intro', durationInFrames: 30 },
    { id: 'empty', durationInFrames: 0 },
    { id: 'b', durationInFrames: 20, offset: -10 },
    { id: 'c', durationInFrames: 5, offset: 3 },
  ]);
  assert.deepEqual(
    list.scenes.map(({ index, id, name, from, durationInFrames }) => ({ index, id, name, from, durationInFrames })),
    [
      { index: 0, id: 'a', name: 'Intro', from: 0, durationInFrames: 30 },
      { index: 1, id: 'empty', name: 'empty', from: 30, durationInFrames: 0 },
      { index: 2, id: 'b', name: 'b', from: 20, durationInFrames: 20 },
      { index: 3, id: 'c', name: 'c', from: 43, durationInFrames: 5 },
    ],
  );
  assert.equal(list.durationInFrames, 48);
  assert.throws(() => defineScenes([{ id: 'a', durationInFrames: 1 }, { id: 'a', durationInFrames: 1 }]), /used more than once/);
  assert.throws(() => defineScenes([{ id: '', durationInFrames: 1 }]), /non-empty string id/);
  assert.throws(() => defineScenes([{ id: 'a', durationInFrames: -1 }]), /non-negative integer/);
  assert.throws(() => defineScenes([{ id: 'a', durationInFrames: 5, offset: -6 }]), /before frame 0/);
});

test('sceneAt handles boundaries, overlaps, gaps, empty scenes, and the ends', () => {
  const list = defineScenes([
    { id: 'a', durationInFrames: 30, offset: 10 },
    { id: 'empty', durationInFrames: 0 },
    { id: 'b', durationInFrames: 20, offset: -10 },
    { id: 'c', durationInFrames: 10, offset: 5 },
  ]);
  const expected = {
    0: 'none', 9: 'none',
    10: 'a:0:0.00', 29: 'a:19:0.63',
    30: 'b:0:0.00', 39: 'b:9:0.45', 49: 'b:19:0.95',
    50: 'b:20:1.00', 54: 'b:24:1.00',
    55: 'c:0:0.00', 64: 'c:9:0.90',
    65: 'none', 1000: 'none',
  };
  for (const [frame, value] of Object.entries(expected)) {
    assert.equal(label(sceneAt(list, Number(frame))), value, `frame ${frame}`);
  }
  const state = sceneAt(list, 30);
  assert.ok(state);
  assert.equal(state.previous?.id, 'empty');
  assert.equal(state.next?.id, 'c');
  assert.equal(state.scenes, list.scenes);
  assert.equal(state.totalDurationInFrames, 65);
});

test('useScene agrees inside and outside Scenes, through nested sequences and seeks', () => {
  const seen: string[] = [];
  function Probe({ where, list }: { where: string; list?: SceneList }) {
    seen.push(`${where}=${label(useScene(list))}`);
    return null;
  }
  const make = (id: string) => () => h(Sequence, { from: 3 }, h(Sequence, { from: 2 }, h(Probe, { where: `in-${id}` })));
  const list = defineScenes([
    { id: 'a', durationInFrames: 30, Scene: make('a') },
    { id: 'b', durationInFrames: 30, offset: -10, Scene: make('b') },
  ]);
  const composition = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 80 },
    h(Sequence, { from: 20 },
      h(Scenes, { scenes: list }),
      h(Probe, { where: 'hud', list }),
    ),
  ));
  for (const frame of [25, 30, 45, 50, 25]) {
    seen.length = 0;
    at(composition, frame);
    const hud = sceneAt(list, frame - 20);
    for (const entry of seen) {
      assert.equal(entry.split('=')[1], label(hud), `${entry} at frame ${frame}`);
    }
    assert.ok(seen.includes(`hud=${label(hud)}`));
  }
  seen.length = 0;
  at(composition, 46);
  assert.deepEqual(seen.sort(), ['hud=b:6:0.20', 'in-a=b:6:0.20', 'in-b=b:6:0.20']);
});

test('Scenes plays each scene in its window and skips empty ones', () => {
  const list = defineScenes([
    { id: 'a', durationInFrames: 10, Scene: () => h(Text, null, 'a') },
    { id: 'empty', durationInFrames: 0, Scene: () => h(Text, null, 'empty') },
    { id: 'b', durationInFrames: 10, Scene: () => h(Text, null, 'b') },
  ]);
  const composition = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 30 },
    h(Scenes, { scenes: list }),
  ));
  assert.deepEqual(texts(at(composition, 0).scene.layers), ['a']);
  assert.deepEqual(texts(at(composition, 10).scene.layers), ['b']);
  assert.deepEqual(texts(at(composition, 20).scene.layers), []);
});

test('useScene without a list requires Scenes', () => {
  function Orphan() {
    useScene();
    return null;
  }
  assert.throws(
    () => mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 10 }, h(Orphan))),
    /inside <Scenes>/,
  );
});
