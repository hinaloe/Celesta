import assert from 'node:assert/strict';
import { test } from 'vitest';

import { compositionArgs, stillsArgs, videoArgs } from '../src/args.js';

test('a video export passes its options as --name=value flags', () => {
  assert.deepEqual(
    videoArgs({
      source: 'film.tsx',
      output: 'film.mp4',
      composition: 'intro',
      props: { title: 'Hi' },
      from: 1.5,
      to: '00:10',
      crf: 20,
      bitDepth: 10,
      subtitles: 'film.{lang}.vtt',
      overwrite: true,
      onProgress() {},
    }),
    [
      '--json',
      '--stdin-cancel',
      '--json-progress',
      '--react',
      '--composition=intro',
      '--props={"title":"Hi"}',
      '--overwrite',
      '--from=1.5',
      '--to=00:10',
      '--subtitles=film.{lang}.vtt',
      '--crf=20',
      '--bit-depth=10',
      '--',
      'film.tsx',
      'film.mp4',
    ],
  );
});

test('a .json source is a project unless react says otherwise', () => {
  assert.deepEqual(compositionArgs({ source: 'demo.celesta.json' }), ['--json', '--stdin-cancel', '--info', '--', 'demo.celesta.json']);
  assert.ok(compositionArgs({ source: 'entry.json', react: true }).includes('--react'));
  assert.ok(compositionArgs({ source: 'film.TSX' }).includes('--react'));
});

test('seconds become millisecond timecodes', () => {
  const from = (time: number) => videoArgs({ source: 'p.celesta.json', output: 'o.mp4', from: time }).find((arg) => arg.startsWith('--from='));
  assert.equal(from(0), '--from=0');
  assert.equal(from(10), '--from=10');
  assert.equal(from(2.0004), '--from=2');
  assert.equal(from(1 / 3), '--from=0.333');
  assert.throws(() => from(-1), { code: 'usage' });
  assert.throws(() => from(Number.NaN), { code: 'usage' });
});

test('a video needs an output or subtitles', () => {
  assert.throws(() => videoArgs({ source: 'film.tsx' }), { name: 'CelestaExportError', code: 'usage' });
  assert.deepEqual(videoArgs({ source: 'film.tsx', subtitles: ['a.srt'] }).slice(-3), ['--subtitles=a.srt', '--', 'film.tsx']);
});

test('stills take frames or every, and contact sheet options', () => {
  assert.deepEqual(stillsArgs({ source: 'film.tsx', output: 'f.png', frames: [0, 90] }), [
    '--json',
    '--stdin-cancel',
    '--react',
    '--frame=0,90',
    '--',
    'film.tsx',
    'f.png',
  ]);
  assert.ok(stillsArgs({ source: 'film.tsx', output: 'f.png', frames: 3 }).includes('--frame=3'));
  const sheet = stillsArgs({ source: 'film.tsx', output: 's.webp', every: 30, from: 1, contactSheet: { columns: 4 }, quality: 80 });
  for (const flag of ['--every=30', '--from=1', '--quality=80', '--contact-sheet', '--columns=4']) {
    assert.ok(sheet.includes(flag), flag);
  }
  assert.throws(() => stillsArgs({ source: 'film.tsx', output: 'f.png' }), { code: 'usage' });
  assert.throws(() => stillsArgs({ source: 'film.tsx', output: 'f.png', frames: [1], every: 2 }), { code: 'usage' });
  assert.throws(() => stillsArgs({ source: 'film.tsx', output: 'f.png', frames: [1], from: 1 }), { code: 'usage' });
});

test('a source that starts with a dash stays positional', () => {
  assert.deepEqual(compositionArgs({ source: '-film.tsx' }).slice(-2), ['--', '-film.tsx']);
});
