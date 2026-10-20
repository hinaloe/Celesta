import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import * as React from 'react';

import { Composition, Group, Rect, Sequence, Theme } from '@celesta/react';
import { mount } from '@celesta/react/internal';
import { Callout } from '../dist/index.js';
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

const points = (layer) => layer.content.commands.filter((c) => c.type !== 'close').map((c) => [c.x, c.y]);

/** The Callout's group, its connector paths (line first, arrow last), and the box. */
function parts(callout) {
  const layers = callout.content.layers;
  const paths = layers.filter((layer) => layer.content.type === 'path');
  const box = layers.find((layer) => layer.content.type === 'group');
  const background = box.content.layers.find((layer) => layer.content.type === 'rect');
  const content = box.content.layers.find((layer) => layer.content.type === 'group');
  return { paths, box, background, texts: content.content.layers };
}

/** Whether the arrowhead outline has its tip at `[x, y]`. */
const tipAt = (arrow, [x, y]) => points(arrow).some(([px, py]) => Math.abs(px - x) < 1e-9 && Math.abs(py - y) < 1e-9);

// The stub measures 20 px text as 10 px a character on a 25 px line box,
// 28 px text as 14 px on a 35 px line box.
const box = { x: 400, y: 300, width: 200, padding: 20, title: 'Title', titleStyle: { fontSize: 20 }, fill: '#182030' };
// 20 + 25 + 20: the box is 200 × 65, from (400, 300) to (600, 365).

test('the box is the measured title and text inside the padding, as tall as they are', () => {
  const [callout] = render(h(Callout, {
    ...box, target: { x: 100, y: 330 }, text: 'Body', textStyle: { fontSize: 20 }, gap: 10, color: '#ffffff',
  }))();
  const { background, box: panel, texts } = parts(callout);
  // 20 + 25 + 10 + 25 + 20.
  assert.deepEqual([background.content.width, background.content.height], [200, 100]);
  assert.deepEqual(panel.transform.position, { x: 400, y: 300 });
  assert.deepEqual(texts.map((t) => [t.content.text, t.transform.position.y, t.content.maxWidth]), [['Title', 20, 160], ['Body', 55, 160]]);
  assert.ok(texts.every((t) => t.content.baselineAnchor && t.content.style.fill.color === '#ffffff'));
});

test('with side auto the line leaves the middle of the edge facing the target, on each side', () => {
  const cases = [
    [{ x: 100, y: 330 }, [400, 332.5]],
    [{ x: 900, y: 400 }, [600, 332.5]],
    [{ x: 450, y: 50 }, [500, 300]],
    [{ x: 560, y: 700 }, [500, 365]],
  ];
  for (const [target, start] of cases) {
    const { paths } = parts(render(h(Callout, { ...box, target }))()[0]);
    assert.equal(paths.length, 1, JSON.stringify(target));
    const arrow = paths[0];
    assert.ok(tipAt(arrow, [target.x, target.y]), `tip at ${JSON.stringify(target)}`);
    // The shaft starts half a line width either side of the edge's middle.
    const [sx, sy] = points(arrow)[0];
    assert.ok(Math.hypot(sx - start[0], sy - start[1]) <= 1 + 1e-9, `${JSON.stringify(target)}: ${sx}, ${sy}`);
  }
});

test('auto picks the edge the target is furthest outside of', () => {
  // 50 left of the box and 300 below it: below wins.
  const { paths } = parts(render(h(Callout, { ...box, target: { x: 350, y: 665 }, head: 'none' }))()[0]);
  assert.deepEqual(points(paths[0]), [[500, 365], [350, 665]]);
});

test('a named side overrides the facing one', () => {
  const { paths } = parts(render(h(Callout, { ...box, target: { x: 350, y: 665 }, side: 'left', head: 'none' }))()[0]);
  assert.deepEqual(points(paths[0]), [[400, 332.5], [350, 665]]);
});

