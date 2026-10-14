// `layerSource` requests: the editor asks which JSX produced a layer. Run
// after `pnpm run build:runtime`.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const cli = fileURLToPath(new URL('../bin/celesta-react-render.js', import.meta.url));

const time = { value: 0, timescale: 30 };

function run(requests, flags = ['--source-locations']) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'celesta-layer-source-')));
  const entry = join(dir, 'entry.tsx');
  const title = join(dir, 'title.tsx');
  // The Rect is on line 3, column 10 of title.tsx.
  writeFileSync(title, [
    "import { Rect } from '@celesta/react';",
    'export function Title() {',
    '  return <Rect id="title-rect" width={4} height={4} fill="#ffffff" />;',
    '}',
    '',
  ].join('\n'));
  writeFileSync(entry, `
    import { Composition, Rect, Static, Text } from '@celesta/react';
    import { Title } from './title';
    export default function Film() {
      return <Composition width={64} height={64} fps={30} durationInFrames={3}>
        <Title />
        <Static><Rect id="static-rect" width={4} height={4} fill="#00ff00" /></Static>
        <Text id="label">hello</Text>
      </Composition>;
    }
  `);
  try {
    const result = spawnSync(process.execPath, [cli, entry, ...flags], {
      input: requests.map((request) => `${JSON.stringify(request)}\n`).join(''),
      encoding: 'utf8',
    });
    return { dir, entry, title, result, responses: result.stdout.trim().split('\n').slice(1).map((line) => JSON.parse(line)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('finds the JSX of a layer in another file', () => {
  const { responses, title, entry, result } = run([{ layerSource: 'title-rect', time, preview: true }]);
  assert.equal(result.status, 0, result.stderr);
  const { chain } = responses[0].layerSource;
  assert.equal(chain[0].name, 'Rect');
  assert.equal(chain[0].file, title);
  assert.equal(chain[0].line, 3);
  assert.equal(chain[0].column, 10);
  const outer = chain.find((entryItem) => entryItem.name === 'Title');
  assert.ok(outer, JSON.stringify(chain));
  assert.equal(outer.file, entry);
});

test('finds layers inside <Static>', () => {
  const { responses, result } = run([
    { time, compactTransforms: true, statics: { decoded: 0 } },
    { layerSource: 'static-rect', time, preview: true },
    { time, compactTransforms: true, statics: { decoded: 1 } },
  ]);
  assert.equal(result.status, 0, result.stderr);
  const [first, lookup, second] = responses;
  assert.ok(lookup.layerSource.chain.length > 0);
  assert.equal(lookup.layerSource.chain[0].name, 'Rect');
  const reference = (frame) => frame.scene.layers.find((layer) => layer.content.type === 'staticRef');
  assert.equal(second.seq, first.seq + 1);
  assert.equal(reference(second).content.key, reference(first).content.key);
  assert.equal('statics' in second, false);
});

test('answers null for unknown ids', () => {
  const { responses } = run([{ layerSource: 'nope', time, preview: true }]);
  assert.deepEqual(responses[0], { layerSource: { chain: null } });
});

test('answers [] without --source-locations', () => {
  const { responses, result } = run([{ layerSource: 'title-rect', time, preview: true }], []);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(responses[0], { layerSource: { chain: [] } });
});

test('does not change scenes', () => {
  const requests = [0, 1, 2].map((value) => ({ time: { value, timescale: 30 }, preview: true }));
  const withFlag = run(requests).responses.map((frame) => frame.scene);
  const without = run(requests, []).responses.map((frame) => frame.scene);
  assert.equal(withFlag.length, 3);
  assert.deepEqual(withFlag, without);
});

test('rejects unknown options', () => {
  const { result } = run([], ['--source-location']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^usage: .*\[--source-locations\]/);
});
