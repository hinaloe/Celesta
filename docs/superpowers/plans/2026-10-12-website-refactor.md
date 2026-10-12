# Website Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise `packages/website/src` by page with one shared route module and extracted build plugins (no behavior change), then give every page the same header and footer.

**Architecture:** Stacked pull requests managed with `gh stack`, above a bottom layer (`claude/website-refactor-plan`) that holds only this plan and its spec. Layer 1 (`claude/website-reorg`) moves files with `git mv`, introduces `src/site/routes.ts`, and moves the two Vite plugins into `plugins/`; a masked `dist/` comparison proves the build output is unchanged. Layer 2 (`claude/website-site-chrome`) adds `SiteHeader` and `SiteFooter`, replaces the per-page markup, and swaps positional-slot navigation messages for per-item catalog keys.

**Tech Stack:** Vite 8 (Rolldown), React 19, TypeScript 5.9, i18next/react-i18next, Tailwind CSS 4 (utility classes only where already used), Cloudflare Workers Static Assets, `node:test`, `gh stack`.

**Spec:** `docs/superpowers/specs/2026-10-12-website-refactor-design.md`

## Global Constraints

- Node.js 22.12+; pnpm 12.9.1 (root `packageManager`). No new dependencies.
- The set of built files is unchanged by layer 1: masked file lists and masked HTML of `dist/` match the baseline.
- Documentation prose, chapter order, and catalog messages are unchanged, except the navigation and footer messages replaced in layer 2. `en.json` and `ja.json` keep identical key sets.
- Modules loaded by Node (`src/site/*`, `plugins/*`, `vite.config.ts`, `worker.ts`, `tests/*`) import local TypeScript with explicit `.ts` extensions; browser modules keep extensionless imports.
- Vite-specific imports (`?raw`, `?worker`, `import.meta.glob`) stay in `src/features/playground/`, `src/pages/showcase/sources.ts`, and `src/pages/docs/`.
- Move files with `git mv` so history follows them. Edit file contents with an editor (the Edit tool), not `sed`/`perl` rewrites.
- Commit subjects use `refactor(website): …` or `feat(website): …`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pull request bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- The repository has two remotes (`origin` = mika-f/celesta, `fork`). Pass `--remote origin` to every `gh stack push`/`submit`/`sync`.
- No server rendering, no TanStack Start or makit work, no legacy-URL redirects, no splitting of `guides.tsx`/`packages.tsx` by chapter.

## Review Focus

1. Direct visits to every generated address, including the unprefixed legacy `/docs/<slug>/` and `/showcase/<slug>/` pages and the legacy `/docs/#export` hash link, still open the right page after the files move. (Task 3 route tests; Task 4 browser check.)
2. Showcase posters and browser-edition sources still resolve after the source file moves two directories deeper, because `import.meta.glob` keys are relative to the importing file. (Task 1 dist comparison counts the poster assets; Task 4 opens the gallery and Apex.)
3. The dev server still serves `/showcase-assets/...` fonts, licences, and portraits after the plugin leaves `vite.config.ts` and stops resolving paths from `import.meta.url`. (Task 2 dev-server check.)
4. On the docs page at 779 px and narrower, the new menu button opens and closes the navigation above the docs contents toggle, and the language links keep the chapter and hash. (Task 5 browser check.)
5. `pnpm check:examples` still type-checks the moved examples and the playground scene. (Task 1 Step 7.)

---

## File structure after both layers

```
packages/website/
  index.html                         script → /src/pages/home/main.tsx
  docs/index.html                    script → /src/pages/docs/main.tsx
  showcase/index.html                script → /src/pages/showcase/main.tsx
  vite.config.ts                     plugin wiring only
  plugins/
    sample-sources.ts                editor text for repository examples (?raw)
    site-pages.ts                    per-locale HTML, dev/preview routing, showcase assets
  worker.ts
  tests/
    locales.test.mjs
    routes.test.mjs                  new
  src/
    vite-env.d.ts
    locales/en.json, ja.json
    site/                            Node-importable, no DOM/CSS/import.meta.env at import
      locales.ts  catalog.ts  i18n.ts  docs-nav.ts  showcase-catalog.ts
      routes.ts                      new: parseRoute, docPath, showcasePath
      links.ts                       new: repository
    components/
      Brand.tsx  LanguageSwitcher.tsx  Download.tsx
      download-links.ts              was src/links.ts (download URLs, platform detection)
      SiteHeader.tsx  SiteFooter.tsx layer 2
    features/playground/
      Playground.tsx  SourceEditor.tsx  demo/title-scene.tsx
    pages/
      home/main.tsx  home/HomePage.tsx                         was main.tsx, App.tsx
      docs/main.tsx  docs/DocsPage.tsx  docs/DocCode.tsx  docs/syntax.ts
      docs/content/guides.tsx  packages.tsx  shared.tsx         was docs-content/-packages/-shared
      docs/examples/*                                           was src/examples
      showcase/main.tsx  showcase/ShowcasePage.tsx  showcase/sources.ts
    styles/style.css  styles/docs.css
```

---

## Layer 1 — `claude/website-reorg`

### Task 0: Baseline build and stack

**Files:**
- Create (outside the repository): `$SCRATCH/compare-dist.sh`, `$SCRATCH/dist-before/`

`$SCRATCH` is any directory outside the repository (in a Claude Code session, the session scratchpad). Shell state does not persist between commands, so write the absolute path each time.

- [ ] **Step 1: Install and build the unchanged site**

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run build:runtime
pnpm --dir packages/website build
pnpm --dir packages/website test
pnpm --dir packages/website check:examples
```

Expected: all succeed. `build` also builds `@celesta/web` and generates `worker-configuration.d.ts`, which later steps need for `tsc`.

- [ ] **Step 2: Keep the baseline output**

```bash
rm -rf "$SCRATCH/dist-before" && cp -R packages/website/dist "$SCRATCH/dist-before"
```

- [ ] **Step 3: Write the comparison script**

Create `$SCRATCH/compare-dist.sh`:

```sh
#!/bin/sh
# Usage: compare-dist.sh BEFORE AFTER
# Compares the file list and every HTML file with Rolldown content hashes masked.
set -eu
before=$1
after=$2
work=$(mktemp -d)
mask() { sed -E 's/-[A-Za-z0-9_-]{8}\.([a-z0-9]+)/-HASH.\1/g'; }
(cd "$before" && find . -type f | sort) | mask > "$work/before.txt"
(cd "$after" && find . -type f | sort) | mask > "$work/after.txt"
status=0
diff -u "$work/before.txt" "$work/after.txt" || status=1
for file in $(cd "$after" && find . -name '*.html' | sort); do
  if [ -f "$before/$file" ]; then
    mask < "$before/$file" > "$work/b.html"
    mask < "$after/$file" > "$work/a.html"
    diff -q "$work/b.html" "$work/a.html" > /dev/null || { echo "HTML differs: $file"; diff -u "$work/b.html" "$work/a.html" | head -40; status=1; }
  fi
