import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import * as React from 'react';

import { Composition, Rect, Sequence, Span, Theme, useCurrentFrame } from '@celesta/react';
import { mount, setTextMeasurer } from '@celesta/react/internal';
import { Center, useLayoutBounds } from '@celesta/layout';
import { Badge } from '../dist/index.js';

const h = React.createElement;

// A stand-in for the shaper: Japanese characters are a full em wide, others
// half an em (0.6 em in "mono"); lines break at `maxWidth` between characters.
const requests = [];
function advance(character, style) {
  const size = style.fontSize ?? 20;
  if (/[　-鿿]/u.test(character)) return size;
  return size * (style.fontFamily === 'mono' ? 0.6 : 0.5);
}
function metrics(request) {
  const { text, style, maxWidth } = request;
  const size = style.fontSize ?? 20;
  const lineHeight = style.lineHeight ?? size * 1.25;
  const lines = [[]];
  for (const character of Array.from(text)) {
    const line = lines[lines.length - 1];
    const width = line.reduce((sum, c) => sum + advance(c, style), 0) + advance(character, style);
    if (maxWidth !== undefined && line.length > 0 && width > maxWidth) lines.push([character]);
    else line.push(character);
  }
  const widths = lines.map((line) => line.reduce((sum, c) => sum + advance(c, style), 0));
  return {
    width: Math.max(...widths), height: text === '' ? 0 : lines.length * lineHeight,
    ascent: size, descent: lineHeight - size, lineHeight, capHeight: size * 0.7, xHeight: size * 0.5,
    lines: lines.length, glyphs: [],
  };
}
beforeEach(() => {
  requests.length = 0;
  setTextMeasurer(async (request) => metrics(request), (request) => {
    requests.push(request);
    return metrics(request);
  });
});

function render(element, { theme } = {}) {
  const composition = mount(() => h(Composition, { width: 1920, height: 1080, fps: 30, durationInFrames: 300 },
    theme ? h(Theme, theme, element) : element));
  return (frame = 0) => composition.renderAt({ value: frame, timescale: 30 }, null).scene.layers;
}

/** The background, content group, and text of a rendered badge. */
function parts(badge) {
  const layers = badge.content.layers;
  const background = layers.find((layer) => layer.content.type === 'rect' && layer.content.fill);
  const content = layers.find((layer) => layer.content.type === 'group');
  const text = content.content.layers.find((layer) => layer.content.type === 'text');
  return { background, content, text };
}

function Probe() {
  const { width, height } = useLayoutBounds();
  return h(Rect, { width, height, fill: '#ff0000' });
}

const style = { fontFamily: 'sans', fontSize: 20 };

test('the background is the measured text plus the padding, and the text sits on its baseline inside it', () => {
  const [badge] = render(h(Badge, { x: 100, y: 50, fill: '#204060', style, padding: { top: 10, right: 20, bottom: 10, left: 20 } }, 'Chapter'))();
  const { background, content, text } = parts(badge);
  assert.deepEqual(badge.transform.position, { x: 100, y: 50 });
  // 7 characters × 10 px, 25 px line box.
  assert.deepEqual([background.content.width, background.content.height], [110, 45]);
  assert.equal(background.content.cornerRadius, 8);
  assert.deepEqual(content.transform.position, { x: 20, y: 10 });
  assert.deepEqual(text.transform.position, { x: 0, y: 20 });
  assert.equal(text.content.baselineAnchor, true);
  assert.equal(text.content.text, 'Chapter');
});

test('Japanese and Latin text are measured, not estimated from the number of characters', () => {
  const [ja] = render(h(Badge, { fill: '#000000', style, padding: 0 }, '第1章'))();
  const [en] = render(h(Badge, { fill: '#000000', style, padding: 0 }, 'abc'))();
  // 第 and 章 are 20 px, 1 is 10 px; abc is 3 × 10 px.
  assert.equal(parts(ja).background.content.width, 50);
  assert.equal(parts(en).background.content.width, 30);
});

test('the measurement and the drawn text get the same text and style, shorthand and theme fonts included', () => {
  const [badge] = render(h(Badge, { fill: 'surface', fontFamily: 'display', fontSize: 30, fontWeight: 700, color: 'ink', padding: 0 },
    'Hi ', h(Span, { fontWeight: 400 }, 'there')), { theme: { fonts: { display: 'mono' }, colors: { surface: '#101010', ink: '#fafafa' } } })();
  const { background, text } = parts(badge);
  const [request] = requests;
  assert.equal(request.text, 'Hi there');
  assert.equal(request.style.fontFamily, 'mono');
  assert.equal(request.style.fontSize, 30);
  assert.equal(text.content.style.fontFamily, 'mono');
  assert.equal(text.content.style.fontSize, 30);
  assert.equal(text.content.style.fontWeight, 700);
  assert.deepEqual(text.content.style.fontRuns, request.style.fontRuns);
  assert.equal(text.content.style.fill.color, '#fafafa');
  assert.equal(background.content.fill.color, '#101010');
  // 8 characters × 18 px in mono at 30 px.
  assert.equal(background.content.width, 144);
});

