import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

import { phraseBoundaries, phrases } from '../src/index.js';
import { JAPANESE_MODEL } from '../src/budoux-ja.js';

// The same cases as crates/budoux, so both ports split alike.

test('the model is the one crates/budoux reads', () => {
  const json = JSON.parse(readFileSync(new URL('../../../crates/budoux/src/models/ja.json', import.meta.url), 'utf8'));
  assert.deepEqual(JAPANESE_MODEL, json);
});

test('splits Japanese into the phrases lineBreak: phrase keeps on one line', () => {
  assert.deepEqual(
    phrases('Google の使命は、世界中の情報を整理し、世界中の人がアクセスできて使えるようにすることです。'),
    ['Google の', '使命は、', '世界中の', '情報を', '整理し、', '世界中の', '人が', 'アクセスできて', '使えるように', 'する', 'ことです。'],
  );
  assert.deepEqual(phraseBoundaries('今日は晴れ'), [3]);
});

test('keeps every character, and an empty text has no phrases', () => {
  const sentence = 'フレームは時刻の関数なので、どのフレームからでも描き直せるのだ。\n改行も🇯🇵も残る';
  assert.equal(phrases(sentence).join(''), sentence);
  assert.deepEqual(phrases(''), []);
  assert.deepEqual(phraseBoundaries(''), []);
});

test('counts code points, so a character outside the BMP is one', () => {
  // "𠮷" is one code point (two UTF-16 units), so "𠮷野家は" ends at 4, not 5.
  assert.deepEqual(phraseBoundaries('𠮷野家は安い'), [4]);
  assert.deepEqual(phrases('𠮷野家は安い'), ['𠮷野家は', '安い']);
});
