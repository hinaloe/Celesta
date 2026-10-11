// Every template under templates/ is staged with the runtime and evaluates
// through the real CLI. Per-template cases are added below as templates land.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { entryPropsLayer, evaluate } from './harness.mjs';

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

for (const format of ['16:9', '9:16']) {
  test(`ranking evaluates in ${format}`, async () => {
    const dir = join(templatesDir, 'ranking');
    const result = await evaluate(join(dir, 'film.tsx'),
      [entryPropsLayer(dir), { source: 'props', baseDir: dir, values: { format } }]);
    assert.ok(result.config, JSON.stringify(result));
    assert.deepEqual([result.config.width, result.config.height], format === '16:9' ? [1920, 1080] : [1080, 1920]);
    assert.equal(result.config.fps, 30);
  });
}

test('ranking variants validate', async () => {
  const dir = join(templatesDir, 'ranking');
  const variants = join(dir, 'variants');
  // A variant file replaces props.json, so it is the only layer.
  for (const name of ['spring.json', 'autumn.json']) {
    const file = join(variants, name);
    const values = JSON.parse(readFileSync(file, 'utf8'));
    const result = await evaluate(join(dir, 'film.tsx'), [{ source: 'propsFile', file, baseDir: variants, values }]);
    assert.equal(result.invalidProperties, undefined, `${name}: ${JSON.stringify(result.invalidProperties)}`);
    assert.ok(result.config, `${name}: ${JSON.stringify(result)}`);
  }
});

test('ranking rejects an empty data file', async () => {
  const dir = join(templatesDir, 'ranking');
  const data = join(mkdtempSync(join(tmpdir(), 'celesta-ranking-')), 'empty.json');
  writeFileSync(data, '[]');
  const result = await evaluate(join(dir, 'film.tsx'),
    [entryPropsLayer(dir), { source: 'props', baseDir: dir, values: { data } }]);
  assert.match(String(result.error), /must be a non-empty array/);
});
