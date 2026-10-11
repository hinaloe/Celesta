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

// ROW_START + 3 rows * ROW_STAGGER + BAR_GROW + HOLD = 24 + 24 + 30 + 75 for
// the three sample rows in data.json.
const RANKING_SAMPLE_FRAMES = 153;

function rankingWithData(contents) {
  const dir = join(templatesDir, 'ranking');
  const data = join(mkdtempSync(join(tmpdir(), 'celesta-ranking-')), 'data.json');
  writeFileSync(data, contents);
  return evaluate(join(dir, 'film.tsx'), [entryPropsLayer(dir), { source: 'props', baseDir: dir, values: { data } }]);
}

for (const format of ['16:9', '9:16']) {
  test(`ranking evaluates in ${format}`, async () => {
    const dir = join(templatesDir, 'ranking');
    const result = await evaluate(join(dir, 'film.tsx'),
      [entryPropsLayer(dir), { source: 'props', baseDir: dir, values: { format } }]);
    assert.ok(result.config, JSON.stringify(result));
    assert.deepEqual([result.config.width, result.config.height], format === '16:9' ? [1920, 1080] : [1080, 1920]);
    assert.equal(result.config.fps, 30);
    assert.equal(result.config.durationInFrames, RANKING_SAMPLE_FRAMES);
  });
}

test('ranking variants validate', async () => {
  const dir = join(templatesDir, 'ranking');
  const variants = join(dir, 'variants');
  // variants/ holds props files (objects) and the data files they name
  // (arrays). A props file replaces props.json, so it is the only layer.
  const propsFiles = readdirSync(variants)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, file: join(variants, name) }))
    .map((entry) => ({ ...entry, values: JSON.parse(readFileSync(entry.file, 'utf8')) }))
    .filter(({ values }) => values !== null && typeof values === 'object' && !Array.isArray(values));
  assert.ok(propsFiles.length >= 2, `variants: ${propsFiles.map(({ name }) => name)}`);
  for (const { name, file, values } of propsFiles) {
    const result = await evaluate(join(dir, 'film.tsx'), [{ source: 'propsFile', file, baseDir: variants, values }]);
    assert.equal(result.invalidProperties, undefined, `${name}: ${JSON.stringify(result.invalidProperties)}`);
    assert.ok(result.config, `${name}: ${JSON.stringify(result)}`);
  }
});

test('ranking rejects an empty data file', async () => {
  const result = await rankingWithData('[]');
  assert.match(String(result.error), /must be a non-empty array/);
});

test('ranking names the data file when it is not JSON', async () => {
  const result = await rankingWithData('[{ "name": ');
  assert.match(String(result.error), /data\.json: /);
});

test('ranking rejects a row without a name, naming the file and row', async () => {
  const result = await rankingWithData('[{ "name": "りんご", "score": 3 }, { "score": 2 }]');
  assert.match(String(result.error), /data\.json: row 1 must be an object with a string "name" and a number "score"/);
});

test('ranking rejects a null row', async () => {
  const result = await rankingWithData('[{ "name": "りんご", "score": 3 }, null]');
  assert.match(String(result.error), /data\.json: row 1 /);
});