done
echo "files: $(wc -l < "$work/after.txt")"
[ "$status" -eq 0 ] && echo "dist matches"
exit "$status"
```

Run `sh "$SCRATCH/compare-dist.sh" "$SCRATCH/dist-before" packages/website/dist`.
Expected: `dist matches` (the script compared the baseline with itself).

Comparing the baseline with itself cannot show that the mask works, so check it separately:

```bash
ls packages/website/dist/assets | head
find packages/website/dist -type f | sed -E 's/-[A-Za-z0-9_-]{8}\.([a-z0-9]+)/-HASH.\1/g' | grep -c HASH
```

Expected: asset names end in `-<8 characters>.<ext>` and the count is greater than 0. If Rolldown's hashes have another length, change `{8}` in both the script and this command.

- [ ] **Step 4: Add the reorganisation layer**

The spec and this plan are already the bottom layer of the stack (`claude/website-refactor-plan`, trunk `main`). Check it out and add the next layer:

```bash
gh stack checkout claude/website-refactor-plan
gh stack add claude/website-reorg
gh stack view --json
```

Expected: `currentBranch` is `claude/website-reorg`, the branch below it is `claude/website-refactor-plan`, and `trunk` is `main`. If the plan pull request has already merged, run `gh stack sync --remote origin` first; `claude/website-reorg` then sits directly on `main`.

---

### Task 1: Move sources into the page layout

**Files:**
- Move: every file under `packages/website/src` except `vite-env.d.ts` and `locales/` (commands in Step 1)
- Create: `packages/website/src/site/links.ts`
- Modify: imports in every moved file; `index.html`, `docs/index.html`, `showcase/index.html`, `tsconfig.json`, `tsconfig.examples.json`, `vite.config.ts`, `worker.ts`, `tests/locales.test.mjs`

**Interfaces:**
- Produces: `repository` from `src/site/links.ts`; `allDownloads`, `downloads`, `visitorPlatform`, `Platform` from `src/components/download-links.ts`; `HomePage`, `DocsPage`, `ShowcasePage` components; `posterURL(slug: string): string | undefined` and `loadShowcase(slug: string): Promise<Record<string, string>>` from `src/pages/showcase/sources.ts`.

- [ ] **Step 1: Move the files**

From `packages/website`:

```bash
mkdir -p src/site src/components src/features/playground src/pages/home src/pages/docs/content src/pages/showcase src/styles
git mv src/locales.ts src/catalog.ts src/i18n.ts src/docs-nav.ts src/showcase-catalog.ts src/site/
git mv src/links.ts src/components/download-links.ts
git mv src/Brand.tsx src/LanguageSwitcher.tsx src/Download.tsx src/components/
git mv src/Playground.tsx src/SourceEditor.tsx src/demo src/features/playground/
git mv src/App.tsx src/pages/home/HomePage.tsx
git mv src/main.tsx src/pages/home/main.tsx
git mv src/Docs.tsx src/pages/docs/DocsPage.tsx
git mv src/docs-main.tsx src/pages/docs/main.tsx
git mv src/DocCode.tsx src/syntax.ts src/examples src/pages/docs/
git mv src/docs-content.tsx src/pages/docs/content/guides.tsx
git mv src/docs-packages.tsx src/pages/docs/content/packages.tsx
git mv src/docs-shared.tsx src/pages/docs/content/shared.tsx
git mv src/Showcase.tsx src/pages/showcase/ShowcasePage.tsx
git mv src/showcase-main.tsx src/pages/showcase/main.tsx
git mv src/showcase-sources.ts src/pages/showcase/sources.ts
git mv src/style.css src/docs.css src/styles/
ls src
```

Expected `ls src`: `components features locales pages site styles vite-env.d.ts`.

- [ ] **Step 2: Split the repository link out of the download links**

Create `src/site/links.ts`:

```ts
export const repository = 'https://github.com/mika-f/Celesta';
```

In `src/components/download-links.ts`, replace the first line `export const repository = 'https://github.com/mika-f/Celesta';` with:

```ts
import { repository } from '../site/links';
```

The rest of the file is unchanged.

- [ ] **Step 3: Update imports in `src/site/` and `src/components/`**

`src/site/catalog.ts` lines 2–3 become:

```ts
import en from '../locales/en.json' with { type: 'json' };
import ja from '../locales/ja.json' with { type: 'json' };
```

`src/site/i18n.ts`, `src/site/docs-nav.ts`, `src/site/locales.ts`, `src/site/showcase-catalog.ts`: no change.

`src/components/Brand.tsx` line 1:

```ts
import { homePath, t } from '../site/i18n';
```

`src/components/LanguageSwitcher.tsx` lines 2–3:

```ts
import { currentLocale, t } from '../site/i18n';
import { localeCodes, locales, localizedPath } from '../site/locales';
```

`src/components/Download.tsx` lines 1–3:

```ts
import { docPath } from '../site/docs-nav';
import { t, text } from '../site/i18n';
import { allDownloads, downloads, visitorPlatform, type Platform } from './download-links';
```

- [ ] **Step 4: Update imports in the Playground and the pages**

`src/features/playground/Playground.tsx` line 1 (the `./demo/title-scene.tsx?raw` and `./SourceEditor` imports stay):

```ts
import { t, text } from '../../site/i18n';
```

`src/features/playground/SourceEditor.tsx` line 7:

```ts
import { t } from '../../site/i18n';
```

`src/pages/home/HomePage.tsx` lines 1–9 become the block below, and `export function App()` becomes `export function HomePage()`:

```ts
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { docPath } from '../../site/docs-nav';
import { currentLocale, t, text } from '../../site/i18n';
import { showcasePath } from '../../site/showcase-catalog';
import { useEffect, useRef, useState } from 'react';
import { Playground } from '../../features/playground/Playground';
import { Brand } from '../../components/Brand';
import { DownloadAlternatives, DownloadButton } from '../../components/Download';
import { allDownloads } from '../../components/download-links';
import { repository } from '../../site/links';
```

`src/pages/home/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HomePage } from './HomePage';
import '../../styles/style.css';

createRoot(document.getElementById('root')!).render(<StrictMode><HomePage /></StrictMode>);
```

`src/pages/docs/DocsPage.tsx` lines 1–8 become the block below, and `export function Docs()` becomes `export function DocsPage()`:

```ts
import { showcasePath } from '../../site/showcase-catalog';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { currentLocale, t, text, homePath } from '../../site/i18n';
import { useEffect, useState } from 'react';
import { Brand } from '../../components/Brand';
import { contents } from './content/guides';
import { docGroups, docPages, docPath } from '../../site/docs-nav';
import { packageContents } from './content/packages';
import { repository } from '../../site/links';
```

`src/pages/docs/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DocsPage } from './DocsPage';
import '../../styles/style.css';
import '../../styles/docs.css';

