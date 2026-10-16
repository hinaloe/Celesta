export interface GoogleFontOptions {
  /** Static weights, from 100 to 900 in steps of 100. Defaults to [400]. */
  weights?: readonly number[];
  /**
   * Google Fonts script subsets, such as latin, cyrillic, or japanese. Omitted
   * or empty loads every script the family has; listing subsets loads only
   * those scripts, plus Latin when the family has it. Not combinable with text.
   */
  subsets?: readonly string[];
  /**
   * The characters to load, such as every string a film draws. Google Fonts
   * returns one file per weight holding only these glyphs; characters left
   * out are drawn with a fallback font. Not combinable with subsets.
   */
  text?: string;
}

/** A Google Fonts CSS URL, usable by <Font src> and measureText's fonts option. */
export function googleFont(family: string, { weights = [400], subsets = [], text }: GoogleFontOptions = {}): string {
  family = family.trim();
  if (!family || /[:|]/.test(family)) {
    throw new Error('Google Fonts requires one non-empty family name without ":" or "|".');
  }
  if (!weights.length || weights.some(weight => !Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100 !== 0)) {
    throw new Error(`Google Fonts "${family}" requires weights from 100 to 900 in steps of 100.`);
  }
  if (subsets.some(subset => !/^[a-z]+(?:-[a-z]+)*$/.test(subset))) {
    throw new Error(`Google Fonts "${family}" requires script subset names such as "latin" or "japanese".`);
  }
  if (text !== undefined && subsets.length) {
    throw new Error(`Google Fonts "${family}" accepts either \`text\` or \`subsets\`, but not both.`);
  }
  if (text === '') {
    throw new Error(`Google Fonts "${family}" requires at least one character in \`text\`.`);
  }
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');
  const sortedWeights = [...new Set(weights)].sort((a, b) => a - b);
  const sortedSubsets = [...new Set(subsets)].sort();
  // Only the v1 CSS API takes script subsets, but without &subset= it returns
  // Latin alone to clients without unicode-range. The v2 API ignores subsets
  // and returns every script, so it serves the whole-family and text= requests.
  if (!sortedSubsets.length) {
    const url = `https://fonts.googleapis.com/css2?family=${encode(family)}:wght@${sortedWeights.join(';')}`;
    // Unique, sorted characters: the same set of glyphs shares one cache entry.
    return text === undefined ? url : `${url}&text=${encode([...new Set(text)].sort().join(''))}`;
  }
  return `https://fonts.googleapis.com/css?family=${encode(family)}:${sortedWeights.join(',')}&subset=${sortedSubsets.join(',')}`;
}
