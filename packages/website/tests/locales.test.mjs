import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preferredLocale } from '../site/locales.ts';
import worker from '../worker.ts';

test('negotiate browser preferences, quality values, regional tags and fallback', () => {
  for (const [header, expected] of [
    ['ja-JP, en-US;q=0.8', 'ja'], ['en-US,ja;q=0.8', 'en'],
    ['en;q=0.5, ja;q=0.9', 'ja'], ['fr-FR,ja;q=0.7,en;q=0.5', 'ja'],
    ['JA-jp ; q=0.9, en;q=0.8', 'ja'], ['ja;q=0,en;q=0.4', 'en'],
    ['ja ;q=0.9, en;q=0.8', 'ja'], [' JA ; q=0.9 , EN;q=0.8 ', 'ja'],
    ['en;q=0,*;q=0.5', 'ja'], ['ja;q=0,*;q=0.5', 'en'],
    ['en-US;q=0,*;q=0.5', 'ja'], ['en;q=0.5,*;q=0.9', 'ja'],
    ['en;q=0,ja;q=0.5,*;q=1', 'ja'], ['en;q=0,ja;q=0,*;q=1', 'en'],
    ['ja;q=invalid,en', 'en'], ['ja;q=2,en', 'en'], ['fr-FR', 'en'],
    ['*', 'en'], ['', 'en'], [null, 'en'],
  ]) assert.equal(preferredLocale(header), expected, String(header));
});

test('only the root negotiates: explicit languages and assets keep their URLs', async () => {
  const calls = [];
  const env = { ASSETS: { fetch(request) { calls.push(request.url); return new Response('asset'); } } };
  const response = await worker.fetch(new Request('https://celesta.natsuneko.cat/?ref=launch', { headers: { 'Accept-Language': 'ja' } }), env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://celesta.natsuneko.cat/ja/?ref=launch');
  assert.equal(response.headers.get('Vary'), 'Accept-Language');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(calls, []);
  const paths = ['/en/', '/ja/', '/ja/docs/export/', '/docs/export/', '/assets/site.js', '/unknown/'];
  for (const path of paths) {
    const result = await worker.fetch(new Request(`https://celesta.natsuneko.cat${path}`, { headers: { 'Accept-Language': 'ja' } }), env);
    assert.equal(await result.text(), 'asset');
  }
  assert.deepEqual(calls, paths.map(path => `https://celesta.natsuneko.cat${path}`));
});