createRoot(document.getElementById('root')!).render(<StrictMode><DocsPage /></StrictMode>);
```

`src/pages/docs/DocCode.tsx` lines 1 and 3:

```ts
import { t, text } from '../../site/i18n';
import { highlight } from './syntax';
```

`src/pages/docs/content/shared.tsx` line 1:

```ts
import { t, text } from '../../../site/i18n';
```

`src/pages/docs/content/guides.tsx`: lines 1–20 become the block below. Delete the `export { repository };` line (DocsPage now imports `repository` from `site/links`). The example paths keep their `/examples/` segment, which the `celesta-sample-sources` plugin matches.

```ts
import { docPath } from '../../../site/docs-nav';
import { currentLocale, t, text, homePath } from '../../../site/i18n';
import { showcasePath } from '../../../site/showcase-catalog';
import { useState, type ReactNode } from 'react';
import { DocCode } from '../DocCode';
import { Api, Note } from './shared';
import { allDownloads, downloads } from '../../../components/download-links';
import { repository } from '../../../site/links';
import firstScene from '../examples/first-scene.tsx?raw';
import dialogueScene from '../examples/dialogue.tsx?raw';
import dialogueProject from '../examples/dialogue.celesta.json?raw';
import dialogueSeriesScene from '../examples/dialogue-series.tsx?raw';
import transitionSeriesScene from '../examples/transition-series.tsx?raw';
import fittedTextScene from '../examples/fitted-text.tsx?raw';
import dataScene from '../examples/data.tsx?raw';
import lipSyncScene from '../examples/lip-sync.tsx?raw';
import mediaScene from '../examples/media.tsx?raw';
import timelineExample from '../../../../../../examples/editor-demo.celesta.json?raw';
import withProject from '../../../../../cli/examples/with-project.tsx?raw';
```

`src/pages/docs/content/packages.tsx` lines 1–6:

```ts
import { docPath } from '../../../site/docs-nav';
import { t, text, homePath } from '../../../site/i18n';
import type { ReactNode } from 'react';
import { DocCode } from '../DocCode';
import { Api, Note } from './shared';
import voicevoxScene from '../examples/voicevox.tsx?raw';
```

`src/pages/showcase/sources.ts` (whole file). The glob keys are relative to this file, so the helper owns the path and the page no longer repeats it:

```ts
import { showcase } from '../../site/showcase-catalog';

// Relative to this file: src/pages/showcase → the repository's examples/.
const examples = '../../../../../examples/';
const sources = import.meta.glob('../../../../../examples/**/*.{ts,tsx}', { query: '?raw', import: 'default' });
const posters = import.meta.glob('../../../../../examples/*/poster.jpg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** The poster image of an example, when it has one. */
export const posterURL = (slug: string): string | undefined => posters[`${examples}${slug}/poster.jpg`];

export async function loadShowcase(slug: string): Promise<Record<string, string>> {
  if (!showcase.some(sample => sample.slug === slug && !('desktop' in sample))) throw new Error('This composition requires the desktop app.');
  const prefix = `${examples}${slug}/`;
  const files = await Promise.all(Object.entries(sources).filter(([path]) => path.startsWith(prefix)).map(async ([path, load]) => [path.slice(prefix.length), await load()] as [string, string]));
  if (!files.some(([path]) => path === 'film.tsx')) throw new Error('This composition has no browser source files.');
  return Object.fromEntries(files);
}
```

`src/pages/showcase/ShowcasePage.tsx`: lines 1–9 become the block below; `export function Showcase()` becomes `export function ShowcasePage()`; and in the gallery map, `const poster = posters[\`../../../examples/${item.slug}/poster.jpg\`];` becomes `const poster = posterURL(item.slug);`.

```ts
import { useEffect, useState } from 'react';
import { Brand } from '../../components/Brand';
import { Playground } from '../../features/playground/Playground';
import { repository } from '../../site/links';
import { showcase, showcasePath } from '../../site/showcase-catalog';
import { loadShowcase, posterURL } from './sources';
import { currentLocale, homePath, t } from '../../site/i18n';
import { docPath } from '../../site/docs-nav';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
```

`src/pages/showcase/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ShowcasePage } from './ShowcasePage';
import '../../styles/style.css';

createRoot(document.getElementById('root')!).render(<StrictMode><ShowcasePage /></StrictMode>);
```

- [ ] **Step 5: Update entries, configs, the Worker, and tests**

HTML entry scripts:
- `index.html`: `src="/src/main.tsx"` → `src="/src/pages/home/main.tsx"`
- `docs/index.html`: `src="/src/docs-main.tsx"` → `src="/src/pages/docs/main.tsx"`
- `showcase/index.html`: `src="/src/showcase-main.tsx"` → `src="/src/pages/showcase/main.tsx"`

`tsconfig.json` `exclude`:

```json
  "exclude": [
    "src/pages/docs/examples",
    "src/features/playground/demo/title-scene.tsx"
  ]
```

`tsconfig.examples.json` `include`:

```json
  "include": ["src/features/playground/demo/title-scene.tsx", "src/pages/docs/examples/*.tsx"]
```

`vite.config.ts` lines 9–13:

```ts
import { getDocGroups } from './src/site/docs-nav.ts';
import { richText } from './src/site/i18n.ts';
import { translate } from './src/site/catalog.ts';
import { languageRedirect, localeCodes, localeFromPath, type Locale } from './src/site/locales.ts';
import { showcase } from './src/site/showcase-catalog.ts';
```

`worker.ts` line 1:

```ts
import { languageRedirect } from './src/site/locales.ts';
```

`tests/locales.test.mjs` lines 4–7 (the catalog JSON path `../src/locales/${locale}.json` is unchanged):

```js
import { localeCodes, preferredLocale, localizedPath } from '../src/site/locales.ts';
import { getDocGroups } from '../src/site/docs-nav.ts';
import { translate } from '../src/site/catalog.ts';
import { richText } from '../src/site/i18n.ts';
```

- [ ] **Step 6: Find leftovers**

```bash
grep -rn "from '\./\(i18n\|docs-nav\|links\|showcase-catalog\|locales\|Brand\|Playground\)'" src
grep -rn "src/\(main\|docs-main\|showcase-main\)\.tsx\|src/examples\|src/demo" index.html docs showcase tsconfig*.json vite.config.ts
```

Expected: no output from either command. Fix any hit.

- [ ] **Step 7: Type-check, test, and build**

From `packages/website`:

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm check:examples
pnpm exec vite build
sh "$SCRATCH/compare-dist.sh" "$SCRATCH/dist-before" dist
```

Expected: `tsc` prints nothing; tests pass; `check:examples` passes (Review Focus 5); the comparison prints `dist matches`. The poster JPEGs under `assets/` must appear in both lists (Review Focus 2).

If the comparison fails:
- A missing or extra file, or a different number of files, means an import path or entry is wrong. Investigate and fix it.
- Rolldown names a shared chunk after one of its modules, so a chunk may be renamed (for example `assets/catalog-HASH.js` → `assets/i18n-HASH.js`) without anything being wrong. This is acceptable when the file count is the same, the HTML is identical except for that chunk name, and nothing else differs. Record the rename in the pull request body.

- [ ] **Step 8: Commit**

```bash
git add -A packages/website
git commit -m "refactor(website): organise sources by page

Node-importable logic lives in src/site, shared UI in src/components,
the editor in src/features/playground, and each page with its own
content under src/pages. The build output is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Move the Vite plugins out of the config

**Files:**
- Move: `packages/website/vite.config.ts` → `packages/website/plugins/site-pages.ts`
- Create: `packages/website/plugins/sample-sources.ts`, `packages/website/vite.config.ts` (new, short)
- Modify: `packages/website/tsconfig.json` (`include`)

**Interfaces:**
- Produces: `sampleSources(root: string): Plugin`, `sitePages(root: string): Plugin`. `root` is the repository root as an absolute path (with a trailing separator, from `fileURLToPath(new URL('../..', import.meta.url))` in `vite.config.ts`).

The current `vite.config.ts` becomes `plugins/site-pages.ts`, so its history follows the HTML plugin. `sampleSources` moves to its own file and a new, short `vite.config.ts` is written.

- [ ] **Step 1: Rename the config and create `plugins/sample-sources.ts`**

```bash
mkdir -p plugins
git mv vite.config.ts plugins/site-pages.ts
```

Create `plugins/sample-sources.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Samples are editor text, independent of their desktop .celesta/tsconfig. `root` is the repository root. */
export function sampleSources(root: string): Plugin {
  const prefix = '\0celesta-sample:';
  return {
    name: 'celesta-sample-sources', enforce: 'pre',
    resolveId(source, importer) {
      if (!source.includes('/examples/') || !source.endsWith('?raw')) return;
      return `${prefix}${encodeURIComponent(relative(root, resolve(importer ? dirname(importer) : '.', source.slice(0, -4))))}.js`;
    },
    load(id) {
      if (!id.startsWith(prefix)) return;
      const path = join(root, decodeURIComponent(id.slice(prefix.length, -3)));
      this.addWatchFile(path);
      return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`;
    },
  };
}
```

- [ ] **Step 2: Turn the renamed file into the HTML plugin**

Edit `plugins/site-pages.ts` (the old config). `escapeHtml`, `site`, `localizedHtml`, and the body of `sitePages` stay as they are, apart from the replacements below.

Replace the import block (the first 13 lines) with:

```ts
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizePath, type Plugin } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDocGroups } from '../src/site/docs-nav.ts';
import { richText } from '../src/site/i18n.ts';
import { translate } from '../src/site/catalog.ts';
import { languageRedirect, localeCodes, localeFromPath, type Locale } from '../src/site/locales.ts';
import { showcase } from '../src/site/showcase-catalog.ts';
```

Delete the whole `sampleSources` function with its doc comment (Step 1 created its new home), and delete the trailing `export default defineConfig({ … });` block.

Replace the line

```ts
/** Build real HTML entries for every locale and documentation chapter. */
function sitePages(): Plugin {
```

with

```ts
/** Build real HTML entries for every locale and documentation chapter. `root` is the repository root. */
export function sitePages(root: string): Plugin {
```

The two paths that were resolved from `import.meta.url` now come from `root`. The dev-server path is decoded first, as `fileURLToPath` did. Inside `configureServer`, replace:

```ts
request.url = '/@fs/' + normalizePath(fileURLToPath(new URL(`../../${url.pathname.slice('/showcase-assets/'.length)}`, import.meta.url)));
```

with

```ts
request.url = '/@fs/' + normalizePath(join(root, decodeURIComponent(url.pathname.slice('/showcase-assets/'.length))));
```

and, inside `writeBundle`:

```ts
cpSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), join(outDir, 'showcase-assets', path), { recursive: true });
```

with

```ts
cpSync(join(root, path), join(outDir, 'showcase-assets', path), { recursive: true });
```

Afterwards `grep -n "import.meta.url\|fileURLToPath\|defineConfig\|sampleSources" plugins/site-pages.ts` must print nothing.

- [ ] **Step 3: Write the new `vite.config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sampleSources } from './plugins/sample-sources.ts';
import { sitePages } from './plugins/site-pages.ts';

