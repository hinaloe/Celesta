// Downloads the third-party media this film uses into ./assets.
// The files are not redistributed in this repository; run this once:
//
//   node examples/zunda/prepare-assets.ts
//
// The official PSDs are very large (ずんだもん is 4832 × 9488). Every mouth
// shape and blink is a separate raster in Celesta's PSD cache, so the PSDs
// are scaled down here once, layer by layer, and written back as PSDs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// ag-psd is a dependency of packages/react; borrow it from there.
type AgPsd = {
  initializeCanvas(createCanvas: () => never, createImageData: (width: number, height: number) => unknown): void;
  readPsd(buffer: Uint8Array, options: object): unknown;
  writePsd(psd: unknown, options: object): ArrayBuffer;
};
const require = createRequire(join(import.meta.dirname, '../../packages/react/package.json'));
const { initializeCanvas, readPsd, writePsd } = require('ag-psd') as AgPsd;

// Pixels stay plain byte arrays (useImageData), so no real canvas is needed.
initializeCanvas(
  () => {
    throw new Error('canvas is not available');
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
);

const ASSETS = join(import.meta.dirname, 'assets');

type Source = { file: string; url: string; scale?: number };

const SOURCES: Source[] = [
  // 東北ずん子・ずんだもんプロジェクト公式イラスト (https://zunko.jp/con_illust.html)
  { file: 'zundamon.psd', url: 'https://zunko.jp/sozai/zundamon/zunmon008.psd', scale: 0.25 },
  { file: 'metan-happy.psd', url: 'https://zunko.jp/sozai/methane/met_s214.psd', scale: 0.2 },
  { file: 'metan-talk.psd', url: 'https://zunko.jp/sozai/methane/met_s215.psd', scale: 0.2 },
  { file: 'metan-worried.psd', url: 'https://zunko.jp/sozai/methane/met_s219.psd', scale: 0.2 },
  { file: 'metan-what.psd', url: 'https://zunko.jp/sozai/methane/met_s220.psd', scale: 0.2 },
  // Mixkit Stock Video Free License (https://mixkit.co/license/#videoFree)
  { file: 'field.mp4', url: 'https://assets.mixkit.co/videos/8621/8621-720.mp4' },
];

type Pixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };

// Area-averaged downscale with premultiplied alpha, so transparent edges do
// not darken.
function shrink(src: Pixels, scale: number): Pixels {
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const acc = new Float64Array(width * height * 5);
  for (let y = 0; y < src.height; y++) {
    const ty = Math.min(height - 1, Math.floor(y * scale));
    for (let x = 0; x < src.width; x++) {
      const tx = Math.min(width - 1, Math.floor(x * scale));
      const s = (y * src.width + x) * 4;
      const a = src.data[s + 3] / 255;
      const t = (ty * width + tx) * 5;
      acc[t] += src.data[s] * a;
      acc[t + 1] += src.data[s + 1] * a;
      acc[t + 2] += src.data[s + 2] * a;
      acc[t + 3] += a;
      acc[t + 4] += 1;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = acc[i * 5 + 3];
    const n = acc[i * 5 + 4] || 1;
    if (a > 0) {
      data[i * 4] = acc[i * 5] / a;
      data[i * 4 + 1] = acc[i * 5 + 1] / a;
      data[i * 4 + 2] = acc[i * 5 + 2] / a;
    }
    data[i * 4 + 3] = (a / n) * 255;
  }
  return { width, height, data };
}

type Bounds = { top?: number; left?: number; bottom?: number; right?: number };
type AnyLayer = Bounds & { imageData?: Pixels; children?: AnyLayer[]; mask?: Bounds & { imageData?: Pixels } };

function shrinkLayers(layers: AnyLayer[] | undefined, scale: number) {
  for (const layer of layers ?? []) {
    if (layer.imageData && layer.imageData.width > 0 && layer.imageData.height > 0) {
      layer.imageData = shrink(layer.imageData, scale);
      layer.left = Math.round((layer.left ?? 0) * scale);
      layer.top = Math.round((layer.top ?? 0) * scale);
      layer.right = layer.left + layer.imageData.width;
      layer.bottom = layer.top + layer.imageData.height;
    }
    if (layer.mask?.imageData) {
      layer.mask.imageData = shrink(layer.mask.imageData, scale);
      layer.mask.left = Math.round((layer.mask.left ?? 0) * scale);
      layer.mask.top = Math.round((layer.mask.top ?? 0) * scale);
      layer.mask.right = layer.mask.left + layer.mask.imageData.width;
      layer.mask.bottom = layer.mask.top + layer.mask.imageData.height;
    }
    shrinkLayers(layer.children, scale);
  }
}

function shrinkPsd(input: Uint8Array, scale: number): Uint8Array {
  const psd = readPsd(input, { useImageData: true, skipThumbnail: true }) as unknown as {
    width: number;
    height: number;
    imageData?: Pixels;
    children?: AnyLayer[];
  };
  psd.width = Math.round(psd.width * scale);
  psd.height = Math.round(psd.height * scale);
  if (psd.imageData) psd.imageData = shrink(psd.imageData, scale);
  shrinkLayers(psd.children, scale);
  return new Uint8Array(writePsd(psd as never, { generateThumbnail: false }));
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { 'user-agent': 'celesta-example/0.1' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

mkdirSync(ASSETS, { recursive: true });
for (const { file, url, scale } of SOURCES) {
  const target = join(ASSETS, file);
  if (existsSync(target)) {
    console.log(`skip ${file}`);
    continue;
  }
  const raw = join(ASSETS, '.cache', url.split('/').pop()!);
  mkdirSync(dirname(raw), { recursive: true });
  if (!existsSync(raw)) {
    console.log(`get  ${url}`);
    writeFileSync(raw, await download(url));
  }
  const bytes = readFileSync(raw);
  writeFileSync(target, scale ? shrinkPsd(bytes, scale) : bytes);
  console.log(`done ${file}`);
}

// 「写真」として使う静止画は、同じ映像素材の 1 フレームから切り出す（ffmpeg が必要）。
const still = join(ASSETS, 'field.jpg');
if (!existsSync(still)) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', '12', '-i', join(ASSETS, 'field.mp4'), '-frames:v', '1', '-q:v', '2', still]);
  console.log('done field.jpg');
}
