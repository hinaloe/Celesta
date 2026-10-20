// <Code> draws the characters as written: coding ligatures (`===`, `->`)
// are off unless its style turns them back on, and the measurements its
// layout uses shape the same way.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';

import { Composition } from '@celesta/react';
import type { Layer, LayerContent, TextMetrics, TextStyle } from '@celesta/react';
import { mount, setTextMeasurer } from '@celesta/react/internal';
import type { MeasureTextRequest } from '@celesta/react/internal';
import { Code } from '../src/index.js';

type TextContent = Extract<LayerContent, { type: 'text' }>;

// Every code point is 10 px wide.
function measure({ text, style }: MeasureTextRequest): TextMetrics {
  const lines = text.split('\n');
  const lineHeight = style.lineHeight ?? 36;
  return {
    width: Math.max(...lines.map((line) => Array.from(line).length)) * 10,
    height: lines.length * lineHeight, ascent: lineHeight * 0.75, descent: lineHeight * 0.25,
    lineHeight, capHeight: 0, xHeight: 0, lines: lines.length, lineStarts: [], glyphs: [],
  };
}

function textLayers(layers: readonly Layer[]): TextContent[] {
  return layers.flatMap((layer) => layer.content.type === 'group'
    ? textLayers(layer.content.layers)
    : layer.content.type === 'text' ? [layer.content] : []);
}

/** The text layers and measurement requests of one frame of `<Code style={style}>`. */
function render(style?: TextStyle): { texts: TextContent[]; requests: MeasureTextRequest[] } {
  const requests: MeasureTextRequest[] = [];
  setTextMeasurer(async (request) => measure(request), (request) => {
    requests.push(request);
    return measure(request);
  });
  const Root = () => React.createElement(Composition, { width: 800, height: 300, fps: 30, durationInFrames: 1 },
    React.createElement(Code, { language: 'ts', ...(style ? { style } : {}), children: 'a === b;\nf = () => x != y;\n' }));
  const { scene } = mount(Root).renderAt({ value: 0, timescale: 30 }, null);
  return { texts: textLayers(scene.layers), requests };
}

test('Code turns ligatures and contextual alternates off', () => {
  const { texts, requests } = render();
  assert.equal(texts.length, 2);
  for (const text of texts) assert.deepEqual(text.style.fontFeatures, { liga: false, calt: false });
  assert.ok(requests.length > 0);
  for (const request of requests) assert.deepEqual(request.style.fontFeatures, { liga: false, calt: false });
});

test('a Code style turns features on over the defaults, tag by tag', () => {
  const { texts, requests } = render({ fontFeatures: { liga: true, zero: true } });
  for (const { style } of [...texts, ...requests]) {
    assert.deepEqual(style.fontFeatures, { liga: true, calt: false, zero: true });
  }
});