/** The repository root: examples and other packages' sources are read from here. */
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [sampleSources(root), react(), tailwindcss(), sitePages(root)],
  build: { rolldownOptions: { input: ['index.html', 'docs/index.html', 'showcase/index.html'] } },
});
```

`tsconfig.json` `include` gains `"plugins"`:

```json
  "include": [
    "src",
    "plugins",
    "vite.config.ts",
    "worker.ts",
    "worker-configuration.d.ts"
  ],
```

- [ ] **Step 4: Type-check, build, and compare**

```bash
pnpm exec tsc --noEmit
pnpm exec vite build
sh "$SCRATCH/compare-dist.sh" "$SCRATCH/dist-before" dist
```

Expected: no type errors; `dist matches`.

- [ ] **Step 5: Check the dev server's showcase assets (Review Focus 3)**

Start `pnpm exec vite --host 127.0.0.1` and request one file from each asset directory, plus a raw example through the docs page:

```bash
ls ../../examples/afterimage/assets/fonts | head -1
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5173/showcase-assets/examples/afterimage/assets/fonts/<first file>"
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5173/ja/docs/export/"
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5173/ja/showcase/apex/"
```

Expected: `200` for each (use the port Vite prints). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A packages/website
git commit -m "refactor(website): move the Vite plugins out of the config

The repository root is resolved once in vite.config.ts and passed to
the plugins, so their files can live in plugins/.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One route module

**Files:**
- Create: `packages/website/src/site/routes.ts`, `packages/website/tests/routes.test.mjs`
- Modify: `src/site/docs-nav.ts` (remove `docPath`), `src/site/showcase-catalog.ts` (remove `showcasePath`), `plugins/site-pages.ts` (use `parseRoute`), `src/pages/docs/DocsPage.tsx` (`currentSlug`), `src/pages/showcase/ShowcasePage.tsx` (slug), and the `docPath`/`showcasePath` imports in `src/components/Download.tsx`, `src/pages/home/HomePage.tsx`, `src/pages/docs/DocsPage.tsx`, `src/pages/docs/content/guides.tsx`, `src/pages/docs/content/packages.tsx`, `src/pages/showcase/ShowcasePage.tsx`

**Interfaces:**
- Consumes: `localeFromPath(path: string): Locale`, `Locale` from `src/site/locales.ts`.
- Produces (`src/site/routes.ts`):
  - `type Route = { locale: Locale; page: 'home' } | { locale: Locale; page: 'docs' | 'showcase'; slug: string } | { locale: Locale; page: 'other' }`
  - `parseRoute(pathname: string): Route` — slug is `'overview'` for `/docs/` and `/showcase/`.
  - `docPath(slug: string, locale?: Locale): string` — default locale from `window.location`, `'en'` in Node (unchanged behavior).
  - `showcasePath(slug?: string, locale?: string): string` — defaults `''` and `'en'` (unchanged behavior).

- [ ] **Step 1: Write the failing tests**

Create `tests/routes.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localeCodes } from '../src/site/locales.ts';
import { getDocGroups } from '../src/site/docs-nav.ts';
import { showcase } from '../src/site/showcase-catalog.ts';
import { docPath, parseRoute, showcasePath } from '../src/site/routes.ts';

