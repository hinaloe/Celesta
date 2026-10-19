// <Theme> font and color names in fitted and animated text. Run after `pnpm run build`.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';

import { Composition, Span, Text, Theme } from '@celesta/react';
import { TextBox, TextReveal, fitText, useFitText, useTypewriter } from '../dist/index.js';
import { mount, setTextMeasurer } from '@celesta/react/internal';

const h = React.createElement;
const fonts = { mono: ['JetBrains Mono', 'Noto Sans JP'], display: 'Inter' };
const colors = { paper: '#f4f1ea', accent: '#ff3300' };
const MONO = ['JetBrains Mono', 'Noto Sans JP'];

// Every character is `fontSize` wide; lines start at each `\n`.
function measure({ text, style }) {
  const size = style.fontSize ?? 10;
  const lines = text.split('\n');
  const lineHeight = size * 1.25;
  return {
    width: Math.max(...lines.map((line) => Array.from(line).length)) * size,
    height: lines.length * lineHeight,
    ascent: size,
    descent: size * 0.25,
    lineHeight,
    lines: lines.length,
    glyphs: [],
    lineStarts: [0],
  };
}

function install() {
  const requests = [];
  const sync = (request) => {
    requests.push(request);
    return measure(request);
  };
  setTextMeasurer(async (request) => sync(request), sync);
  return requests;
}

function render(element) {
  const Root = () => h(Composition, { width: 1920, height: 1080, fps: 30, durationInFrames: 1 }, element);
  return mount(Root).renderAt({ value: 0, timescale: 30 }, null).scene;
}

const box = { width: 400, height: 100, minFontSize: 10, maxFontSize: 30 };

test('TextBox measures and draws with theme names looked up', () => {
  const requests = install();
  const scene = render(h(Theme, { fonts, colors },
    h(TextBox, { ...box, style: { fontFamily: 'mono', fill: { type: 'solid', color: 'paper' } } },
      'Hi ', h(Span, { fontFamily: 'display', color: 'accent' }, 'there'))));
  for (const request of requests) {
    assert.deepEqual(request.style.fontFamily, MONO);
    assert.deepEqual(request.style.fontRuns, [{ start: 3, end: 8, fontFamily: 'Inter' }]);
  }
  const [label] = scene.layers[0].content.layers;
  assert.deepEqual(label.content.style.fontFamily, MONO);
  assert.equal(label.content.style.fill.color, '#f4f1ea');
  assert.deepEqual(label.content.style.colorRuns, [{ start: 3, end: 8, color: '#ff3300' }]);
});

test('useFitText adds its theme option to the <Theme>s around it', () => {
  const requests = install();
  let fit;
  function Probe() {
    fit = useFitText(h(Span, { color: 'accent' }, 'Hi'), {
      ...box, style: { fontFamily: 'mono' }, theme: { fonts: { mono: 'Fira Code' } },
    });
    return null;
  }
  render(h(Theme, { fonts, colors }, h(Probe)));
  assert.equal(requests[0].style.fontFamily, 'Fira Code');
  assert.equal(fit.style.fontFamily, 'Fira Code');
});

test('fitText looks names up in its theme option, and only there', async () => {
  const requests = install();
  const fit = await fitText(h(Span, { color: 'accent' }, 'Hi'), { ...box, style: { fontFamily: 'mono' }, theme: { fonts, colors } });
  assert.deepEqual(requests[0].style.fontFamily, MONO);
  assert.deepEqual(fit.style.fontFamily, MONO);
  // Without one, a name is used as a family name.
  await fitText('Hi', { ...box, style: { fontFamily: 'mono' } });
  assert.equal(requests.at(-1).style.fontFamily, 'mono');
});

test('TextReveal looks names up in its style and spans', () => {
  const requests = install();
  const scene = render(h(Theme, { fonts, colors },
    h(TextReveal, { maxWidth: 1000, style: { fontSize: 10, fontFamily: 'mono' } },
      'aa ', h(Span, { color: 'accent', fontFamily: 'display' }, 'bb'))));
  assert.deepEqual(requests[0].style.fontFamily, MONO);
  assert.deepEqual(requests[0].style.fontRuns, [{ start: 3, end: 5, fontFamily: 'Inter' }]);
  const line = scene.layers[0].content.layers[0].content.layers[0].content;
  assert.deepEqual(line.style.fontFamily, MONO);
  assert.deepEqual(line.style.colorRuns, [{ start: 3, end: 5, color: '#ff3300' }]);
});

test('useTypewriter accepts spans colored by theme name', () => {
  install();
  let typed;
  function Typing() {
    typed = useTypewriter(['ab', h(Span, { key: 's', color: 'accent' }, 'cd')], { from: -10 });
    return h(Text, null, typed.text);
  }
  render(h(Theme, { colors }, h(Typing)));
  assert.equal(typed.text, 'abcd');
});
