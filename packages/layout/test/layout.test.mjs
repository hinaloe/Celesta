import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const cli = fileURLToPath(new URL('../../cli/bin/celesta-react-render.js', import.meta.url));

test('layout components position children inside inherited bounds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'celesta-layout-'));
  const entry = join(dir, 'entry.tsx');
  writeFileSync(
    entry,
    `import { Composition, Text } from '@celesta/react'; import { Center, Fit, Grid, SafeArea, Stack } from '@celesta/layout';\n` +
      `export default function Root() {\n` +
      `  return (\n` +
      `    <Composition width={300} height={200} fps={30} durationInFrames={1}>\n` +
      `      <SafeArea padding={20}>\n` +
      `        <Center><Text>center</Text></Center>\n` +
      `        <Stack spacing={15}><Text>a</Text><Text>b</Text><Text>c</Text></Stack>\n` +
      `        <Grid columns={2} columnWidth={50} rowHeight={40} columnGap={10} rowGap={5}><Text>a</Text><Text>b</Text><Text>c</Text></Grid>\n` +
      `        <Fit sourceWidth={100} sourceHeight={100}><Text>fit</Text></Fit>\n` +
      `      </SafeArea>\n` +
      `    </Composition>\n` +
      `  );\n` +
      `}\n`,
  );

  try {
    const result = spawnSync(process.execPath, [cli, entry], {
      input: '{"time":{"value":0,"timescale":1}}\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const [, frame] = result.stdout.split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const safeArea = frame.scene.layers[0];
    assert.deepEqual(safeArea.transform.position, { x: 20, y: 20 });

    const [center, stack, grid, fit] = safeArea.content.layers;
    assert.deepEqual(center.transform.position, { x: 130, y: 80 });
    assert.deepEqual(stack.content.layers.map((layer) => layer.transform.position.y), [0, 15, 30]);
    assert.deepEqual(grid.content.layers.map((layer) => layer.transform.position), [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 0, y: 45 },
    ]);
    assert.deepEqual(fit.transform.position, { x: 50, y: 0 });
    assert.deepEqual(fit.transform.scale, { x: 1.6, y: 1.6 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('safe areas take per-edge insets and scale presets to the canvas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'celesta-layout-'));
  const entry = join(dir, 'entry.tsx');
  writeFileSync(
    entry,
    `import { Composition, Text } from '@celesta/react'; import { Center, SafeArea, safeAreaInsets } from '@celesta/layout';\n` +
      `export default function Root() {\n` +
      `  return (\n` +
      `    <Composition width={1080} height={1920} fps={30} durationInFrames={1}>\n` +
      `      <SafeArea padding="vertical-social"><Center><Text>preset</Text></Center></SafeArea>\n` +
      `      <SafeArea padding={{ right: 100, bottom: 300 }}><Center><Text>edges</Text></Center></SafeArea>\n` +
      `      <Text>{JSON.stringify(safeAreaInsets('vertical-social', 720, 1280))}</Text>\n` +
      `    </Composition>\n` +
      `  );\n` +
      `}\n`,
  );

  try {
    const result = spawnSync(process.execPath, [cli, entry], {
      input: '{"time":{"value":0,"timescale":1}}\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const [, frame] = result.stdout.split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const [preset, edges, scaled] = frame.scene.layers;
    // top 192, right 200, bottom 384, left 72 px on 1080×1920.
    assert.deepEqual(preset.transform.position, { x: 72, y: 192 });
    assert.deepEqual(preset.content.layers[0].transform.position, { x: 404, y: 672 });
    assert.deepEqual(edges.transform.position, { x: 0, y: 0 });
    assert.deepEqual(edges.content.layers[0].transform.position, { x: 490, y: 810 });
    assert.deepEqual(JSON.parse(scaled.content.text), { top: 128, right: 133, bottom: 256, left: 48 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown safe area preset names the known ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'celesta-layout-'));
  const entry = join(dir, 'entry.tsx');
  writeFileSync(
    entry,
    `import { Composition } from '@celesta/react'; import { SafeArea } from '@celesta/layout';\n` +
      `export default function Root() {\n` +
      `  return <Composition width={1080} height={1920} fps={30} durationInFrames={1}><SafeArea padding="shorts" /></Composition>;\n` +
      `}\n`,
  );

  try {
    const result = spawnSync(process.execPath, [cli, entry], {
      input: '{"time":{"value":0,"timescale":1}}\n',
      encoding: 'utf8',
    });
    assert.match(result.stdout, /unknown safe area preset 'shorts' \(expected 'vertical-social'\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a camera blends its view as one layer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'celesta-layout-'));
  const entry = join(dir, 'entry.tsx');
  writeFileSync(
    entry,
    `import { Composition, Rect } from '@celesta/react'; import { Camera } from '@celesta/layout';\n` +
      `export default function Root() {\n` +
      `  return <Composition width={100} height={100} fps={30} durationInFrames={1}>` +
      `<Camera blendMode="softLight" opacity={0.5}><Rect width={10} height={10} fill="#808080" /></Camera>` +
      `</Composition>;\n` +
      `}\n`,
  );

  try {
    const result = spawnSync(process.execPath, [cli, entry], {
      input: '{"time":{"value":0,"timescale":1}}\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const [, frame] = result.stdout.split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.equal(frame.error, undefined);
    const [camera] = frame.scene.layers;
    assert.equal(camera.blendMode, 'softLight');
    assert.equal(camera.opacity, 0.5);
    assert.equal(camera.content.layers[0].blendMode, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
