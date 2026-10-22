// SPDX-License-Identifier: Apache-2.0
//
// Japanese phrases, the same ones `lineBreak: 'phrase'` keeps on one line: a
// port of crates/budoux, itself a port of BudouX's `budoux/parser.py`. Each
// position between two characters is scored with the model's unigram
// (`UW1`–`UW6`), bigram (`BW1`–`BW3`), and trigram (`TW1`–`TW4`) weights
// around it, and a phrase starts where the score is positive. Characters are
// code points, as in the Python version and the Rust port.
//
// BudouX is Copyright Google LLC, licensed under the Apache License,
// Version 2.0.

import { JAPANESE_MODEL } from './budoux-ja';

interface Model {
  weights: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Twice upstream's base score (minus half the sum of every weight), so the score stays an integer. */
  baseScore: number;
}

let japanese: Model | undefined;

function model(): Model {
  if (!japanese) {
    let total = 0;
    for (const group of Object.values(JAPANESE_MODEL)) {
      for (const weight of Object.values(group)) total += weight;
    }
    japanese = { weights: JAPANESE_MODEL, baseScore: -total };
  }
  return japanese;
}

/**
 * Where phrases of `text` start, other than 0, as code-point offsets: the
 * places `lineBreak: 'phrase'` may break a line of Japanese.
 */
export function phraseBoundaries(text: string): number[] {
  const { weights, baseScore } = model();
  const chars = Array.from(text);
  const length = chars.length;
  const weight = (feature: string, from: number, to: number): number =>
    weights[feature]?.[chars.slice(from, to).join('')] ?? 0;
  const boundaries: number[] = [];
  for (let i = 1; i < length; i += 1) {
    let score = 0;
    if (i > 2) score += weight('UW1', i - 3, i - 2);
    if (i > 1) score += weight('UW2', i - 2, i - 1);
    score += weight('UW3', i - 1, i);
    score += weight('UW4', i, i + 1);
    if (i + 1 < length) score += weight('UW5', i + 1, i + 2);
    if (i + 2 < length) score += weight('UW6', i + 2, i + 3);

    if (i > 1) score += weight('BW1', i - 2, i);
    score += weight('BW2', i - 1, i + 1);
    if (i + 1 < length) score += weight('BW3', i, i + 2);

    if (i > 2) score += weight('TW1', i - 3, i);
    if (i > 1) score += weight('TW2', i - 2, i + 1);
    if (i + 1 < length) score += weight('TW3', i - 1, i + 2);
    if (i + 2 < length) score += weight('TW4', i, i + 3);

    if (baseScore + 2 * score > 0) boundaries.push(i);
  }
  return boundaries;
}

/**
 * `text` split into Japanese phrases (文節) with BudouX's model, the
 * phrases `lineBreak: 'phrase'` keeps on one line. Joined, they are `text`
 * again; an empty text has none.
 *
 * ```ts
 * phrases('世界中の情報を整理し、') // ['世界中の', '情報を', '整理し、']
 * ```
 */
export function phrases(text: string): string[] {
  if (text === '') return [];
  const chars = Array.from(text);
  const parts: string[] = [];
  let start = 0;
  for (const boundary of phraseBoundaries(text)) {
    parts.push(chars.slice(start, boundary).join(''));
    start = boundary;
  }
  parts.push(chars.slice(start).join(''));
  return parts;
}
