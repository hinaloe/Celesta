import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import * as React from 'react';

import { Composition, Sequence, Theme } from '@celesta/react';
import { SafeArea } from '@celesta/layout';
import { mount, setTextMeasurer } from '@celesta/react/internal';
import { TitleCard } from '../dist/index.js';

const h = React.createElement;

// Every character is `fontSize` wide; lines break at `\n` and wrap at maxWidth.
function measure({ text, style, maxWidth }) {
  const size = style.fontSize ?? 10;
  const per = maxWidth === undefined ? Infinity : Math.max(1, Math.floor(maxWidth / size));
  const lines = text === '' ? [] : text.split('\n').flatMap((line) => {
    const chars = Array.from(line);
    const out = [];
    for (let i = 0; i < Math.max(1, chars.length); i += per) out.push(chars.slice(i, i + per).join(''));
    return out;
  });
  const lineHeight = style.lineHeight ?? size * 1.25;
  return {
    width: Math.max(0, ...lines.map((line) => Array.from(line).length * size)),
    height: lines.length * lineHeight,
    ascent: size,
    descent: size * 0.25,
    lineHeight,
    lines: lines.length,
    glyphs: [],
    lineStarts: [0],
  };
}

beforeEach(() => setTextMeasurer(async (request) => measure(request), measure));

const at = (composition, frame) => composition.renderAt({ value: frame, timescale: 30 }, null);
const root = (child, { width = 1920, height = 1080, durationInFrames = 90 } = {}) => () =>
  h(Composition, { width, height, fps: 30, durationInFrames }, child);

// Every text and rect layer with its position summed through its groups.
function leaves(layers, x = 0, y = 0, opacity = 1, out = []) {
  for (const layer of layers) {
    const lx = x + layer.transform.position.x;
    const ly = y + layer.transform.position.y;
    const lo = opacity * layer.opacity;
    if (layer.content.type === 'group') leaves(layer.content.layers, lx, ly, lo, out);
    else out.push({ ...layer.content, x: lx, y: ly, opacity: lo });
  }
  return out;
}

const texts = (composition, frame) => Object.fromEntries(
  leaves(at(composition, frame).scene.layers).filter((l) => l.type === 'text').map((l) => [l.text, l]));

// Top and bottom of a text layer, from its baseline and the fake metrics.
function box(layer) {
  const size = layer.style.fontSize;
  const lineHeight = layer.style.lineHeight ?? size * 1.25;
  const lines = measure({ text: layer.text, style: layer.style, maxWidth: layer.maxWidth }).lines;
  return { top: layer.y - size, bottom: layer.y - size + lines * lineHeight };
}

const still = { enter: null, exit: null };

test('the pieces stack top to bottom with the gap, and absent ones leave no space', () => {
  const full = texts(mount(root(h(TitleCard, {
    ...still, chapter: '01', kicker: 'KICK', title: 'Title', subtitle: 'Sub', gap: 20, padding: 100,
    titleSize: 80, subtitleSize: 30, kickerSize: 20, chapterSize: 120, verticalAlign: 'top',
  }))), 0);
  const order = ['01', 'KICK', 'Title', 'Sub'].map((text) => box(full[text]));
  assert.equal(order[0].top, 100);
  for (let i = 1; i < order.length; i += 1) {
    assert.equal(order[i].top, order[i - 1].bottom + 20, `piece ${i}`);
  }
  for (const text of ['01', 'KICK', 'Title', 'Sub']) assert.equal(full[text].x, 100, text);

  const bare = texts(mount(root(h(TitleCard, { ...still, title: 'Title', padding: 100, titleSize: 80, verticalAlign: 'top' }))), 0);
  assert.deepEqual(Object.keys(bare), ['Title']);
  assert.equal(box(bare.Title).top, 100);
});

test('verticalAlign places the whole block, and align places every line', () => {
  const props = { ...still, title: 'Title', subtitle: 'Sub', padding: 100, gap: 0, titleSize: 80, subtitleSize: 40 };
  const blockHeight = 80 * 1.1 + Math.round(40 * 1.4);
  for (const [verticalAlign, top] of [['top', 100], ['middle', 100 + (880 - blockHeight) / 2], ['bottom', 980 - blockHeight]]) {
    const layers = texts(mount(root(h(TitleCard, { ...props, verticalAlign }))), 0);
    assert.equal(box(layers.Title).top, top, verticalAlign);
    assert.equal(box(layers.Sub).bottom, top + blockHeight, verticalAlign);
  }
  for (const align of ['left', 'center', 'right']) {
    const layers = texts(mount(root(h(TitleCard, { ...props, align, maxWidth: 800 }))), 0);
    const left = align === 'left' ? 100 : align === 'center' ? 100 + (1720 - 800) / 2 : 1820 - 800;
    for (const text of ['Title', 'Sub']) {
      assert.equal(layers[text].x, left, `${align} ${text}`);
      assert.equal(layers[text].maxWidth, 800, `${align} ${text}`);
      assert.equal(layers[text].style.align, align, `${align} ${text}`);
    }
  }
});

