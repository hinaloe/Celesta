// Property tables: the props the editor's Properties tab edits, per primitive.

import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { RectProps } from '../src/components.js';
import { listPrimitiveProperties, num, propertyTable } from '../src/internal.js';

// The primitives register their tables beside their definitions, as an entry
// loads them.
import '../src/index.js';

const keysOf = (table: string, group: string) =>
  listPrimitiveProperties()[table]?.groups.find((entry) => entry.name === group)?.fields.map((row) => row.key);

test('every Celesta primitive registers a table', () => {
  const names = Object.keys(listPrimitiveProperties());
  for (const name of ['Group', 'Image', 'Rect', 'Text', 'Video']) {
    assert.ok(names.includes(name), `${name} in ${names.join(', ')}`);
  }
});

test('tables keep their declared order', () => {
  const tables = listPrimitiveProperties();
  assert.deepEqual(tables.Rect?.groups.map((group) => group.name), ['Transform', 'Size', 'Appearance']);
  assert.deepEqual(keysOf('Rect', 'Size'), ['width', 'height', 'cornerRadius']);
  assert.deepEqual(keysOf('Text', 'Text'), ['children', 'fontFamily', 'fontSize', 'fontWeight', 'color']);
});

test('size names the props that hold the box', () => {
  const tables = listPrimitiveProperties();
  assert.deepEqual(tables.Rect?.size, { width: 'width', height: 'height' });
  assert.deepEqual(tables.Text?.size, { width: 'maxWidth' });
  assert.equal(tables.Group?.size, undefined);
});

test('fields carry their defaults and bounds', () => {
  const field = (table: string, group: string, key: string) =>
    listPrimitiveProperties()[table]?.groups.find((entry) => entry.name === group)?.fields
      .find((row) => row.key === key)?.field;
  assert.deepEqual(field('Rect', 'Transform', 'opacity'), { type: 'number', defaultValue: 1, min: 0, max: 1 });
  assert.deepEqual(field('Image', 'Size', 'fit'), { type: 'select', options: ['contain', 'cover'] });
});

// Type test: compiled by `tsc -b test`, never run. A key or size prop the
// props type lacks does not compile.
export function misspelledKeysDoNotCompile() {
  // @ts-expect-error `widht` is not a prop of `<Rect>`.
  propertyTable<RectProps>({ groups: { Size: { widht: num() } } });
  // @ts-expect-error `<Rect>` has no `radius`.
  propertyTable<RectProps>({ size: { radius: 'radius' }, groups: {} });
}
