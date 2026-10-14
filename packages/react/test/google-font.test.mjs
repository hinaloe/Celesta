import assert from 'node:assert/strict';
import { test } from 'vitest';
import { googleFont } from '../dist/index.js';
import { prepareFonts } from '../dist/text-measure.js';

test('googleFont encodes one family and canonicalizes weights and subsets for the cache', () => {
  const url = googleFont(' M PLUS Rounded 1c ', { weights: [700, 400, 700], subsets: ['japanese', 'latin', 'japanese'] });
  assert.equal(url, 'https://fonts.googleapis.com/css?family=M+PLUS+Rounded+1c:400,700&subset=japanese,latin');
  assert.equal(googleFont('M PLUS Rounded 1c', { weights: [400, 700], subsets: ['latin', 'japanese'] }), url);
  assert.deepEqual(prepareFonts([url]), [{ id: url, location: { type: 'url', url } }]);
  assert.equal(googleFont('Noto Sans JP'), 'https://fonts.googleapis.com/css?family=Noto+Sans+JP:400');
  assert.equal(new URL(googleFont('A&B + 日本語')).searchParams.get('family'), 'A&B + 日本語:400');
});

test('googleFont rejects empty families, injected API syntax, weights, and subsets', () => {
  for (const family of ['', ' ', 'Inter|Roboto', 'Inter:700']) {
    assert.throws(() => googleFont(family), /family name/);
  }
  for (const weights of [[], [0], [1000], [450], [NaN], [400.5]]) {
    assert.throws(() => googleFont('Inter', { weights }), /weights/);
  }
  for (const subsets of [[''], ['japanese&family=Roboto'], ['latin,cyrillic']]) {
    assert.throws(() => googleFont('Inter', { subsets }), /subset/);
  }
});