test('the kicker rule sits before the kicker, and the pair is placed by its measured width', () => {
  for (const align of ['left', 'center', 'right']) {
    const leafs = leaves(at(mount(root(h(TitleCard, {
      ...still, kicker: 'ABCD', kickerRule: 36, kickerSize: 20, title: 'T', align, padding: 100, maxWidth: 1000,
    }))), 0).scene.layers);
    const rule = leafs.find((l) => l.type === 'rect');
    const kicker = leafs.find((l) => l.text === 'ABCD');
    const line = 36 + 16 + 80;
    const start = align === 'left' ? 100 : align === 'center' ? 100 + (1720 - 1000) / 2 + (1000 - line) / 2 : 100 + 1720 - line;
    assert.equal(rule.x, start, align);
    assert.equal(rule.width, 36);
    assert.equal(kicker.x, start + 36 + 16, align);
  }
});

test('an explicit line break is kept, and a long title shrinks to fit the room', () => {
  const two = texts(mount(root(h(TitleCard, { ...still, title: 'Code is\nthe cut', titleSize: 100, padding: 100 }))), 0);
  assert.equal(two['Code is\nthe cut'].style.fontSize, 100);

  const long = 'A'.repeat(60);
  const fitted = texts(mount(root(h(TitleCard, {
    ...still, title: long, subtitle: 'Sub', titleSize: 200, minTitleSize: 20, maxTitleLines: 2, padding: 100,
  }))), 0)[long];
  const size = fitted.style.fontSize;
  assert.ok(size < 200 && size >= 20, `size ${size}`);
  assert.ok(measure({ text: long, style: fitted.style, maxWidth: 1720 }).lines <= 2);
  assert.ok(measure({ text: long, style: { ...fitted.style, fontSize: size + 1 }, maxWidth: 1720 }).lines > 2);
});

test('the text stays inside the padding and the safe area in landscape and portrait, the background fills the frame', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const leafs = leaves(at(mount(root(h(TitleCard, {
      ...still, safeArea: 'vertical-social', kicker: 'KICKER', chapter: 7, kickerRule: true,
      title: 'A title long enough to wrap onto a few lines at the largest size', subtitle: 'A subtitle that wraps as well, at the column',
      background: '#102030', verticalAlign: 'bottom',
    }), { width, height })), 0).scene.layers);
    const [background] = leafs;
    assert.deepEqual([background.type, background.x, background.y, background.width, background.height], ['rect', 0, 0, width, height]);
    const side = Math.min(width, height);
    const pad = Math.round(side * 0.09);
    const inset = { top: Math.round(0.1 * height), right: Math.round(0.185 * width), bottom: Math.round(0.2 * height), left: Math.round(width / 15) };
    for (const layer of leafs.filter((l) => l.type === 'text')) {
      const { top, bottom } = box(layer);
      const right = layer.x + (layer.maxWidth ?? measure({ text: layer.text, style: layer.style }).width);
      assert.ok(layer.x >= inset.left + pad, `${width}x${height} ${layer.text} left`);
      assert.ok(right <= width - inset.right - pad + 1e-9, `${width}x${height} ${layer.text} right`);
      assert.ok(top >= inset.top + pad - 1e-9, `${width}x${height} ${layer.text} top`);
      assert.ok(bottom <= height - inset.bottom - pad + 1e-9, `${width}x${height} ${layer.text} bottom ${bottom}`);
    }
  }
});

test('TitleCard lays out in the area of an enclosing <SafeArea>', () => {
  const layers = texts(mount(root(h(SafeArea, { padding: 50 },
    h(TitleCard, { ...still, title: 'T', padding: 0, titleSize: 100, verticalAlign: 'top', align: 'right' })))), 0);
  assert.equal(layers.T.x, 50);
  assert.equal(layers.T.maxWidth, 1820);
  assert.equal(box(layers.T).top, 50);
});

