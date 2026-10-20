// Subtitle pages and emphasis on dialogue lines: one voice and one lip-sync
// clock per line, however its subtitle pages through. Text is measured with
// a fixed stand-in for the shaper, so no fonts are needed.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import React from 'react';

import { Assets, Composition, Rect, Span, Text } from '@celesta/react';
import { mount, setTextMeasurer } from '@celesta/react/internal';
import { Character, CharacterView, Dialogue, DialogueSeries, lipSyncFromKeyframes, planDialogue } from '../dist/index.js';

const h = React.createElement;

// Every code point is `fontSize` wide; lines wrap at maxWidth by code point and break at `\n`.
function measure({ text, style, maxWidth }) {
  const size = style.fontSize ?? 10;
  const per = maxWidth === undefined ? Infinity : Math.max(1, Math.floor(maxWidth / size));
  const rows = [];
  let offset = 0;
  for (const paragraph of text.split('\n')) {
    const chars = Array.from(paragraph);
    for (let i = 0; i < Math.max(1, chars.length); i += per) rows.push({ start: offset + i, length: Math.min(per, chars.length - i) });
    offset += chars.length + 1;
  }
  return {
    width: Math.max(...rows.map((row) => row.length * size)), height: rows.length * size * 1.25,
    ascent: size, descent: size * 0.25, lineHeight: size * 1.25, capHeight: 7, xHeight: 5,
    lines: rows.length, glyphs: [], lineStarts: rows.map((row) => row.start),
  };
}

let requests;
beforeEach(() => {
  requests = [];
  const sync = (request) => {
    requests.push(request);
    return measure(request);
  };
  setTextMeasurer(async (request) => sync(request), sync);
});

const portrait = { defaultExpression: 'n', expressions: { n: 'n.png' }, lipSync: { a: 'a.png', i: 'i.png', u: 'u.png', e: 'e.png', o: 'o.png', closed: 'c.png' } };

function texts(layers) {
  return layers.flatMap((layer) =>
    layer.content.type === 'text' ? [layer.content] : layer.content.type === 'group' ? texts(layer.content.layers) : []);
}
function images(layers) {
  return layers.flatMap((layer) =>
    layer.content.type === 'image' ? [layer.content.asset.id] : layer.content.type === 'group' ? images(layer.content.layers) : []);
}

/** Mounts a script under one character; `subtitle` is its subtitle config. */
function series(lines, { subtitle = { style: { fontSize: 10 } }, durationInFrames = 120, ...seriesProps } = {}) {
  const actor = React.createRef();
  const view = React.createRef();
  let plan;
  const ready = planDialogue(lines, { fps: 30, gap: 0 }).then((result) => { plan = result; });
  const Root = () => h(Composition, { width: 640, height: 360, fps: 30, durationInFrames },
    h(Assets, null, h(Character, { ref: actor, name: 'zunda', portrait, subtitle })),
    h(CharacterView, { ref: view, character: actor }),
    h(DialogueSeries, { plan, views: { zunda: view }, ...seriesProps }));
  return ready.then(() => {
    const mounted = mount(Root);
    return { plan, mounted, at: (frame) => mounted.renderAt({ value: frame, timescale: 30 }, null) };
  });
}

const danger = {
  id: 'danger', speaker: 'zunda', durationInFrames: 90, audio: 'danger.wav',
  text: 'HPが1です。回復しましょう。',
  spokenText: 'えいちぴーがいちです。かいふくしましょう。',
  subtitlePages: [{ from: 0, durationInFrames: 45, text: 'HPが1です。' }, { from: 45, text: '回復しましょう。' }],
  emphasis: [{ start: 3, end: 4, style: { color: '#ff6060', fontWeight: 800 } }, { start: 7, end: 9, style: 'calm' }],
};

test('pages change on their boundary frames; the open last page runs to the line end', async () => {
  const { at } = await series([danger], { subtitle: { style: { fontSize: 10 }, emphasisStyles: { calm: { color: '#60c0ff' } } } });
  const shown = (frame) => texts(at(frame).scene.layers).map((layer) => layer.text);
  assert.deepEqual(shown(0), ['HPが1です。']);
  assert.deepEqual(shown(44), ['HPが1です。']);
  assert.deepEqual(shown(45), ['回復しましょう。']);
  assert.deepEqual(shown(89), ['回復しましょう。']);
  assert.deepEqual(shown(90), []);
});

test('emphasis is cut to the page it falls on, with named styles from the speaker', async () => {
  const { at } = await series([danger], { subtitle: { style: { fontSize: 10 }, emphasisStyles: { calm: { color: '#60c0ff' } } } });
  const [first] = texts(at(10).scene.layers);
  assert.deepEqual(first.style.colorRuns, [{ start: 3, end: 4, color: '#ff6060' }]);
  assert.deepEqual(first.style.fontRuns, [{ start: 3, end: 4, fontWeight: 800 }]);
  // 回復 is clusters 7–9 of the line, 0–2 of the second page.
  const [second] = texts(at(60).scene.layers);
  assert.deepEqual(second.style.colorRuns, [{ start: 0, end: 2, color: '#60c0ff' }]);
});

