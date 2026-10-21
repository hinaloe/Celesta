import assert from 'node:assert/strict';
import { onTestFinished, test, vi } from 'vitest';
import { animatableType, animationFrame, decodeAnimatedImage, frameDurationMicros } from '../src/animated-image';
import { SceneCanvas } from '../src/scene-canvas';
import type { Layer, Transform } from '../src/types';
import { still } from './scenes.mjs';
import { fetchStub, standIn } from './stand-in.mjs';

// The same cases as celesta-renderer's `picks_the_frame_showing_at_a_time`.
test('picks the frame showing at a time, as the Rust renderer does', () => {
  const ends = [100_000, 300_000, 400_000];
  const frame = (seconds: number, loop: boolean) => animationFrame(ends, seconds, loop);
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
  const bytes = (text: string) => new Uint8Array([...text].map(c => c.charCodeAt(0)));
  assert.equal(animatableType(bytes('GIF89a')), 'image/gif');
  assert.equal(animatableType(new Uint8Array([0x89, ...bytes('PNG\r\n')])), 'image/png');
  assert.equal(animatableType(bytes('RIFF\0\0\0\0WEBPVP8X')), 'image/webp');
  assert.equal(animatableType(bytes('\xff\xd8\xff\xe0')), undefined);
});

/** A decoded frame of `mockDecoder`, and the bitmap made of it. */
type Frame = { frameIndex: number; duration: number; close(): void };
type Bitmap = { frame: number; width: number; height: number; close(): void };

/** An `ImageDecoder` stand-in for frames of the given durations (µs). */
function mockDecoder(durations: number[], { animated = true } = {}) {
  const closed: (number | 'decoder')[] = [];
  const originals = { ImageDecoder: globalThis.ImageDecoder, createImageBitmap: globalThis.createImageBitmap };
  onTestFinished(() => { Object.assign(globalThis, originals); });
  globalThis.ImageDecoder = standIn(class {
    static async isTypeSupported(type: string) { return type === 'image/gif'; }
    type: string;
    tracks: { ready: Promise<void>; selectedTrack: { animated: boolean; frameCount: number } };
    completed: Promise<void>;
    constructor({ type }: ImageDecoderInit) {
      this.type = type;
      const track = { animated, frameCount: durations.length };
      this.tracks = { ready: Promise.resolve(), selectedTrack: track };
      this.completed = Promise.resolve();
    }
    async decode({ frameIndex }: { frameIndex: number }): Promise<{ image: Frame }> {
      return { image: { frameIndex, duration: durations[frameIndex], close() { closed.push(frameIndex); } } };
    }
    close() { closed.push('decoder'); }
  });
  globalThis.createImageBitmap = standIn(async (image: Frame): Promise<Bitmap> => ({ frame: image.frameIndex, width: 30, height: 10, close() {} }));
  return closed;
}

const gif = () => new Uint8Array([...'GIF89a'].map(c => c.charCodeAt(0))).buffer;

test('decodes every frame with its delay, and nothing for a still image', async () => {
  const closed = mockDecoder([50_000, 0, 20_000]);
  const animation = (await decodeAnimatedImage(gif()))!;
  assert.deepEqual(animation.frames.map(frame => standIn<Bitmap>(frame).frame), [0, 1, 2]);
  assert.deepEqual(animation.ends, [50_000, 150_000, 170_000]);
  assert.deepEqual(closed, [0, 1, 2, 'decoder']);
  mockDecoder([50_000], { animated: false });
  assert.equal(await decodeAnimatedImage(gif()), undefined);
  assert.equal(await decodeAnimatedImage(new Uint8Array([0xff, 0xd8]).buffer), undefined);
});

test('an animated image layer draws the frame at its source time', async () => {
  mockDecoder([50_000, 50_000, 100_000]);
  const originals = { document: globalThis.document, DOMMatrix: globalThis.DOMMatrix, fetch: globalThis.fetch };
  onTestFinished(() => { Object.assign(globalThis, originals); });
  globalThis.DOMMatrix = standIn(class { translate() { return this; } rotate() { return this; } scale() { return this; } });
  const fetchGif = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchStub(async () => new Response(gif())));
  const drawn: [number, number, number][] = [];
  const canvas = () => {
    const element = { width: 30, height: 10, getContext() { return context; } };
    const context = {
      canvas: element, globalAlpha: 1, filter: 'none', globalCompositeOperation: 'source-over',
      save() {}, restore() {}, setTransform() {}, fillRect() {}, beginPath() {}, rect() {}, clip() {},
      drawImage(source: Bitmap, x: number, y: number, width: number, height: number) { drawn.push([source.frame, width, height]); },
    };
    return element;
  };
  globalThis.document = standIn({ fonts: new Set(), createElement: canvas });
  const renderer = new SceneCanvas(new Map(), 'https://media.test/');
  const transform: Transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0, y: 0 }, rotation: 0 };
  type Image = Extract<Layer['content'], { type: 'image' }>;
  const draw = async (animation: Image['animation']) => {
    drawn.length = 0;
    const content: Image = { type: 'image', asset: { id: 'a.gif', location: { type: 'file', path: 'a.gif' } }, height: 20, animation };
    await renderer.draw(standIn(canvas()), still({ width: 30, height: 10, fonts: [], layers: [{ id: 'image', opacity: 1, transform, content }] }));
    return drawn[0];
  };
  assert.deepEqual(await draw({ sourceTimeSeconds: 0, loop: true }), [0, 60, 20]);
  assert.deepEqual(await draw({ sourceTimeSeconds: 0.06, loop: true }), [1, 60, 20]);
  // 200 ms long: 0.25 s is 50 ms into the second pass, or the last frame held.
  assert.deepEqual(await draw({ sourceTimeSeconds: 0.25, loop: true }), [1, 60, 20]);
  assert.deepEqual(await draw({ sourceTimeSeconds: 0.25, loop: false }), [2, 60, 20]);
  assert.equal(fetchGif.mock.calls.length, 1, 'frames are decoded once');
  renderer.dispose();
});
