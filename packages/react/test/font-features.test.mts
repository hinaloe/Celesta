// `fontFeatures` on text and `<Span>`: spans write them into font runs,
// merged over outer spans tag by tag, and malformed ones fail where they
// are set rather than at export.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';

import { Composition, Span, Text } from '../src/index.js';
import type { FontFeatures, LayerContent, TextStyle } from '../src/index.js';
import { mount } from '../src/render.js';
import { flattenTextContent, withTextRuns } from '../src/rich-text.js';

const h = React.createElement;

type TextContent = Extract<LayerContent, { type: 'text' }>;

function textLayer(...children: React.ReactNode[]): TextContent {
  const Root = () => h(Composition, { width: 400, height: 200, fps: 30, durationInFrames: 1 }, ...children);
  const [layer] = mount(Root).renderAt({ value: 0, timescale: 30 }, null).scene.layers;
  assert.equal(layer?.content.type, 'text');
  return layer.content as TextContent;
}

test('a span writes its features into a font run, merged over outer spans', () => {
  const flat = flattenTextContent([
    'a',
    h(Span, { style: { fontFeatures: { liga: false, calt: false } } },
      '==',
      h(Span, { style: { fontFeatures: { calt: true, ss01: 2 } } }, '=')),
    'b',
  ], '<Text> children');
  assert.equal(flat.text, 'a===b');
  assert.deepEqual(flat.fontRuns, [
    { start: 1, end: 3, fontFeatures: { liga: false, calt: false } },
    { start: 3, end: 4, fontFeatures: { liga: false, calt: true, ss01: 2 } },
  ]);
});

test('adjacent spans with the same features share one run', () => {
  const flat = flattenTextContent([
    h(Span, { style: { fontFeatures: { liga: false, calt: false } } }, 'ab'),
    h(Span, { style: { fontFeatures: { calt: false, liga: false } } }, 'cd'),
    h(Span, { style: { fontFeatures: { liga: 0, calt: 0 } } }, 'ef'),
    h(Span, { style: { fontFeatures: { liga: false } } }, 'gh'),
  ], '<Text> children');
  assert.deepEqual(flat.fontRuns, [
    { start: 0, end: 6, fontFeatures: { liga: false, calt: false } },
    { start: 6, end: 8, fontFeatures: { liga: false } },
  ]);
});

test('a span keeps its weight and family next to its features', () => {
  const flat = flattenTextContent(
    h(Span, { style: { fontWeight: 700, fontFamily: 'JetBrains Mono' } },
      h(Span, { style: { fontFeatures: { zero: true } } }, '0')),
    '<Text> children',
  );
  assert.deepEqual(flat.fontRuns, [
    { start: 0, end: 1, fontWeight: 700, fontFamily: 'JetBrains Mono', fontFeatures: { zero: true } },
  ]);
});

test('Text passes its features and its spans\' to the renderer', () => {
  const style: TextStyle = { fontFamily: 'JetBrains Mono', fontFeatures: { liga: false, calt: false } };
  const children = ['a ', h(Span, { key: 'arrow', style: { fontFeatures: { liga: true } } }, '=>'), ' b'];
  const content = textLayer(h(Text, { style, children }));
  assert.equal(content.text, 'a => b');
  assert.deepEqual(content.style.fontFeatures, { liga: false, calt: false });
  assert.deepEqual(content.style.fontRuns, [{ start: 2, end: 4, fontFeatures: { liga: true } }]);
});

test('malformed features fail at the text or span that sets them', () => {
  const malformedTags: FontFeatures[] = [{ lig: false }, { ligatures: false }, { 'lïga': false }, { 'li\nga': false }];
  for (const fontFeatures of malformedTags) {
    assert.throws(() => textLayer(h(Text, { style: { fontFeatures }, children: 'a' })),
      /<Text> fontFeatures tag .* must be four ASCII characters/, JSON.stringify(fontFeatures));
    assert.throws(() => flattenTextContent(h(Span, { style: { fontFeatures } }, 'a'), '<Text> children'),
      /<Span> fontFeatures tag .* must be four ASCII characters/, JSON.stringify(fontFeatures));
  }
  for (const value of [-1, 1.5, 2 ** 32, Number.NaN, 'off', null]) {
    const fontFeatures = { liga: value } as unknown as FontFeatures;
    assert.throws(() => textLayer(h(Text, { style: { fontFeatures }, children: 'a' })),
      /<Text> fontFeatures\.liga must be true, false, or a whole number from 0 up/, String(value));
    assert.throws(() => flattenTextContent(h(Span, { style: { fontFeatures } }, 'a'), '<Text> children'),
      /<Span> fontFeatures\.liga must be true, false, or a whole number from 0 up/, String(value));
  }
  const notAnObject = ['liga'] as unknown as FontFeatures;
  assert.throws(() => textLayer(h(Text, { style: { fontFeatures: notAnObject }, children: 'a' })),
    /<Text> fontFeatures must be an object of feature tags/);
});

test('span features cannot be combined with style.fontRuns', () => {
  const flat = flattenTextContent(h(Span, { style: { fontFeatures: { liga: false } } }, 'ab'), '<Text> children');
  assert.throws(() => withTextRuns({ fontRuns: [{ start: 0, end: 1, fontWeight: 700 }] }, flat, '<Text>'),
    /<Text> cannot combine style\.fontRuns with <Span> fontWeight, fontFamily, or fontFeatures/);
});
