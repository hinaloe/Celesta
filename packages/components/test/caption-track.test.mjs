import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import * as React from 'react';

import { Composition, Rect, Sequence, Text, Theme, useCurrentFrame } from '@celesta/react';
import { mount, setTextMeasurer } from '@celesta/react/internal';
import { CaptionTrack } from '../dist/index.js';

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
    descent: lineHeight - size,
    lineHeight,
    lines: lines.length,
    glyphs: [],
  };
}

beforeEach(() => setTextMeasurer(async (request) => measure(request), measure));

const root = (child, { width = 1920, height = 1080, durationInFrames = 300 } = {}) => () =>
  h(Composition, { width, height, fps: 30, durationInFrames }, child);
const at = (composition, frame) => composition.renderAt({ value: frame, timescale: 30 }, null).scene;

function leaves(layers, x = 0, y = 0, opacity = 1, out = []) {
  for (const layer of layers) {
    const lx = x + layer.transform.position.x;
    const ly = y + layer.transform.position.y;
    const lo = opacity * layer.opacity;
    if (layer.content.type === 'group') {
      if (layer.content.clip) out.push({ type: 'clip', clip: layer.content.clip, x: lx, y: ly });
      leaves(layer.content.layers, lx, ly, lo, out);
    } else out.push({ ...layer.content, id: layer.id, x: lx, y: ly, opacity: lo });
  }
  return out;
}

const drawn = (composition, frame) => leaves(at(composition, frame).layers);
const shown = (composition, frame) => drawn(composition, frame).filter((l) => l.type === 'text').map((l) => l.text);

const cues = [
  { id: 'intro', from: 0, durationInFrames: 60, text: 'こんにちは' },
  { id: 'next', from: 60, durationInFrames: 90, text: '動画を作ります' },
  { id: 'late', from: 180, durationInFrames: 30, text: 'Bye' },
];

const still = { enter: null, exit: null };

test('cues switch on their boundary frames from data alone, with gaps showing nothing', () => {
  const track = mount(root(h(CaptionTrack, { cues, ...still })));
  assert.deepEqual(shown(track, 0), ['こんにちは']);
  assert.deepEqual(shown(track, 59), ['こんにちは']);
  assert.deepEqual(shown(track, 60), ['動画を作ります']);
  assert.deepEqual(shown(track, 149), ['動画を作ります']);
  assert.deepEqual(shown(track, 150), []);
  assert.deepEqual(shown(track, 179), []);
  assert.deepEqual(shown(track, 180), ['Bye']);
  assert.deepEqual(shown(track, 210), []);
  // A band (the Panel's background rect) behind every caption, and none in the gap.
  assert.equal(drawn(track, 30).filter((l) => l.type === 'rect').length, 1);
  assert.equal(drawn(track, 160).filter((l) => l.type === 'rect').length, 0);
});

test('the default band sits at the bottom centre, sized from the measured text', () => {
  const track = mount(root(h(CaptionTrack, { cues, ...still, fontSize: 40 })));
  const [band] = drawn(track, 10).filter((l) => l.type === 'rect');
  const [text] = drawn(track, 10).filter((l) => l.type === 'text');
  // 5 characters × 40 px, padding 0.6 em at the sides and 0.3 em above and below; line height 1.4.
  assert.equal(band.width, 200 + 48);
  assert.equal(band.height, 56 + 24);
  assert.equal(band.x, (1920 - 248) / 2);
  // The margin is 6% of 1080.
  assert.equal(band.y + band.height, 1080 - 65);
  assert.equal(text.maxWidth, Math.round(0.8 * (1920 - 130)));
  assert.equal(text.style.align, 'center');
  assert.equal(text.style.lineHeight, 56);
});

test('nested in a Sequence, cues count from its start', () => {
  const track = mount(root(h(Sequence, { from: 100 }, h(Sequence, { from: 20 }, h(CaptionTrack, { cues, ...still })))));
  assert.deepEqual(shown(track, 119), []);
  assert.deepEqual(shown(track, 120), ['こんにちは']);
  assert.deepEqual(shown(track, 180), ['動画を作ります']);
});

