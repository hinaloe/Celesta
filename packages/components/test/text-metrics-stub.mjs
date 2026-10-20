// A stand-in for the shaper, installed with setTextMeasurer(): Japanese
// characters are a full em wide, others half an em (0.6 em in "mono"); `\n`
// breaks lines, and so does `maxWidth`, between any two characters; the line
// box is 1.25 em with the baseline 1 em down.

import { setTextMeasurer } from '@celesta/react/internal';

function advance(character, style) {
  const size = style.fontSize ?? 20;
  if (/[　-鿿]/u.test(character)) return size;
  return size * (style.fontFamily === 'mono' ? 0.6 : 0.5);
}

export function stubMetrics(request) {
  const { text, style, maxWidth } = request;
  const size = style.fontSize ?? 20;
  const lineHeight = style.lineHeight ?? size * 1.25;
  const lines = text.split('\n').flatMap((paragraph) => {
    const wrapped = [[]];
    for (const character of Array.from(paragraph)) {
      const line = wrapped[wrapped.length - 1];
      const width = line.reduce((sum, c) => sum + advance(c, style), 0) + advance(character, style);
      if (maxWidth !== undefined && line.length > 0 && width > maxWidth) wrapped.push([character]);
      else line.push(character);
    }
    return wrapped.map((line) => line.join(''));
  });
  const widths = lines.map((line) => Array.from(line).reduce((sum, c) => sum + advance(c, style), 0));
  return {
    width: Math.max(...widths), height: lines.length * lineHeight,
    ascent: size, descent: lineHeight - size, lineHeight, capHeight: size * 0.7, xHeight: size * 0.5,
    lines: lines.length, glyphs: [],
  };
}

/** Installs the stub; returns the requests it measures. */
export function installStubMeasurer() {
  const requests = [];
  setTextMeasurer(async (request) => stubMetrics(request), (request) => {
    requests.push(request);
    return stubMetrics(request);
  });
  return requests;
}
