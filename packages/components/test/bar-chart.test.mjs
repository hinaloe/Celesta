import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import * as React from 'react';

import { Composition, Easings, Sequence, Theme } from '@celesta/react';
import { mount } from '@celesta/react/internal';
import { BarChart, Ranking, formatNumber } from '../dist/index.js';
import { installStubMeasurer } from './text-metrics-stub.mjs';

const h = React.createElement;

beforeEach(() => {
  installStubMeasurer();
});

function render(element, { theme } = {}) {
  const composition = mount(() => h(Composition, { width: 1920, height: 1080, fps: 30, durationInFrames: 300 },
    theme ? h(Theme, theme, element) : element));
  return (frame = 0) => composition.renderAt({ value: frame, timescale: 30 }, null).scene.layers;
}

/** Each row's group, label, note, bar, track, rank, and value. */
function rows(chart) {
  return chart.content.layers.map((row) => {
    const layers = row.content.layers;
    const label = layers.find((layer) => layer.content.type === 'group');
    const texts = layers.filter((layer) => layer.content.type === 'text');
    const rects = layers.filter((layer) => layer.content.type === 'rect');
    return {
      row, label, labelText: label.content.layers[0], note: label.content.layers[1],
      track: rects.length === 2 ? rects[0] : rects.find((rect) => rect.content.width === undefined),
      bar: rects.length === 2 ? rects[1] : rects[0], rects,
      rank: texts.length === 2 ? texts[0] : undefined, value: texts[texts.length - 1],
    };
  });
}

// 10 px per character and a 25 px line box for labels and values, 8 px and
// 20 px for notes; linear timing so progress is easy to read.
const base = {
  width: 400, labelGap: 20, valueGap: 10, barHeight: 20, durationInFrames: 10, easing: (t) => t, fadeInFrames: 0,
  labelStyle: { fontSize: 20 }, valueStyle: { fontSize: 20 }, noteStyle: { fontSize: 16 },
};
const data = [{ id: 'a', label: 'A', value: 100 }, { id: 'b', label: 'BB', value: 50 }];

test('rows lay out a label column, bars scaled to the largest value, and values past the bar ends', () => {
  const draw = render(h(BarChart, { ...base, data }));
  const [a, b] = rows(draw(5)[0]);
  // The label column is as wide as "BB", the value column as "100": the
  // bars start at 20 + 20 and have 400 - 40 - 30 - 10 = 320 px of room.
  assert.deepEqual(a.bar.transform.position, { x: 40, y: 2.5 });
  assert.deepEqual([a.bar.content.width, b.bar.content.width], [160, 80]);
  assert.deepEqual([a.value.content.text, b.value.content.text], ['50', '25']);
  assert.deepEqual(a.value.transform.position, { x: 210, y: 12.5 });
  assert.equal(a.value.transform.anchor.x, 0);
  assert.deepEqual([a.row.transform.position.y, b.row.transform.position.y], [0, 41]);
  const [aDone, bDone] = rows(draw(10)[0]);
  assert.deepEqual([aDone.bar.content.width, bDone.bar.content.width], [320, 160]);
  assert.deepEqual([aDone.value.content.text, bDone.value.content.text], ['100', '50']);
});

test('the bar length and the printed value come from the same progress', () => {
  const values = [{ id: 'x', value: 873 }, { id: 'y', value: 412.5 }];
  const draw = render(h(BarChart, { ...base, data: values, decimals: 1, easing: Easings.easeOutCubic, durationInFrames: 24 }));
  const track = 400 - 0 - 20 - 50 - 10;
  for (let frame = 0; frame <= 24; frame += 1) {
    rows(draw(frame)[0]).forEach(({ bar, value }, i) => {
      const progress = bar ? bar.content.width / (track * (values[i].value / 873)) : 0;
      assert.equal(value.content.text, formatNumber(values[i].value * progress, { decimals: 1 }), `frame ${frame} row ${i}`);
    });
  }
});

test('valuePosition right lines the values up at the chart\'s right edge', () => {
  const [a, b] = rows(render(h(BarChart, { ...base, data, valuePosition: 'right' }))(5)[0]);
  for (const { value } of [a, b]) {
    assert.deepEqual(value.transform.position, { x: 400, y: 12.5 });
    assert.equal(value.transform.anchor.x, 1);
  }
});