test('parse home, documentation and showcase addresses', () => {
  for (const [path, expected] of [
    ['/', { locale: 'en', page: 'home' }],
    ['/index.html', { locale: 'en', page: 'home' }],
    ['/ja/', { locale: 'ja', page: 'home' }],
    ['/ja/index.html', { locale: 'ja', page: 'home' }],
    ['/en/docs/', { locale: 'en', page: 'docs', slug: 'overview' }],
    ['/ja/docs/index.html', { locale: 'ja', page: 'docs', slug: 'overview' }],
    ['/ja/docs/export/', { locale: 'ja', page: 'docs', slug: 'export' }],
    ['/ja/docs/export', { locale: 'ja', page: 'docs', slug: 'export' }],
    ['/docs/export/', { locale: 'en', page: 'docs', slug: 'export' }],
    ['/docs/index.html', { locale: 'en', page: 'docs', slug: 'overview' }],
    ['/ja/showcase/', { locale: 'ja', page: 'showcase', slug: 'overview' }],
    ['/ja/showcase/36-days/', { locale: 'ja', page: 'showcase', slug: '36-days' }],
    ['/showcase/apex/', { locale: 'en', page: 'showcase', slug: 'apex' }],
    ['/showcase/index.html', { locale: 'en', page: 'showcase', slug: 'overview' }],
  ]) assert.deepEqual(parseRoute(path), expected, path);
});

test('other addresses are not pages', () => {
  for (const path of ['/en', '/ja/unknown/', '/ja/docs/export/extra/', '/ja/docs/Export/', '/fr/docs/export/', '/assets/site.js', '/showcase-assets/examples/x.woff2']) {
    assert.equal(parseRoute(path).page, 'other', path);
  }
});

test('built paths parse back to their page in every locale', () => {
  const slugs = ['overview', ...getDocGroups('en').flatMap(group => group.pages).map(page => page.slug)];
  for (const locale of localeCodes) {
    for (const slug of slugs) assert.deepEqual(parseRoute(docPath(slug, locale)), { locale, page: 'docs', slug });
    assert.deepEqual(parseRoute(showcasePath('', locale)), { locale, page: 'showcase', slug: 'overview' });
    for (const { slug } of showcase) assert.deepEqual(parseRoute(showcasePath(slug, locale)), { locale, page: 'showcase', slug });
  }
});

