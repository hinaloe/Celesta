import assert from 'node:assert/strict';
import { test } from 'vitest';
import { googleFont } from '../src/index.js';
import { prepareFonts } from '../src/text-measure.js';

test('googleFont encodes one family and canonicalizes weights and subsets for the cache', () => {
  const url = googleFont(' M PLUS Rounded 1c ', { weights: [700, 400, 700], subsets: ['japanese', 'latin', 'japanese'] });
  assert.equal(url, 'https://fonts.googleapis.com/css?family=M+PLUS+Rounded+1c:400,700&subset=japanese,latin');
  assert.equal(googleFont('M PLUS Rounded 1c', { weights: [400, 700], subsets: ['latin', 'japanese'] }), url);
  assert.deepEqual(prepareFonts([url]), [{ id: url, location: { type: 'url', url } }]);
  assert.equal(new URL(googleFont('A&B + 日本語')).searchParams.get('family'), 'A&B + 日本語:wght@400');
});

test('googleFont without subsets requests the whole family from the v2 API', () => {
  // The v1 API narrows a request without &subset= to Latin; v2 returns every script.
  assert.equal(googleFont('Noto Sans JP'), 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400');
  const url = googleFont('JetBrains Mono', { weights: [700, 400, 700] });
  assert.equal(url, 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700');
  assert.equal(googleFont('JetBrains Mono', { weights: [400, 700], subsets: [] }), url);
  assert.equal(
    googleFont('JetBrains Mono', { weights: [400, 700], subsets: ['greek'] }),
    'https://fonts.googleapis.com/css?family=JetBrains+Mono:400,700&subset=greek',
  );
});

test('googleFont text requests only those characters, deduplicated and sorted for the cache', () => {
  const url = googleFont('Noto Sans JP', { weights: [700, 500], text: '日本語の字幕、日本語' });
  assert.equal(url, `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500;700&text=${encodeURIComponent('、の字幕日本語')}`);
  assert.equal(googleFont('Noto Sans JP', { weights: [500, 700], text: '語本日幕字の、' }), url);
  // Encoded as one query value: separators and astral characters stay inside it.
  const params = new URL(googleFont('Inter', { text: 'a&b=c+d #😀' })).searchParams;
  assert.equal(params.get('family'), 'Inter:wght@400');
  assert.equal(params.get('text'), ' #&+=abcd😀');
  assert.equal(googleFont('Inter', { text: 'ab', subsets: [] }), googleFont('Inter', { text: 'ba' }));
});

test('googleFont rejects text with subsets and empty text', () => {
  assert.throws(() => googleFont('Noto Sans JP', { text: '日本', subsets: ['japanese'] }), /either `text` or `subsets`/);
  assert.throws(() => googleFont('Noto Sans JP', { text: '' }), /at least one character/);
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
