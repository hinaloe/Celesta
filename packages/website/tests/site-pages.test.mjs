import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { showcaseAsset } from '../plugins/site-pages.ts';

const root = '/repo/';

test('showcase asset requests resolve to files in the copied directories', () => {
  assert.equal(showcaseAsset(root, '/showcase-assets/examples/afterimage/assets/fonts/BebasNeue-Regular.ttf'), join(root, 'examples/afterimage/assets/fonts/BebasNeue-Regular.ttf'));
  assert.equal(showcaseAsset(root, '/showcase-assets/examples/versus/bench/assets/licenses/OFL.txt'), join(root, 'examples/versus/bench/assets/licenses/OFL.txt'));
  assert.equal(showcaseAsset(root, '/showcase-assets/examples/assets/dialogue-demo/portraits/komugi-normal.png'), join(root, 'examples/assets/dialogue-demo/portraits/komugi-normal.png'));
  assert.equal(showcaseAsset(root, '/showcase-assets/examples/afterimage/assets/fonts/My%20Font.ttf'), join(root, 'examples/afterimage/assets/fonts/My Font.ttf'));
});

test('showcase asset requests cannot leave their directory or break the server', () => {
  for (const path of [
    '/showcase-assets/examples/afterimage/assets/fonts/..%2F..%2F..%2F..%2Fpackage.json',
    '/showcase-assets/examples/afterimage/assets/fonts/..%5C..%5Cpackage.json',
    '/showcase-assets/examples/afterimage/assets/fonts/..',
    '/showcase-assets/examples/afterimage/assets/fonts/%E0%A4%A',
    '/showcase-assets/examples/afterimage/assets/fonts/',
    '/showcase-assets/examples/afterimage/assets/fonts/sub/a.ttf',
    '/showcase-assets/examples/apex/film.tsx',
    '/examples/afterimage/assets/fonts/BebasNeue-Regular.ttf',
  ]) assert.equal(showcaseAsset(root, path), undefined, path);
});