test('order sorts by value and keeps equal values in their given order; ids keep the rows', () => {
  const tied = [{ id: 'p', label: 'P', value: 5 }, { id: 'q', label: 'Q', value: 9 }, { id: 'r', label: 'R', value: 5 }];
  const labels = (order) => rows(render(h(BarChart, { ...base, data: tied, order }))(10)[0]).map((row) => row.labelText.content.text);
  assert.deepEqual(labels(undefined), ['P', 'Q', 'R']);
  assert.deepEqual(labels('input'), ['P', 'Q', 'R']);
  assert.deepEqual(labels('descending'), ['Q', 'P', 'R']);
  assert.deepEqual(labels('ascending'), ['P', 'R', 'Q']);
  assert.throws(() => render(h(BarChart, { ...base, data: tied, order: 'random' }))(), /<BarChart> order must be/);
});

test('a value of 0 draws no bar, and so does a chart whose values are all 0', () => {
  const [zero, some] = rows(render(h(BarChart, { ...base, data: [{ id: 'z', value: 0 }, { id: 's', value: 10 }] }))(10)[0]);
  assert.equal(zero.rects.length, 0);
  assert.equal(zero.value.content.text, '0');
  // No labels, and "10" is 20 px: 400 - 20 - 20 - 10.
  assert.equal(some.bar.content.width, 350);
  const all = rows(render(h(BarChart, { ...base, data: [{ id: 'z', value: 0 }, { id: 'y', value: 0 }] }))(10)[0]);
  assert.deepEqual(all.map((row) => [row.rects.length, row.value.content.text]), [[0, '0'], [0, '0']]);
  const maxZero = rows(render(h(BarChart, { ...base, data, max: 0 }))(10)[0]);
  assert.deepEqual(maxZero.map((row) => [row.rects.length, row.value.content.text]), [[0, '100'], [0, '50']]);
});

test('max sets the full length; larger values stop at it', () => {
  const [a, b] = rows(render(h(BarChart, { ...base, data, max: 80 }))(10)[0]);
  assert.deepEqual([a.bar.content.width, b.bar.content.width], [320, 200]);
  assert.equal(a.value.content.text, '100');
});

test('empty data draws nothing', () => {
  const [chart] = render(h(BarChart, { ...base, data: [] }))(10);
  assert.deepEqual(chart.content.layers, []);
});

test('negative, missing, and non-finite values and duplicate ids throw, naming the item', () => {
  const cases = [
    [[{ id: 'n', value: -1 }], /<BarChart> item "n" value must be 0 or more, not -1/],
    [[{ id: 'm', value: Number.NaN }], /<BarChart> item "m" value must be a finite number, not NaN/],
    [[{ id: 'u' }], /<BarChart> item "u" value must be a finite number, not undefined/],
    [[{ id: 'i', value: Infinity }], /<BarChart> item "i" value must be a finite number, not Infinity/],
    [[{ id: 'd', value: 1 }, { id: 'd', value: 2 }], /<BarChart> id "d" is used by more than one item/],
    [[{ id: '', value: 1 }], /<BarChart> every item needs a non-empty string id/],
  ];
  for (const [items, message] of cases) {
    assert.throws(() => render(h(BarChart, { ...base, data: items }))(), message, JSON.stringify(items));
  }
  assert.throws(() => render(h(BarChart, { ...base, data, width: -1 }))(), /<BarChart> width must be/);
  assert.throws(() => render(h(BarChart, { ...base, data, max: Number.NaN }))(), /<BarChart> max must be/);
});

test('a given labelWidth cuts a longer label off at the column', () => {
  const long = [{ id: 'l', label: 'A very long label that does not fit', value: 1 }];
  const [row] = rows(render(h(BarChart, { ...base, data: long, labelWidth: 120 }))(10)[0]);
  assert.deepEqual(row.label.content.clip, { x: 0, y: 0, width: 120, height: 25, cornerRadius: 0 });
  assert.equal(row.bar.transform.position.x, 140);
  const [measured] = rows(render(h(BarChart, { ...base, data: long }))(10)[0]);
  assert.equal(measured.label.content.clip, undefined);
});

test('notes sit under the labels and the row grows to hold both', () => {
  const noted = [{ id: 'a', label: 'A', note: 'a long note', value: 1 }, { id: 'b', label: 'B', value: 2 }];
  const [a, b] = rows(render(h(BarChart, { ...base, data: noted }))(10)[0]);
  // A 25 px label, 6 px, and a 20 px note: rows are 51 px; the column is the note's 88 px.
  assert.equal(b.row.transform.position.y, 67);
  assert.deepEqual([a.labelText.transform.position.y, a.note.transform.position.y], [20, 47]);
  assert.equal(a.note.content.text, 'a long note');
  assert.equal(b.note, undefined);
  assert.equal(a.bar.transform.position.x, 108);
  assert.equal(a.bar.transform.position.y, 15.5);
});

