// layerSource: what the editor needs to write a transform back into source.
// Run after `pnpm run build`.

import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { test } from 'vitest';

import { Composition, Group, Rect, Sequence } from '../dist/index.js';
import { jsxDEV } from '../dist/jsx-dev-runtime.js';
import { mount } from '../dist/render.js';

const at = (fileName, lineNumber, columnNumber) => ({ fileName, lineNumber, columnNumber });
const resolve = (file) => `/abs/${file}`;
const FRAME = 30;
const time = (frame) => ({ value: frame, timescale: FRAME });
const comp = (...children) =>
  jsxDEV(Composition, { width: 100, height: 100, fps: FRAME, durationInFrames: 100, children }, undefined, true, at('entry.tsx', 1, 1));
const layerIds = (layers) => layers.flatMap((layer) => [layer.id, ...(layer.content.layers ? layerIds(layer.content.layers) : [])]);

function reportFor(composition, frame, index = 0) {
  const { scene } = composition.renderAt(time(frame), null);
  const ids = layerIds(scene.layers);
  return composition.layerSource(time(frame), ids[index], resolve);
}

test('localFrame is relative to the enclosing Sequence', () => {
  const composition = mount(() =>
    comp(jsxDEV(Sequence, { from: 20, children: jsxDEV(Rect, { width: 1, height: 1 }, undefined, false, at('entry.tsx', 5, 7)) }, undefined, false, at('entry.tsx', 4, 5))),
  );
  assert.equal(reportFor(composition, 30).localFrame, 10);
});

test('props are the transform props the primitive received', () => {
  const composition = mount(() =>
    comp(jsxDEV(Rect, { x: 12, rotation: 5, width: 1, height: 1, fill: '#fff' }, undefined, false, at('entry.tsx', 5, 7))),
  );
  assert.deepEqual(reportFor(composition, 0).props, { x: 12, rotation: 5 });
});

test('renderCount counts the layers one element produced', () => {
  function Many() {
    return jsxDEV('group', {
      children: [0, 1, 2].map((i) => jsxDEV(Rect, { x: i, width: 1, height: 1 }, i, false, at('entry.tsx', 8, 9))),
    }, undefined, true, at('entry.tsx', 7, 3));
  }
  const composition = mount(() => comp(h(Many)));
  const { scene } = composition.renderAt(time(0), null);
  const inner = scene.layers[0].content.layers[0].id;
  const report = composition.layerSource(time(0), inner, resolve);
  assert.equal(report.chain[0].name, 'Rect');
  assert.equal(report.renderCount, 3);
});

test('a Group entry carries its layerId', () => {
  const composition = mount(() =>
    comp(
      jsxDEV(Group, { id: 'outer', x: 3, children: jsxDEV(Rect, { width: 1, height: 1 }, undefined, false, at('entry.tsx', 6, 7)) }, undefined, true, at('entry.tsx', 5, 5)),
    ),
  );
  const { scene } = composition.renderAt(time(0), null);
  const inner = scene.layers[0].content.layers[0].id;
  const report = composition.layerSource(time(0), inner, resolve);
  const group = report.chain.find((entry) => entry.name === 'Group');
  assert.equal(group.kind, 'primitive');
  assert.equal(group.layerId, scene.layers[0].id);
  assert.equal(report.chain[0].layerId, inner);
});

test('a missing layer reports null', () => {
  const composition = mount(() => comp());
  assert.equal(composition.layerSource(time(0), 'nope', resolve), null);
});
