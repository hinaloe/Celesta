// The JSX dev runtime: builds the same elements as `react/jsx-runtime` and
// records where each was written. Run after `pnpm run build`.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { jsx, jsxs } from 'react/jsx-runtime';

import { sourceOfProps } from '../dist/internal.js';
import { jsxDEV } from '../dist/jsx-dev-runtime.js';

const source = { fileName: 'a.tsx', lineNumber: 3, columnNumber: 7 };

test('records the source for the element props', () => {
  const el = jsxDEV('rect', { width: 1 }, undefined, false, source);
  assert.deepEqual(sourceOfProps(el.props), source);
});

test('creates the same element as jsx', () => {
  const el = jsxDEV('rect', { width: 1 }, undefined, false, source);
  const expected = jsx('rect', { width: 1 });
  assert.equal(el.type, expected.type);
  assert.equal(el.key, expected.key);
  assert.deepEqual(el.props, expected.props);
});

test('creates the same element as jsxs for static children', () => {
  const children = ['a', 'b'];
  const el = jsxDEV('group', { children }, 'k', true, source);
  const expected = jsxs('group', { children }, 'k');
  assert.equal(el.type, expected.type);
  assert.equal(el.key, expected.key);
  assert.deepEqual(el.props, expected.props);
});

test('adds no keys to props', () => {
  const el = jsxDEV('rect', { width: 1 }, undefined, false, source);
  assert.deepEqual(Object.keys(el.props), ['width']);
  assert.equal(Object.getOwnPropertySymbols(el.props).length, 0);
});

test('records nothing without a source', () => {
  assert.equal(sourceOfProps(jsxDEV('rect', {}, undefined, false).props), undefined);
  assert.equal(sourceOfProps(null), undefined);
  assert.equal(sourceOfProps(1), undefined);
});
