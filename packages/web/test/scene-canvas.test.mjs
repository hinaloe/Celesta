import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild-wasm';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const directory = mkdtempSync(fileURLToPath(new URL('../node_modules/.canvas-test-', import.meta.url)));
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/scene-canvas.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const modulePath = join(directory, 'canvas.mjs');
writeFileSync(modulePath, result.outputFiles[0].text);
const { SceneCanvas } = await import(pathToFileURL(modulePath));
rmSync(directory, { recursive: true });

test('file font URLs are reused across frames and isolated opacity is applied once', async t => {
  const faces = new Set(), operations = [];
  const originals = { document: globalThis.document, DOMMatrix: globalThis.DOMMatrix, FontFace: globalThis.FontFace, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, originals));
  const createURL = t.mock.method(URL, 'createObjectURL', () => 'blob:font');
  const revokeURL = t.mock.method(URL, 'revokeObjectURL', () => {});
  globalThis.FontFace = class { async load() { return this; } };
  const fetchFont = t.mock.method(globalThis, 'fetch', async () => new Response('@font-face {font-family: Demo; src: url(https://fonts.test/font.woff)}', { headers: { 'content-type': 'text/css' } }));
  globalThis.DOMMatrix = class { translate() { return this; } rotate() { return this; } scale() { return this; } };
  let nextCanvas = 0;
  const canvas = () => {
    const element = { id: nextCanvas++, width: 10, height: 10, getContext() { return context; } };
    const stack = [];
    const context = {
      canvas: element, globalAlpha: 1, filter: 'none', globalCompositeOperation: 'source-over',
      save() { stack.push({ globalAlpha: this.globalAlpha, filter: this.filter, globalCompositeOperation: this.globalCompositeOperation }); },
      restore() { Object.assign(this, stack.pop()); }, setTransform() {}, fillRect() {}, beginPath() {}, roundRect() {},
      fill() { operations.push(['fill', element.id, this.globalAlpha]); },
      drawImage(source, x, y) { operations.push(['composite', element.id, this.globalAlpha, source.id, this.filter, this.globalCompositeOperation, x, y]); },
    };
    return element;
  };
  globalThis.document = { fonts: faces, createElement: canvas };
  const renderer = new SceneCanvas(new Map([['font.css', new File(['font'], 'font.css')]]));
  const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0, y: 0 }, rotation: 0 };
  const rect = { opacity: 1, transform, content: { type: 'rect', width: 10, height: 10, cornerRadius: 0, fill: { type: 'solid', color: '#fff' } } };
  const group = { opacity: 0.5, transform, effects: { glow: { blur: 1, color: '#fff' } }, content: { type: 'group', layers: [rect] } };
  const scene = { width: 10, height: 10, fonts: [{ id: 'font', location: { type: 'file', path: 'font.css' } }], layers: [group] };
  const output = canvas();
  renderer.styledText.set('fallback', {});
  renderer.textLayouts.set('fallback', {});
  await renderer.draw(output, scene);
  assert.equal(renderer.styledText.size, 0, 'font changes invalidate painted text');
  assert.equal(renderer.textLayouts.size, 0, 'font changes invalidate shaped text');
  renderer.textLayouts.set('loaded-font', {});
  await renderer.draw(output, scene);
  assert.equal(renderer.textLayouts.size, 1, 'unchanged fonts retain the layout cache');
  assert.equal(createURL.mock.callCount(), 1);
  assert.equal(fetchFont.mock.callCount(), 1);
  assert.equal(faces.size, 1);
  assert.deepEqual(operations.filter(([kind, id]) => kind === 'fill' || id === output.id).map(([kind, , alpha]) => [kind, alpha]), [['fill', 1], ['composite', 0.5], ['fill', 1], ['composite', 0.5]]);

  operations.length = 0;
  const effects = { blur: 2, shadow: { color: '#0008', blur: 4, offsetX: 3, offsetY: 5 }, glow: { color: '#f008', blur: 6 } };
  await renderer.draw(output, { ...scene, layers: [{ ...rect, opacity: 0.5, effects }] });
  const source = operations.find(([kind]) => kind === 'fill')[1];
  const composites = operations.filter(([kind]) => kind === 'composite');
  const masks = composites.filter(([, , , from, filter]) => from === source && filter === 'none');
  assert.equal(masks.length, 2, 'shadow and glow independently read the original source');
  const base = composites.find(([, , , from, filter]) => from === source && filter === 'blur(2px)');
  const result = base[1];
  assert.deepEqual(composites.filter(([, id]) => id === result).map(([, , alpha, , filter, mode, x, y]) => ({ alpha, filter, mode, x, y })), [
    { alpha: 1, filter: 'blur(4px)', mode: 'source-over', x: 3, y: 5 },
    { alpha: 1, filter: 'blur(6px)', mode: 'source-over', x: 0, y: 0 },
    { alpha: 1, filter: 'blur(2px)', mode: 'source-over', x: 0, y: 0 },
  ]);
  assert.deepEqual(composites.filter(([, id]) => id === output.id).map(([, , alpha, from, filter]) => [alpha, from, filter]), [[0.5, result, 'none']]);
  await assert.rejects(
    renderer.draw(output, { ...scene, layers: [{ ...rect, effects: { filters: [{ type: 'invert', amount: 1 }, { type: 'shader', id: 'ripple' }] } }] }),
    /custom shaders are not supported in the browser renderer/,
  );
  renderer.dispose();
  assert.equal(revokeURL.mock.callCount(), 1);
  assert.equal(faces.size, 0);

});