test('one voice clip and one mouth clock for the whole line, across pages', async () => {
  const lipSync = lipSyncFromKeyframes([
    { seconds: 0, mouth: 'a' }, { seconds: 1.4, mouth: 'i' }, { seconds: 1.6, mouth: 'o' }, { seconds: 2.5, mouth: 'closed' },
  ], 3);
  const { at } = await series([{ ...danger, emphasis: undefined, lipSync }]);
  for (const frame of [0, 44, 45, 50, 80]) {
    const { audio, scene } = at(frame);
    // The same clip, from the line's start, on every frame: never one per page.
    assert.deepEqual(audio.map(({ src, start, duration }) => [src.split(/[\\/]/).pop(), start, duration]), [['danger.wav', 0, 3]]);
    assert.ok(images(scene.layers).includes(`${lipSync.mouthAtFrame(frame, 30) === 'closed' ? 'c' : lipSync.mouthAtFrame(frame, 30)}.png`));
  }
});

test('the subtitle file gets each page for its own frames', async () => {
  const { mounted } = await series([{ ...danger, emphasis: undefined }]);
  assert.deepEqual(mounted.collectSubtitles(0, 120).map(({ text, start, end }) => [text, start, end]), [
    ['HPが1です。', 0, 1.5],
    ['回復しましょう。', 1.5, 3],
  ]);
});

test('subtitle.render gets the page, its emphasis, and the line clock; gaps hold the band', async () => {
  const seen = [];
  const render = (info) => {
    seen.push({
      text: info.text, lineText: info.lineText, held: info.held, frame: info.frame, duration: info.durationInFrames,
      page: info.page && [info.page.index, info.page.count, info.page.from, info.page.durationInFrames, info.page.frame, info.page.timing],
      emphasis: info.emphasis.map((entry) => [entry.start, entry.end, entry.text]),
      width: info.metrics.width,
    });
    return h(Rect, { id: 'band', width: info.metrics.width, height: 10, fill: '#000000' });
  };
  const gapped = {
    ...danger,
    subtitlePages: [{ from: 0, durationInFrames: 40, text: 'HPが1です。' }, { from: 50, timing: 'aligned', text: '回復しましょう。' }],
  };
  const { at } = await series([gapped], { holdSubtitle: true, subtitle: { style: { fontSize: 10 }, render, emphasisStyles: { calm: {} } } });
  for (const frame of [0, 39, 40, 49, 50, 89]) at(frame);
  assert.deepEqual(seen.map((info) => [info.text, info.held, info.frame, info.duration, info.page]), [
    ['HPが1です。', false, 0, 90, [0, 2, 0, 40, 0, 'manual']],
    ['HPが1です。', false, 39, 90, [0, 2, 0, 40, 39, 'manual']],
    // 40–49 no page covers: the band stays, sized from the page before.
    ['HPが1です。', true, 40, 90, [0, 2, 0, 40, 40, 'manual']],
    ['HPが1です。', true, 49, 90, [0, 2, 0, 40, 49, 'manual']],
    ['回復しましょう。', false, 50, 90, [1, 2, 50, 40, 0, 'aligned']],
    ['回復しましょう。', false, 89, 90, [1, 2, 50, 40, 39, 'aligned']],
  ]);
  assert.equal(seen[0].lineText, danger.text);
  assert.deepEqual(seen[0].emphasis, [[3, 4, '1']]);
  assert.deepEqual(seen[4].emphasis, [[0, 2, '回復']]);
  // Measured per page: 7 code points, then 8, at 10 px.
  assert.equal(seen[0].width, 70);
  assert.equal(seen[4].width, 80);
  assert.ok(requests.some((request) => request.text === 'HPが1です。' && request.style.fontRuns?.[0]?.fontWeight === 800));
});

test('holdThroughGap keeps the last page up through the gap; a held copy holds the last page', async () => {
  const lines = [{ ...danger, emphasis: undefined, gap: 1 }, { id: 'next', speaker: 'zunda', text: 'つぎ', durationInFrames: 30 }];
  const actor = React.createRef();
  const view = React.createRef();
  const plan = await planDialogue(lines, { fps: 30 });
  const build = (props, subtitle) => mount(() => h(Composition, { width: 640, height: 360, fps: 30, durationInFrames: 200 },
    h(Assets, null, h(Character, { ref: actor, name: 'zunda', portrait, subtitle })),
    h(CharacterView, { ref: view, character: actor }),
    h(DialogueSeries, { plan, views: { zunda: view }, ...props })));
  const through = build({ holdThroughGap: true }, { style: { fontSize: 10 } });
  assert.deepEqual(texts(through.renderAt({ value: 100, timescale: 30 }, null).scene.layers).map((l) => l.text), ['回復しましょう。']);
  const seen = [];
  const held = build({ holdSubtitle: true }, { style: { fontSize: 10 }, render: (info) => { seen.push([info.text, info.held]); return null; } });
  held.renderAt({ value: 100, timescale: 30 }, null);
  assert.deepEqual(seen.at(-1), ['回復しましょう。', true]);
});

