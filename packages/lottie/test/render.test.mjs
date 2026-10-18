// `<Lottie>` through the CLI: the scene it draws, scrubbing, timing, and
// warnings.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const cli = fileURLToPath(new URL('../../cli/bin/celesta-react-render.js', import.meta.url));
const demo = fileURLToPath(new URL('../../../examples/assets/lottie/demo.json', import.meta.url));

/**
 * Renders `frames` (composition frames, in that order) of a 30 fps
 * composition whose body is `body`, with `animation` imported from `data`.
 * Returns the frame lines and stderr.
 */
function render(body, { frames = [0], data = demo, allowFailure = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'celesta-lottie-'));
  const entry = join(dir, 'entry.tsx');
  let source = data;
  if (typeof data !== 'string') {
    source = join(dir, 'animation.json');
    writeFileSync(source, JSON.stringify(data));
  }
  writeFileSync(
    entry,
    `import { Composition } from '@celesta/react'; import { Lottie } from '@celesta/lottie';\n` +
      `import animation from ${JSON.stringify(source)};\n` +
      `export default function Root() {\n` +
      `  return <Composition width={480} height={270} fps={30} durationInFrames={600}>${body}</Composition>;\n` +
      `}\n`,
  );
  try {
    const result = spawnSync(process.execPath, [cli, entry], {
      input: frames.map(frame => `{"time":{"value":${frame},"timescale":30}}\n`).join(''),
      encoding: 'utf8',
    });
    if (allowFailure && result.status !== 0) {
      return { error: result.stdout + result.stderr };
    }
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const [, ...lines] = result.stdout.split(/\r?\n/).filter(Boolean).map(JSON.parse);
    return { frames: lines, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every layer below `layers`, depth first, masks included. */
function* walk(layers) {
  for (const layer of layers) {
    yield layer;
    if (layer.content.type === 'group') {
      yield* walk(layer.content.layers);
      if (layer.content.mask) {
        yield* walk(layer.content.mask.layers);
      }
    }
  }
}

test('scrubbing to a frame draws what playing up to it draws', () => {
  const { frames } = render('<Lottie data={animation} />', { frames: [0, 10, 20, 37, 20, 37, 5] });
  const [, , twenty, thirtySeven, twentyAgain, thirtySevenAgain] = frames;
  assert.deepEqual(twentyAgain.scene.layers, twenty.scene.layers);
  assert.deepEqual(thirtySevenAgain.scene.layers, thirtySeven.scene.layers);
  assert.notDeepEqual(twenty.scene.layers, thirtySeven.scene.layers);
});

test('the animation loops at its end, or holds its last frame', () => {
  // demo.json is 90 frames at 30 fps: 3 s.
  const looped = render('<Lottie data={animation} />', { frames: [12, 102] }).frames;
  assert.deepEqual(looped[1].scene.layers, looped[0].scene.layers);
  const held = render('<Lottie data={animation} loop={false} />', { frames: [89, 120, 300] }).frames;
  assert.deepEqual(held[1].scene.layers, held[0].scene.layers);
  assert.deepEqual(held[2].scene.layers, held[0].scene.layers);
  const ranged = render('<Lottie data={animation} startFrame={30} endFrame={60} playbackRate={2} />', { frames: [0, 15] }).frames;
  assert.deepEqual(ranged[1].scene.layers, ranged[0].scene.layers);
});

test('the box is the file\'s size, clipped, and scales to `width` and `height`', () => {
  const [frame] = render('<Lottie data={animation} x={100} y={50} width={240} />').frames;
  const [outer] = frame.scene.layers;
  assert.deepEqual(outer.transform.position, { x: 100, y: 50 });
  const [inner] = outer.content.layers;
  assert.deepEqual(inner.transform.scale, { x: 0.5, y: 0.5 });
  assert.deepEqual(inner.content.clip, { x: 0, y: 0, width: 480, height: 270, cornerRadius: 0 });
  const [centred] = render('<Lottie data={animation} x={240} y={135} anchorX={0.5} anchorY={0.5} />').frames;
  assert.deepEqual(centred.scene.layers[0].content.layers[0].transform.position, { x: -240, y: -135 });
});

test('masks, track mattes, and precompositions become group masks and clips', () => {
  const [frame] = render('<Lottie data={animation} />', { frames: [30] }).frames;
  const layers = [...walk(frame.scene.layers)];
  const masked = layers.filter(layer => layer.content.type === 'group' && layer.content.mask);
  // The card's add-then-subtract masks, and the bars' matte.
  assert.ok(masked.some(layer => layer.content.mask.invert === true), 'a subtract mask is an inverted mask');
  const clipped = layers.filter(layer => layer.content.type === 'group' && layer.content.clip?.width === 480);
  assert.ok(clipped.length >= 2, 'the root box and the precomposition clip');
  const gradients = layers.filter(layer => layer.content.type === 'path' && layer.content.fill?.type === 'linear');
  assert.equal(gradients.length, 3);
  const strokes = layers.filter(layer => layer.content.type === 'path' && layer.content.stroke);
  assert.ok(strokes.some(layer => layer.content.lineCap === 'round'), 'the ring\'s round caps');
});

test('a trim path cuts the stroke it comes before', () => {
  const ring = (frames) => render('<Lottie data={animation} />', { frames }).frames
    .map(frame => [...walk(frame.scene.layers)].find(layer => layer.content.stroke?.paint?.color === '#4DD8C0FF'));
  const [start, middle] = ring([0, 20]);
  assert.equal(start, undefined, 'nothing is drawn at a trim of 0–0');
  assert.ok(middle.content.commands.length > 0);
  assert.notEqual(middle.content.commands.at(-1).type, 'close', 'a partly trimmed ring ends open');
});

test('unsupported features warn once and the rest still draws', () => {
  const data = {
    v: '5.12.1', fr: 30, ip: 0, op: 30, w: 100, h: 100,
    layers: [
      { ty: 5, nm: 'Title', ip: 0, op: 30, ks: {} },
      { ty: 1, nm: 'Back', ip: 0, op: 30, sc: '#ff0000', sw: 100, sh: 100, ks: {} },
    ],
  };
  const { frames, stderr } = render('<Lottie data={animation} />', { data, frames: [0, 1, 2] });
  assert.equal(stderr.match(/does not support text layers \(layer "Title"\)/g)?.length, 1, stderr);
  const rects = [...walk(frames[0].scene.layers)].filter(layer => layer.content.type === 'rect');
  assert.equal(rects.length, 1);
  assert.equal(rects[0].content.width, 100);
});

test('data that is not a Lottie animation fails with a clear message', () => {
  const { error } = render('<Lottie data={animation} />', { data: { layers: [] }, allowFailure: true });
  assert.match(error, /data\.fr` must be a positive number/);
});
