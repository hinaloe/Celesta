import { raw_grammar as bashGrammar, reclassifiers as bashReclassifiers } from '@twinkleplop/bash';
import { create_language } from '@twinkleplop/core';
import { compile, define_grammar } from '@twinkleplop/core/compile';
import type { GrammarRule } from '@twinkleplop/core/compile';
import { tokenize as json } from '@twinkleplop/json';
import { tokenize as tsx } from '@twinkleplop/tsx';
import { tokenize as ts } from '@twinkleplop/typescript';

export type CodeLanguage = 'tsx' | 'ts' | 'json' | 'bash' | 'text';

export interface CodeToken {
  /** Original source, including whitespace. */
  text: string;
  /** twinkleplop token name; JSON keys are `property`, unclassified text is `plain`. */
  type: string;
  /** Start (inclusive) and end (exclusive), in UTF-16 source offsets. */
  start: number;
  end: number;
}

// twinkleplop's bash grammar splits a word at `-`, `.`, `/` and `#`, so
// `Celesta-export` became `Celesta`, `-`, then the builtin `export`, and
// `file#1` started a comment. A bash word only ends at a metacharacter, so once
// a word starts, stay in it: the word is one token, and the keyword/builtin
// reclassifier only ever sees whole words. A word starting with `-` is a flag,
// one `parameter` token. `$((...))` and `${...}` keep upstream's rules, where
// these characters are operators.
const bashWordCharacters = ['_', '-', '.', '/', ',', '~', '@', '%', ':', '#'];
const bashWordRange: GrammarRule['range'] = [['a', 'z'], ['A', 'Z'], ['0', '9']];

function wordBash(state: 'main' | 'cmd_sub' | 'conditional'): GrammarRule[] {
  const rules = bashGrammar.states[state].rules ?? [];
  const word = rules.findIndex(rule => rule.token === 'identifier' && rule.range);
  if (word < 0) throw new Error(`Unexpected twinkleplop bash grammar in ${state}`);
  const result = rules.slice();
  result[word] = { ...rules[word], state: 'word' };
  // Inside `[[ ]]`, `-f`, `-eq` and the like are test operators; leave them.
  if (state === 'conditional') return result;
  const dash = rules.findIndex(rule => Array.isArray(rule.match) && rule.match.includes('-'));
  if (dash < 0 || rules[dash].token !== 'operator') throw new Error(`Unexpected twinkleplop bash grammar in ${state}`);
  result.splice(dash, 1,
    { token: 'parameter', match: '-', state: 'flag' },
    { ...rules[dash], match: (rules[dash].match as string[]).filter(match => match !== '-') });
  return result;
}

const bash = create_language(compile(define_grammar({
  ...bashGrammar,
  states: {
    ...bashGrammar.states,
    main: { rules: wordBash('main') },
    cmd_sub: { rules: wordBash('cmd_sub') },
    conditional: { rules: wordBash('conditional') },
    word: { rules: [{ token: 'identifier', match: bashWordCharacters, range: bashWordRange }, { any: true, exit: true }] },
    flag: { rules: [{ token: 'parameter', match: bashWordCharacters, range: bashWordRange }, { any: true, exit: true }] },
  },
})), bashReclassifiers);

const tokenizers = new Map([
  ['tsx', tsx()], ['ts', ts()], ['json', json()], ['bash', bash()],
]);

/** Tokenizes the complete source without producing HTML or requiring a DOM. */
export function tokenizeCode(source: string, language: CodeLanguage = 'text'): CodeToken[] {
  if (typeof source !== 'string') throw new Error('Code source must be a string');
  if (language === 'text') return source ? [{ text: source, type: 'plain', start: 0, end: source.length }] : [];
  const tokenize = tokenizers.get(language);
  if (!tokenize) throw new Error(`Unsupported code language: ${language}`);
  const { tokens, token_types } = tokenize(source);
  const result: CodeToken[] = [];
  let offset = 0;
  const append = (type: string, start: number, end: number) => {
    if (end > start) result.push({ text: source.slice(start, end), type, start, end });
  };
  for (let i = 0; i < tokens.length; i += 3) {
    const type = tokens[i];
    const start = tokens[i + 1];
    const end = tokens[i + 2];
    append('plain', offset, start);
    append(token_types[type], start, end);
    offset = end;
  }
  append('plain', offset, source.length);
  if (language === 'json') {
    for (let start = 0; start < result.length; start++) {
      if (result[start].type !== 'string' || !result[start].text.startsWith('"')) continue;
      // Escapes split a JSON string into multiple tokens. Color the entire key,
      // including those fragments, after identifying its closing quote and colon.
      let end = start + 1;
      while (end < result.length && (result[end].type === 'string' || result[end].type === 'string_escape')) end++;
      const last = result[end - 1];
      let next = end;
      while (next < result.length && /^[ \t\r\n]*$/.test(result[next].text)) next++;
      if (last.type === 'string' && last.text.endsWith('"') && last.end > result[start].start + 1
        && result[next]?.text.startsWith(':')) {
        for (let i = start; i < end; i++) result[i].type = 'property';
      }
      start = end - 1;
    }
  }
  return result;
}

export function validateTabSize(tabSize: number): void {
  if (!Number.isSafeInteger(tabSize) || tabSize < 1) throw new Error('Code tabSize must be a positive integer');
}

/** Tab stops count code points, as do Code's columns and useTypewriter(). */
export function expandTabs(text: string, tabSize: number, column = 0): string {
  let result = '';
  for (const character of text) {
    const expanded = character === '\t' ? ' '.repeat(tabSize - column % tabSize) : character;
    result += expanded;
    column += character === '\t' ? expanded.length : 1;
  }
  return result;
}

/** Adjacent tokens of one type on one line, with tabs expanded. */
export interface CodeRun {
  type: string;
  text: string;
  /** Expanded code-point column where the run starts. */
  column: number;
}

export interface CodeLine {
  /** The line with tabs expanded, without its line break. */
  text: string;
  runs: CodeRun[];
  /** Original source code points before the line, as Code.visibleCharacters counts them. */
  start: number;
  /** Expanded columns at each original source code-point boundary. */
  columns: number[];
}

/** Splits tokens into lines at LF, CRLF and CR, expanding tabs as Code does. */
export function codeLines(tokens: readonly CodeToken[], tabSize = 2): CodeLine[] {
  validateTabSize(tabSize);
  const lines: CodeLine[] = [{ text: '', runs: [], start: 0, columns: [0] }];
  let offset = 0;
  let column = 0;
  let previousCR = false;
  for (const token of tokens) {
    for (const character of token.text) {
      const line = lines[lines.length - 1];
      if (character === '\r' || character === '\n') {
        if (character !== '\n' || !previousCR) lines.push({ text: '', runs: [], start: offset + 1, columns: [0] });
        if (character === '\n' && previousCR) lines[lines.length - 1].start = offset + 1;
        column = 0;
      } else {
        let run = line.runs[line.runs.length - 1];
        if (!run || run.type !== token.type) {
          run = { type: token.type, text: '', column };
          line.runs.push(run);
        }
        const expanded = expandTabs(character, tabSize, column);
        run.text += expanded;
        line.text += expanded;
        column += Array.from(expanded).length;
        line.columns.push(column);
      }
      previousCR = character === '\r';
      offset++;
    }
  }
  return lines;
}
