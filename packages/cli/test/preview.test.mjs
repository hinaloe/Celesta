// `preview` frame requests: the editor's .tsx preview asks for whole frames
// like an export does, and says so with `preview: true`. Run after
// `pnpm run build`.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const cli = fileURLToPath(new URL('../bin/celesta-react-render.js', import.meta.url));

function frames(requests) {
  const dir = mkdtempSync(join(tmpdir(), 'celesta-preview-'));
  const entry = join(dir, 'entry.tsx');
  writeFileSync(entry, `
    import { Composition, Rect, Static, Text, useDebugGuides, useIsPreview } from '@celesta/react';
    function Mode() {
      return <Text>{(useIsPreview() ? 'preview' : 'export') + (useDebugGuides() ? ' guides' : '')}</Text>;
    }
    function Swatch() {
      return <Rect width={4} height={4} fill={useIsPreview() ? '#ff0000' : '#ffffff'} />;
    }
    export default function Film() {
      return <Composition width={64} height={64} fps={30} durationInFrames={3}>
        <Mode />
        <Static><Swatch /></Static>
      </Composition>;
    }
  `);
  try {
    const result = spawnSync(process.execPath, [cli, entry], {
      input: requests.map((request) => `${JSON.stringify(request)}\n`).join(''),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split('\n').slice(1).map((line) => JSON.parse(line));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mode = (frame) => frame.scene.layers[0].content.text;

test('useIsPreview() is true only in frames asked for with preview', () => {
  const time = { value: 0, timescale: 30 };
  const [plain, preview, guides, again] = frames([
    { time },
    { time, preview: true },
    { time, debugGuides: true },
    { time, preview: false },
  ]);
  assert.equal(mode(plain), 'export');
  // The preview draws debug guides too.
  assert.equal(mode(preview), 'preview guides');
  assert.equal(mode(guides), 'export guides');
  assert.equal(mode(again), 'export');
});

test('a <Static> that reads useIsPreview() is walked again when preview changes', () => {
  const time = (value) => ({ value, timescale: 30 });
  const fill = (frame, definitions) => {
    const { content } = frame.scene.layers[1];
    const layers = content.type === 'staticRef'
      ? definitions.find((definition) => definition.key === content.key).layers
      : content.layers;
    return layers[0].content.fill.color;
  };
  const responses = frames([
    { time: time(0), compactTransforms: true, statics: { decoded: 0 } },
    { time: time(1), compactTransforms: true, statics: { decoded: 1 }, preview: true },
    { time: time(2), compactTransforms: true, statics: { decoded: 2 } },
  ]);
  const definitions = responses.flatMap((frame) => frame.statics ?? []);
  assert.deepEqual(responses.map((frame) => fill(frame, definitions)), ['#ffffff', '#ff0000', '#ffffff']);
  const [first, preview, plain] = responses;
  assert.notEqual(preview.scene.layers[1].content.key, first.scene.layers[1].content.key);
  assert.notEqual(plain.scene.layers[1].content.key, preview.scene.layers[1].content.key);
});
