// Every template under templates/ is staged with the runtime and evaluates
// through the real CLI. Per-template cases are added below as templates land.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { evaluate } from './harness.mjs';

const templatesDir = fileURLToPath(new URL('../', import.meta.url));

function templateNames() {
  return readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(templatesDir, entry.name, 'template.json')))
    .map((entry) => entry.name)
    .sort();
}

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object?.[key]]));
}

test('staging copies every template and leaves out source/', () => {
  const staged = fileURLToPath(new URL('../../packages/cli/dist/templates/', import.meta.url));
  for (const name of templateNames()) {
    assert.ok(existsSync(join(staged, name, 'template.json')), name);
    assert.ok(!existsSync(join(staged, name, 'source')), `${name}/source`);
  }
});

test('blank evaluates without inputs', async () => {
  const result = await evaluate(join(templatesDir, 'blank/film.tsx'), []);
  assert.deepEqual(pick(result.config, ['width', 'height', 'fps', 'durationInFrames']),
    { width: 1920, height: 1080, fps: 30, durationInFrames: 150 });
});
