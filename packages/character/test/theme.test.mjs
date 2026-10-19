// <Theme> font and color names in <Dialogue> subtitles. Run after `pnpm run build`.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';

import { Assets, Composition, Span, Text, Theme } from '@celesta/react';
import { Character, CharacterView, Dialogue } from '../dist/index.js';
import { mount, setTextMeasurer } from '@celesta/react/internal';

const h = React.createElement;
const fonts = { serif: 'Noto Serif JP', bold: 'Inter' };
const colors = { paper: '#f4f1ea', accent: '#ff3300' };
const style = { fontSize: 10, fontFamily: 'serif', fill: { type: 'solid', color: 'paper' } };

function installMeasurer() {
  const requests = [];
  const sync = (request) => {
    requests.push(request);
    const size = request.style.fontSize ?? 10;
    return {
      width: Array.from(request.text).length * size, height: size * 1.25, ascent: size, descent: size * 0.25,
      lineHeight: size * 1.25, lines: 1, glyphs: [],
    };
  };
  setTextMeasurer(async (request) => sync(request), sync);
  return requests;
}

function find(layers, test) {
  for (const layer of layers) {
    if (test(layer)) return layer;
    if (layer.content.type === 'group') {
      const found = find(layer.content.layers, test);
      if (found) return found;
    }
  }
  return undefined;
}

function scene(subtitle) {
  const mira = React.createRef();
  const view = React.createRef();
  const Root = () => h(Composition, { width: 640, height: 360, fps: 30, durationInFrames: 30 },
    h(Assets, null, h(Character, {
      ref: mira, name: 'mira', portrait: { defaultExpression: 'calm', expressions: { calm: 'calm.png' } }, subtitle,
    })),
    h(Theme, { fonts, colors },
      h(CharacterView, { ref: view, character: mira }),
      h(Dialogue, { character: view, id: 'line' }, 'Hello ', h(Span, { color: 'accent', fontFamily: 'bold' }, 'world'))));
  return mount(Root).renderAt({ value: 0, timescale: 30 }, null).scene;
}

test('a plain subtitle draws with the theme names of its line looked up', () => {
  const layers = scene({ style }).layers;
  const subtitle = find(layers, (layer) => layer.id === 'line.subtitle').content;
  assert.equal(subtitle.text, 'Hello world');
  assert.equal(subtitle.style.fontFamily, 'Noto Serif JP');
  assert.equal(subtitle.style.fill.color, '#f4f1ea');
  assert.deepEqual(subtitle.style.colorRuns, [{ start: 6, end: 11, color: '#ff3300' }]);
  assert.deepEqual(subtitle.style.fontRuns, [{ start: 6, end: 11, fontFamily: 'Inter' }]);
});

test('subtitle.render measures and gets its style with theme names looked up', () => {
  const requests = installMeasurer();
  let given;
  const render = (props) => {
    given = props;
    void props.metrics;
    return h(Text, { style: props.style }, props.content);
  };
  const layers = scene({ style, render }).layers;
  assert.equal(given.style.fontFamily, 'Noto Serif JP');
  assert.equal(given.style.fill.color, '#f4f1ea');
  const request = requests.at(-1);
  assert.equal(request.style.fontFamily, 'Noto Serif JP');
  assert.deepEqual(request.style.fontRuns, [{ start: 6, end: 11, fontFamily: 'Inter' }]);
  const drawn = find(layers, (layer) => layer.content.type === 'text').content;
  assert.deepEqual(drawn.style.colorRuns, [{ start: 6, end: 11, color: '#ff3300' }]);
});
