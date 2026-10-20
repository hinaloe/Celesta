import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild-wasm';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Bundled with the font set it reads, which the tests below change.
const directory = mkdtempSync(fileURLToPath(new URL('../node_modules/.text-layout-test-', import.meta.url)));
const result = await build({
  stdin: { contents: `export * from './text-layout.ts'; export { loadFonts, resetFonts } from './fonts.ts';`, resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm',
});
const modulePath = join(directory, 'text-layout.mjs');
writeFileSync(modulePath, result.outputFiles[0].text);
const { cssFont, letterSpacingPx, loadFonts, measureLine, resetFonts, runPieces, textLines, textLineRanges, textMeasurer, textStyle, withLoadedFallback } = await import(pathToFileURL(modulePath));
rmSync(directory, { recursive: true });

test('wrapping uses the requested language, including with older canvas contexts', t => {
  const locales = [], Segmenter = Intl.Segmenter;
  t.mock.method(Intl, 'Segmenter', function(locale, options) {
    locales.push(locale);
    return new Segmenter(locale, options);
  });
  const ctx = { measureText: text => ({ width: text.length, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }) };
  assert.deepEqual(textLines(ctx, 'hello world', 6, ' ja '), ['hello', 'world']);
  const original = globalThis.OffscreenCanvas;
  t.after(() => { globalThis.OffscreenCanvas = original; });
  globalThis.OffscreenCanvas = class { getContext() { return ctx; } };
  const metrics = textMeasurer()({ text: 'hello world', style: { lang: 'th' }, maxWidth: 6, fonts: [] });
  assert.deepEqual(locales, ['ja', 'th']);
  assert.equal(metrics.lines, 2);
  assert.deepEqual(metrics.lineStarts, [0, 6]);
});

test('whole-run kerning and ligature widths are preserved without fabricating glyph positions', t => {
  // A shaping engine measures AV and fi differently from separate characters.
  const ctx = { measureText: text => ({ width: ({ AV: 35, fi: 18 })[text] ?? 20, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }) };
  const original = globalThis.OffscreenCanvas;
  t.after(() => { globalThis.OffscreenCanvas = original; });
  globalThis.OffscreenCanvas = class { getContext() { return ctx; } };
  for (const [text, width] of [['AV', 35], ['fi', 18]]) {
    const metrics = textMeasurer()({ text, style: {}, fonts: [] });
    assert.equal(metrics.width, width);
    assert.throws(() => metrics.glyphs, /Shaped glyph metrics.*native renderer/);
  }
});


test('runPieces keeps clusters whole and uses each cluster first code point', () => {
  const runs = [{ start: 1, end: 3, fontWeight: 700 }];
  // e + U+0301 is one cluster at 0..2; the run starts inside it.
  assert.deepEqual(runPieces('éab', 0, runs).map(p => [p.text, p.start, p.utf16, p.run?.fontWeight]), [
    ['é', 0, 0, undefined], ['a', 2, 2, 700], ['b', 3, 3, undefined],
  ]);
  // Offsets are relative to the full text: this line starts at 2.
  assert.deepEqual(runPieces('ab', 2, runs).map(p => [p.text, p.run?.fontWeight]), [['a', 700], ['b', undefined]]);
  // UTF-16 indices step over surrogate pairs.
  assert.deepEqual(runPieces('😀a', 0, [{ start: 1, end: 2, fontWeight: 700 }]).map(p => [p.text, p.start, p.utf16]), [
    ['😀', 0, 0], ['a', 1, 2],
  ]);
});

test('measuring and wrapping use each run font', () => {
  const fonts = [];
  const ctx = {
    font: '',
    measureText(text) {
      fonts.push(this.font);
      const bold = this.font.startsWith('700');
      const width = Array.from(text).length * (bold ? 2 : 1);
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: bold ? 9 : 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 };
    },
  };
  const style = { fontSize: 10 };
  const runs = [{ start: 2, end: 4, fontWeight: 700 }];
  ctx.font = cssFont(style);
  const line = measureLine(ctx, style, 'abcd', 0, runs);
  assert.equal(line.width, 2 + 4);
  assert.equal(line.actualBoundingBoxAscent, 9);
  assert.equal(line.fontBoundingBoxAscent, 8);
  assert.equal(ctx.font, cssFont(style));
  assert.ok(fonts.includes(cssFont(style, runs[0])));
  const width = (text, start) => measureLine(ctx, style, text, start, runs).width;
  assert.deepEqual(textLineRanges(ctx, 'ab cd ef', 5, 'en', width), [
    { text: 'ab', start: 0 }, { text: 'cd', start: 3 }, { text: 'ef', start: 6 },
  ]);
  assert.deepEqual(textLineRanges(ctx, 'ab cd ef', 5, 'en'), [
    { text: 'ab cd', start: 0 }, { text: 'ef', start: 6 },
  ]);
});

