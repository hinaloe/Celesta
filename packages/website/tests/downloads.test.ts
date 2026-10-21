import assert from 'node:assert/strict';
import { test } from 'vitest';
import { downloadLinks } from '../site/downloads.ts';

const latest = 'https://github.com/mika-f/Celesta/releases/latest';

test('defaults to the latest release', () => {
  assert.deepEqual(downloadLinks({}), { all: latest, macOS: latest, Windows: latest });
});

test('platform links fall back to the general link', () => {
  assert.deepEqual(downloadLinks({ CELESTA_DOWNLOAD_URL: 'u' }), { all: 'u', macOS: 'u', Windows: 'u' });
});

test('platform links override', () => {
  assert.deepEqual(downloadLinks({ CELESTA_DOWNLOAD_URL: 'u', CELESTA_DOWNLOAD_URL_MACOS: 'm' }), { all: 'u', macOS: 'm', Windows: 'u' });
  assert.deepEqual(downloadLinks({ CELESTA_DOWNLOAD_URL_WINDOWS: 'w' }), { all: latest, macOS: latest, Windows: 'w' });
});

test('empty strings count as unset', () => {
  assert.deepEqual(downloadLinks({ CELESTA_DOWNLOAD_URL: '', CELESTA_DOWNLOAD_URL_MACOS: '' }), { all: latest, macOS: latest, Windows: latest });
  assert.deepEqual(downloadLinks({ CELESTA_DOWNLOAD_URL: 'u', CELESTA_DOWNLOAD_URL_MACOS: '', CELESTA_DOWNLOAD_URL_WINDOWS: '' }), { all: 'u', macOS: 'u', Windows: 'u' });
});

test('reads process.env by default', () => {
  const saved = process.env.CELESTA_DOWNLOAD_URL_MACOS;
  process.env.CELESTA_DOWNLOAD_URL_MACOS = 'https://example.com/m.dmg';
  try {
    assert.equal(downloadLinks().macOS, 'https://example.com/m.dmg');
  } finally {
    if (saved === undefined) delete process.env.CELESTA_DOWNLOAD_URL_MACOS;
    else process.env.CELESTA_DOWNLOAD_URL_MACOS = saved;
  }
});