test('colors and fonts take <Theme> names', () => {
  const card = h(TitleCard, {
    ...still, kicker: 'K', title: 'T', subtitle: 'S', background: 'bg', color: 'ink', subtitleColor: 'soft', accentColor: 'accent', fontFamily: 'display',
  });
  const leafs = leaves(at(mount(root(h(Theme, {
    fonts: { display: 'Inter' }, colors: { bg: '#000000', ink: '#ffffff', soft: '#888888', accent: '#ff3300' },
  }, card))), 0).scene.layers);
  const fill = (text) => leafs.find((l) => l.text === text).style.fill.color;
  assert.deepEqual([fill('K'), fill('T'), fill('S')], ['#ff3300', '#ffffff', '#888888']);
  assert.equal(leafs[0].fill.color ?? leafs[0].fill, '#000000');
  assert.deepEqual(leafs.filter((l) => l.type === 'text').map((l) => l.style.fontFamily), ['Inter', 'Inter', 'Inter']);
});

test('the default staggers each piece in, top to bottom, and all leave together', () => {
  const composition = mount(root(h(TitleCard, { chapter: '01', kicker: 'K', title: 'T', subtitle: 'S' }), { durationInFrames: 60 }));
  // A fifth of a second apart: 0, 6, 12, 18.
  const shown = (frame) => Object.keys(texts(composition, frame));
  assert.deepEqual(shown(0), ['01']);
  assert.deepEqual(shown(6), ['01', 'K']);
  assert.deepEqual(shown(17), ['01', 'K', 'T']);
  assert.deepEqual(shown(18), ['01', 'K', 'T', 'S']);
  const opacity = (frame) => Object.values(texts(composition, frame)).map((l) => l.opacity);
  assert.deepEqual(opacity(40), [1, 1, 1, 1]);
  assert.deepEqual(opacity(59), [0, 0, 0, 0]);
  // fade-up: each piece starts below its place.
  const t = (frame) => texts(composition, frame).T;
  assert.ok(t(12).y > t(40).y);
});

test('the calm setting brings every piece in at once, and null cuts', () => {
  const calm = mount(root(h(TitleCard, { kicker: 'K', title: 'T', subtitle: 'S', enter: 'fade', stagger: 0 })));
  const opacities = (composition, frame) => Object.values(texts(composition, frame)).map((l) => l.opacity);
  const middle = opacities(calm, 7);
  assert.equal(middle.length, 3);
  assert.ok(middle.every((o) => o === middle[0] && o > 0 && o < 1));

  const cut = mount(root(h(TitleCard, { kicker: 'K', title: 'T', subtitle: 'S', ...still })));
  for (const frame of [0, 45, 89]) assert.deepEqual(opacities(cut, frame), [1, 1, 1]);
});

test('scale grows each piece about its aligned anchor', () => {
  const composition = mount(root(h(TitleCard, { title: 'Title', align: 'center', enter: { type: 'scale', scaleFrom: 0.5 }, exit: null, maxWidth: 600 })));
  const group = (frame) => {
    const find = (layers, x = 0) => {
      for (const layer of layers) {
        if (layer.content.type !== 'group') continue;
        const inner = layer.content.layers;
        if (inner.some((l) => l.content.type === 'text')) return { x: x + layer.transform.position.x, scale: layer.transform.scale.x };
        const found = find(inner, x + layer.transform.position.x);
        if (found) return found;
      }
      return undefined;
    };
    return find(at(composition, frame).scene.layers);
  };
  assert.equal(group(3).x, 960);
  assert.ok(group(3).scale < 1);
  assert.equal(group(40).scale, 1);
});

test('TitleCard is the same at a frame whether played to or seeked, alone or in nested sequences', () => {
  const card = h(TitleCard, { chapter: '02', kicker: 'K', title: 'Two\nlines', subtitle: 'S' });
  const flat = mount(root(card, { durationInFrames: 50 }));
  const nested = mount(root(h(Sequence, { from: 10 }, h(Sequence, { from: 5, durationInFrames: 50 }, card)), { durationInFrames: 80 }));
  const expected = Array.from({ length: 50 }, (_, frame) => texts(flat, frame));
  for (const frame of [33, 2, 49, 0, 17, 8, 33]) {
    assert.deepEqual(texts(nested, frame + 15), expected[frame], `frame ${frame}`);
  }
});

test('TitleCard rejects bad sizes and colors', () => {
  const render = (props) => () => at(mount(root(h(TitleCard, { title: 'T', ...props }))), 0);
  assert.throws(render({ titleSize: 0 }), /titleSize/);
  assert.throws(render({ gap: -1 }), /gap/);
  assert.throws(render({ stagger: -2 }), /stagger/);
  assert.throws(render({ color: 'nope' }), /color "nope"/);
});
