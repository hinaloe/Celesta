import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { onTestFinished, test } from 'vitest';

/** The shape loop.mjs writes to loop.json. */
interface LoopResults {
  date: string;
  results: Record<string, number[]>;
  measuredAt: Record<string, string>;
}

function measure(previous: string | undefined): { result: LoopResults; stderr: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'celesta-loop-test-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const bench = path.join(root, 'examples/versus/bench');
  mkdirSync(path.join(bench, 'celesta'), { recursive: true });
  const script = path.join(bench, 'loop.mjs');
  copyFileSync(new URL('./loop.mjs', import.meta.url), script);
  const source = path.join(bench, 'celesta/nebula.tsx');
  const original = 'const color = "#8FB8FF";\r\n';
  writeFileSync(source, original);
  const file = path.join(bench, 'loop.json');
  if (previous !== undefined) writeFileSync(file, previous);
  // Replace only the child script's exporter call; the real entry point still
  // edits/restores its source and reads/merges/writes its results on disk.
  const mock = path.join(root, 'mock-exporter.mjs');
  writeFileSync(mock, `import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
cp.spawnSync = () => ({ status: 0 });
syncBuiltinESMExports();
`);
  const run = spawnSync(process.execPath,
    ['--import', pathToFileURL(mock).href, script, '--only', 'celesta', '--runs', '1'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(source, 'utf8'), original);
  const result: LoopResults = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(result.results.celesta.length, 1);
  assert.ok(Number.isFinite(result.results.celesta[0]));
  assert.equal(result.measuredAt.celesta, result.date);
  assert.ok(Number.isFinite(Date.parse(result.date)));
  return { result, stderr: run.stderr };
}

for (const [name, previous] of [
  ['missing', undefined], ['empty', ''], ['malformed', '{'], ['null', 'null'],
] as const) {
  test(`saves fresh measurements when previous results are ${name}`, () => {
    const { result, stderr } = measure(previous);
    assert.deepEqual(Object.keys(result.results), ['celesta']);
    if (name === 'empty' || name === 'malformed') {
      assert.match(stderr, /Ignoring unreadable previous loop results/);
    } else {
      assert.equal(stderr, '');
    }
  });
}

test('retains unselected pipelines and their measurement dates', () => {
  const oldDate = '2026-09-25T12:00:00.000Z';
  const remotionDate = '2026-09-26T12:00:00.000Z';
  const { result } = measure(JSON.stringify({
    date: oldDate,
    results: { celesta: [9], remotion: [2, 3], fframes: [4, 5] },
    measuredAt: { remotion: remotionDate },
  }));
  assert.deepEqual(result.results.remotion, [2, 3]);
  assert.deepEqual(result.results.fframes, [4, 5]);
  assert.equal(result.measuredAt.remotion, remotionDate);
  assert.equal(result.measuredAt.fframes, oldDate);
});
