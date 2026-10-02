import { tokenize as bash } from '@twinkleplop/bash';
import { tokenize as json } from '@twinkleplop/json';
import { tokenize as tsx } from '@twinkleplop/tsx';
import { tokenize as ts } from '@twinkleplop/typescript';

export type CodeLanguage = 'tsx' | 'ts' | 'json' | 'bash' | 'text';

export interface CodeToken {
  /** Original source, including whitespace. */
  text: string;
  /** twinkleplop token name; unclassified text is `plain`. */
  type: string;
  /** Start (inclusive) and end (exclusive), in UTF-16 source offsets. */
  start: number;
  end: number;
}

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

export interface CodeRun {
  type: string;
  characters: string[];
  text: string;
  prefix: string;
  column: number;
  /** Code-point offset in the original source (not the expanded text). */
  start: number;
}

export interface CodeLine {
  text: string;
  runs: CodeRun[];
}

export function codeLines(tokens: readonly CodeToken[], tabSize: number): CodeLine[] {
  const lines: CodeLine[] = [{ text: '', runs: [] }];
  let offset = 0;
  let column = 0;
  let previousCR = false;
  for (const token of tokens) {
    for (const character of token.text) {
      const line = lines[lines.length - 1];
      if (character === '\r' || character === '\n') {
        if (character !== '\n' || !previousCR) lines.push({ text: '', runs: [] });
        column = 0;
      } else {
        let run = line.runs[line.runs.length - 1];
        if (!run || run.type !== token.type) {
          run = { type: token.type, characters: [], text: '', prefix: line.text, column, start: offset };
          line.runs.push(run);
        }
        const expanded = expandTabs(character, tabSize, column);
        run.characters.push(character);
        run.text += expanded;
        line.text += expanded;
        column += Array.from(expanded).length;
      }
      previousCR = character === '\r';
      offset++;
    }
  }
  return lines;
}
