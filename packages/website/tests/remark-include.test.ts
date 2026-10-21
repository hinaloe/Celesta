import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Code } from 'mdast';
import { test } from 'vitest';
import remarkDirective from 'remark-directive';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { VFile } from 'vfile';
import { remarkInclude } from '../plugins/remark-include.ts';

// <tmp>/repo/packages/website, as in the repository; <tmp>/outside.txt lies outside the repository.
const base = mkdtempSync(join(tmpdir(), 'remark-include-'));
const root = join(base, 'repo/packages/website');
mkdirSync(join(root, 'examples'), { recursive: true });
mkdirSync(join(base, 'repo/examples'));
writeFileSync(join(root, 'examples/a.tsx'), 'export {}\n');
writeFileSync(join(base, 'repo/examples/b.json'), '{}\n');
writeFileSync(join(base, 'outside.txt'), 'secret\n');

const processor = unified().use(remarkParse).use(remarkInclude, { root }).use(remarkStringify);
const run = (markdown: string, data: Record<string, unknown> = {}) => {
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

test('reads files elsewhere in the repository', async () => {
  const out = await run('```json file=../../examples/b.json\n```\n');
  assert.match(out, /\{\}/);
});

test('rejects a path outside the repository', async () => {
  await assert.rejects(run('```txt file=../../../outside.txt\n```\n'), /remark-include: "\.\.\/\.\.\/\.\.\/outside\.txt" resolves outside the repository/);
});

test('rejects an absolute path outside the repository', async () => {
  await assert.rejects(run(`\`\`\`txt file=${join(base, 'outside.txt')}\n\`\`\`\n`), /resolves outside the repository/);
});

test('ignores fences without file=', async () => {
  const markdown = '```tsx title="x"\nconst a = 1;\n```\n';
  assert.equal(await run(markdown), markdown);
});

test('ignores fences with a body', async () => {
  const markdown = '```tsx file=examples/a.tsx\nconst a = 1;\n```\n';
  assert.equal(await run(markdown), markdown);
});

test('fills a fence inside a tab, as Makit 0.9 parses tabs (remark-directive)', async () => {
  const tabs = unified().use(remarkParse).use(remarkDirective).use(remarkInclude, { root });
  const tree = await tabs.run(tabs.parse('::::tabs[Platform]{default="macOS"}\n:::tab[macOS]\n\n```tsx file=examples/a.tsx title="Scene"\n```\n\n:::\n::::\n'));
  const [group] = tree.children;
  assert.ok(group.type === 'containerDirective', 'the group is a container directive');
  const [, tab] = group.children; // the label paragraph, then the tab
  assert.ok(tab.type === 'containerDirective', 'the tab is a container directive');
  assert.equal(tab.name, 'tab');
  const code = tab.children.find((node): node is Code => node.type === 'code');
  assert.ok(code, 'the tab holds a code block');
  assert.deepEqual({ meta: code.meta, value: code.value }, { meta: 'title="Scene"', value: 'export {}' });
});
