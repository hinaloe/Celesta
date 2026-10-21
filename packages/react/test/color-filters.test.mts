// The built-in color filters: the props, and their place among the
// `shader` prop's filters.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as React from 'react';
import type { ReactNode } from 'react';

import { Composition, Group, Image, Rect, Text } from '../src/index.js';
import { mount } from '../src/render.js';
import { colorFilter, shaderEffect, shaderSource } from '../src/internal.js';
import type { RectProps, Time } from '../src/index.js';

const h = React.createElement;
const ZERO: Time = { value: 0, timescale: 30 };
const WGSL = 'fn effect(input: EffectInput) -> vec4f { return source_at(input.position); }';

function frame(children: ReactNode) {
  const Root = () => h(Composition, { width: 16, height: 16, fps: 30, durationInFrames: 1 }, children);
  return mount(Root).renderAt(ZERO, null).scene;
}

function filters(props: Partial<RectProps>) {
  return frame(h(Rect, { width: 4, height: 4, ...props })).layers[0].effects?.filters;
}

test('the props serialize in a fixed order, after the shader prop', () => {
  const plain = shaderSource({ wgsl: WGSL, params: [] });
  assert.deepEqual(
    filters({
      // Listed out of order: the order is the props', not the object's.
      vignette: 0.3,
      tint: { color: '#ff800080', amount: 0.5 },
      invert: 0.25,
      grayscale: 1,
      hue: 45,
      saturation: 1.5,
      contrast: 0.8,
      brightness: 1.2,
      shader: [shaderEffect(plain, [], 0), colorFilter('brightness', 0.5)],
    }),
    [
      { type: 'shader', id: plain.id },
      { type: 'brightness', amount: 0.5 },
      { type: 'brightness', amount: 1.2 },
      { type: 'contrast', amount: 0.8 },
      { type: 'saturation', amount: 1.5 },
      { type: 'hue', degrees: 45 },
      { type: 'grayscale', amount: 1 },
      { type: 'invert', amount: 0.25 },
      { type: 'tint', color: '#ff800080', amount: 0.5 },
      { type: 'vignette', amount: 0.3, radius: 0.5, softness: 0.5 },
    ],
  );
});

test('every visual layer and group takes them', () => {
  const scene = frame([
    h(Group, { key: 'g', grayscale: 1 }, h(Rect, { width: 4, height: 4 })),
    h(Text, { key: 't', invert: 1, children: 'A' }),
    h(Image, { key: 'i', src: 'a.png', width: 4, height: 4, brightness: 2 }),
  ]);
  assert.deepEqual(scene.layers.map((layer) => layer.effects?.filters?.[0].type), ['grayscale', 'invert', 'brightness']);
  assert.equal('shaders' in scene, false);
});

test('values that leave the pixels as they were add no filter', () => {
  const unchanged = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    hue: 360,
    grayscale: 0,
    invert: 0,
    tint: { color: '#ff0000', amount: 0 },
    vignette: 0,
  };
  assert.equal(filters(unchanged), undefined);
  assert.equal(filters({ tint: { color: '#ff000000' } }), undefined);
  // Still kept in the shader prop, where the author placed them.
  assert.deepEqual(filters({ shader: colorFilter('brightness', 1) }), [{ type: 'brightness', amount: 1 }]);
});

test('the object forms fill in their defaults', () => {
  assert.deepEqual(filters({ tint: { color: '#00ff00' }, vignette: { amount: 1, softness: 0 } }), [
    { type: 'tint', color: '#00ff00', amount: 1 },
    { type: 'vignette', amount: 1, radius: 0.5, softness: 0 },
  ]);
});

test('values out of range are refused with the prop named', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ brightness: -0.1 }, /brightness must be a finite number of at least 0/],
    [{ contrast: Number.NaN }, /contrast must be a finite number of at least 0/],
    [{ saturation: '1' }, /saturation must be a finite number of at least 0/],
    [{ hue: Infinity }, /hue must be a finite number/],
    [{ grayscale: 1.5 }, /grayscale must be a finite number between 0 and 1/],
    [{ invert: null }, /invert must be a finite number between 0 and 1/],
    [{ tint: '#ff0000' }, /tint must be an object/],
    [{ tint: { color: 'red' } }, /tint.color must be a #RRGGBB or #RRGGBBAA color/],
    [{ tint: { color: '#ff0000', amount: 2 } }, /tint.amount must be a finite number between 0 and 1/],
    [{ vignette: 2 }, /vignette must be a finite number between 0 and 1/],
    [{ vignette: {} }, /vignette.amount must be a finite number between 0 and 1/],
    [{ vignette: { amount: 0.5, radius: -1 } }, /vignette.radius must be a finite number of at least 0/],
  ];
  for (const [props, message] of cases) {
    // Most are invalid on purpose, so cast.
    assert.throws(() => filters(props as Partial<RectProps>), message, JSON.stringify(props));
  }
});
