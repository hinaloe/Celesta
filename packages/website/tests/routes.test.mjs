import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localeCodes } from '../src/site/locales.ts';
import { getDocGroups } from '../src/site/docs-nav.ts';
import { showcase } from '../site/showcase-catalog.ts';
import { docPath, parseRoute, showcasePath } from '../src/site/routes.ts';

test('parse home, documentation and showcase addresses', () => {
  for (const [path, expected] of [
    ['/', { locale: 'en', page: 'home' }],
    ['/index.html', { locale: 'en', page: 'home' }],
    ['/ja/', { locale: 'ja', page: 'home' }],
    ['/ja/index.html', { locale: 'ja', page: 'home' }],
    ['/en/docs/', { locale: 'en', page: 'docs', slug: 'overview' }],
    ['/ja/docs/index.html', { locale: 'ja', page: 'docs', slug: 'overview' }],
    ['/ja/docs/export/', { locale: 'ja', page: 'docs', slug: 'export' }],
    ['/ja/docs/export', { locale: 'ja', page: 'docs', slug: 'export' }],
    ['/docs/export/', { locale: 'en', page: 'docs', slug: 'export' }],
    ['/docs/index.html', { locale: 'en', page: 'docs', slug: 'overview' }],
    ['/ja/showcase/', { locale: 'ja', page: 'showcase', slug: 'overview' }],
    ['/ja/showcase/36-days/', { locale: 'ja', page: 'showcase', slug: '36-days' }],
    ['/showcase/apex/', { locale: 'en', page: 'showcase', slug: 'apex' }],
    ['/showcase/index.html', { locale: 'en', page: 'showcase', slug: 'overview' }],
  ]) assert.deepEqual(parseRoute(path), expected, path);
});

test('other addresses are not pages', () => {
  for (const path of ['/en', '/ja/unknown/', '/ja/docs/export/extra/', '/ja/docs/Export/', '/fr/docs/export/', '/assets/site.js', '/showcase-assets/examples/x.woff2']) {
    assert.equal(parseRoute(path).page, 'other', path);
  }
});

test('built paths parse back to their page in every locale', () => {
  const slugs = ['overview', ...getDocGroups('en').flatMap(group => group.pages).map(page => page.slug)];
  for (const locale of localeCodes) {
    for (const slug of slugs) assert.deepEqual(parseRoute(docPath(slug, locale)), { locale, page: 'docs', slug });
    assert.deepEqual(parseRoute(showcasePath('', locale)), { locale, page: 'showcase', slug: 'overview' });
    for (const { slug } of showcase) assert.deepEqual(parseRoute(showcasePath(slug, locale)), { locale, page: 'showcase', slug });
  }
});

test('path builders keep their defaults', () => {
  assert.equal(docPath('overview', 'ja'), '/ja/docs/');
  assert.equal(docPath('export'), '/en/docs/export/');
  assert.equal(showcasePath(), '/en/showcase/');
  assert.equal(showcasePath('apex', 'ja'), '/ja/showcase/apex/');
});
