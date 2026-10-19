import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as React from 'react';

import { Composition, FrameChrome, Theme, defineScenes, frameToTimecode } from '../dist/index.js';
import { mount } from '../dist/render.js';

const h = React.createElement;

// Every leaf layer with its position summed through its groups.
function leaves(layers, x = 0, y = 0, out = []) {
  for (const layer of layers) {
    const lx = x + layer.transform.position.x;
    const ly = y + layer.transform.position.y;
    if (layer.content.type === 'group') leaves(layer.content.layers, lx, ly, out);
    else out.push({ ...layer.content, x: lx, y: ly, opacity: layer.opacity, anchor: layer.transform.anchor });
  }
  return out;
}

function render(props, { width = 1920, height = 1080, durationInFrames = 90, frame = 0, theme } = {}) {
  const chrome = h(FrameChrome, props);
  const composition = mount(() => h(Composition, { width, height, fps: 30, durationInFrames },
    theme ? h(Theme, theme, chrome) : chrome));
  return (f = frame) => composition.renderAt({ value: f, timescale: 30 }, null).scene.layers;
}

const textAt = (layers, text) => leaves(layers).find((layer) => layer.type === 'text' && layer.text === text);

test('frameToTimecode can leave the hours out', () => {
  assert.equal(frameToTimecode(30 * 3725 + 7, 30), '01:02:05:07');
  assert.equal(frameToTimecode(30 * 3725 + 7, 30, { hours: false }), '62:05:07');
  assert.equal(frameToTimecode(-4, 30, { hours: false }), '00:00:00');
});

test('FrameChrome keeps its corners and labels inside the margin at any canvas shape', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
    const layers = render({ corners: true, timecode: true, title: 'T', caption: 'C', margin: 40, cornerLength: 20, gap: 10 },
      { width, height })(0);
    const rects = leaves(layers).filter((layer) => layer.type === 'rect');
    assert.equal(rects.length, 8);
    const xs = rects.flatMap((r) => [r.x, r.x + r.width]);
    const ys = rects.flatMap((r) => [r.y, r.y + r.height]);
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], [40, width - 40], `${width}x${height}`);
    assert.deepEqual([Math.min(...ys), Math.max(...ys)], [40, height - 40], `${width}x${height}`);
    const title = textAt(layers, 'T');
    assert.deepEqual([title.x, title.y, title.anchor.x], [70, 50, 0]);
    const timecode = textAt(layers, '00:00:00:00');
    assert.deepEqual([timecode.x, timecode.y, timecode.anchor.x], [width - 70, 50, 1]);
    const caption = textAt(layers, 'C');
    assert.deepEqual([caption.x, caption.y, caption.anchor.x], [width - 70, height - 50, 1]);
  }
});

test('FrameChrome draws only what is turned on, the bar blended apart from the marks', () => {
  assert.deepEqual(render({ blendMode: 'difference', opacity: 0.8 })(0), []);
  const layers = render({ corners: true, progress: true, blendMode: 'difference', progressBlendMode: 'normal', opacity: 0.8 })(10);
  assert.deepEqual(layers.map((layer) => [layer.blendMode, layer.opacity]), [['difference', 0.8], [undefined, 0.8]]);
  const same = render({ corners: true, progress: true, blendMode: 'difference' })(10);
  assert.deepEqual(same.map((layer) => layer.blendMode), ['difference', 'difference']);
});

test('the progress bar is empty on the first frame and full on the last', () => {
  const frame = render({ progress: true, margin: 60, trackOpacity: 0 }, { width: 1000, durationInFrames: 31 });
  const bar = (f) => leaves(frame(f)).filter((layer) => layer.type === 'rect');
  assert.deepEqual(bar(0), []);
  assert.equal(bar(15)[0].width, 440);
  const full = bar(30)[0];
  assert.deepEqual([full.x, full.width, full.y + full.height / 2], [60, 880, 1080 - 30]);
});

test('scene segments fill as one bar, without a break at the boundaries', () => {
  const scenes = defineScenes([
    { id: 'a', durationInFrames: 20 },
    { id: 'empty', durationInFrames: 0 },
    { id: 'b', durationInFrames: 40 },
  ]);
  const frame = render({ progress: true, scenes, margin: 0, segmentGap: 10, trackOpacity: 0.5, progressColor: '#ff0000' },
    { width: 610, durationInFrames: 60 });
  const filled = (f) => leaves(frame(f)).filter((layer) => layer.type === 'rect' && layer.fill.color === '#ff0000');
  const tracks = leaves(frame(0)).filter((layer) => layer.type === 'rect');
  assert.deepEqual(tracks.map((r) => [r.x, r.width]), [[0, 200], [210, 400]]);
  assert.ok(tracks.every((r) => r.opacity === 0.5));
  assert.deepEqual(filled(0), []);
  // Filled share of the bar, segment by segment, against the film's progress.
  let last = 0;
  for (let f = 0; f < 60; f++) {
    const share = filled(f).reduce((sum, r) => sum + r.width, 0) / 600;
    assert.ok(Math.abs(share - f / 59) < 1e-9, `frame ${f}: ${share}`);
    assert.ok(share >= last);
    last = share;
  }
  assert.deepEqual(filled(59).map((r) => r.width), [200, 400]);
});

test('labels show the timecode, the current chapter, and a two-weight title', () => {
  const scenes = defineScenes([
    { id: 'intro', name: 'COLD OPEN', durationInFrames: 30 },
    { id: 'body', durationInFrames: 30 },
  ]);
  const frame = render({ timecode: true, timecodeHours: false, chapters: true, scenes, title: 'CELESTA', subtitle: '/ REEL',
    color: 'paper', fontFamily: 'mono', formatChapter: (s) => `0${s.index + 1}  ${s.name}` },
  { theme: { colors: { paper: '#f4f1ea' }, fonts: { mono: 'JetBrains Mono' } } });
  const layers = frame(45);
  assert.ok(textAt(layers, '00:01:15'));
  const chapter = textAt(layers, '02  body');
  assert.equal(chapter.style.fontFamily, 'JetBrains Mono');
  assert.equal(chapter.style.fill.color, '#f4f1ea');
  const title = textAt(layers, 'CELESTA / REEL');
  assert.equal(title.style.fontWeight, 400);
  assert.deepEqual(title.style.fontRuns.map((run) => run.fontWeight), [700]);
  assert.deepEqual(title.style.colorRuns.map((run) => run.color), ['#f4f1ea99']);
  assert.ok(textAt(frame(10), '01  COLD OPEN'));
  assert.deepEqual(leaves(frame(89)).map((l) => l.text), ['CELESTA / REEL', '00:02:29'], 'no chapter after the last scene');
});

test('positions move labels, and two labels in one corner throw', () => {
  const layers = render({ timecode: true, title: 'T', positions: { timecode: 'bottom-right' } })(0);
  const timecode = textAt(layers, '00:00:00:00');
  assert.deepEqual([timecode.x, timecode.y], [1920 - 94, 1080 - 68]);
  assert.throws(() => render({ timecode: true, title: 'T', positions: { title: 'top-right' } })(0), /both placed top-right/);
  assert.throws(() => render({ progress: true, color: 'nope' })(0), /neither a #RRGGBB/);
});
