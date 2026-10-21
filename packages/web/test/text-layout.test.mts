import assert from 'node:assert/strict';
import { onTestFinished, test, vi } from 'vitest';
import { cssFont, letterSpacingPx, measureLine, runPieces, textLines, textLineRanges, textMeasurer, textStyle, withLoadedFallback } from '../src/text-layout';
// The font set text-layout reads, which the tests below change.
import { loadFonts, resetFonts } from '../src/fonts';
import type { FontRun, TextStyle } from '../src/types';
import { fetchStub, scope, standIn } from './stand-in.mjs';

/** A canvas context standing in for the browser's, with what text layout calls. */
const context = <T extends object>(value: T) => standIn<CanvasRenderingContext2D>(value);

/** `OffscreenCanvas` drawing through `ctx`, as `textMeasurer` makes one, until the test ends. */
function offscreen(ctx: CanvasRenderingContext2D) {
  const original = globalThis.OffscreenCanvas;
  onTestFinished(() => { globalThis.OffscreenCanvas = original; });
  globalThis.OffscreenCanvas = standIn<typeof OffscreenCanvas>(class { getContext() { return ctx; } });
}

test('wrapping uses the requested language, including with older canvas contexts', () => {
  const locales: Intl.LocalesArgument[] = [], Segmenter = Intl.Segmenter;
  vi.spyOn(Intl, 'Segmenter').mockImplementation(function(locale, options) {
    locales.push(locale);
    return new Segmenter(locale, options);
  });
  const ctx = context({ measureText: (text: string) => ({ width: text.length, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }) });
  assert.deepEqual(textLines(ctx, 'hello world', 6, ' ja '), ['hello', 'world']);
  offscreen(ctx);
  const metrics = textMeasurer()({ text: 'hello world', style: { lang: 'th' }, maxWidth: 6, fonts: [] });
  assert.deepEqual(locales, ['ja', 'th']);
  assert.equal(metrics.lines, 2);
  assert.deepEqual(metrics.lineStarts, [0, 6]);
});

test('whole-run kerning and ligature widths are preserved without fabricating glyph positions', () => {
  // A shaping engine measures AV and fi differently from separate characters.
  const widths: Record<string, number> = { AV: 35, fi: 18 };
  offscreen(context({ measureText: (text: string) => ({ width: widths[text] ?? 20, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }) }));
  for (const [text, width] of [['AV', 35], ['fi', 18]] as const) {
    const metrics = textMeasurer()({ text, style: {}, fonts: [] });
    assert.equal(metrics.width, width);
    assert.throws(() => metrics.glyphs, /Shaped glyph metrics.*native renderer/);
  }
});


test('runPieces keeps clusters whole and uses each cluster first code point', () => {
  const runs: FontRun[] = [{ start: 1, end: 3, fontWeight: 700 }];
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
  const fonts: string[] = [];
  const ctx = context({
    font: '',
    measureText(text: string) {
      fonts.push(this.font);
      const bold = this.font.startsWith('700');
      const width = Array.from(text).length * (bold ? 2 : 1);
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: bold ? 9 : 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 };
    },
  });
  const style: TextStyle = { fontSize: 10 };
  const runs: FontRun[] = [{ start: 2, end: 4, fontWeight: 700 }];
  ctx.font = cssFont(style);
  const line = measureLine(ctx, style, 'abcd', 0, runs);
  assert.equal(line.width, 2 + 4);
  assert.equal(line.actualBoundingBoxAscent, 9);
  assert.equal(line.fontBoundingBoxAscent, 8);
  assert.equal(ctx.font, cssFont(style));
  assert.ok(fonts.includes(cssFont(style, runs[0])));
  const width = (text: string, start: number) => measureLine(ctx, style, text, start, runs).width;
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
  const ctx = context({
    font: '',
    measureText(text: string) {
      const bold = this.font.startsWith('700');
      const width = Array.from(text).length;
      return { width, actualBoundingBoxLeft: bold ? 5 : 0, actualBoundingBoxRight: bold ? width + 4 : width, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 };
    },
  });
  const style: TextStyle = { fontSize: 10 };
  ctx.font = cssFont(style);
  const line = measureLine(ctx, style, 'abcdef', 0, [{ start: 2, end: 4, fontWeight: 700 }]);
  assert.equal(line.actualBoundingBoxLeft, 3);
  assert.equal(line.actualBoundingBoxRight, 8);
});

