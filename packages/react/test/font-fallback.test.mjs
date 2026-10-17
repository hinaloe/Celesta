// `fontFallback` reaches text the way `lang` does. Run after `pnpm run build`.

import { expect, test } from 'vitest';
import React from 'react';

import { Composition, FreezeFrame, Group, Rect, Sequence, Static, Text, useCurrentFrame, useTextMetrics } from '../dist/index.js';
import { mount } from '../dist/render.js';
import { setTextMeasurer } from '../dist/text-measure.js';

const h = React.createElement;
const at = (frame) => ({ value: frame, timescale: 30 });

function scene(children, props = {}, frame = 0) {
  const Root = () => h(Composition, { width: 100, height: 100, fps: 30, durationInFrames: 30, ...props }, children);
  return mount(Root).renderAt(at(frame), null).scene;
}

const label = (key, style) => h(Text, { key, style }, 'あ');

test('<Composition fontFallback> reaches its text, and text without it has none', () => {
  const [text] = scene(label('t'), { fontFallback: 'loaded' }).layers;
  expect(text.content.style.fontFallback).toBe('loaded');
  const [plain] = scene(label('t')).layers;
  expect(plain.content.style.fontFallback).toBeUndefined();
});

test('<Group>, <Sequence>, and <FreezeFrame> pass it on, and the nearest wins', () => {
  const layers = scene([
    h(Group, { key: 'g', fontFallback: 'system' }, label('t')),
    h(Sequence, { key: 's', fontFallback: 'loaded' }, label('t')),
    h(FreezeFrame, { key: 'f', frame: 0 }, label('t')),
  ], { fontFallback: 'loaded' }).layers;
  const styles = layers.map((layer) => layer.content.layers[0].content.style.fontFallback);
  expect(styles).toEqual(['system', 'loaded', 'loaded']);
  const [sequence] = scene(h(Sequence, { fontFallback: 'loaded' }, label('t'))).layers;
  expect(sequence.content.layers[0].content.style.fontFallback).toBe('loaded');
});

test('an explicit style.fontFallback overrides ancestors', () => {
  const [text] = scene(label('t', { fontFallback: 'system' }), { fontFallback: 'loaded' }).layers;
  expect(text.content.style.fontFallback).toBe('system');
});

test('raw project layers inherit it', () => {
  const text = { id: 't', transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    opacity: 1, content: { type: 'text', text: 'あ', style: {} } };
  const [group] = scene(h(Group, { fontFallback: 'loaded' }, h('rawLayers', { layers: [text] }))).layers;
  expect(group.content.layers[0].content.style.fontFallback).toBe('loaded');
});

test('useTextMetrics measures with the inherited value', () => {
  const requests = [];
  setTextMeasurer(async () => null, (request) => {
    requests.push(request);
    return { width: 10, height: 10, ascent: 8, descent: 2, lineHeight: 10, lines: 1, glyphs: [], lineStarts: [0] };
  });
  function Measured() {
    const metrics = useTextMetrics('あ', { fontFamily: 'Inter' });
    return h(Rect, { width: metrics.width, height: 1 });
  }
  scene(h(Measured), { fontFallback: 'loaded' });
  expect(requests.at(-1).style.fontFallback).toBe('loaded');
});

test('an invalid value throws', () => {
  expect(() => scene(label('t'), { fontFallback: 'fonts' })).toThrow(
    "Celesta components require `fontFallback` to be 'system' or 'loaded'",
  );
  expect(() => scene(h(Group, { fontFallback: 'fonts' }, label('t')))).toThrow(
    "Celesta components require `fontFallback` to be 'system' or 'loaded'",
  );
});

test('a <Static> below a changed fontFallback walks again', () => {
  const mounted = mount(() => h(Composition, { width: 10, height: 10, fps: 30, durationInFrames: 90 }, h(() => {
    const frame = useCurrentFrame();
    return h(Group, { fontFallback: frame === 0 ? 'system' : 'loaded' }, h(Static, null, label('t')));
  })));
  const textStyle = (layers) => {
    for (const layer of layers) {
      if (layer.content.type === 'text') return layer.content.style;
      const inner = textStyle(layer.content.layers ?? []);
      if (inner) return inner;
    }
    return undefined;
  };
  expect(textStyle(mounted.renderAt(at(0), null).scene.layers).fontFallback).toBe('system');
  expect(textStyle(mounted.renderAt(at(1), null).scene.layers).fontFallback).toBe('loaded');
});
