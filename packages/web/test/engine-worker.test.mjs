import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild-wasm';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packages = fileURLToPath(new URL('../../', import.meta.url));
const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/engine.worker.ts', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'worker-in-node', setup(build) {
    // The same source aliases as vite.config.ts.
    build.onResolve({ filter: /^\.\/entry-dir$/ }, () => ({ path: join(packages, 'react/src/entry-dir.browser.ts') }));
    build.onResolve({ filter: /^@celesta\/react$/ }, () => ({ path: join(packages, 'react/src/browser.ts') }));
    build.onResolve({ filter: /^@celesta\/react\/internal$/ }, () => ({ path: join(packages, 'react/src/internal.ts') }));
    build.onResolve({ filter: /^@celesta\/[a-z-]+$/ }, args => ({ path: join(packages, args.path.slice('@celesta/'.length), 'src/index.ts') }));
    build.onResolve({ filter: /^esbuild-wasm$/ }, () => ({ path: 'esbuild', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export async function initialize() {} export {build, transform} from ${JSON.stringify(require.resolve('esbuild-wasm'))};` }));
    build.onResolve({ filter: /esbuild-wasm\/lib\/main\.js$/ }, args => ({ path: args.path, external: true }));
    build.onResolve({ filter: /\.wasm\?url$/ }, () => ({ path: 'wasm', namespace: 'wasm' }));
    build.onLoad({ filter: /.*/, namespace: 'wasm' }, () => ({ contents: 'export default "wasm"' }));
  } }],
});
const directory = mkdtempSync(fileURLToPath(new URL('../node_modules/.worker-test-', import.meta.url)));
const modulePath = join(directory, 'worker.cjs');
writeFileSync(modulePath, result.outputFiles[0].text);

test('compiles serialize, fonts refresh the same mount, and recompile unmounts the old root', async t => {
  const originals = { self: globalThis.self, fonts: globalThis.fonts, FontFace: globalThis.FontFace, OffscreenCanvas: globalThis.OffscreenCanvas, fetch: globalThis.fetch };
  t.after(() => { Object.assign(globalThis, originals); delete globalThis.mountCount; delete globalThis.cleanupCount; rmSync(directory, { recursive: true }); });
  globalThis.mountCount = 0; globalThis.cleanupCount = 0;
  globalThis.fonts = new Set();
  globalThis.FontFace = class { constructor(family, source) { this.family = family; this.source = source; } async load() { return this; } };
  globalThis.OffscreenCanvas = class {
    getContext() { return { measureText(text) { return { width: text.length * (globalThis.fonts.size ? 20 : 10), fontBoundingBoxAscent: 15, fontBoundingBoxDescent: 5 }; } }; }
  };
  const requested = [];
  const fetched = Promise.withResolvers(), unblock = Promise.withResolvers();
  const voice = readFileSync(fileURLToPath(new URL('../../../examples/assets/voices/001.wav', import.meta.url)));
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.startsWith('https://audio.test/')) return new Response(voice);
    requested.push(url);
    if (url.startsWith('https://first.test/')) { fetched.resolve(); await unblock.promise; }
    return new Response(`@font-face { font-family: Demo; src: url(${new URL('demo.woff', url).href}); }`, { headers: { 'content-type': 'text/css' } });
  });
  const responses = [], completion = new Map();
  globalThis.self = { postMessage(response) { responses.push(response); completion.get(response.id)?.resolve(response); } };
  require(modulePath);
  const send = data => { const pending = Promise.withResolvers(); completion.set(data.id, pending); self.onmessage({ data }); return pending.promise; };
  const source = `import { React, Composition, Font, Rect, Audio, useTextMetrics } from '@celesta/react';
    export default function Root() {
      React.useState(() => { globalThis.mountCount++; return 0; });
      React.useLayoutEffect(() => () => { globalThis.cleanupCount++; }, []);
      const metrics = useTextMetrics('abc', { fontFamily: 'Demo' });
      return <Composition width={100} height={100} fps={30} durationInFrames={3}><Font src="font.css" /><Rect width={metrics.width} height={10}/><Audio src="https://audio.test/tone.wav" /></Composition>;
    }`;
  const first = send({ id: 1, type: 'compile', source, options: { baseURL: 'https://first.test/', silent: true } });
  await fetched.promise;
  const firstFrame = send({ id: 2, type: 'frame', frame: 0 });
  const second = send({ id: 3, type: 'compile', source, options: { baseURL: 'https://second.test/', silent: false } });
  const secondFrame = send({ id: 4, type: 'frame', frame: 0 });
  assert.equal(mountCount, 1);
  assert.deepEqual(requested, ['https://first.test/font.css']);
  unblock.resolve();
  const values = await Promise.all([first, firstFrame, second, secondFrame]);
  assert.deepEqual(responses.map(response => response.id), [1, 2, 3, 4]);
  for (const response of values) assert.equal(response.error, undefined);
  assert.deepEqual(requested, ['https://first.test/font.css', 'https://second.test/font.css']);
  assert.equal(mountCount, 2);
  assert.equal(cleanupCount, 1);
  assert.equal(values[1].value.scene.layers[0].content.width, 60);
  assert.equal(values[1].value.audio.length, 0);
  assert.equal(values[3].value.audio.length, 1);
  assert.equal(fonts.size, 1);
  assert.match([...fonts][0].source, /second\.test\/demo\.woff/);

  const explicit = `import {Composition, Rect, useTextMetrics, measureText} from '@celesta/react';
    export default function Root() { const m=useTextMetrics('abc', {fontFamily:'Demo'}, {fonts:['https://extra.test/font.css']}); return <Composition width={100} height={100} fps={30} durationInFrames={1}><Rect width={m.width} height={1}/></Composition>; }`;
  const expectedError = t.mock.method(console, 'error', () => {});
  const rejected = await send({ id: 5, type: 'compile', source: explicit });
  expectedError.mock.restore();
  assert.match(rejected.error, /preloaded fonts/);
  assert.equal(fonts.size, 0);
  const prepared = await send({ id: 6, type: 'compile', source: explicit + `export async function prepare() { await measureText('abc', {fontFamily:'Demo'}, {fonts:['https://extra.test/font.css']}); }` });
  assert.equal(prepared.error, undefined);
  const preparedFrame = await send({ id: 7, type: 'frame', frame: 0 });
  assert.equal(preparedFrame.value.scene.layers[0].content.width, 60);

  const fallback = await send({ id: 8, type: 'compile', source: explicit + `export async function prepare() { try { const metrics = await measureText('fi'); metrics.glyphs; } catch (error) { if (!error.message.includes('Shaped glyph metrics')) throw error; } await measureText('abc', {fontFamily:'Demo'}, {fonts:['https://extra.test/font.css']}); }` });
  assert.equal(fallback.error, undefined);
  assert.equal(fonts.size, 1);

  // Split packages share the worker's core runtime: layout bounds (also
  // across packages, as a Panel's for a Center inside it), the text
  // measurer (a Badge sizes itself with it), and the character elements
  // registered with its scene walker.
  const split = await send({ id: 9, type: 'compile', source: `import { React, Assets, Composition } from '@celesta/react';
    import { Center } from '@celesta/layout';
    import { Badge, Panel } from '@celesta/components';
    import { Circle } from '@celesta/shapes';
    import { Character, CharacterView } from '@celesta/character';
    export default function Root() {
      const actor = React.useRef(null);
      return <Composition width={100} height={100} fps={30} durationInFrames={1}>
        <Assets><Character ref={actor} name="a" portrait={{ defaultExpression: 'n', expressions: { n: 'n.png' } }} /></Assets>
        <Center><Circle radius={5} fill="#ffffff" /></Center>
        <CharacterView character={actor} />
        <Panel width={40} height={20} padding={5}><Center><Circle radius={2} fill="#ffffff" /></Center></Panel>
        <Badge padding={4} fill="#000000">ab</Badge>
      </Composition>;
    }` });
  assert.equal(split.error, undefined);
  const splitFrame = await send({ id: 10, type: 'frame', frame: 0 });
  const [center, view, panel, badge] = splitFrame.value.scene.layers;
  assert.deepEqual(center.transform.position, { x: 50, y: 50 });
  assert.deepEqual(panel.content.layers[0].content.layers[0].transform.position, { x: 15, y: 5 });
  // The stub canvas's two 10 px characters and the default 38.4 px line
  // box (32 px text × 1.2), plus the padding.
  assert.deepEqual([badge.content.layers[0].content.width, badge.content.layers[0].content.height], [28, 46.4]);
  assert.deepEqual(view.content.layers[0].content.asset.location, { type: 'file', path: 'n.png' });
  const missing = await send({ id: 11, type: 'compile', source: `import { ProjectTimeline } from '@celesta/project'; export default ProjectTimeline;` });
  assert.match(missing.error, /unavailable in the web editor/);
  // The color filters run in the browser; custom shaders fail when drawn.
  const shader = await send({ id: 12, type: 'compile', source: `import { Composition, Rect } from '@celesta/react';
    import { grayscale } from '@celesta/shader';
    export default function Scene() {
      return <Composition width={100} height={100} fps={30} durationInFrames={1}>
        <Rect width={10} height={10} fill="#ff0000" shader={grayscale()} brightness={1.5} />
      </Composition>;
    }` });
  assert.equal(shader.error, undefined);
  const shaded = await send({ id: 13, type: 'frame', frame: 0 });
  assert.deepEqual(shaded.value.scene.layers[0].effects.filters, [
    { type: 'grayscale', amount: 1 },
    { type: 'brightness', amount: 1.5 },
  ]);

  // Lottie animations draw as paths here too, at the composition's time.
  const demo = readFileSync(fileURLToPath(new URL('../../../examples/assets/lottie/demo.json', import.meta.url)), 'utf8');
  const lottie = await send({ id: 30, type: 'compile', source: `import { Composition } from '@celesta/react';
    import { Lottie } from '@celesta/lottie';
    const demo = ${demo};
    export default function Scene() {
      return <Composition width={480} height={270} fps={30} durationInFrames={90}><Lottie data={demo} /></Composition>;
    }` });
  assert.equal(lottie.error, undefined);
  const lottieFrame = await send({ id: 31, type: 'frame', frame: 45 });
  const paths = JSON.stringify(lottieFrame.value.scene).match(/"type":"path"/g) ?? [];
  assert.ok(paths.length > 5, `${paths.length} paths`);

  // prepare() decodes an uploaded file with mediabunny, to the same samples
  // as the WAV parser reads from the same bytes.
  const spectrum = await send({ id: 14, type: 'compile', options: { assets: new Map([['voice.wav', new File([voice], 'voice.wav')]]) }, source: `import { Composition, Rect } from '@celesta/react';
    import { analyzeAudioSpectrum, loadAudioSpectrum, useAudioSpectrum } from '@celesta/media-utils';
    import { decodeWav } from '@celesta/character';
    let music, reference;
    export async function prepare() {
      music = await loadAudioSpectrum('./voice.wav', { bands: 4 });
      const bytes = new Uint8Array(await (await fetch('https://audio.test/voice.wav')).arrayBuffer());
      reference = analyzeAudioSpectrum(decodeWav(bytes), { bands: 4 });
    }
    function Meter({ spectrum }) {
      const { bands, rms } = useAudioSpectrum(spectrum);
      return <Rect width={rms} height={bands[2]} />;
    }
    export default function Scene() {
      return <Composition width={100} height={100} fps={30} durationInFrames={60}>
        <Meter spectrum={music} /><Meter spectrum={reference} />
      </Composition>;
    }` });
  assert.equal(spectrum.error, undefined);
  const metered = await send({ id: 15, type: 'frame', frame: 30 });
  const [decoded, parsed] = metered.value.scene.layers.map(layer => layer.content);
  assert.ok(decoded.width > 0.01 && decoded.height > 0);
  assert.equal(decoded.width, parsed.width);
  assert.equal(decoded.height, parsed.height);
  // A recompile reads the file uploaded under that name now, not the last one.
  const silence = Buffer.alloc(44 + 2 * 44100);
  silence.write('RIFF', 0); silence.writeUInt32LE(silence.length - 8, 4); silence.write('WAVEfmt ', 8);
  silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
  silence.writeUInt32LE(44100, 24); silence.writeUInt32LE(88200, 28); silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34);
  silence.write('data', 36); silence.writeUInt32LE(2 * 44100, 40);
  const recompiled = await send({ id: 17, type: 'compile', options: { assets: new Map([['voice.wav', new File([silence], 'voice.wav')]]) }, source: `import { Composition, Rect } from '@celesta/react';
    import { loadAudioSpectrum, useAudioSpectrum } from '@celesta/media-utils';
    let music;
    export async function prepare() { music = await loadAudioSpectrum('./voice.wav', { bands: 4 }); }
    function Meter() { const { rms } = useAudioSpectrum(music); return <Rect width={rms} height={1} />; }
    export default function Scene() { return <Composition width={100} height={100} fps={30} durationInFrames={30}><Meter /></Composition>; }` });
  assert.equal(recompiled.error, undefined);
  const quiet = await send({ id: 18, type: 'frame', frame: 15 });
  assert.equal(quiet.value.scene.layers[0].content.width, 0);
  const missingAudio = await send({ id: 19, type: 'compile', source: `import { Composition } from '@celesta/react';
    import { loadAudioSpectrum } from '@celesta/media-utils';
    export async function prepare() { await loadAudioSpectrum('nowhere.wav'); }
    export default function Scene() { return <Composition width={10} height={10} fps={30} durationInFrames={1} />; }` });
  assert.match(missingAudio.error, /Missing audio file: nowhere\.wav/);
});