test('rows start a stagger apart and fade in from their start', () => {
  const draw = render(h(BarChart, { ...base, data, delay: 4, stagger: 6, fadeInFrames: 4 }));
  const at = (frame) => rows(draw(frame)[0]).map((row) => [row.row.opacity ?? 1, row.value.content.text]);
  assert.deepEqual(at(4), [[0, '0'], [0, '0']]);
  assert.deepEqual(at(6), [[0.5, '20'], [0, '0']]);
  assert.deepEqual(at(12), [[1, '80'], [0.5, '10']]);
  assert.deepEqual(at(20), [[1, '100'], [1, '50']]);
});

test('colors take <Theme> names, per item for the bar and, over the styles\' fill, the text', () => {
  const colored = [{ id: 'a', label: 'A', value: 1, color: 'hot', textColor: 'hot' }, { id: 'b', label: 'B', value: 1 }];
  const ink = { type: 'solid', color: '#F4F1EA' };
  const [a, b] = rows(render(h(BarChart, {
    ...base, data: colored, barColor: 'calm', trackColor: 'line',
    labelStyle: { ...base.labelStyle, fill: ink }, valueStyle: { ...base.valueStyle, fill: ink },
  }), { theme: { colors: { hot: '#FF4D1F', calm: '#4F8CFF', line: '#FFFFFF14' } } })(10)[0]);
  assert.equal(a.bar.content.fill.color, '#FF4D1F');
  assert.equal(b.bar.content.fill.color, '#4F8CFF');
  assert.equal(a.track.content.fill.color, '#FFFFFF14');
  assert.equal(a.labelText.content.style.fill.color, '#FF4D1F');
  assert.equal(a.value.content.style.fill.color, '#FF4D1F');
  assert.equal(b.labelText.content.style.fill.color, '#F4F1EA');
  assert.equal(b.value.content.style.fill.color, '#F4F1EA');
  // Colors are checked before any bar has length.
  assert.throws(() => render(h(BarChart, { ...base, data, barColor: 'nope' }))(0), /<BarChart> barColor "nope"/);
  assert.throws(() => render(h(BarChart, { ...base, data: [{ id: 'x', value: 1, textColor: 'nope' }] }))(0), /<BarChart> textColor of "x" "nope"/);
});

test('a Ranking adds ranks by position after sorting, with its order spelled out', () => {
  const scores = [{ id: 'x', label: 'X', value: 3 }, { id: 'y', label: 'Y', value: 7 }, { id: 'z', label: 'Z', value: 7 }];
  const draw = (props) => rows(render(h(Ranking, { ...base, data: scores, ...props }))(10)[0]);
  const ranked = draw({ order: 'descending', formatRank: (rank) => String(rank).padStart(2, '0') });
  assert.deepEqual(ranked.map((row) => [row.rank.content.text, row.labelText.content.text]), [['01', 'Y'], ['02', 'Z'], ['03', 'X']]);
  // "01" is 20 px wide and the rank gap 24: the labels start at 44.
  assert.deepEqual(ranked[0].rank.transform.position, { x: 20, y: 12.5 });
  assert.equal(ranked[0].rank.transform.anchor.x, 1);
  assert.equal(ranked[0].label.transform.position.x, 44);
  assert.equal(ranked[0].bar.transform.position.x, 44 + 10 + 20);
  const input = draw({ order: 'input', rankWidth: 40, rankGap: 10 });
  assert.deepEqual(input.map((row) => [row.rank.content.text, row.labelText.content.text]), [['1', 'X'], ['2', 'Y'], ['3', 'Z']]);
  assert.equal(input[0].label.transform.position.x, 50);
  assert.throws(() => render(h(Ranking, { ...base, data: scores }))(), /<Ranking> order is required/);
});

test('a chart seeks to the same frame it plays to, inside a nested Sequence', () => {
  const scene = h(Sequence, { from: 10 }, h(Sequence, { from: 5 }, h(Ranking, { ...base, data, order: 'descending', stagger: 3, fadeInFrames: 5 })));
  const played = render(scene);
  for (let frame = 0; frame <= 40; frame += 1) played(frame);
  assert.deepEqual(played(40), render(scene)(40));
  assert.deepEqual(played(22), render(scene)(22));
});
