// <Text> style shorthand, and font and color names from <Theme>.

import { expect, test } from 'vitest';
import assert from 'node:assert/strict';
import React from 'react';
import type { ReactNode } from 'react';

import { Composition, Group, Rect, Sequence, Span, Text, Theme, measureText, useTextMetrics, useTheme } from '../src/index.js';
import * as browser from '../src/browser.js';
import { mount } from '../src/render.js';
import type { ResolvedTheme, TextMetrics } from '../src/index.js';
import { setTextMeasurer } from '../src/text-measure.js';
import type { MeasureTextRequest } from '../src/text-measure.js';

import { childrenOf, colorOf, contentOf } from './helpers.mjs';

const h = React.createElement;

function scene(children: ReactNode) {
  const Root = () => h(Composition, { width: 100, height: 100, fps: 30, durationInFrames: 30 }, children);
  return mount(Root).renderAt({ value: 0, timescale: 30 }, null).scene;
}

const content = (node: ReactNode) => contentOf(scene(node).layers[0], 'text');
const fonts = { display: 'Inter', mono: ['JetBrains Mono', 'Noto Sans JP'] };
const colors = { paper: '#f4f1ea', ink: '#111111' };

test('shorthand props draw the same text as style', () => {
  const shorthand = content(h(Text, { fontFamily: 'Inter', fontSize: 18, fontWeight: 700, color: '#f4f1ea', children: 'A' }));
  const style = content(h(Text, {
    style: { fontFamily: 'Inter', fontSize: 18, fontWeight: 700, fill: { type: 'solid', color: '#f4f1ea' } },
    children: 'A',
  }));
  expect(shorthand).toEqual(style);
});

test('style wins over shorthand for the same property', () => {
  const { style } = content(h(Text, {
    fontSize: 18, color: '#000000', fontWeight: 400,
    style: { fontSize: 24, fill: { type: 'solid', color: '#ffffff' } },
    children: 'A',
  }));
  expect(style).toEqual({ fontSize: 24, fontWeight: 400, fill: { type: 'solid', color: '#ffffff' } });
});

test('text without shorthand or theme keeps its props', () => {
  const style = { fontSize: 10 };
  expect(content(h(Text, { style, children: 'A' })).style).toBe(style);
  expect(content(h(Text, null, 'A')).style).toEqual({});
});

test('<Theme> names resolve in shorthand and style', () => {
  const [a, b] = scene(h(Theme, { fonts, colors },
    h(Text, { key: 'a', fontFamily: 'mono', color: 'paper', children: 'A' }),
    h(Text, { key: 'b', style: {
      fontFamily: 'display', fill: { type: 'solid', color: 'ink' }, stroke: { paint: { type: 'solid', color: 'paper' }, width: 2 },
    }, children: 'B' }),
  )).layers;
  expect(contentOf(a, 'text').style).toEqual({ fontFamily: ['JetBrains Mono', 'Noto Sans JP'], fill: { type: 'solid', color: '#f4f1ea' } });
  const { style } = contentOf(b, 'text');
  expect(style.fontFamily).toBe('Inter');
  expect(colorOf(style.fill)).toBe('#111111');
  assert.ok(style.stroke && 'paint' in style.stroke, 'one stroke');
  expect(colorOf(style.stroke.paint)).toBe('#f4f1ea');
});

test('the inner <Theme> wins, through groups and sequences', () => {
  const layers = scene(h(Theme, { fonts, colors },
    h(Group, { key: 'g' }, h(Theme, { colors: { paper: '#ffffff' } }, h(Text, { fontFamily: 'display', color: 'paper', children: 'A' }))),
    h(Sequence, { key: 's' }, h(Text, { color: 'paper', children: 'B' })),
  )).layers;
  expect(contentOf(childrenOf(layers[0])[0], 'text').style).toEqual({ fontFamily: 'Inter', fill: { type: 'solid', color: '#ffffff' } });
  expect(colorOf(contentOf(childrenOf(layers[1])[0], 'text').style.fill)).toBe('#f4f1ea');
});

test('<Span> resolves names and takes shorthand, style winning', () => {
  const { style } = content(h(Theme, { fonts, colors }, h(Text, { fontFamily: 'display', children: [
    'a',
    h(Span, { key: 'b', color: 'paper', fontFamily: 'mono' }, 'b'),
    h(Span, { key: 'c', style: { fill: 'ink' }, color: 'paper', fontWeight: 700 }, 'c'),
  ] })));
  expect(style.fontFamily).toBe('Inter');
  expect(style.colorRuns).toEqual([{ start: 1, end: 2, color: '#f4f1ea' }, { start: 2, end: 3, color: '#111111' }]);
  expect(style.fontRuns).toEqual([
    { start: 1, end: 2, fontFamily: ['JetBrains Mono', 'Noto Sans JP'] },
    { start: 2, end: 3, fontWeight: 700 },
  ]);
});

test('an unknown font name is a family name; an unknown color shorthand throws', () => {
  expect(content(h(Theme, { fonts }, h(Text, { fontFamily: 'Georgia', children: 'A' }))).style.fontFamily).toBe('Georgia');
  expect(() => scene(h(Theme, { colors }, h(Text, { color: 'papr', children: 'A' })))).toThrow(
    '<Text> color "papr" is neither a #RRGGBB or #RRGGBBAA color nor a <Theme> color name (paper, ink)',
  );
  expect(() => scene(h(Text, null, h(Span, { color: 'paper' }, 'A')))).toThrow('<Span> fill must be a #RRGGBB');
});

test('<Theme> rejects bad entries', () => {
  expect(() => scene(h(Theme, { colors: { paper: 'white' } }, null))).toThrow('<Theme> color "paper" must be');
  expect(() => scene(h(Theme, { fonts: { mono: [] } }, null))).toThrow('<Theme> font "mono" must be');
});

test('useTheme() returns the merged names', () => {
  let seen: ResolvedTheme | undefined;
  function Probe() {
    seen = useTheme();
    return h(Rect, { width: 1, height: 1, fill: seen.colors.paper });
  }
  scene(h(Theme, { fonts, colors }, h(Theme, { colors: { accent: '#ff0000' } }, h(Probe))));
  expect(seen).toEqual({ fonts, colors: { ...colors, accent: '#ff0000' } });
});

test('useTextMetrics and measureText measure with theme names', async () => {
  const requests: MeasureTextRequest[] = [];
  const metrics: TextMetrics = {
    width: 10, height: 10, ascent: 8, descent: 2, lineHeight: 10, capHeight: 0, xHeight: 0, lines: 1, glyphs: [], lineStarts: [0],
  };
  setTextMeasurer(async (request) => { requests.push(request); return metrics; }, (request) => {
    requests.push(request);
    return metrics;
  });
  function Measured() {
    useTextMetrics(['a', h(Span, { fontFamily: 'display' }, 'b')], { fontFamily: 'mono', fontSize: 18 });
    return null;
  }
  scene(h(Theme, { fonts }, h(Measured)));
  expect(requests.at(-1)?.style).toMatchObject({
    fontFamily: ['JetBrains Mono', 'Noto Sans JP'], fontSize: 18, fontRuns: [{ start: 1, end: 2, fontFamily: 'Inter' }],
  });
  await measureText('a', { fontFamily: 'display' }, { theme: { fonts } });
  expect(requests.at(-1)?.style.fontFamily).toBe('Inter');
});

test('the browser entry exports <Theme> and useTheme too', () => {
  expect(browser.Theme).toBe(Theme);
  expect(browser.useTheme).toBe(useTheme);
});
