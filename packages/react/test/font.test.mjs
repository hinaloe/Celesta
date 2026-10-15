import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const cli = fileURLToPath(new URL('../../cli/bin/celesta-react-render.js', import.meta.url));

function renderFrame(source, frame = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'celesta-font-'));
  const entry = join(dir, 'entry.tsx');
  writeFileSync(entry, source);
  try {
    const result = spawnSync(process.execPath, [cli, entry], {
      input: JSON.stringify({ time: { value: frame, timescale: 30 } }) + '\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const [, response] = result.stdout.split(/\r?\n/).filter(Boolean).map(JSON.parse);
    return response.scene;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('<Font> declarations become scene fonts only while mounted', () => {
  const source =
    `import { Assets, Composition, Font, Sequence, Text } from '@celesta/react';\n` +
      `export default function Root() {\n` +
      `  return (\n` +
      `    <Composition width={100} height={100} fps={30} durationInFrames={60}>\n` +
      `      <Assets>\n` +
      `        <Font src="./fonts/Brand-Regular.ttf" name="brand" />\n` +
      `        <Font src="./fonts/Brand-Regular.ttf" name="brand" />\n` +
      `      </Assets>\n` +
      `      <Sequence from={30}><Font src="/abs/Other.otf" /></Sequence>\n` +
      `      <Text style={{ fontFamily: 'Brand' }}>hi</Text>\n` +
      `    </Composition>\n` +
      `  );\n` +
      `}\n`;
  for (const frame of [0, 30, 59, 60]) {
    const scene = renderFrame(source, frame);
    const expected = [{ id: 'brand', location: { type: 'file', path: './fonts/Brand-Regular.ttf' } }];
    if (frame >= 30 && frame < 60) {
      expected.push({ id: '/abs/Other.otf', location: { type: 'file', path: '/abs/Other.otf' } });
    }
    assert.deepEqual(scene.fonts, expected);
    assert.equal(scene.layers.length, frame >= 30 && frame < 60 ? 2 : 1);
  }
});

test('a scene without <Font> omits fonts', () => {
  const scene = renderFrame(
    `import { Composition, Text } from '@celesta/react';\n` +
      `export default function Root() {\n` +
      `  return <Composition width={100} height={100} fps={30} durationInFrames={1}><Text>hi</Text></Composition>;\n` +
      `}\n`,
  );
  assert.equal(scene.fonts, undefined);
});

test('<Font google> uses the same stylesheet asset as src and googleFont(), including refs', () => {
  const scene = renderFrame(`
    import React from 'react';
    import { Assets, Composition, Font, googleFont } from '@celesta/react';
    export default function Root() {
      const font = React.useRef();
      return <Composition width={100} height={100} fps={30} durationInFrames={1}>
        <Assets>
          <Font google="M PLUS Rounded 1c" weights={[700, 400]} subsets={['japanese']} ref={font} name="rounded" />
          <Font src={font} />
          <Font src={googleFont('M PLUS Rounded 1c', { weights: [400, 700], subsets: ['japanese'] })} name="rounded" />
          <Font google="Inter" />
        </Assets>
      </Composition>;
    }
  `);
  assert.deepEqual(scene.fonts, [
    { id: 'rounded', location: { type: 'url', url: 'https://fonts.googleapis.com/css?family=M+PLUS+Rounded+1c:400,700&subset=japanese' } },
    { id: 'https://fonts.googleapis.com/css2?family=Inter:wght@400', location: { type: 'url', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400' } },
  ]);
});

test('<Font> rejects mixing a file source with a Google Fonts family', () => {
  assert.throws(() => renderFrame(`
    import { Composition, Font } from '@celesta/react';
    export default function Root() {
      return <Composition width={100} height={100} fps={30} durationInFrames={1}>
        <Font src="font.ttf" google="Inter" />
      </Composition>;
    }
  `), /accepts either `src` or `google`, but not both/);
});