test('color filters change the layer\'s pixels before its other effects', async t => {
  const originals = { document: globalThis.document, DOMMatrix: globalThis.DOMMatrix };
  t.after(() => Object.assign(globalThis, originals));
  globalThis.DOMMatrix = class { translate() { return this; } rotate() { return this; } scale() { return this; } };
  const operations = [];
  let nextCanvas = 0;
  const canvas = () => {
    const element = { id: nextCanvas++, width: 4, height: 1, getContext() { return context; } };
    // Every pixel of a canvas a fill touches is red, opaque.
    let pixels = new Uint8ClampedArray(16);
    const context = {
      canvas: element, globalAlpha: 1, filter: 'none', globalCompositeOperation: 'source-over',
      save() {}, restore() {}, setTransform() {}, beginPath() {}, roundRect() {},
      fillRect() {},
      fill() { pixels = Uint8ClampedArray.from([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]); },
      getImageData(x, y, width, height) {
        operations.push(['read', element.id, x, y, width, height]);
        return { data: Uint8ClampedArray.from(pixels) };
      },
      putImageData(image, x, y, dirtyX, dirtyY, dirtyWidth, dirtyHeight) {
        operations.push(['write', element.id, Array.from(image.data.slice(0, 8)), dirtyX, dirtyY, dirtyWidth, dirtyHeight]);
      },
      drawImage(source) { operations.push(['composite', element.id, source.id, this.filter]); },
    };
    return element;
  };
  globalThis.document = { fonts: new Set(), createElement: canvas };
  const renderer = new SceneCanvas(new Map());
  const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0, y: 0 }, rotation: 0 };
  const rect = {
    opacity: 1, transform,
    effects: { blur: 1, filters: [{ type: 'invert', amount: 1 }, { type: 'brightness', amount: 0.5 }] },
    content: { type: 'rect', width: 2, height: 1, cornerRadius: 0, fill: { type: 'solid', color: '#f00' } },
  };
  const output = canvas();
  await renderer.draw(output, { width: 4, height: 1, layers: [rect] });
  const [read] = operations.filter(([kind]) => kind === 'read');
  const source = read[1];
  assert.deepEqual(read.slice(2), [0, 0, 4, 1]);
  // Inverted, then halved; only the layer's box is written back.
  assert.deepEqual(operations.find(([kind]) => kind === 'write'), ['write', source, [0, 128, 128, 255, 0, 128, 128, 255], 0, 0, 2, 1]);
  // The blur reads the filtered source.
  assert.ok(operations.some(([kind, , from, filter]) => kind === 'composite' && from === source && filter === 'blur(1px)'));
  renderer.dispose();
});