test('the browser measurer rejects invalid font runs like scene rendering', () => {
  offscreen(context({ font: '', measureText: (text: string) => ({ width: text.length, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }) }));
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
  const ctx = context({});
  textStyle(ctx, { fontSize: 50, letterSpacing: { em: 0.1 }, lang: 'en' });
  assert.equal(ctx.letterSpacing, '5px');
});

test('cssFont turns a font stack into a CSS family list', () => {
  assert.equal(cssFont({ fontSize: 20, fontFamily: ['Inter', 'Noto Sans JP'] }), '400 20px "Inter", "Noto Sans JP", system-ui, sans-serif');
  assert.equal(cssFont({ fontSize: 20, fontFamily: 'Serif A' }, { start: 0, end: 1, fontFamily: ['Mono B', 'Noto Sans JP'] }), '400 20px "Mono B", "Noto Sans JP", system-ui, sans-serif');
});

test('the browser measurer wraps and measures with font runs', () => {
  offscreen(context({
    font: '',
    measureText(text: string) {
      const width = Array.from(text).length * (this.font.startsWith('700') ? 2 : 1);
      return { width, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 };
    },
  }));
  const metrics = textMeasurer()({ text: 'ab cd', style: { fontSize: 10, fontRuns: [{ start: 0, end: 5, fontWeight: 700 }] }, maxWidth: 6, fonts: [] });
  assert.equal(metrics.lines, 2);
  assert.equal(metrics.width, 4);
});

test('wrapped ranges retain source code-point offsets across trimmed spaces and CRLF', () => {
  const ctx = context({ measureText: (text: string) => ({ width: Array.from(text).length }) });
  assert.deepEqual(textLineRanges(ctx, '😀 AV   AV\r\né', 5, 'en'), [
    { text: '😀 AV', start: 0 }, { text: 'AV', start: 7 }, { text: 'é', start: 11 },
  ]);
});

test('fontFallback "loaded" appends loaded families to the stack', () => {
  const loaded: TextStyle = { fontFamily: 'JetBrains Mono', fontFallback: 'loaded' };
  assert.equal(cssFont(withLoadedFallback(loaded, ['Noto Sans JP'])), '400 32px "JetBrains Mono", "Noto Sans JP", system-ui, sans-serif');
  const system: TextStyle = { fontFamily: 'JetBrains Mono' };
  assert.equal(withLoadedFallback(system, ['Noto Sans JP']), system);
  const unnamed: TextStyle = { fontFallback: 'loaded' };
  assert.equal(withLoadedFallback(unnamed, ['Noto Sans JP']), unnamed);
  assert.equal(withLoadedFallback(loaded, []), loaded);
  const stacked: TextStyle = {
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
  const style: TextStyle = { fontFallback: 'loaded', fontRuns: [{ start: 0, end: 2, fontFamily: 'JetBrains Mono' }] };
  const resolved = withLoadedFallback(style, ['Noto Sans JP']);
  assert.deepEqual(resolved.fontRuns, [{ start: 0, end: 2, fontFamily: ['JetBrains Mono', 'Noto Sans JP'] }]);
  assert.equal(resolved.fontFamily, undefined);
});

// Last: the tests above expect the strings of a worker whose font set never changed.
test('a worker font names its font set after sans-serif, anew on each change', async () => {
  const originals = { fonts: scope.fonts, FontFace: globalThis.FontFace, fetch: globalThis.fetch };
  onTestFinished(() => { resetFonts(); Object.assign(globalThis, originals); });
  scope.fonts = new Set();
  globalThis.FontFace = standIn<typeof FontFace>(class { constructor(readonly family: string) {} async load() { return this; } });
  globalThis.fetch = fetchStub(async () => new Response('@font-face { font-family: Demo; src: url(demo.woff); }', { headers: { 'content-type': 'text/css' } }));
  const style: TextStyle = { fontSize: 20, fontFamily: 'Demo' };
  const fonts = [cssFont(style)];
  const url = 'https://fonts.test/demo.css';
  await loadFonts([{ id: url, location: { type: 'url', url } }], () => url);
  fonts.push(cssFont(style));
  resetFonts();
  fonts.push(cssFont(style));
  assert.equal(new Set(fonts).size, 3);
  for (const font of fonts) assert.match(font, /^400 20px "Demo", system-ui, sans-serif(, "celesta-font-set-\d+")?$/);
});
