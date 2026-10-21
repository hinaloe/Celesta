// The built-in stylize effects and the chroma key: the props, their
// defaults, and the noise's seed.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as React from 'react';
import type { ReactElement, ReactNode } from 'react';

import { Composition, FreezeFrame, Group, Image, MotionBlur, Rect, Sequence, Static, Text, Video } from '../src/index.js';
import { mount } from '../src/render.js';
import { builtinFilter } from '../src/internal.js';
import type { Layer, RectProps } from '../src/index.js';

import { childrenOf } from './helpers.mjs';

const h = React.createElement;

function scene(children: ReactNode, frame = 0) {
  const Root = () => h(Composition, { width: 16, height: 16, fps: 30, durationInFrames: 120 }, children);
  return mount(Root).renderAt({ value: frame, timescale: 30 }, null).scene;
}

function filters(props: Partial<RectProps>, frame = 0) {
  return scene(h(Rect, { width: 4, height: 4, ...props }), frame).layers[0].effects?.filters;
}

/** The seed of a layer's first filter, checked to be a noise. */
function seedOf(layer: Layer): number {
  const filter = layer.effects?.filters?.[0];
  assert.ok(filter?.type === 'noise', 'a noise filter');
  return filter.seed;
}

test('the props serialize in a fixed order around the color filters', () => {
  assert.deepEqual(
    filters({
      // Listed out of order: the order is the props', not the object's.
      scanlines: 0.5,
      noise: { amount: 0.2, seed: 3 },
      halftone: 10,
      brightness: 1.2,
      chromaticAberration: 4,
      zoomBlur: 0.25,
      wave: { amplitude: 6, wavelength: 80 },
      pixelate: 8,
      chromaKey: '#00b140',
      shader: builtinFilter('pixelate', { size: 2 }),
    }),
    [
      { type: 'pixelate', size: 2 },
      { type: 'chromaKey', color: '#00b140', tolerance: 0.2, softness: 0.1, spill: 0.5 },
      { type: 'pixelate', size: 8 },
      { type: 'wave', amplitude: 6, wavelength: 80, phase: 0, angle: 0 },
      { type: 'zoomBlur', amount: 0.25, centerX: 0.5, centerY: 0.5 },
      { type: 'chromaticAberration', offset: 4, angle: 0 },
      { type: 'brightness', amount: 1.2 },
      { type: 'halftone', size: 10, angle: 45 },
      { type: 'noise', amount: 0.2, seed: 3, monochrome: true },
      { type: 'scanlines', amount: 0.5, spacing: 4, thickness: 0.5, offset: 0 },
    ],
  );
});

test('every visual layer and group takes them, video and images included', () => {
  const layers = scene([
    h(Group, { key: 'g', pixelate: 4 }, h(Rect, { width: 4, height: 4 })),
    h(Text, { key: 't', wave: { amplitude: 2, wavelength: 10 }, children: 'A' }),
    h(Image, { key: 'i', src: 'a.png', width: 4, height: 4, chromaKey: { color: '#00ff00', spill: 1 } }),
    h(Video, { key: 'v', src: 'a.mp4', chromaKey: '#0000ff' }),
  ]).layers;
  assert.deepEqual(layers.map((layer) => layer.effects?.filters?.[0].type), ['pixelate', 'wave', 'chromaKey', 'chromaKey']);
});

test('values that leave the pixels as they were add no filter', () => {
  const unchanged = {
    pixelate: 1,
    halftone: 0,
    chromaticAberration: 0,
    wave: { amplitude: 0, wavelength: 10 },
    noise: 0,
    scanlines: 0,
    zoomBlur: 0,
  };
  assert.equal(filters(unchanged), undefined);
  // A chroma key always keys; in the shader prop, everything stays.
  assert.equal(filters({ chromaKey: '#00ff00' })?.length, 1);
  assert.deepEqual(filters({ shader: builtinFilter('pixelate', 1) }), [{ type: 'pixelate', size: 1 }]);
});