test('changing the text or the font resizes the background on the next frame', () => {
  function Changing({ frame }) {
    return h(Badge, { fill: '#000000', padding: 0, style: { fontFamily: frame < 2 ? 'sans' : 'mono', fontSize: 20 } }, frame < 1 ? 'ab' : 'abcd');
  }
  const composition = mount(() => h(Composition, { width: 400, height: 200, fps: 30, durationInFrames: 10 },
    h(FrameDriven, { render: (frame) => h(Changing, { frame }) })));
  const widthAt = (frame) => parts(composition.renderAt({ value: frame, timescale: 30 }, null).scene.layers[0]).background.content.width;
  assert.deepEqual([widthAt(0), widthAt(1), widthAt(2)], [20, 40, 48]);
});

test('empty text keeps one line box, so the badge does not collapse', () => {
  const [badge] = render(h(Badge, { fill: '#000000', style }, ''))();
  const { background } = parts(badge);
  assert.deepEqual([background.content.width, background.content.height], [32, 41]);
});

test('a leading decoration lays out in its own box one line tall, then the gap, then the text', () => {
  const [badge] = render(h(Badge, {
    fill: '#000000', style, padding: { left: 24, right: 24, top: 16, bottom: 16 }, leadingWidth: 8, gap: 12,
    leading: h(Center, null, h(Probe)),
  }, 'API'))();
  const { background, content, text } = parts(badge);
  assert.equal(background.content.width, 24 + 8 + 12 + 30 + 24);
  const [center] = content.content.layers;
  // The leading box is 8 × 25; Center puts its children at the middle.
  assert.deepEqual(center.transform.position, { x: 4, y: 12.5 });
  const [probe] = center.content.layers;
  assert.deepEqual([probe.content.width, probe.content.height], [8, 25]);
  assert.equal(text.transform.position.x, 20);
});

test('a leading decoration without a width throws', () => {
  assert.throws(() => render(h(Badge, { leading: h(Probe) }, 'x'))(), /<Badge> leading needs a leadingWidth/);
});

test('maxWidth wraps long text inside the padding and the badge grows taller, never wider', () => {
  const [badge] = render(h(Badge, { fill: '#000000', style, padding: 10, maxWidth: 100 }, 'abcdefghijklmnop'))();
  const { background, text } = parts(badge);
  // 80 px of room: 8 characters a line, two lines.
  assert.equal(text.content.maxWidth, 80);
  assert.deepEqual([background.content.width, background.content.height], [100, 70]);
  const [short] = render(h(Badge, { fill: '#000000', style, padding: 10, maxWidth: 100 }, 'abc'))();
  assert.equal(parts(short).background.content.width, 50);
});

test('maxWidth leaves room for the leading decoration', () => {
  const [badge] = render(h(Badge, { style, padding: 0, maxWidth: 60, leading: h(Probe), leadingWidth: 10, gap: 10 }, 'abcdefgh'))();
  assert.equal(parts(badge).text.content.maxWidth, 40);
});

test('cornerRadius "pill" is half the measured height', () => {
  const [badge] = render(h(Badge, { fill: '#000000', style, padding: 10, cornerRadius: 'pill' }, 'pill'))();
  assert.equal(parts(badge).background.content.cornerRadius, 22.5);
});

test('the anchor and transforms move the background and the text together', () => {
  const [badge] = render(h(Badge, {
    x: 960, y: 540, anchorX: 0.5, anchorY: 0.5, scale: 2, rotation: 15, fill: '#000000', style, padding: 10,
  }, 'abcd'))();
  const { background, content } = parts(badge);
  assert.deepEqual(badge.transform.position, { x: 960, y: 540 });
  assert.deepEqual(badge.transform.scale, { x: 2, y: 2 });
  assert.equal(badge.transform.rotation, 15);
  // 60 × 45: both start at the top-left of the box centred on the anchor.
  assert.deepEqual(background.transform.position, { x: -30, y: -22.5 });
  assert.deepEqual(content.transform.position, { x: -20, y: -12.5 });
});

test('the group language goes into the measured and drawn style', () => {
  render(h(Badge, { lang: 'ja', style }, '漢字'))();
  assert.equal(requests[0].style.lang, 'ja');
});

test('negative or non-finite sizes throw', () => {
  const cases = [
    [{ padding: -1 }, /<Badge> padding top must be/],
    [{ cornerRadius: -2 }, /<Badge> cornerRadius must be/],
    [{ gap: Number.NaN, leading: h(Probe), leadingWidth: 4 }, /<Badge> gap must be/],
    [{ leading: h(Probe), leadingWidth: -4 }, /<Badge> leadingWidth must be/],
    [{ maxWidth: Infinity }, /<Badge> maxWidth must be/],
  ];
  for (const [props, message] of cases) {
    assert.throws(() => render(h(Badge, { style, ...props }, 'x'))(), message, JSON.stringify(props));
  }
});

test('a badge renders the same on a seek as when played up to it, inside a Sequence', () => {
  const scene = h(Sequence, { from: 10 }, h(Badge, { fill: '#123456', style, cornerRadius: 'pill' }, 'seek'));
  const played = render(scene);
  for (let frame = 0; frame <= 30; frame += 1) played(frame);
  assert.deepEqual(played(30), render(scene)(30));
});

/** Calls `render` with the current frame, to change props from frame to frame. */
function FrameDriven({ render: draw }) {
  return draw(useCurrentFrame());
}