test('a line ink box is the union of its pieces', () => {
  // The bold middle piece starts at x=2. Its ink reaches 5px left of that,
  // past the first piece's ink, and 4px past its own advance, to x=8, past
  // the last piece's right edge at x=6: neither the first nor the last
  // piece alone bounds the line.
  const ctx = {
    font: '',
    measureText(text) {
      const bold = this.font.startsWith('700');
      const width = Array.from(text).length;
      return { width, actualBoundingBoxLeft: bold ? 5 : 0, actualBoundingBoxRight: bold ? width + 4 : width, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 };
    },
  };
  const style = { fontSize: 10 };
  ctx.font = cssFont(style);
  const line = measureLine(ctx, style, 'abcdef', 0, [{ start: 2, end: 4, fontWeight: 700 }]);
  assert.equal(line.actualBoundingBoxLeft, 3);
  assert.equal(line.actualBoundingBoxRight, 8);
});

test('the browser measurer rejects invalid font runs like scene rendering', t => {
  const ctx = { font: '', measureText: text => ({ width: text.length, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }) };
  const original = globalThis.OffscreenCanvas;
  t.after(() => { globalThis.OffscreenCanvas = original; });
  globalThis.OffscreenCanvas = class { getContext() { return ctx; } };
  for (const fontRuns of [[{ start: 0, end: 5 }], [{ start: 1, end: 0 }], [{ start: 0, end: 2 }, { start: 1, end: 3 }]]) {
    assert.throws(() => textMeasurer()({ text: 'abcd', style: { fontRuns }, fonts: [] }), /Invalid text font run range/);
  }
});

test('cssFont reads a run weight and family over the style', () => {
  assert.equal(cssFont({ fontSize: 20, fontFamily: 'Serif A' }), '400 20px "Serif A", system-ui, sans-serif');
  assert.equal(cssFont({ fontSize: 20, fontFamily: 'Serif A' }, { start: 0, end: 1, fontWeight: 700, fontFamily: 'Mono B' }), '700 20px "Mono B", system-ui, sans-serif');
});

test('letter spacing in em follows the font size', () => {
  assert.equal(letterSpacingPx({}), 0);
  assert.equal(letterSpacingPx({ fontSize: 20, letterSpacing: 3 }), 3);
  assert.equal(letterSpacingPx({ fontSize: 50, letterSpacing: { em: -0.02 } }), -1);
  assert.equal(letterSpacingPx({ letterSpacing: { em: 0.25 } }), 8);
  const ctx = {};
  textStyle(ctx, { fontSize: 50, letterSpacing: { em: 0.1 }, lang: 'en' });
  assert.equal(ctx.letterSpacing, '5px');
});

test('cssFont turns a font stack into a CSS family list', () => {
  assert.equal(cssFont({ fontSize: 20, fontFamily: ['Inter', 'Noto Sans JP'] }), '400 20px "Inter", "Noto Sans JP", system-ui, sans-serif');
  assert.equal(cssFont({ fontSize: 20, fontFamily: 'Serif A' }, { start: 0, end: 1, fontFamily: ['Mono B', 'Noto Sans JP'] }), '400 20px "Mono B", "Noto Sans JP", system-ui, sans-serif');
});