test('the noise seed defaults to the layer\'s frame, so it changes every frame', () => {
  const seedAt = (frame: number, element: ReactElement) => seedOf(scene(element, frame).layers[0]);
  const rect = (props: Partial<RectProps>) => h(Rect, { width: 4, height: 4, ...props });
  assert.equal(seedAt(7, rect({ noise: 0.2 })), 7);
  assert.equal(seedAt(8, rect({ noise: 0.2 })), 8);
  assert.equal(seedAt(8, rect({ noise: { amount: 0.2, seed: 41 } })), 41);
  // The function form resolves at the same place.
  assert.equal(seedAt(9, rect({ shader: builtinFilter('noise', 0.2) })), 9);
  // Inside a <Sequence>, the local frame; inside a <FreezeFrame>, the held one.
  const inSequence = scene(h(Sequence, { from: 5 }, rect({ noise: 0.2 })), 12).layers[0];
  assert.equal(seedOf(childrenOf(inSequence)[0]), 7);
  const frozen = scene(h(FreezeFrame, { frame: 3 }, rect({ noise: 0.2 })), 40).layers[0];
  assert.equal(seedOf(childrenOf(frozen)[0]), 3);
  // Seeds are 32-bit, as the renderers hash them.
  assert.equal(seedAt(0, rect({ noise: { amount: 0.2, seed: -1 } })), 0xffffffff);
});

test('every <MotionBlur> sample takes the frame\'s noise seed, as its media does', () => {
  // A 720° shutter's samples reach a frame either side of frame 10.
  const layer = scene(h(MotionBlur, { samples: 4, shutterAngle: 720 }, h(Rect, { width: 4, height: 4, noise: 0.2 })), 10).layers[0];
  const seeds = childrenOf(layer).map((sample) => seedOf(childrenOf(sample)[0]));
  assert.deepEqual(seeds, [10, 10, 10, 10]);
});

test('a <Static> subtree needs a noise seed', () => {
  assert.throws(() => scene(h(Static, null, h(Rect, { width: 4, height: 4, noise: 0.2 }))), /noise inside <Static> needs a seed/);
  const layers = scene(h(Static, null, h(Rect, { width: 4, height: 4, noise: { amount: 0.2, seed: 1 } }))).layers;
  assert.equal(JSON.stringify(layers).includes('"seed":1'), true);
});

test('values out of range are refused with the prop named', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ pixelate: -1 }, /pixelate must be a finite number of at least 0/],
    [{ pixelate: '8' }, /pixelate must be a finite number of at least 0/],
    [{ halftone: { size: 4, angle: Infinity } }, /halftone.angle must be a finite number/],
    [{ chromaticAberration: { offset: Number.NaN } }, /chromaticAberration.offset must be a finite number/],
    [{ wave: 4 }, /wave must be an object with amplitude and wavelength/],
    [{ wave: { amplitude: 4, wavelength: 0 } }, /wave.wavelength must be a finite number above 0/],
    [{ noise: 2 }, /noise must be a finite number between 0 and 1/],
    [{ noise: { amount: 0.2, seed: 1.5 } }, /noise.seed must be an integer/],
    [{ noise: { amount: 0.2, monochrome: 1 } }, /noise.monochrome must be a boolean/],
    [{ scanlines: { amount: 0.5, spacing: 0 } }, /scanlines.spacing must be a finite number above 0/],
    [{ scanlines: { amount: 0.5, thickness: 2 } }, /scanlines.thickness must be a finite number between 0 and 1/],
    [{ zoomBlur: 1.5 }, /zoomBlur must be a finite number between 0 and 1/],
    [{ chromaKey: 'green' }, /chromaKey must be a #RRGGBB color/],
    [{ chromaKey: { color: '#00ff0080' } }, /chromaKey.color must be a #RRGGBB color/],
    [{ chromaKey: { color: '#00ff00', spill: 2 } }, /chromaKey.spill must be a finite number between 0 and 1/],
    [{ chromaKey: { color: '#00ff00', tolerance: -1 } }, /chromaKey.tolerance must be a finite number of at least 0/],
  ];
  for (const [props, message] of cases) {
    // Most are invalid on purpose, so cast.
    assert.throws(() => filters(props as Partial<RectProps>), message, JSON.stringify(props));
  }
});
