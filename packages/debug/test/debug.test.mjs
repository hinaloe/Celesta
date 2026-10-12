import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const cli = fileURLToPath(new URL('../../cli/bin/celesta-react-render.js', import.meta.url));

/** Renders `body` inside a 1080×1920 composition once per request, returning each frame's layers. */
function render(body, requests) {
  const dir = mkdtempSync(join(tmpdir(), 'celesta-debug-'));
  const entry = join(dir, 'entry.tsx');
  writeFileSync(
    entry,
    `import { Composition, Rect } from '@celesta/react'; import { DebugBounds, DebugOverlay } from '@celesta/debug';\n` +
      `export default function Root() {\n` +
      `  return <Composition width={1080} height={1920} fps={30} durationInFrames={1}>${body}</Composition>;\n` +
      `}\n`,
  );
  try {
    const result = spawnSync(process.execPath, [cli, entry], {
      input: requests.map((request) => JSON.stringify({ time: { value: 0, timescale: 1 }, ...request })).join('\n') + '\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const [, ...frames] = result.stdout.split(/\r?\n/).filter(Boolean).map(JSON.parse);
    return frames.map((frame) => {
      assert.ok(frame.scene, JSON.stringify(frame));
      return frame.scene.layers;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rects = (layers) =>
  layers.flatMap((layer) =>
    layer.content.type === 'group'
      ? rects(layer.content.layers)
      : layer.content.type === 'rect'
        ? [{ ...layer.transform.position, width: layer.content.width, height: layer.content.height }]
        : [],
  );

test('guides draw only when a frame asks for them', () => {
  const [plain, guides] = render(
    `<DebugOverlay /><DebugBounds width={100} height={50}><Rect width={100} height={50} fill="#fff" /></DebugBounds>`,
    [{}, { debugGuides: true }],
  );
  assert.equal(plain.length, 1);
  assert.equal(rects(plain).length, 1);
  assert.ok(rects(guides).length > 1);
});

test('the vertical-social preset outlines and shades the covered edges', () => {
  const [layers] = render(`<DebugOverlay safeArea="vertical-social" showCenter={false} showFrame={false} />`, [
    { debugGuides: true },
  ]);
  assert.deepEqual(rects(layers), [
    { x: 0, y: 0, width: 1080, height: 192 },
    { x: 0, y: 1536, width: 1080, height: 384 },
    { x: 0, y: 192, width: 72, height: 1344 },
    { x: 880, y: 192, width: 200, height: 1344 },
    { x: 72, y: 192, width: 808, height: 1344 },
  ]);
});

test('per-edge insets leave unset edges at zero and shade can be turned off', () => {
  const [layers] = render(
    `<DebugOverlay safeArea={{ right: 150, bottom: 400 }} shade={false} showCenter={false} showFrame={false} />`,
    [{ debugGuides: true }],
  );
  assert.deepEqual(rects(layers), [{ x: 0, y: 0, width: 930, height: 1520 }]);
});
