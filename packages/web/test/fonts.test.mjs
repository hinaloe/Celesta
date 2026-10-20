import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFonts, loadedFamilies, requireLoadedFonts, resetFonts } from '../src/fonts.ts';

// A minimal OpenType name table with only a Unicode-platform family record.
function unicodeFont() {
  const bytes = new ArrayBuffer(72), view = new DataView(bytes);
  view.setUint16(4, 1); view.setUint32(12, 0x6e616d65); view.setUint32(20, 28);
  view.setUint16(30, 1); view.setUint16(32, 18);
  view.setUint16(34, 0); view.setUint16(40, 16); view.setUint16(42, 26);
  [...'UnicodeFamily'].forEach((char, i) => view.setUint16(46 + i * 2, char.charCodeAt(0)));
  return bytes;
}

test('Unicode font names, preload requirements, cached failures and partial CSS fallback', async t => {
  const faces = new Set(), fetched = [], warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const originals = { fetch: globalThis.fetch, FontFace: globalThis.FontFace, fonts: globalThis.fonts };
  t.after(() => Object.assign(globalThis, originals));
  globalThis.fonts = faces;
  globalThis.FontFace = class {
    constructor(family) { this.family = family; }
    async load() { if (this.family === 'Broken') throw new Error('bad font'); return this; }
  };
  globalThis.fetch = async url => {
    fetched.push(url);
    if (url.endsWith('missing.ttf')) return new Response('', { status: 404 });
    if (url.endsWith('invalid.ttf')) return new Response(new Uint8Array(2));
    if (url.endsWith('.css')) return new Response('@font-face {font-family: Broken; src: url(bad.woff)} @font-face {font-family: Good; src: url(good.woff)}', { headers: { 'content-type': 'text/css' } });
    return new Response(unicodeFont());
  };
  const asset = path => ({ id: path, location: { type: 'url', url: `https://fonts.test/${path}` } });
  const resolve = asset => asset.location.url;
  const unicode = asset('unicode.ttf');
  assert.throws(() => requireLoadedFonts([unicode], resolve), /prepare\(\)/);
  await Promise.all([loadFonts([unicode], resolve), loadFonts([unicode], resolve)]);
  requireLoadedFonts([unicode], resolve);
  assert.equal(fetched.length, 1);
  assert.equal([...faces][0].family, 'UnicodeFamily');

  for (const path of ['missing.ttf', 'invalid.ttf', 'faces.css']) {
    const font = asset(path);
    await loadFonts([font], resolve);
    await loadFonts([font], resolve);
    requireLoadedFonts([font], resolve);
  }
  // The stylesheet's two faces are fetched as files, once each.
  assert.equal(fetched.length, 6);
  assert.deepEqual(fetched.slice(4), ['https://fonts.test/bad.woff', 'https://fonts.test/good.woff']);
  assert.deepEqual([...faces].map(face => face.family), ['UnicodeFamily', 'Good']);
  assert.equal(warnings.length, 3);
  const unresolved = { id: 'local', location: { type: 'file', path: 'local.ttf' } };
  const missingMedia = () => { throw new Error('No media directory'); };
  await loadFonts([unresolved], missingMedia);
  requireLoadedFonts([unresolved], missingMedia);
  await loadFonts([unresolved], missingMedia);
  assert.equal(warnings.length, 4);
  resetFonts();
  assert.equal(faces.size, 0);
  assert.throws(() => requireLoadedFonts([unicode], resolve), /preloaded fonts/);
  await loadFonts([asset('missing.ttf')], resolve);
  await loadFonts([unresolved], missingMedia);
  assert.equal(fetched.length, 7);
  assert.equal(warnings.length, 6);
  resetFonts();
});

test('Google Fonts loads every Japanese split face and reports unknown names without caching failures', async t => {
  const faces = new Set();
  const originals = { fetch: globalThis.fetch, FontFace: globalThis.FontFace, fonts: globalThis.fonts };
  t.after(() => { resetFonts(); Object.assign(globalThis, originals); });
  globalThis.fonts = faces;
  globalThis.FontFace = class {
    constructor(family, source, descriptors) { Object.assign(this, { family, source, descriptors }); }
    async load() { return this; }
  };
  let hits = 0;
  globalThis.fetch = async url => {
    hits++;
    if (url.includes('Missing')) return new Response('', { status: 400 });
    if (url.endsWith('.woff2')) return new Response(new Uint8Array(4));
    return new Response(`
      @font-face {font-family: 'Noto Sans JP'; font-weight: 700; src: url(https://fonts.gstatic.com/japanese.woff2); unicode-range: U+3040-30FF}
      @font-face {font-family: 'Noto Sans JP'; font-weight: 700; src: url(https://fonts.gstatic.com/latin.woff2); unicode-range: U+0000-00FF}
    `, { headers: { 'content-type': 'text/css' } });
  };
  const url = 'https://fonts.googleapis.com/css?family=Noto+Sans+JP:700&subset=japanese';
  const font = { id: url, location: { type: 'url', url } };
  const resolve = asset => asset.location.url;
  await loadFonts([font], resolve);
  await loadFonts([font], resolve);
  // The stylesheet, then each split face's file.
  assert.equal(hits, 3);
  assert.deepEqual([...faces].map(face => [face.family, face.descriptors.weight, face.descriptors.unicodeRange]), [
    ['Noto Sans JP', '700', 'U+3040-30FF'], ['Noto Sans JP', '700', 'U+0000-00FF'],
  ]);
  for (const missingURL of [
    'https://fonts.googleapis.com/css?family=Missing+Family:400',
    'https://fonts.googleapis.com/css2?family=Missing+Family:wght@400',
  ]) {
    const missing = { id: missingURL, location: { type: 'url', url: missingURL } };
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(loadFonts([missing], resolve), /could not find family "Missing Family" or the requested weights/);
      assert.throws(() => requireLoadedFonts([missing], resolve), /preloaded fonts/);
    }
  }
  assert.equal(hits, 7);
});

test('loadedFamilies lists the families of each font in list order', async t => {
  const originals = { fetch: globalThis.fetch, FontFace: globalThis.FontFace, fonts: globalThis.fonts };
  t.after(() => { resetFonts(); Object.assign(globalThis, originals); });
  globalThis.fonts = new Set();
  globalThis.FontFace = class {
    constructor(family) { this.family = family; }
    async load() { return this; }
  };
  globalThis.fetch = async url => url.endsWith('a.css')
    ? new Response('@font-face {font-family: Alpha; src: url(a1.woff)} @font-face {font-family: Alpha; src: url(a2.woff)} @font-face {font-family: Beta; src: url(b.woff)}', { headers: { 'content-type': 'text/css' } })
    : new Response(unicodeFont());
  const asset = path => ({ id: path, location: { type: 'url', url: `https://fonts.test/${path}` } });
  const resolve = asset => asset.location.url;
  const unresolved = { id: 'local', location: { type: 'file', path: 'local.ttf' } };
  const fonts = [asset('a.css'), asset('unicode.ttf')];
  await loadFonts(fonts, resolve);
  assert.deepEqual(loadedFamilies(fonts, resolve), ['Alpha', 'Beta', 'UnicodeFamily']);
  assert.deepEqual(loadedFamilies([...fonts].reverse(), resolve), ['UnicodeFamily', 'Alpha', 'Beta']);
  assert.deepEqual(loadedFamilies([unresolved], () => { throw new Error('No media directory'); }), []);
});
