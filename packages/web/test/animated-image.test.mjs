import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild-wasm';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { animatableType, animationFrame, decodeAnimatedImage, frameDurationMicros } from '../src/animated-image.ts';

const directory = mkdtempSync(fileURLToPath(new URL('../node_modules/.animated-test-', import.meta.url)));
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/scene-canvas.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const modulePath = join(directory, 'canvas.mjs');
writeFileSync(modulePath, result.outputFiles[0].text);
const { SceneCanvas } = await import(pathToFileURL(modulePath));
rmSync(directory, { recursive: true });

// The same cases as celesta-renderer's `picks_the_frame_showing_at_a_time`.
test('picks the frame showing at a time, as the Rust renderer does', () => {
  const ends = [100_000, 300_000, 400_000];
  const frame = (seconds, loop) => animationFrame(ends, seconds, loop);
  assert.equal(frame(0, false), 0);
  assert.equal(frame(0.0999, false), 0);
  assert.equal(frame(0.1, false), 1);
  assert.equal(frame(0.35, false), 2);
  assert.equal(frame(0.4, true), 0);
  assert.equal(frame(0.45, true), 0);
  assert.equal(frame(0.75, true), 2);
  assert.equal(frame(0.4, false), 2);
  assert.equal(frame(10, false), 2);
  for (const before of [-1, NaN, -Infinity]) assert.equal(frame(before, true), 0);
  assert.equal(animationFrame([], 1, true), 0);
  assert.equal(animationFrame([0, 0], 1, false), 0);
});

test('short delays show for 100 ms, as browsers show them', () => {
  assert.equal(frameDurationMicros(0), 100_000);
  assert.equal(frameDurationMicros(10_000), 100_000);
  assert.equal(frameDurationMicros(20_000), 20_000);
});

test('only GIF, PNG, and WebP can animate', () => {
  const bytes = text => new Uint8Array([...text].map(c => c.charCodeAt(0)));
  assert.equal(animatableType(bytes('GIF89a')), 'image/gif');
  assert.equal(animatableType(new Uint8Array([0x89, ...bytes('PNG\r\n')])), 'image/png');
  assert.equal(animatableType(bytes('RIFF\0\0\0\0WEBPVP8X')), 'image/webp');
  assert.equal(animatableType(bytes('\xff\xd8\xff\xe0')), undefined);
});

/** An `ImageDecoder` stand-in for frames of the given durations (µs). */
function mockDecoder(t, durations, { animated = true } = {}) {
  const closed = [];
  const originals = { ImageDecoder: globalThis.ImageDecoder, createImageBitmap: globalThis.createImageBitmap };
  t.after(() => Object.assign(globalThis, originals));
  globalThis.ImageDecoder = class {
    static async isTypeSupported(type) { return type === 'image/gif'; }
    constructor({ type }) {
      this.type = type;
      const track = { animated, frameCount: durations.length };
      this.tracks = { ready: Promise.resolve(), selectedTrack: track };
      this.completed = Promise.resolve();
    }
    async decode({ frameIndex }) {
      return { image: { frameIndex, duration: durations[frameIndex], close() { closed.push(frameIndex); } } };
    }
    close() { closed.push('decoder'); }
  };
  globalThis.createImageBitmap = async image => ({ frame: image.frameIndex, width: 30, height: 10, close() {} });
  return closed;
}

const gif = () => new Uint8Array([...'GIF89a'].map(c => c.charCodeAt(0))).buffer;

test('decodes every frame with its delay, and nothing for a still image', async t => {
  const closed = mockDecoder(t, [50_000, 0, 20_000]);
  const animation = await decodeAnimatedImage(gif());
  assert.deepEqual(animation.frames.map(frame => frame.frame), [0, 1, 2]);
  assert.deepEqual(animation.ends, [50_000, 150_000, 170_000]);
  assert.deepEqual(closed, [0, 1, 2, 'decoder']);
  mockDecoder(t, [50_000], { animated: false });
  assert.equal(await decodeAnimatedImage(gif()), undefined);
  assert.equal(await decodeAnimatedImage(new Uint8Array([0xff, 0xd8]).buffer), undefined);
});

test('an animated image layer draws the frame at its source time', async t => {
  mockDecoder(t, [50_000, 50_000, 100_000]);
  const originals = { document: globalThis.document, DOMMatrix: globalThis.DOMMatrix, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, originals));
  globalThis.DOMMatrix = class { translate() { return this; } rotate() { return this; } scale() { return this; } };
  t.mock.method(globalThis, 'fetch', async () => new Response(gif()));
  const drawn = [];
  const canvas = () => {
    const element = { width: 30, height: 10, getContext() { return context; } };
    const context = {
      canvas: element, globalAlpha: 1, filter: 'none', globalCompositeOperation: 'source-over',
      save() {}, restore() {}, setTransform() {}, fillRect() {}, beginPath() {}, rect() {}, clip() {},
      drawImage(source, x, y, width, height) { drawn.push([source.frame, width, height]); },
    };
    return element;
  };
  globalThis.document = { fonts: new Set(), createElement: canvas };
  const renderer = new SceneCanvas(new Map(), 'https://media.test/');
  const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0, y: 0 }, rotation: 0 };
  const draw = async animation => {
    drawn.length = 0;
    const content = { type: 'image', asset: { id: 'a.gif', location: { type: 'file', path: 'a.gif' } }, height: 20, animation };
    await renderer.draw(canvas(), { width: 30, height: 10, fonts: [], layers: [{ opacity: 1, transform, content }] });
    return drawn[0];
  };
  assert.deepEqual(await draw({ sourceTimeSeconds: 0, loop: true }), [0, 60, 20]);
  assert.deepEqual(await draw({ sourceTimeSeconds: 0.06, loop: true }), [1, 60, 20]);
  // 200 ms long: 0.25 s is 50 ms into the second pass, or the last frame held.
  assert.deepEqual(await draw({ sourceTimeSeconds: 0.25, loop: true }), [1, 60, 20]);
  assert.deepEqual(await draw({ sourceTimeSeconds: 0.25, loop: false }), [2, 60, 20]);
  assert.equal(globalThis.fetch.mock.callCount(), 1, 'frames are decoded once');
  renderer.dispose();
});
