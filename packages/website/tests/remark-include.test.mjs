import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { VFile } from 'vfile';
import { remarkInclude } from '../plugins/remark-include.ts';

const root = mkdtempSync(join(tmpdir(), 'remark-include-'));
mkdirSync(join(root, 'examples'));
writeFileSync(join(root, 'examples/a.tsx'), 'export {}\n');

const processor = unified().use(remarkParse).use(remarkInclude, { root }).use(remarkStringify);
const run = (markdown, data = {}) => {
  const file = new VFile(markdown);
  Object.assign(file.data, data);
  return processor.process(file).then(String);
};

test('inlines the file', async () => {
  const out = await run('```tsx file=examples/a.tsx\n```\n');
  assert.match(out, /export \{\}/);
  assert.match(out, /title="a\.tsx"/);
  assert.doesNotMatch(out, /file=/);
});

test('keeps an explicit title', async () => {
  const out = await run('```tsx file=examples/a.tsx title="Scene"\n```\n');
  assert.match(out, /```tsx title="Scene"\n/);
  assert.doesNotMatch(out, /file=|a\.tsx/);
});

test('accepts a double-quoted path', async () => {
  const out = await run('```tsx file="examples/a.tsx"\n```\n');
  assert.match(out, /export \{\}/);
});

test('resolves from the root, not the chapter', async () => {
  const out = await run('```tsx file=examples/a.tsx\n```\n', { linkRewriteContext: { currentRelativePath: 'en/docs/01-(x)/02-y.md' } });
  assert.match(out, /export \{\}/);
});

test('fails on a missing file', async () => {
  await assert.rejects(run('```tsx file=examples/missing.tsx\n```\n'), /examples\/missing\.tsx/);
});

test('ignores fences without file=', async () => {
  const markdown = '```tsx title="x"\nconst a = 1;\n```\n';
  assert.equal(await run(markdown), markdown);
});

test('ignores fences with a body', async () => {
  const markdown = '```tsx file=examples/a.tsx\nconst a = 1;\n```\n';
  assert.equal(await run(markdown), markdown);
});