test('a vignette spans the layer\'s shapes as the GPU renderer places them', async t => {
  const originals = { document: globalThis.document, DOMMatrix: globalThis.DOMMatrix, DOMPoint: globalThis.DOMPoint };
  t.after(() => Object.assign(globalThis, originals));
  // A 2D affine matrix, as DOMMatrix behaves for these calls.
  globalThis.DOMMatrix = class Matrix {
    constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { Object.assign(this, { a, b, c, d, e, f }); }
    multiply(m) {
      return new Matrix(this.a * m.a + this.c * m.b, this.b * m.a + this.d * m.b, this.a * m.c + this.c * m.d,
        this.b * m.c + this.d * m.d, this.a * m.e + this.c * m.f + this.e, this.b * m.e + this.d * m.f + this.f);
    }
    translate(x, y) { return this.multiply(new Matrix(1, 0, 0, 1, x, y)); }
    scale(x, y) { return this.multiply(new Matrix(x, 0, 0, y, 0, 0)); }
    rotate(degrees) {
      const r = degrees * Math.PI / 180;
      return this.multiply(new Matrix(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0));
    }
    transformPoint(p) { return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f }; }
  };
  globalThis.DOMPoint = class { constructor(x, y) { this.x = x; this.y = y; } };
  // Every character advances 10px; ink reaches 8 above the baseline and 2
  // below, the font box 9 and 3.
  const ctx = {
    canvas: { width: 200, height: 200 }, font: '', letterSpacing: '', save() {}, restore() {},
    measureText: text => ({
      width: 10 * Array.from(text).length, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 10 * Array.from(text).length,
      actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3,
    }),
  };
  const renderer = new SceneCanvas(new Map());
  const at = (x, y, extra = {}) => ({ position: { x, y }, scale: { x: 1, y: 1 }, anchor: { x: 0, y: 0 }, rotation: 0, ...extra });
  const text = (value, transform, style = {}) => ({ opacity: 1, transform, content: { type: 'text', text: value, style: { fontSize: 10, ...style } } });
  const box = layer => renderer.shapeBox(ctx, layer, new DOMMatrix(), 1);

  // One line: its visible rows (1 to 11 below the line's top), grown by the
  // stroke, moved onto whole pixels.
  assert.deepEqual(await box(text('ABC', at(10.4, 20.3), { stroke: { width: 2, paint: { type: 'solid', color: '#000' } } })), [8, 18, 42, 32]);
  // Several lines: their line boxes, anchored at the centre.
  assert.deepEqual(await box(text('A\nBC', at(50, 50, { anchor: { x: 0.5, y: 0.5 } }))), [40, 38, 60, 62]);
  // A group: the union of its children's shapes; scaled text is not moved
  // onto whole pixels, and a child drawn at opacity 0 has no shape.
  const rect = { opacity: 1, transform: at(0, 0), content: { type: 'rect', width: 10, height: 10, cornerRadius: 0 } };
  const hidden = { ...rect, opacity: 0, transform: at(-50, -50) };
  const scaled = text('A', at(100.25, 0, { scale: { x: 2, y: 2 } }));
  assert.deepEqual(await box({ opacity: 1, transform: at(0, 0), content: { type: 'group', layers: [rect, hidden, scaled] } }), [0, 0, 120.25, 20]);
  // A path: its stroked extent in whole pixels, within the scene.
  const path = {
    opacity: 1, transform: at(0.5, 0.5),
    content: { type: 'path', commands: [{ type: 'moveTo', x: 0, y: 0 }, { type: 'lineTo', x: 10, y: 5 }], stroke: { width: 2, paint: { type: 'solid', color: '#fff' } } },
  };
  assert.deepEqual(await box(path), [0, 0, 12, 7]);
  // A rotated rect: the box around its corners.
  const turned = await box({ ...rect, transform: at(0, 0, { rotation: 90 }) });
  assert.deepEqual(turned.map(value => Math.round(value * 1e9) / 1e9), [-10, 0, 0, 10]);
});

test('text wrapped at maxWidth is anchored by its line boxes, as text broken with newlines', async t => {
  const originals = { document: globalThis.document, DOMMatrix: globalThis.DOMMatrix };
  t.after(() => Object.assign(globalThis, originals));
  globalThis.DOMMatrix = class { translate() { return this; } rotate() { return this; } scale() { return this; } };
  const drawn = [];
  const canvas = () => {
    const element = { width: 400, height: 400, getContext() { return context; } };
    const context = {
      canvas: element, globalAlpha: 1, filter: 'none', globalCompositeOperation: 'source-over',
      save() {}, restore() {}, setTransform() {}, fillRect() {}, drawImage() {},
      // Each character is 10 px wide; the font's line box is 30 px above
      // the baseline and 10 below, the ink 20 above and none below.
      measureText: text => ({
        width: text.length * 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 10,
        actualBoundingBoxAscent: 20, actualBoundingBoxDescent: 0, fontBoundingBoxAscent: 30, fontBoundingBoxDescent: 10,
      }),
      fillText(text, x, y) { drawn.push([text, y]); },
    };
    return element;
  };
  globalThis.document = { fonts: new Set(), createElement: canvas };
  const renderer = new SceneCanvas(new Map());
  const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0, y: 0 }, rotation: 0 };
  const layer = text => ({ opacity: 1, transform, content: { type: 'text', text, style: { lineHeight: 40 }, maxWidth: 50 } });
  const baselines = async text => {
    drawn.length = 0;
    await renderer.draw(canvas(), { width: 400, height: 400, fonts: [], layers: [layer(text)] });
    return drawn.slice();
  };
  const broken = await baselines('abc\ndef');
  assert.deepEqual(broken, [['abc', 30], ['def', 70]]);
  assert.deepEqual(await baselines('abc def'), broken);
  renderer.dispose();
});