test('an elbow goes out of the edge and turns once, the arrow on the last segment', () => {
  const across = parts(render(h(Callout, { ...box, target: { x: 900, y: 700 }, side: 'right', route: 'elbow' }))()[0]);
  assert.equal(across.paths.length, 2);
  assert.deepEqual(points(across.paths[0]), [[600, 332.5], [900, 332.5]]);
  assert.ok(tipAt(across.paths[1], [900, 700]));
  const down = parts(render(h(Callout, { ...box, target: { x: 100, y: 700 }, side: 'bottom', route: 'elbow', head: 'none' }))()[0]);
  assert.deepEqual(points(down.paths[0]), [[500, 365], [500, 700], [100, 700]]);
});

test('an elbow whose turn falls on the target is one straight segment', () => {
  const { paths } = parts(render(h(Callout, { ...box, target: { x: 900, y: 332.5 }, side: 'right', route: 'elbow', head: 'none' }))()[0]);
  assert.deepEqual(points(paths[0]), [[600, 332.5], [900, 332.5]]);
});

test('the anchor places the box by its measured size and leaves the target end where it is', () => {
  const { box: panel, paths } = parts(render(h(Callout, {
    ...box, x: 400, y: 332.5, anchorY: 0.5, padding: { left: 12 }, target: { x: 400, y: 600 }, side: 'left', head: 'none',
  }))()[0]);
  // 25 px tall with no vertical padding: its left middle is at (400, 332.5).
  assert.deepEqual(panel.transform.position, { x: 400, y: 320 });
  assert.deepEqual(points(paths[0]), [[400, 332.5], [400, 600]]);
  const centred = parts(render(h(Callout, { ...box, x: 500, y: 0, anchorX: 0.5, target: { x: 500, y: 300 } }))()[0]);
  assert.deepEqual(centred.box.transform.position, { x: 400, y: 0 });
});

test('a target inside the box draws no line', () => {
  const { paths } = parts(render(h(Callout, { ...box, target: { x: 450, y: 320 } }))()[0]);
  assert.equal(paths.length, 0);
  const named = parts(render(h(Callout, { ...box, target: { x: 450, y: 320 }, side: 'top' }))()[0]);
  assert.equal(named.paths.length, 0);
});

test('long text wraps, the box grows taller, and the line leaves the middle of the taller edge', () => {
  const long = 'a'.repeat(40);
  const { background, texts, paths } = parts(render(h(Callout, {
    ...box, target: { x: 100, y: 330 }, text: long, textStyle: { fontSize: 20 }, head: 'none',
  }))()[0]);
  // 160 px of room is 16 characters a line: 40 of them take 3 lines.
  assert.equal(texts[1].content.maxWidth, 160);
  const height = 20 + 25 + 8 + 75 + 20;
  assert.equal(background.content.height, height);
  assert.deepEqual(points(paths[0])[0], [400, 300 + height / 2]);
});

test('title-only and text-only boxes hold one line', () => {
  const titled = parts(render(h(Callout, { ...box, target: { x: 0, y: 0 } }))()[0]);
  assert.deepEqual(titled.texts.map((t) => t.content.text), ['Title']);
  const texted = parts(render(h(Callout, { ...box, title: undefined, text: 'Only', textStyle: { fontSize: 20 }, target: { x: 0, y: 0 } }))()[0]);
  assert.deepEqual(texted.texts.map((t) => [t.content.text, t.transform.position.y]), [['Only', 20]]);
  assert.equal(texted.background.content.height, 65);
});

test('lineProgress draws the line from the target towards the box', () => {
  const draw = (lineProgress, extra = {}) => parts(render(h(Callout, { ...box, target: { x: 100, y: 332.5 }, side: 'left', head: 'none', lineProgress, ...extra }))()[0]).paths;
  assert.deepEqual(points(draw(0.25)[0]), [[175, 332.5], [100, 332.5]]);
  assert.equal(draw(0).length, 0);
  // An elbow 300 + 200 long, three fifths drawn: the last segment and 100 of the first.
  const elbow = draw(0.6, { target: { x: 100, y: 532.5 }, route: 'elbow' });
  assert.deepEqual(points(elbow[0]), [[200, 332.5], [100, 332.5], [100, 532.5]]);
});