test('the browser measurer wraps and measures with font runs', t => {
  const ctx = {
    font: '',
    measureText(text) {
      const width = Array.from(text).length * (this.font.startsWith('700') ? 2 : 1);
      return { width, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 };
    },
  };
  const original = globalThis.OffscreenCanvas;
  t.after(() => { globalThis.OffscreenCanvas = original; });
  globalThis.OffscreenCanvas = class { getContext() { return ctx; } };
  const metrics = textMeasurer()({ text: 'ab cd', style: { fontSize: 10, fontRuns: [{ start: 0, end: 5, fontWeight: 700 }] }, maxWidth: 6, fonts: [] });
  assert.equal(metrics.lines, 2);
  assert.equal(metrics.width, 4);
});

test('wrapped ranges retain source code-point offsets across trimmed spaces and CRLF', () => {
  const ctx = { measureText: text => ({ width: Array.from(text).length }) };
  assert.deepEqual(textLineRanges(ctx, '😀 AV   AV\r\né', 5, 'en'), [
    { text: '😀 AV', start: 0 }, { text: 'AV', start: 7 }, { text: 'é', start: 11 },
  ]);
});

test('fontFallback "loaded" appends loaded families to the stack', () => {
  const loaded = { fontFamily: 'JetBrains Mono', fontFallback: 'loaded' };
  assert.equal(cssFont(withLoadedFallback(loaded, ['Noto Sans JP'])), '400 32px "JetBrains Mono", "Noto Sans JP", system-ui, sans-serif');
  const system = { fontFamily: 'JetBrains Mono' };
  assert.equal(withLoadedFallback(system, ['Noto Sans JP']), system);
  const unnamed = { fontFallback: 'loaded' };
  assert.equal(withLoadedFallback(unnamed, ['Noto Sans JP']), unnamed);
  assert.equal(withLoadedFallback(loaded, []), loaded);
  const stacked = {
    fontFamily: ['JetBrains Mono', 'Noto Sans JP'], fontFallback: 'loaded',
    fontRuns: [{ start: 0, end: 1, fontFamily: 'Inter' }, { start: 1, end: 2, fontWeight: 700 }],
  };
  const resolved = withLoadedFallback(stacked, ['Noto Sans JP', 'Noto Emoji']);
  assert.deepEqual(resolved.fontFamily, ['JetBrains Mono', 'Noto Sans JP', 'Noto Emoji']);
  assert.deepEqual(resolved.fontRuns, [
    { start: 0, end: 1, fontFamily: ['Inter', 'Noto Sans JP', 'Noto Emoji'] },
    { start: 1, end: 2, fontWeight: 700 },
  ]);
});

test('fontFallback "loaded" extends a span family when the text has none', () => {
  const style = { fontFallback: 'loaded', fontRuns: [{ start: 0, end: 2, fontFamily: 'JetBrains Mono' }] };
  const resolved = withLoadedFallback(style, ['Noto Sans JP']);
  assert.deepEqual(resolved.fontRuns, [{ start: 0, end: 2, fontFamily: ['JetBrains Mono', 'Noto Sans JP'] }]);
  assert.equal(resolved.fontFamily, undefined);
});

// Last: the tests above expect the strings of a worker whose font set never changed.
test('a worker font names its font set after sans-serif, anew on each change', async t => {
  const originals = { fonts: globalThis.fonts, FontFace: globalThis.FontFace, fetch: globalThis.fetch };
  t.after(() => { resetFonts(); Object.assign(globalThis, originals); });
  globalThis.fonts = new Set();
  globalThis.FontFace = class { constructor(family) { this.family = family; } async load() { return this; } };
  globalThis.fetch = async () => new Response('@font-face { font-family: Demo; src: url(demo.woff); }', { headers: { 'content-type': 'text/css' } });
  const style = { fontSize: 20, fontFamily: 'Demo' };
  const fonts = [cssFont(style)];
  await loadFonts([{ location: { type: 'url', url: 'https://fonts.test/demo.css' } }], asset => asset.location.url);
  fonts.push(cssFont(style));
  resetFonts();
  fonts.push(cssFont(style));
  assert.equal(new Set(fonts).size, 3);
  for (const font of fonts) assert.match(font, /^400 20px "Demo", system-ui, sans-serif(, "celesta-font-set-\d+")?$/);
});
