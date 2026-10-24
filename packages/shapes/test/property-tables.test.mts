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