test('path builders keep their defaults', () => {
  assert.equal(docPath('overview', 'ja'), '/ja/docs/');
  assert.equal(docPath('export'), '/en/docs/export/');
  assert.equal(showcasePath(), '/en/showcase/');
  assert.equal(showcasePath('apex', 'ja'), '/ja/showcase/apex/');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test`
Expected: FAIL in `routes.test.mjs` with `ERR_MODULE_NOT_FOUND` for `src/site/routes.ts`.

- [ ] **Step 3: Create `src/site/routes.ts`**

```ts
import { localeFromPath, type Locale } from './locales.ts';

/** The page an address shows. Documentation and showcase index pages have the slug `overview`. */
export type Route =
  | { locale: Locale; page: 'home' }
  | { locale: Locale; page: 'docs' | 'showcase'; slug: string }
  | { locale: Locale; page: 'other' };

/** Read an address. Paths without a language, such as the legacy `/docs/export/`, are English. */
export function parseRoute(pathname: string): Route {
  const locale = localeFromPath(pathname);
  const prefix = `/${locale}/`;
  const path = pathname.startsWith(prefix) ? pathname.slice(prefix.length - 1) : pathname;
  if (path === '/' || path === '/index.html') return { locale, page: 'home' };
  for (const page of ['docs', 'showcase'] as const) {
    if (path === `/${page}/index.html`) return { locale, page, slug: 'overview' };
    const match = new RegExp(`^/${page}/(?:([a-z0-9-]+)/?)?$`).exec(path);
    if (match) return { locale, page, slug: match[1] ?? 'overview' };
  }
  return { locale, page: 'other' };
}

const windowLocale = () => localeFromPath(typeof window === 'undefined' ? '/en/' : window.location.pathname);

/** The path of a documentation page. The overview is `/<locale>/docs/`. */
export function docPath(slug: string, locale: Locale = windowLocale()): string {
  return slug === 'overview' ? `/${locale}/docs/` : `/${locale}/docs/${slug}/`;
}

/** The path of a showcase entry, or of the gallery when `slug` is empty. */
export const showcasePath = (slug = '', locale = 'en') => `/${locale}/showcase/${slug ? `${slug}/` : ''}`;
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test`
Expected: PASS, including the existing `locales.test.mjs`.

- [ ] **Step 5: Remove the old builders and switch the importers**

In `src/site/docs-nav.ts`, delete the `docPath` function and its doc comment (the last 4 lines). In `src/site/showcase-catalog.ts`, delete the comment `// Keep these paths pure…` and the `showcasePath` line.

Change these imports:
- `src/components/Download.tsx`: `import { docPath } from '../site/docs-nav';` → `import { docPath } from '../site/routes';`
- `src/pages/home/HomePage.tsx`: replace the `docPath` and `showcasePath` imports with `import { docPath, showcasePath } from '../../site/routes';`
- `src/pages/docs/DocsPage.tsx`: `import { showcasePath } from '../../site/showcase-catalog';` → `import { docPath, parseRoute, showcasePath } from '../../site/routes';`, and `import { docGroups, docPages, docPath } from '../../site/docs-nav';` → `import { docGroups, docPages } from '../../site/docs-nav';`
- `src/pages/docs/content/guides.tsx`: replace the `docPath` and `showcasePath` imports with `import { docPath, showcasePath } from '../../../site/routes';`
- `src/pages/docs/content/packages.tsx`: `import { docPath } from '../../../site/docs-nav';` → `import { docPath } from '../../../site/routes';`
- `src/pages/showcase/ShowcasePage.tsx`: `import { showcase, showcasePath } from '../../site/showcase-catalog';` → `import { showcase } from '../../site/showcase-catalog';`, `import { docPath } from '../../site/docs-nav';` → `import { docPath, parseRoute, showcasePath } from '../../site/routes';`

- [ ] **Step 6: Use `parseRoute` in the pages**

`src/pages/docs/DocsPage.tsx`, replace `currentSlug`:

```ts
/** The page for the current address: `/docs/` is the overview, `/docs/<slug>/` a chapter. */
function currentSlug(): string {
  const route = parseRoute(window.location.pathname);
  return route.page === 'docs' && docPages.some(page => page.slug === route.slug) ? route.slug : 'overview';
}
```

`src/pages/showcase/ShowcasePage.tsx`, replace the line `const slug = window.location.pathname.replace(…).replace(/\/+$/, '');` with:

```ts
  const route = parseRoute(window.location.pathname);
  const slug = route.page === 'showcase' && route.slug !== 'overview' ? route.slug : '';
```

- [ ] **Step 7: Use `parseRoute` in the HTML plugin**

In `plugins/site-pages.ts`: remove `localeFromPath` from the `locales.ts` import, add `import { parseRoute } from '../src/site/routes.ts';`, and delete the local `route` function.

In `configureServer`, replace the line `const { slug, home, showcaseSlug } = route(url.pathname);` and the three `if/else if` branches that use it with:

```ts
        const route = parseRoute(url.pathname);
        if (route.page === 'home') request.url = '/index.html' + url.search;
        else if (route.page === 'docs' && (route.slug === 'overview' || slugs.includes(route.slug))) request.url = '/docs/index.html' + url.search;
        else if (route.page === 'showcase' && (route.slug === 'overview' || showcase.some(item => item.slug === route.slug))) request.url = '/showcase/index.html' + url.search;
```

(the following `else if (/^\/showcase-assets\/…/` branch stays). Replace `transformIndexHtml` with:

```ts
    transformIndexHtml(html, context) {
      const route = parseRoute((context.originalUrl ?? context.path).split(/[?#]/)[0]);
      return localizedHtml(html, route.locale, route.page === 'docs' ? route.slug : undefined, route.page === 'showcase' ? route.slug : undefined);
    },
```

- [ ] **Step 8: Verify**

```bash
grep -rn "docs-nav'.*docPath\|showcase-catalog'.*showcasePath\|location.pathname.replace" src plugins
pnpm exec tsc --noEmit
pnpm test
pnpm exec vite build
sh "$SCRATCH/compare-dist.sh" "$SCRATCH/dist-before" dist
```

Expected: the grep prints nothing; no type errors; tests pass; `dist matches`.

- [ ] **Step 9: Commit**

```bash
git add -A packages/website
git commit -m "refactor(website): parse and build addresses in one module

The HTML plugin and the documentation and showcase pages read the
address with parseRoute(); docPath() and showcasePath() move beside it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: README, browser check, and the layer-1 pull request

**Files:**
- Modify: `packages/website/README.md`

- [ ] **Step 1: Update the README paths**

In `packages/website/README.md`:
- "Languages": `src/locales.ts` → `src/site/locales.ts` (twice); `` `catalog.ts` `` → `` `src/site/catalog.ts` ``; `` `src/catalog.ts` `` → `` `src/site/catalog.ts` ``.
- Replace the bullets of "Content and behavior" that name source files (from `` - `src/App.tsx` `` through the `src/Brand.tsx` bullet) with:

```markdown
- Source layout: `src/site/` holds code that also runs in Node (languages,
  catalogs, routes, the documentation and showcase lists); `src/components/`
  shared UI; `src/features/playground/` the editor and preview;
  `src/pages/<page>/` each page's entry, component, and content;
  `src/styles/` the style sheets. `plugins/` holds the Vite plugins.
- `src/pages/home/HomePage.tsx`: product copy, navigation, documentation and repository links.
- `src/site/links.ts`, `src/components/download-links.ts`, and
  `src/components/Download.tsx`: repository and download links, and the
  platform-aware download buttons.
- `/docs/`: the on-site bilingual user guide, one page per chapter at
  `/<language>/docs/<slug>/`, all built from `docs/index.html`. `src/site/docs-nav.ts` is the
  single list of groups and pages (slug, title, description, search keywords);
  add a page there, then add its content under the same slug in
  `src/pages/docs/content/guides.tsx` (app, React, and guides) or `src/pages/docs/content/packages.tsx`
  (`@celesta/math`, `@celesta/code`, and `@celesta/voicevox`). `src/pages/docs/DocsPage.tsx` renders the grouped
  sidebar, topic search, previous/next links, and the overview. Old
  `/docs/#<chapter>` links redirect to the matching page. Link between pages
  with `docPath(slug)` from `src/site/routes.ts`; `src/pages/docs/content/shared.tsx` has the `Note` and `Api` helpers.
  `src/pages/docs/DocCode.tsx` supplies accessible copy controls for code examples.
  `src/pages/docs/syntax.ts` highlights code with [twinkleplop](https://twinkleplop.pngwn.at)
  (TSX, JSON, and shell) in documentation.
```

  Keep the remaining bullets, changing their paths: `src/examples/` → `src/pages/docs/examples/`; `src/demo/title-scene.tsx` → `src/features/playground/demo/title-scene.tsx`; `src/SourceEditor.tsx` → `src/features/playground/SourceEditor.tsx`; `src/Playground.tsx` → `src/features/playground/Playground.tsx`; `src/style.css` → `src/styles/style.css`; `src/Brand.tsx` → `src/components/Brand.tsx`.
- "Verification": `` `src/examples/` `` → `` `src/pages/docs/examples/` ``.
- "Showcase": `src/showcase-catalog.ts` → `src/site/showcase-catalog.ts`; `src/showcase-sources.ts` → `src/pages/showcase/sources.ts`.
- Line 53: "then `vite.config.ts` generates" → "then the `plugins/site-pages.ts` Vite plugin generates".

Then `grep -n "src/[A-Za-z-]*\.tsx\?\b\|src/examples\|src/demo" packages/website/README.md` must list only new paths.

- [ ] **Step 2: Check the built site in a browser**

Run `pnpm preview:cloudflare` (builds and serves through local Wrangler) and visit:
- `/` (redirects by `Accept-Language`), `/en/`, `/ja/` — hero, playground preview renders a frame, Monaco loads on focus.
- `/ja/docs/`, `/ja/docs/export/`, `/docs/export/`, `/docs/#export` (must land on `/en/docs/export/`), topic search with and without results (Review Focus 1).
- `/ja/showcase/` (posters visible), `/ja/showcase/apex/` (source files listed, a frame renders), `/en/showcase/prism/` (desktop notice) (Review Focus 2).
- `/ja/nope/` — localized 404.

Expected: identical to the baseline site.

- [ ] **Step 3: Commit and open the pull request**

```bash
git add packages/website/README.md
git commit -m "docs(website): describe the new source layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
gh stack submit --auto --remote origin
gh stack view --json
```

Then set the title and body of the layer-1 PR (number from `view --json`):

```bash
gh pr edit <number> --title "refactor(website): organise sources by page" --body-file <file>
```

The body summarises Tasks 1–4, states that the masked `dist/` comparison matched, lists the commands run, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Layer 2 — `claude/website-site-chrome`

### Task 5: Shared header

**Files:**
- Create: `packages/website/src/components/SiteHeader.tsx`
- Modify: `src/locales/en.json`, `src/locales/ja.json`, `src/pages/home/HomePage.tsx`, `src/pages/docs/DocsPage.tsx`, `src/pages/showcase/ShowcasePage.tsx`, `src/styles/style.css`, `src/styles/docs.css`

**Interfaces:**
- Consumes: `Brand`, `LanguageSwitcher`, `allDownloads`, `repository`, `docPath`, `showcasePath`, `currentLocale`, `homePath`, `t`.
- Produces: `SiteHeader({ current }: { current?: 'docs' | 'showcase' })`; catalog keys `common.navigation.{main,docs,showcase,playground,github,download}`.

- [ ] **Step 1: Start the second layer**

```bash
gh stack add claude/website-site-chrome
```

- [ ] **Step 2: Add the navigation messages**

Line numbers given for catalog keys in Tasks 5 and 6 are from the unchanged files and shift as keys are added; find each key by name.

In `src/locales/en.json`, `common.navigation` becomes:

```json
    "navigation": {
      "menu": "Menu",
      "close": "Close",
      "language": "Language",
      "label": "Celesta home",
      "main": "Main navigation",
      "docs": "Docs",
      "showcase": "Showcase",
      "playground": "Playground",
      "github": "GitHub",
      "download": "Download"
    },
```

In `src/locales/ja.json`:

```json
    "navigation": {
      "menu": "メニュー",
      "close": "閉じる",
      "language": "言語",
      "label": "Celesta のホーム",
      "main": "メインナビゲーション",
      "docs": "ドキュメント",
      "showcase": "ショーケース",
      "playground": "プレイグラウンド",
      "github": "GitHub",
      "download": "ダウンロード"
    },
```

- [ ] **Step 3: Create `src/components/SiteHeader.tsx`**

```tsx
import { useState } from 'react';
import { Brand } from './Brand';
import { LanguageSwitcher } from './LanguageSwitcher';
import { allDownloads } from './download-links';
import { currentLocale, homePath, t } from '../site/i18n';
import { repository } from '../site/links';
import { docPath, showcasePath } from '../site/routes';

/** The header on every page. Below 780 px the navigation folds behind a menu button. */
export function SiteHeader({ current }: { current?: 'docs' | 'showcase' }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <header id="top" className="header">
    <div className="shell header-inner flex items-center justify-between">
      <Brand />
      <button className="menu-toggle" aria-expanded={menuOpen} aria-controls="navigation" onClick={() => setMenuOpen(!menuOpen)}>{t(menuOpen ? 'common.navigation.close' : 'common.navigation.menu')}</button>
      <nav id="navigation" aria-label={t('common.navigation.main')} className={`nav flex items-center ${menuOpen ? 'is-open' : ''}`} onClick={() => setMenuOpen(false)}>
        <a href={docPath('overview')} aria-current={current === 'docs' ? 'true' : undefined}>{t('common.navigation.docs')}</a>
        <a href={showcasePath('', currentLocale)} aria-current={current === 'showcase' ? 'true' : undefined}>{t('common.navigation.showcase')}</a>
        <a href={`${homePath}#playground`}>{t('common.navigation.playground')}</a>
        <a href={repository}>{t('common.navigation.github')} <span aria-hidden="true">↗</span></a>
        <a className="nav-download" href={allDownloads}>{t('common.navigation.download')}</a>
        <LanguageSwitcher />
      </nav>
    </div>
  </header>;
}
```

- [ ] **Step 4: Use it on every page**

`src/pages/home/HomePage.tsx`:
- Replace the whole `<header id="top" className="header">…</header>` element with `<SiteHeader />`.
- Delete `const [menuOpen, setMenuOpen] = useState(false);`.
- Imports: add `import { SiteHeader } from '../../components/SiteHeader';`; remove `LanguageSwitcher`, `allDownloads`, `currentLocale`, `showcasePath` (keep `docPath`: the feature cards use it), and `useState` from the React import. Keep `Brand` and the `documentation` constant: the footer still uses them until Task 6.

`src/pages/docs/DocsPage.tsx`:
- Replace the whole `<header className="header docs-header">…</header>` element with `<SiteHeader current="docs" />`.
- Imports: add `import { SiteHeader } from '../../components/SiteHeader';`; remove `LanguageSwitcher` and `Brand` (only the old header used them).

`src/pages/showcase/ShowcasePage.tsx`:
- Replace the whole `<header className="header">…</header>` element with `<SiteHeader current="showcase" />`.
- Delete `const [menuOpen, setMenuOpen] = useState(false);`.
- Imports: add `import { SiteHeader } from '../../components/SiteHeader';`; remove `LanguageSwitcher` and `Brand` (only the old header used them). Keep `useState`: the loader state uses it.

- [ ] **Step 5: Remove the replaced messages**

Delete these keys from both `en.json` and `ja.json` (line numbers are from the unchanged files; keep the JSON valid, including the comma on the preceding line when a key was last in its object):
- `home.why-celesta-playground-docs-github-download` (line 4)
- `home.main-navigation` (line 5)
- `docs.ui.documentation` (line 127)
- `docs.ui.website-github` (line 128)
- `docs.ui.main-navigation` (line 129)
- `showcase.docs` (line 1086)

Then:

```bash
grep -rn "why-celesta-playground\|home.main-navigation\|docs.ui.documentation'\|website-github\|docs.ui.main-navigation\|showcase.docs'" src
```

Expected: no output.

- [ ] **Step 6: Styles**

`src/styles/style.css`, after the `.nav .nav-download:hover` rule, add:

```css
.nav a[aria-current] { color: var(--text); }
```

`src/styles/docs.css`, delete the rules for the old docs header:
- line 1 `.docs-header-label { … }`, line 2 `.docs-top-nav { … }`, line 3 `.docs-top-nav a:hover { … }`;
- in `@media (max-width: 760px)`: `.docs-header .docs-showcase-link`, `.docs-header-label`, `.docs-header .header-inner > div`, `.docs-top-nav`;
- in the first `@media (max-width: 440px)`: `.docs-header-label`;
- the whole second `@media (max-width: 440px) { .docs-top-nav a:first-child … }` block;
- `.docs-header .header-inner { gap: 16px; }` and `.docs-top-nav a { white-space: nowrap; }`.

Then `grep -n "docs-header\|docs-top-nav\|docs-showcase-link" src` must print nothing.

- [ ] **Step 7: Verify**

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm exec vite build
```

Expected: no errors; the catalog test confirms both languages have the same keys and slots.

Start `pnpm exec vite --host 127.0.0.1` and check `/en/`, `/ja/docs/export/` followed by a `#` and the `id` of any heading on that chapter, and `/ja/showcase/apex/`, at 1280 px, 800 px, and 375 px:
- The same five links and the language switcher appear in the same order on every page; Docs is highlighted on docs pages and Showcase on showcase pages.
- At 375 px on the docs chapter, the menu button opens the navigation over the page and closes on a link click; the docs contents toggle below it still opens the chapter list (Review Focus 4).
- Switching language on the docs chapter keeps the chapter and the hash.
- At 800 px in Japanese, the navigation fits on one line.
- Playground on `/ja/docs/` goes to `/ja/#playground`; on `/ja/` it scrolls without reloading.

- [ ] **Step 8: Commit**

```bash
git add -A packages/website
git commit -m "feat(website): share one header across pages

Every page shows Docs, Showcase, Playground, GitHub, Download, and the
language switcher, with the collapsible menu on narrow screens.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Shared footer

**Files:**
- Create: `packages/website/src/components/SiteFooter.tsx`
- Modify: `src/locales/en.json`, `src/locales/ja.json`, `src/pages/home/HomePage.tsx`, `src/pages/docs/DocsPage.tsx`, `src/pages/showcase/ShowcasePage.tsx`, `src/styles/docs.css`

**Interfaces:**
- Consumes: `Brand`, `repository`, `docPath`, `showcasePath`, `currentLocale`, `t`, and `common.navigation.{showcase,github}` from Task 5.
- Produces: `SiteFooter()`; catalog keys `common.footer.{label,tagline,documentation,releases,issues,built-with,license}`.

- [ ] **Step 1: Add the footer messages**

`src/locales/en.json`, inside `common`, after `clipboard`:

```json
    "footer": {
      "label": "Footer",
      "tagline": "Code-first video. Open source.",
      "documentation": "Documentation",
      "releases": "Releases",
      "issues": "Issues",
      "built-with": "Built with Rust and TypeScript.",
      "license": "MIT / Apache-2.0"
    }
```

`src/locales/ja.json`:

```json
    "footer": {
      "label": "フッター",
      "tagline": "コードで動画を作る、オープンソースのツール。",
      "documentation": "ドキュメント",
      "releases": "リリース",
      "issues": "Issues",
      "built-with": "Rust と TypeScript で開発しています。",
      "license": "MIT / Apache-2.0"
    }
```

(Add the comma after the `clipboard` object.)

- [ ] **Step 2: Create `src/components/SiteFooter.tsx`**

```tsx
import { Brand } from './Brand';
import { currentLocale, t } from '../site/i18n';
import { repository } from '../site/links';
import { docPath, showcasePath } from '../site/routes';

/** The footer on every page. */
export function SiteFooter() {
  return <footer className="footer shell">
    <div className="footer-top">
      <div><Brand /><p>{t('common.footer.tagline')}</p></div>
      <nav aria-label={t('common.footer.label')}>
        <a href={docPath('overview')}>{t('common.footer.documentation')}</a>
        <a href={showcasePath('', currentLocale)}>{t('common.navigation.showcase')}</a>
        <a href={repository}>{t('common.navigation.github')}</a>
        <a href={`${repository}/releases`}>{t('common.footer.releases')}</a>
        <a href={`${repository}/issues`}>{t('common.footer.issues')}</a>
      </nav>
    </div>
    <div className="footer-bottom flex flex-wrap justify-between gap-3"><span>{t('common.footer.built-with')}</span><span>{t('common.footer.license')}</span></div>
  </footer>;
}
```

- [ ] **Step 3: Use it on every page**

`src/pages/home/HomePage.tsx`: replace the whole `<footer className="footer shell">…</footer>` element with `<SiteFooter />`; delete `const documentation = docPath('overview');` (the old header and footer were its only users); add `import { SiteFooter } from '../../components/SiteFooter';`; remove the `Brand` import. Keep `repository` (the hero's development badge links to `${repository}/commits`) and `docPath` (feature cards).

`src/pages/docs/DocsPage.tsx`: delete the line `<footer className="docs-footer">…</footer>` inside `<main>`, and add `<SiteFooter />` after the closing `</div>` of `docs-layout`, so the end of the component reads:

```tsx
        <div className="docs-end">{/* unchanged */}</div>
      </main>
    </div>
    <SiteFooter />
  </div>;
```

Add `import { SiteFooter } from '../../components/SiteFooter';`. Keep `repository` (sidebar "open an issue" link) and `homePath` (the "open the playground" call to action).

`src/pages/showcase/ShowcasePage.tsx`: replace the whole `<footer className="footer shell">…</footer>` element with `<SiteFooter />`; add the import; remove `homePath` from the `i18n` import (the old footer was its only user). Keep `currentLocale` (the `path()` helper uses it).

- [ ] **Step 4: Remove the replaced messages and styles**

Delete from both catalogs (keep the JSON valid):
- `home.code-first-video-open-source`, `home.documentation-github-releases-issues`, `home.footer`, `home.built-with-rust-and-typescript-mit-apache` (lines 57–60)
- `docs.ui.mit-apache-2-0-source-documentation` (line 144)
- `showcase.explore` (line 1049). Before deleting it, run `grep -rn "showcase.explore" src`; an earlier count found two matches. Delete the key only if no `t('showcase.explore')` call remains after Step 3.

Delete `.docs-footer { … }` and `.docs-footer a:hover { … }` from `src/styles/docs.css`.

```bash
grep -rn "code-first-video-open-source\|documentation-github-releases-issues\|'home.footer'\|built-with-rust\|mit-apache-2-0-source\|showcase.explore\|docs-footer" src
```

Expected: no output.

- [ ] **Step 5: Verify**

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm exec vite build
```

Expected: no errors. In the dev server, at 1280 px and 375 px, `/ja/`, `/ja/docs/export/`, and `/ja/showcase/` end with the same footer; on docs pages it spans the full width below the sidebar and article, and the sticky sidebar does not overlap it.

- [ ] **Step 6: Commit**

```bash
git add -A packages/website
git commit -m "feat(website): share one footer across pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: README and the layer-2 pull request

**Files:**
- Modify: `packages/website/README.md`

- [ ] **Step 1: Document the shared chrome**

In "Content and behavior", after the source-layout bullet, add:

```markdown
- `src/components/SiteHeader.tsx` and `src/components/SiteFooter.tsx`: the
  header and footer on every page. Navigation labels are in
  `common.navigation` and `common.footer` in each catalog.
```

- [ ] **Step 2: Full check**

```bash
pnpm test
pnpm build
pnpm check:examples
pnpm deploy:check
```

Expected: all pass. Repeat Task 4 Step 2's browser visits with `pnpm preview:cloudflare`; the only differences from the baseline are the header and footer.

- [ ] **Step 3: Commit and submit**

```bash
git add packages/website/README.md
git commit -m "docs(website): describe the shared header and footer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
gh stack submit --auto --remote origin
gh stack view --json
gh pr edit <layer-2 number> --title "feat(website): share one header and footer across pages" --body-file <file>
```

The body lists the navigation items, the removed docs-only label, the narrow-screen menu now on docs pages, the browser checks performed, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## After this plan

The framework step (TanStack Start or makit) gets its own design once makit's fixed-page support exists. Both need the locale to reach components through context instead of `window` at module load (`currentLocale`, `homePath`, `docGroups`, `docPath`'s default, the documentation `contents` object, `visitorPlatform`); that work is deliberately left out here.
