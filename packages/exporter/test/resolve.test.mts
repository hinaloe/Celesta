import assert from 'node:assert/strict';
import { test } from 'vitest';

import { EXPORTER_COMMAND, installedExporters, resolveExporter } from '../src/index.js';

test('an explicit exporter wins over CELESTA_EXPORTER', () => {
  assert.equal(resolveExporter({ exporter: '/bin/a', env: { CELESTA_EXPORTER: '/bin/b' } }), '/bin/a');
  assert.equal(resolveExporter({ env: { CELESTA_EXPORTER: '/bin/b' }, exists: () => true }), '/bin/b');
});

test('an installed Celesta comes before PATH', () => {
  const [app] = installedExporters('darwin');
  assert.match(app, /Celesta\.app\/Contents\/MacOS\/Celesta-export$/);
  assert.equal(resolveExporter({ env: {}, platform: 'darwin', exists: (candidate: string) => candidate === app }), app);
  assert.equal(
    resolveExporter({ env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, platform: 'win32', exists: () => true }),
    'C:\\Users\\me\\AppData\\Local\\Programs\\Celesta\\Celesta-export.exe',
  );
  assert.equal(resolveExporter({ env: {}, platform: 'linux', exists: () => true }), '/opt/celesta/celesta-exporter');
});

test('without an install it falls back to PATH', () => {
  assert.equal(resolveExporter({ env: {}, platform: 'darwin', exists: () => false }), EXPORTER_COMMAND);
  assert.deepEqual(installedExporters('win32', {}), []);
});
