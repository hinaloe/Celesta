import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { remarkDownloadLinks } from '../plugins/remark-download-links.ts';

const names = ['CELESTA_DOWNLOAD_URL', 'CELESTA_DOWNLOAD_URL_MACOS', 'CELESTA_DOWNLOAD_URL_WINDOWS'];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const setEnv = (values: Partial<Record<string, string>>) => {
  for (const name of names) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
};
afterEach(() => setEnv(saved));

const processor = unified().use(remarkParse).use(remarkDownloadLinks).use(remarkStringify);
const run = (markdown: string) => processor.process(markdown).then(String);

test('rewrites each download target', async () => {
  setEnv({ CELESTA_DOWNLOAD_URL: 'https://example.com/all', CELESTA_DOWNLOAD_URL_MACOS: 'https://example.com/m.dmg', CELESTA_DOWNLOAD_URL_WINDOWS: 'https://example.com/w.exe' });
  const out = await run('[Mac ↓](celesta:download/macos) [Win ↓](celesta:download/windows) [All](celesta:download/all)\n');
  assert.equal(out, '[Mac ↓](https://example.com/m.dmg) [Win ↓](https://example.com/w.exe) [All](https://example.com/all)\n');
});

test('rewrites link definitions', async () => {
  setEnv({ CELESTA_DOWNLOAD_URL_MACOS: 'https://example.com/m.dmg' });
  const out = await run('[Mac][mac]\n\n[mac]: celesta:download/macos\n');
  assert.match(out, /\[mac\]: https:\/\/example\.com\/m\.dmg/);
});

test('defaults to the latest release', async () => {
  setEnv({ CELESTA_DOWNLOAD_URL: '' });
  const out = await run('[All](celesta:download/all)\n');
  assert.equal(out, '[All](https://github.com/mika-f/Celesta/releases/latest)\n');
});

test('leaves other links alone', async () => {
  setEnv({ CELESTA_DOWNLOAD_URL: 'https://example.com/all' });
  const markdown = '[Docs](/en/docs/) [Releases](https://github.com/mika-f/Celesta/releases/latest) [Other](celesta:other)\n';
  assert.equal(await run(markdown), markdown);
});

test('fails on an unknown target', async () => {
  await assert.rejects(run('[x](celesta:download/constructor)\n'), /celesta:download\/constructor/);
  await assert.rejects(run('[Linux](celesta:download/linux)\n'), /celesta:download\/linux/);
});

test('reads the environment when it transforms, not when it is set up', async () => {
  setEnv({ CELESTA_DOWNLOAD_URL_WINDOWS: 'https://example.com/first.exe' });
  assert.match(await run('[Win](celesta:download/windows)\n'), /first\.exe/);
  setEnv({ CELESTA_DOWNLOAD_URL_WINDOWS: 'https://example.com/second.exe' });
  assert.match(await run('[Win](celesta:download/windows)\n'), /second\.exe/);
});
