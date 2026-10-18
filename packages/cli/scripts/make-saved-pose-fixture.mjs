// Regenerates examples/assets/saved-pose-fixture.psd, a small stand-in for a
// public character PSD: unlike the lip-sync fixture, it is saved showing a
// pose — the body, and one variant in each face folder — so it exercises
// rendering from the PSD's saved visibility, and expressions that swap a
// face part on top of it.
//
//   node packages/cli/scripts/make-saved-pose-fixture.mjs
//
// `ag-psd` is a devDependency needed only for this script.

import { writePsdBuffer } from 'ag-psd';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', '..', 'examples', 'assets');

/** A solid RGBA rectangle as an ag-psd `imageData` object. */
function rect(w, h, [r, g, b, a = 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    data.set([r, g, b, a], i * 4);
  }
  return { width: w, height: h, data };
}

function layer(name, left, top, w, h, color, extra = {}) {
  return { name, left, top, right: left + w, bottom: top + h, imageData: rect(w, h, color), ...extra };
}

const psd = {
  width: 240,
  height: 320,
  children: [
    {
      name: 'body',
      children: [
        layer('hair-back', 40, 30, 160, 240, [120, 70, 40, 255]),
        layer('skin', 70, 60, 100, 220, [250, 224, 205, 255]),
        layer('outfit', 56, 176, 128, 120, [40, 60, 130, 255]),
      ],
    },
    // A prop shown in the saved pose, for `hide`.
    { name: 'props', children: [layer('umbrella', 186, 40, 20, 260, [200, 40, 40, 255])] },
    {
      name: 'face',
      children: [
        {
          name: 'brows',
          children: [
            layer('normal', 88, 92, 64, 5, [90, 60, 40, 255]),
            layer('smile', 88, 84, 64, 4, [90, 60, 40, 255], { hidden: true }),
          ],
        },
        {
          name: 'cheeks',
          children: [
            layer('pale', 84, 124, 72, 8, [245, 205, 195, 255]),
            layer('red', 84, 124, 72, 8, [240, 120, 120, 255], { hidden: true }),
          ],
        },
        { name: 'eyes', children: [layer('open', 90, 104, 60, 14, [40, 40, 60, 255])] },
        {
          name: 'mouth',
          children: [
            layer('closed', 110, 150, 20, 3, [180, 90, 90, 255]),
            layer('open', 108, 142, 24, 16, [170, 70, 70, 255], { hidden: true }),
          ],
        },
      ],
    },
    // A whole folder saved hidden.
    { name: 'extras', hidden: true, children: [layer('hat', 60, 10, 120, 30, [30, 120, 60, 255])] },
    { name: 'front-hair', children: [layer('bangs', 60, 40, 120, 40, [140, 85, 50, 255])] },
  ],
};

mkdirSync(ASSETS, { recursive: true });
writeFileSync(join(ASSETS, 'saved-pose-fixture.psd'), Buffer.from(writePsdBuffer(psd, { generateThumbnail: false })));
