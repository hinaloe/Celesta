// The JSX dev runtime: builds the same elements as `react/jsx-runtime` and
// records where each was written.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { jsx, jsxs } from 'react/jsx-runtime';
import type { ElementType } from 'react';

import { sourceOfProps } from '../src/internal.js';
import type { SourcePosition } from '../src/internal.js';
import { jsxDEV } from '../src/jsx-dev-runtime.js';

// A Celesta host type, which React's JSX types do not list.
const group = 'group' as ElementType;

const source: SourcePosition = { fileName: 'a.tsx', lineNumber: 3, columnNumber: 7 };

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
  const expected = jsxs(group, { children }, 'k');
  assert.equal(el.type, expected.type);
  assert.equal(el.key, expected.key);
  assert.deepEqual(el.props, expected.props);
});

test('adds no keys to props', () => {
  const el = jsxDEV('rect', { width: 1 }, undefined, false, source);
  // jsxDEV's elements carry the props object they were given.
  const props = el.props as object;
  assert.deepEqual(Object.keys(props), ['width']);
  assert.equal(Object.getOwnPropertySymbols(props).length, 0);
});

test('records nothing without a source', () => {
  assert.equal(sourceOfProps(jsxDEV('rect', {}, undefined, false).props), undefined);
  assert.equal(sourceOfProps(null), undefined);
  assert.equal(sourceOfProps(1), undefined);
});