test('seeking in any order draws the same frames', () => {
  const frames = [200, 0, 75, 59, 60, 150, 3];
  const forward = mount(root(h(CaptionTrack, { cues })));
  const expected = [...frames].sort((a, b) => a - b).map((frame) => [frame, JSON.stringify(drawn(forward, frame))]);
  const shuffled = mount(root(h(CaptionTrack, { cues })));
  const got = new Map(frames.map((frame) => [frame, JSON.stringify(drawn(shuffled, frame))]));
  for (const [frame, json] of expected) assert.equal(got.get(frame), json, `frame ${frame}`);
});

test('Japanese captions wrap to the line limit; past it they clip, or fail with overflow error', () => {
  const long = { from: 0, durationInFrames: 30, text: 'あいうえおかきくけこさしすせそ' };
  const track = mount(root(h(CaptionTrack, { cues: [long], ...still, fontSize: 40, maxWidth: 240, maxLines: 2 })));
  const layers = drawn(track, 0);
  const [band] = layers.filter((l) => l.type === 'rect');
  // Six characters a line, three lines measured, two shown.
  assert.equal(band.height, 2 * 56 + 24);
  assert.equal(layers.filter((l) => l.type === 'clip').length, 1);
  assert.throws(
    () => at(mount(root(h(CaptionTrack, { cues: [{ ...long, id: 'wall' }], ...still, fontSize: 40, maxWidth: 240, overflow: 'error' }))), 0),
    /<CaptionTrack> cue 0 \("wall"\) "あいうえお.*" does not fit 2 lines of 240 px even at 40 px/,
  );
  // Two lines fit and nothing is clipped; `\n` breaks a line.
  const two = mount(root(h(CaptionTrack, { cues: [{ ...long, text: 'あいう\nえお' }], ...still, fontSize: 40, maxWidth: 240 })));
  assert.equal(drawn(two, 0).filter((l) => l.type === 'rect')[0].height, 2 * 56 + 24);
  assert.equal(drawn(two, 0).filter((l) => l.type === 'clip').length, 0);
});

test('minFontSize lets a long caption shrink to fit maxLines', () => {
  const track = mount(root(h(CaptionTrack, {
    cues: [{ from: 0, durationInFrames: 30, text: 'あいうえおかきくけこさしすせそ' }], ...still,
    fontSize: 40, minFontSize: 20, maxWidth: 240, maxLines: 2,
  })));
  const [text] = drawn(track, 0).filter((l) => l.type === 'text');
  assert.ok(text.style.fontSize < 40 && text.style.fontSize >= 20);
});

test('emphasis draws as runs over grapheme clusters, with named styles and theme colors', () => {
  const track = mount(root(h(Theme, { colors: { warn: '#ffd166' } }, h(CaptionTrack, {
    ...still,
    emphasisStyles: { hot: { color: 'warn', fontWeight: 800 } },
    cues: [{ from: 0, durationInFrames: 30, text: 'HPが👨‍👩‍👧1', emphasis: [{ start: 3, end: 5, style: 'hot' }] }],
  }))));
  const [text] = drawn(track, 0).filter((l) => l.type === 'text');
  assert.deepEqual(text.style.colorRuns, [{ start: 3, end: 9, color: '#ffd166' }]);
  assert.deepEqual(text.style.fontRuns, [{ start: 3, end: 9, fontWeight: 800 }]);
  assert.throws(
    () => at(mount(root(h(CaptionTrack, { ...still, cues: [{ id: 'x', from: 0, durationInFrames: 30, text: 'ab', emphasis: [{ start: 1, end: 3, style: {} }] }] }))), 0),
    /<CaptionTrack> cue 0 \("x"\): emphasis 0 \(1–3\) must cover/,
  );
});

