import assert from 'node:assert/strict';
import { test } from 'vitest';
import { withPackagePath } from '../site/edit-url.ts';

test('inserts the package directory after the branch', () => {
  assert.equal(
    withPackagePath('https://github.com/mika-f/Celesta/edit/main/content/en/docs/04-(packages)/01-(math)/02-math-noise.md'),
    'https://github.com/mika-f/Celesta/edit/main/packages/website/content/en/docs/04-(packages)/01-(math)/02-math-noise.md',
  );
});

test('takes another package path', () => {
  assert.equal(withPackagePath('https://github.com/o/r/edit/dev/content/a.md', 'site'), 'https://github.com/o/r/edit/dev/site/content/a.md');
});

test('leaves other URLs and undefined unchanged', () => {
  assert.equal(withPackagePath(undefined), undefined);
  assert.equal(withPackagePath('https://example.com/edit/main/content/a.md'), 'https://example.com/edit/main/content/a.md');
  assert.equal(withPackagePath('https://github.com/o/r/blob/main/content/a.md'), 'https://github.com/o/r/blob/main/content/a.md');
});
