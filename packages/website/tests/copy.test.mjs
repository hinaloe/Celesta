import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copy, isLocale } from '../site/copy/index.ts';

/** Every leaf path with the kind of value found there. */
function leaves(value, path = '') {
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
  }
  return [[path, typeof value]];
}

test('ja has every en key with the same kind of value', () => {
  const en = leaves(copy('en')).sort();
  const ja = leaves(copy('ja')).sort();
  assert.ok(en.length > 100);
  assert.deepEqual(ja, en);
});

test('isLocale accepts en and ja only', () => {
  for (const value of ['en', 'ja']) assert.equal(isLocale(value), true);
  for (const value of ['en-us', '', 'docs']) assert.equal(isLocale(value), false);
});
