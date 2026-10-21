// Types and helpers the tests share.

import assert from 'node:assert/strict';

import type { Layer, LayerContent, Paint, Scene } from '../src/index.js';
import type { AudioClipDescriptor, SubtitleDescriptor } from '../src/internal.js';

/** The content of a layer of type `T`. */
export type Content<T extends LayerContent['type']> = Extract<LayerContent, { type: T }>;

/** `layer`'s content, checked to be of `type`. */
export function contentOf<T extends LayerContent['type']>(layer: Layer | undefined, type: T): Content<T> {
  assert.ok(layer, `a ${type} layer`);
  assert.equal(layer.content.type, type);
  return layer.content as Content<T>;
}

/** The color of a solid paint. */
export function colorOf(paint: Paint | null | undefined): string {
  assert.ok(paint && paint.type === 'solid', 'a solid paint');
  return paint.color;
}

/** The layers of a group layer. */
export const childrenOf = (layer: Layer | undefined): Layer[] => contentOf(layer, 'group').layers;

/**
 * A line `celesta-react-render` answers a frame request with. When evaluating
 * the frame failed, it holds only `error`; the tests read the field they
 * expect.
 */
export interface FrameResponse {
  scene: Scene;
  audio: AudioClipDescriptor[];
  subtitles?: SubtitleDescriptor[];
  error?: string;
}

/**
 * One of the CLI's output lines, as the answer to a frame request. The CLI
 * starts with a handshake line, which the tests skip unread.
 */
export const parseLine = (line: string): FrameResponse => JSON.parse(line);