test('lines without pages or emphasis keep their subtitles, spans and all', async () => {
  const seen = [];
  const { at } = await series([{ id: 'plain', speaker: 'zunda', durationInFrames: 30, text: h(Span, { color: '#ff0000' }, 'あか') }], {
    subtitle: { style: { fontSize: 10 }, render: (info) => { seen.push([info.text, info.page, info.emphasis, info.held]); return h(Text, null, info.content); } },
  });
  const [layer] = texts(at(5).scene.layers);
  assert.deepEqual(layer.style.colorRuns, [{ start: 0, end: 2, color: '#ff0000' }]);
  assert.deepEqual(seen, [['あか', null, [], false]]);
});

test('a Dialogue of its own pages through its Sequence', () => {
  const actor = React.createRef();
  const view = React.createRef();
  const mounted = mount(() => h(Composition, { width: 640, height: 360, fps: 30, durationInFrames: 60 },
    h(Assets, null, h(Character, { ref: actor, name: 'a', portrait, subtitle: { style: { fontSize: 10 } } })),
    h(CharacterView, { ref: view, character: actor }),
    h(Dialogue, { character: view, subtitlePages: [{ from: 0, text: 'ab' }, { from: 30, text: 'cd' }] }, 'ab cd')));
  const shown = (frame) => texts(mounted.renderAt({ value: frame, timescale: 30 }, null).scene.layers).map((l) => l.text);
  assert.deepEqual([shown(29), shown(30), shown(59)], [['ab'], ['cd'], ['cd']]);
});

test('bad pages and emphasis are refused with the line and page named', async () => {
  const bad = (line, pattern) => assert.rejects(planDialogue([{ id: 'danger', durationInFrames: 90, text: 'HPが1です。回復しましょう。', ...line }], { fps: 30 }), pattern);
  await bad({ subtitlePages: [{ from: 0, durationInFrames: 100, text: 'HPが1です。回復しましょう。' }] },
    /planDialogue\(\): line "danger": page 0 \(frames 0–100\) is outside frames 0–90/);
  await bad({ subtitlePages: [{ from: 0, durationInFrames: 50, text: 'HPが1です。' }, { from: 45, text: '回復しましょう。' }] },
    /line "danger": page 1 \(frames 45–90\) overlaps page 0 \(frames 0–50\)/);
  await bad({ subtitlePages: [{ from: 45, text: 'HPが1です。' }, { from: 0, text: '回復しましょう。' }] },
    /page 1 starts at frame 0, before page 0 \(frame 45\); list them in order/);
  await bad({ subtitlePages: [{ from: 0, text: 'HPが2です。' }, { from: 45, text: '回復しましょう。' }] },
    /line "danger": page 0 text "HPが2です。" does not continue the line's text, which goes on with "HPが1です。回復しまし…"/);
  await bad({ subtitlePages: [{ from: 0, text: 'HPが1です。' }] }, /line "danger": the pages leave out the end of the line's text, "回復しましょう。"/);
  await bad({ subtitlePages: [{ from: 90, text: 'HPが1です。回復しましょう。' }] }, /page 0 starts at frame 90, at or after the end \(frame 90\)/);
  await bad({ subtitlePages: [{ from: 0, text: 'HPが1です。回復しましょう。', timing: 'exact' }] }, /page 0 timing must be 'manual', 'aligned', or 'approximate'/);
  await bad({ emphasis: [{ start: 14, end: 17, style: 'x' }] }, /line "danger": emphasis 0 \(14–17\) must cover at least one of the text's 15 grapheme clusters/);
  await bad({ emphasis: [{ start: 0, end: 3, style: {} }, { start: 2, end: 4, style: {} }] }, /line "danger": emphasis 1 \(2–4\) overlaps emphasis 0/);
  await bad({ text: h(Span, null, 'HP'), subtitlePages: [{ from: 0, text: 'HP' }] }, /line "danger": subtitlePages need the line's text as a string/);
  // Styles are the speaker's, so an unknown name fails where the line is drawn, naming it.
  const { at } = await series([{ ...danger, emphasis: [{ start: 0, end: 2, style: 'shout' }] }]);
  assert.throws(() => at(0), /line "danger": emphasis 0 names the unknown style "shout" \(known: none\)/);
});

test('pages with whitespace between them may leave it out; emoji and combining marks stay whole', async () => {
  const text = 'Hi 👨‍👩‍👧 there.\nCafé next.';
  const plan = await planDialogue([{
    id: 'mix', durationInFrames: 60, text,
    subtitlePages: [{ from: 0, text: 'Hi 👨‍👩‍👧 there.' }, { from: 30, text: 'Café next.' }],
    emphasis: [{ start: 3, end: 4, style: {} }, { start: 13, end: 17, style: {} }],
  }], { fps: 30 });
  assert.deepEqual(plan.line('mix').subtitlePages.map(({ start, stop, from, end, timing }) => [start, stop, from, end, timing]), [
    // 11 clusters (the family emoji is one), the `\n` left out, then 10 (é is one).
    [0, 11, 0, 30, 'manual'],
    [12, 22, 30, 60, 'manual'],
  ]);
});
