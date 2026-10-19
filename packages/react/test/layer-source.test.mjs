// layerSource: what the editor needs to write a transform back into source.
// Run after `pnpm run build`.

import assert from 'node:assert/strict';
import { createContext, createElement as h, useContext } from 'react';
import { test } from 'vitest';

import { Composition, Group, MotionBlur, Rect, Sequence } from '../dist/index.js';
import { jsxDEV } from '../dist/jsx-dev-runtime.js';
import { mount } from '../dist/render.js';

const at = (fileName, lineNumber, columnNumber) => ({ fileName, lineNumber, columnNumber });
const resolve = (file) => `/abs/${file}`;
const FRAME = 30;
const time = (frame) => ({ value: frame, timescale: FRAME });
const comp = (...children) =>
  jsxDEV(Composition, { width: 100, height: 100, fps: FRAME, durationInFrames: 100, children }, undefined, true, at('entry.tsx', 1, 1));
const layerIds = (layers) => layers.flatMap((layer) => [layer.id, ...(layer.content.layers ? layerIds(layer.content.layers) : [])]);

/** The report for the layer at `index` of the frame's layers, depth first; the last (innermost) by default. */
function reportFor(composition, frame, index = -1) {
  const { scene } = composition.renderAt(time(frame), null);
  const ids = layerIds(scene.layers);
  return composition.layerSource(time(frame), ids.at(index), resolve);
}

test('localFrame is the frame where the element was written, not inside the Sequence', () => {
  // The entry wrote the Rect, so an `interpolate(frame, ...)` there reads the
  // entry's frame.
  const composition = mount(() =>
    comp(jsxDEV(Sequence, { from: 20, children: jsxDEV(Rect, { width: 1, height: 1 }, undefined, false, at('entry.tsx', 5, 7)) }, undefined, false, at('entry.tsx', 4, 5))),
  );
  const report = reportFor(composition, 30);
  assert.equal(report.chain[0].name, 'Rect');
  assert.equal(report.localFrame, 30);
});

// `frame` in `interpolate(frame, ...)` is the value `useCurrentFrame()` had in
// the component that wrote the JSX, which may sit above a `<Sequence>`.
const rectAt = (line, props = {}) => jsxDEV(Rect, { width: 1, height: 1, ...props }, undefined, false, at('scene.tsx', line, 7));
const sequence = (from, children, line = 4) => jsxDEV(Sequence, { from, children }, undefined, false, at('scene.tsx', line, 5));

test('localFrame is the frame of the component that wrote the element, above a Sequence', () => {
  // const frame = useCurrentFrame(); <Sequence from={30}><Rect x={interpolate(frame, ...)} /></Sequence>
  function Scene() {
    return sequence(30, rectAt(5, { x: 100 }));
  }
  const composition = mount(() => comp(jsxDEV(Scene, {}, undefined, false, at('entry.tsx', 3, 5))));
  const report = reportFor(composition, 60);
  assert.equal(report.localFrame, 60);
  assert.deepEqual(report.candidateFrames, [30, 60]);
});

test('localFrame follows a Sequence above the writing component', () => {
  function Scene() {
    return rectAt(5);
  }
  const composition = mount(() => comp(sequence(20, jsxDEV(Scene, {}, undefined, false, at('entry.tsx', 3, 5)))));
  assert.equal(reportFor(composition, 60).localFrame, 40);
});

test('a component passing children through does not own them', () => {
  function Later({ children }) {
    return sequence(30, children, 9);
  }
  function Scene() {
    return jsxDEV(Later, { children: rectAt(5) }, undefined, false, at('scene.tsx', 4, 5));
  }
  const composition = mount(() => comp(jsxDEV(Scene, {}, undefined, false, at('entry.tsx', 3, 5))));
  const report = reportFor(composition, 60);
  assert.equal(report.localFrame, 60);
  assert.deepEqual(report.candidateFrames, [30, 60]);
});

test('a MotionBlur moment function is written by the component around it', () => {
  function Scene() {
    return sequence(10, jsxDEV(MotionBlur, { samples: 1, shutterAngle: 0, children: () => rectAt(5) }, undefined, false, at('scene.tsx', 6, 5)));
  }
  const composition = mount(() => comp(jsxDEV(Scene, {}, undefined, false, at('entry.tsx', 3, 5))));
  assert.equal(reportFor(composition, 60).localFrame, 60);
});

// `frame` may be read by any component above the element: the candidates are
// the frames handed down by every frame provider on the way to the root.

test('candidateFrames lists each frame above the element once, nearest first', () => {
  const composition = mount(() =>
    comp(sequence(10, sequence(0, sequence(20, rectAt(5), 6), 5), 4)),
  );
  // 60 at the root, 50 under `from={10}` (and `from={0}` inside it), 30 under `from={20}`.
  assert.deepEqual(reportFor(composition, 60).candidateFrames, [30, 50, 60]);
});

test('candidateFrames covers a render function nested in an object prop', () => {
  function Later({ config }) {
    return config.render();
  }
  function Scene() {
    return sequence(30, jsxDEV(Later, { config: { render: () => rectAt(5) } }, undefined, false, at('scene.tsx', 3, 5)));
  }
  const composition = mount(() => comp(jsxDEV(Scene, {}, undefined, false, at('entry.tsx', 3, 5))));
  assert.deepEqual(reportFor(composition, 60).candidateFrames, [30, 60]);
});

test('candidateFrames covers a render function passed through context', () => {
  const Render = createContext(null);
  function Consumer() {
    return useContext(Render)();
  }
  function Scene() {
    return h(Render.Provider, { value: () => rectAt(5) }, sequence(30, jsxDEV(Consumer, {}, undefined, false, at('scene.tsx', 3, 5))));
  }
  const composition = mount(() => comp(jsxDEV(Scene, {}, undefined, false, at('entry.tsx', 3, 5))));
  assert.deepEqual(reportFor(composition, 60).candidateFrames, [30, 60]);
});

test('candidateFrames covers a render prop called below a frame change', () => {
  function Later({ render }) {
    return sequence(30, render(), 9);
  }
  function Scene() {
    return sequence(10, jsxDEV(Later, { render: () => rectAt(5) }, undefined, false, at('scene.tsx', 4, 5)));
  }
  const composition = mount(() => comp(jsxDEV(Scene, {}, undefined, false, at('entry.tsx', 3, 5))));
  const report = reportFor(composition, 60);
  assert.deepEqual(report.candidateFrames, [20, 50, 60]);
  assert.equal('frameUncertain' in report, false);
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

test('an empty chain reports only the chain', () => {
  const composition = mount(() =>
    h(Composition, { width: 100, height: 100, fps: FRAME, durationInFrames: 100 }, h(Rect, { width: 1, height: 1 })),
  );
  assert.deepEqual(reportFor(composition, 0), { chain: [] });
});