test('a render callback replaces the band and text without changing the cue clock', () => {
  const seen = [];
  function Custom(info) {
    const local = useCurrentFrame();
    seen.push({ id: info.cue.id, frame: info.frame, local, duration: info.durationInFrames, emphasis: info.emphasis.length });
    return h(Rect, { id: 'custom', x: info.box.x, y: info.box.y, width: info.box.width, height: info.box.height, fill: '#ff0000' });
  }
  const track = mount(root(h(Sequence, { from: 10 }, h(CaptionTrack, { cues, render: Custom }))));
  at(track, 10);
  at(track, 99);
  at(track, 190);
  assert.deepEqual(seen.map(({ id, frame, local, duration }) => [id, frame, local, duration]), [
    ['intro', 0, 0, 60],
    ['next', 29, 29, 90],
    ['late', 0, 0, 30],
  ]);
  assert.deepEqual(shown(track, 99), []);
  const plain = mount(root(h(Sequence, { from: 10 }, h(CaptionTrack, { cues, background: null }))));
  // No band, and the same cue on the same frames.
  assert.deepEqual(shown(plain, 99), ['動画を作ります']);
  assert.equal(drawn(plain, 99).filter((l) => l.type === 'rect').length, 0);
  assert.deepEqual(shown(plain, 69), ['こんにちは']);
});

test('captions fade in and out, but back-to-back cues swap without a blink', () => {
  const track = mount(root(h(CaptionTrack, { cues })));
  const opacity = (frame) => drawn(track, frame).find((l) => l.type === 'text').opacity;
  // 3-frame fades at 30 fps: hidden on the first frame, at rest on the third.
  assert.equal(opacity(0), 0);
  assert.ok(opacity(1) > 0 && opacity(1) < 1);
  assert.equal(opacity(2), 1);
  // "intro" ends where "next" starts: no exit, no entrance.
  assert.equal(opacity(59), 1);
  assert.equal(opacity(60), 1);
  // "next" ends before a gap, so it fades out.
  assert.ok(opacity(148) < 1);
  assert.equal(opacity(180), 0);
});

test('overlapping cues are refused unless the later one may cut the earlier', () => {
  const overlapping = [
    { id: 'a', from: 0, durationInFrames: 60, text: 'A' },
    { id: 'b', from: 30, durationInFrames: 60, text: 'B' },
  ];
  assert.throws(
    () => at(mount(root(h(CaptionTrack, { cues: overlapping, ...still }))), 0),
    /<CaptionTrack>: cue 1 \("b"\) \(frames 30–90\) overlaps cue 0 \("a"\) \(frames 0–60\)/,
  );
  const track = mount(root(h(CaptionTrack, { cues: overlapping, ...still, overlap: 'latest' })));
  assert.deepEqual(shown(track, 29), ['A']);
  assert.deepEqual(shown(track, 30), ['B']);
});

test('bad cues and props fail with the cue named', () => {
  const bad = (props, pattern) => assert.throws(() => at(mount(root(h(CaptionTrack, { ...still, ...props }))), 0), pattern);
  bad({ cues: [{ id: 'q', from: 0, durationInFrames: 0, text: 'x' }] }, /cue 0 \("q"\) needs a whole-number `durationInFrames` of at least 1/);
  bad({ cues: [{ from: 0.5, durationInFrames: 10, text: 'x' }] }, /cue 0 needs a whole-number `from`/);
  bad({ cues: [{ from: 0, durationInFrames: 10, text: 3 }] }, /cue 0 needs a string `text`/);
  bad({ cues, maxLines: 0 }, /maxLines must be a whole number of at least 1/);
  bad({ cues, color: 'nope' }, /<CaptionTrack> color "nope" is neither/);
});

test('an empty caption shows no band, and the cues go into the subtitle file', () => {
  const withEmpty = [...cues, { from: 220, durationInFrames: 10, text: '' }];
  const track = mount(root(h(CaptionTrack, { cues: withEmpty, ...still })));
  assert.deepEqual(drawn(track, 225), []);
  const files = track.collectSubtitles(0, 300).map(({ text, start, end }) => [text, start, end]);
  assert.deepEqual(files, [['こんにちは', 0, 2], ['動画を作ります', 2, 5], ['Bye', 6, 7]]);
  const silent = mount(root(h(CaptionTrack, { cues, ...still, subtitles: false })));
  assert.deepEqual(silent.collectSubtitles(0, 300), []);
});

test('a text layer of its own is untouched by the track', () => {
  const track = mount(root(h(React.Fragment, null, h(Text, { id: 'title' }, 'Title'), h(CaptionTrack, { cues, ...still }))));
  assert.deepEqual(shown(track, 0), ['Title', 'こんにちは']);
});