test('a callout in a transformed group stays on a target in the same group', () => {
  const [group] = render(h(Group, { x: 300, y: 100, scale: 1.5, rotation: 20 },
    h(Rect, { x: 120, y: 640, width: 4, height: 4 }),
    h(Callout, { ...box, target: { x: 122, y: 642 } })))();
  const [marker, callout] = group.content.layers;
  assert.deepEqual(callout.transform.position, { x: 0, y: 0 });
  assert.deepEqual(callout.transform.scale, { x: 1, y: 1 });
  assert.equal(callout.transform.rotation, 0);
  const [arrow] = parts(callout).paths;
  assert.ok(tipAt(arrow, [marker.transform.position.x + 2, marker.transform.position.y + 2]));
});

test('an animated target and box are followed frame by frame', () => {
  function Moving() {
    const frame = React.useContext(FrameContext);
    return h(Callout, { ...box, x: 400 + frame * 10, target: { x: 100, y: 330 + frame * 5 }, head: 'none' });
  }
  const FrameContext = React.createContext(0);
  const at = (frame) => parts(mount(() => h(Composition, { width: 1920, height: 1080, fps: 30, durationInFrames: 30 },
    h(FrameContext.Provider, { value: frame }, h(Moving)))).renderAt({ value: 0, timescale: 30 }, null).scene.layers[0]).paths[0];
  assert.deepEqual(points(at(0)), [[400, 332.5], [100, 330]]);
  assert.deepEqual(points(at(4)), [[440, 332.5], [100, 350]]);
});

test('colors take <Theme> names, and the line has its own color and width', () => {
  const [callout] = render(h(Callout, {
    ...box, fill: 'surface', stroke: 'line', strokeWidth: 1, color: 'ink', lineColor: 'accent', lineWidth: 4, target: { x: 100, y: 330 }, head: 'none',
  }), { theme: { colors: { surface: '#101820', line: '#334455', ink: '#FAFAFA', accent: '#FF4D1F' } } })();
  const { paths, background, texts } = parts(callout);
  assert.equal(background.content.fill.color, '#101820');
  assert.equal(texts[0].content.style.fill.color, '#FAFAFA');
  assert.deepEqual([paths[0].content.stroke.paint.color, paths[0].content.stroke.width], ['#FF4D1F', 4]);
});

test('bad points, sizes, and options throw', () => {
  const cases = [
    [{ target: { x: Number.NaN, y: 0 } }, /<Callout> target.x must be a finite number/],
    [{ target: undefined }, /<Callout> target must be a point/],
    [{ target: { x: 0, y: 0 }, x: Infinity }, /<Callout> x must be a finite number/],
    [{ target: { x: 0, y: 0 }, width: -1 }, /<Callout> width must be/],
    [{ target: { x: 0, y: 0 }, side: 'inside' }, /<Callout> side must be/],
    [{ target: { x: 0, y: 0 }, route: 'curve' }, /<Callout> route must be 'straight' or 'elbow'/],
    [{ target: { x: 0, y: 0 }, head: 'dot' }, /<Callout> head must be 'arrow' or 'none'/],
    [{ target: { x: 0, y: 0 }, lineWidth: 0 }, /<Callout> lineWidth must be more than 0/],
    [{ target: { x: 0, y: 0 }, lineProgress: 1.5 }, /<Callout> lineProgress must be from 0 to 1/],
    [{ target: { x: 0, y: 0 }, lineColor: 'nope' }, /<Callout> lineColor "nope"/],
  ];
  for (const [props, message] of cases) {
    assert.throws(() => render(h(Callout, { ...box, ...props }))(), message, JSON.stringify(props));
  }
});

test('a callout renders the same on a seek as when played up to it, inside a nested Sequence', () => {
  const scene = h(Sequence, { from: 10 }, h(Sequence, { from: 5 },
    h(Callout, { ...box, target: { x: 100, y: 700 }, route: 'elbow', text: 'Body' })));
  const played = render(scene);
  for (let frame = 0; frame <= 30; frame += 1) played(frame);
  assert.deepEqual(played(30), render(scene)(30));
});
