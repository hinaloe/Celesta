// Property tables of the shapes: registered when the package loads.

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { listPrimitiveProperties } from '@celesta/react/internal';

import '../src/index.js';

test('importing the package registers every shape', () => {
  const names = Object.keys(listPrimitiveProperties());
  for (const name of ['Ellipse', 'Circle', 'Triangle', 'Polygon', 'Star', 'Pie', 'Heart']) {
    assert.ok(names.includes(name), `${name} in ${names.join(', ')}`);
  }
});

test('shape tables name their box and keep their order', () => {
  const tables = listPrimitiveProperties();
  assert.deepEqual(tables.Circle?.size, { radius: 'radius' });
  assert.deepEqual(
    tables.Star?.groups.find((group) => group.name === 'Size')?.fields.map((row) => row.key),
    ['radius', 'points', 'innerRatio', 'cornerRadius'],
  );
});

test('props the shapes require are declared required', () => {
  const tables = listPrimitiveProperties();
  const required = (name: string) =>
    tables[name]?.groups.flatMap((group) => group.fields).filter((row) => row.field.required).map((row) => row.key);
  assert.deepEqual(required('Circle'), ['radius']);
  assert.deepEqual(required('Star'), ['radius', 'points']);
  assert.deepEqual(required('Polygon'), ['radius', 'sides']);
  assert.deepEqual(required('Pie'), ['radius', 'endAngle']);
  for (const name of ['Ellipse', 'Triangle', 'Heart']) {
    assert.deepEqual(required(name), ['width', 'height'], name);
  }
});

test('shape transforms scrub scale and anchors finely', () => {
  const tables = listPrimitiveProperties();
  for (const name of ['Ellipse', 'Circle', 'Triangle', 'Polygon', 'Star', 'Pie', 'Heart']) {
    const transform = tables[name]?.groups.find((group) => group.name === 'Transform')?.fields;
    const field = (key: string) => transform?.find((row) => row.key === key)?.field;
    assert.deepEqual(field('scale'), { type: 'number', defaultValue: 1, step: 0.01 }, name);
    assert.deepEqual(field('anchorX'), { type: 'number', defaultValue: 0, step: 0.01 }, name);
    assert.deepEqual(field('anchorY'), { type: 'number', defaultValue: 0, step: 0.01 }, name);
    assert.deepEqual(field('opacity'), { type: 'number', defaultValue: 1, min: 0, max: 1 }, name);
  }
});
