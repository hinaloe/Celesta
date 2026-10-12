# Website on Makit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `packages/website` on Makit 0.8 with a custom "Tungsten" theme, Markdown documentation, static pages for the landing page and showcase, and the playground kept as a Vite-built island.

**Architecture:** `packages/website` becomes a Makit project (`content/` Markdown, `pages/` static pages, `theme/` local theme). The playground keeps its Vite toolchain in `playground/` and builds an ES module into `public/_playground/` that a client component mounts. The old Vite site keeps working until the cutover task removes it.

**Tech Stack:** Makit 0.8 (`@natsuneko-laboratory/makit`, Next.js 16 under the hood), React 19, Vite 8 (island only), unified/remark, Node test runner, Cloudflare Workers Static Assets.

**Spec:** `docs/superpowers/specs/2026-10-13-makit-website-design.md`

## Global Constraints

- Makit `^0.8.0`; do not modify Makit. Gaps become workarounds in this package plus a note in the final report.
- Locales are `en` (default) and `ja`; URLs stay `/<locale>/`, `/<locale>/docs/<slug>/`, `/<locale>/showcase/<slug>/`.
- `siteUrl: "https://celesta.natsuneko.cat"`, `github.repository: "mika-f/Celesta"`.
- The 24 chapter slugs: `installation`, `create-project`, `preview`, `react-compositions` (Getting started); `animation`, `motion-toolkit`, `text-camera-lines`, `layout`, `text-fonts`, `media`, `dialogue`, `data`, `export` (Guides); `reference` (Reference); `math`, `math-noise`, `math-shaping`, `code`, `code-typing`, `voicevox` (Packages); `examples`, `timelines`, `build-from-source`, `troubleshooting` (More). Order as listed.
- Tungsten tokens (dark / light): background `#111110` / `#f4f2ed`, panel `#1a1917` / `#eae7e0`, line `#2c2a26` / `#d8d3c8`, text `#efe9df` / `#1a1916`, muted `#958e82` / `#6b655b`, accent `#ffb020` / `#b86e00` (text) with `#ffb020` fills. Corners 3–4 px. Shiki `vitesse-dark` / `vitesse-light`.
- Download variables: `CELESTA_DOWNLOAD_URL`, `CELESTA_DOWNLOAD_URL_MACOS`, `CELESTA_DOWNLOAD_URL_WINDOWS`; default `https://github.com/mika-f/Celesta/releases/latest`; platform variables fall back to `CELESTA_DOWNLOAD_URL`.
- Do not change documentation wording beyond what conversion requires.
- Node 22.12+, pnpm from the root `package.json`. Code style: match the existing website (single quotes, two-space indent, terse JSX).
- Each commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Client-side navigation away from and back to a playground page** — Makit uses `next/link`, so the page does not reload; the island must unmount (terminate its workers, dispose Monaco) and mount again cleanly. Pinned in Task 7.
2. **Download variables set to an empty string** (a CI step that found no asset) — must fall back to the default instead of rendering `href=""`. Pinned in Task 8.
3. **Cross-chapter links after conversion** — a link to a slug that does not exist in that locale must fail the tests, not ship as a 404. Pinned in Task 6.
4. **Code-fence includes from nested chapter directories and missing files** — includes resolve from the package root regardless of chapter depth; a missing file fails the build with the path in the message. Pinned in Task 3.
5. **Narrow screens (375 px)** — header menu and docs sidebar drawer must be reachable and closable by keyboard and touch. Pinned in Tasks 4 and 5.

---

### Task 1: Makit scaffold beside the existing site

**Files:**
- Modify: `packages/website/package.json`, `packages/website/.gitignore`, `pnpm-workspace.yaml` (only if `pnpm install` asks to allow build scripts), `pnpm-lock.yaml`
- Create: `packages/website/makit.config.ts`, `packages/website/content/en/docs/index.md`, `packages/website/content/ja/docs/index.md` (one-line placeholders, replaced in Task 6)

**Interfaces:**
- Produces: scripts `site:dev` (`makit dev`), `site:build` (`makit build --clean`), `site:check` (`makit check`). Task 10 renames them to `dev` / `build`.
- Produces: `makit.config.ts` exporting `defineConfig({...})` that later tasks extend (`theme`, `markdown.remarkPlugins`, `header`).

- [ ] **Step 1:** `pnpm --dir packages/website add -D @natsuneko-laboratory/makit@^0.8.0`. If pnpm reports ignored build scripts, add those packages to `allowBuilds` in `pnpm-workspace.yaml` with `true` only when Makit needs them to run (e.g. `sharp`), otherwise `false`.
- [ ] **Step 2:** Write `makit.config.ts`: `title: 'Celesta'`, `description` from `home.metadata.description` (en), `siteUrl`, `sourceDir: 'content'`, `outDir: 'dist'`, `i18n: { defaultLocale: 'en', locales: [{ locale: 'en', label: 'English' }, { locale: 'ja', label: '日本語' }], root: { behavior: 'detect' } }`, `navigation.auto: { numericPrefixes: true }`, `navigation.pagination: { enabled: true, crossSection: true }`, `markdown.code.copyButton: true`, `markdown.shiki.themes: { light: 'vitesse-light', dark: 'vitesse-dark' }`, `llms.enabled: true`, `github.repository`.
- [ ] **Step 3:** Add `.makit/` to `packages/website/.gitignore`.
- [ ] **Step 4:** Run `pnpm --dir packages/website site:check` then `site:build`. Expected: both exit 0; `dist/en/docs/index.html` and `dist/ja/docs/index.html` exist. Then run the old `pnpm --dir packages/website build` to confirm the Vite site still builds (it overwrites `dist/`; that is fine during the transition).
- [ ] **Step 5:** Commit `feat(website): add Makit scaffold`.

### Task 2: Per-locale copy module

**Files:**
- Create: `packages/website/site/copy/en.ts`, `packages/website/site/copy/ja.ts`, `packages/website/site/copy/index.ts`, `packages/website/site/links.ts`
- Test: `packages/website/tests/copy.test.mjs`

**Interfaces:**
- Produces: `type Locale = 'en' | 'ja'`; `copy(locale: Locale): Copy` where `Copy = typeof en`; `isLocale(value: string): value is Locale`; `repository = 'https://github.com/mika-f/Celesta'` in `site/links.ts`.
- `Copy` sections: `common` (navigation, footer, skip link), `notFound`, `home`, `showcase`, `docsCta` (the "try it without installing" block), `theme` (menu/close/search labels). Values are strings, or `(parts) => ReactNode` functions only where the current message has slots containing elements.

- [ ] **Step 1: Write the failing test** — `tests/copy.test.mjs`: `ja has every en key with the same kind of value` (recursively compare key sets of `copy('en')` and `copy('ja')`, and that `typeof` matches at every leaf); `isLocale accepts en and ja only` (`['en','ja']` true; `'en-us'`, `''`, `'docs'` false).
- [ ] **Step 2:** Run `node --experimental-strip-types --test tests/copy.test.mjs` from `packages/website`. Expected: FAIL (module not found).
- [ ] **Step 3:** Port the strings from `src/locales/{en,ja}.json` (`common.*`, `not-found.*`, `home.*`, `showcase.*`, `docs.ui.try-it-without-installing`, `docs.ui.the-playground-runs-celesta-in-your-browser`, `docs.ui.open-the-playground`) verbatim. `ja.ts` is typed `satisfies Copy`-compatible via `export const ja: Copy = {...}`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(website): add typed per-locale copy`.

### Task 3: Code-fence include plugin

**Files:**
- Create: `packages/website/plugins/remark-include.ts`
- Modify: `packages/website/makit.config.ts` (register plugin), `packages/website/package.json` (devDependencies `unified`, `remark-parse`, `remark-stringify`, `unist-util-visit` if not resolvable)
- Test: `packages/website/tests/remark-include.test.mjs`

**Interfaces:**
- Produces: `remarkInclude(options: { root: string }): Transformer`. A `code` node whose `meta` contains `file=<path>` (unquoted or double-quoted) and whose `value` is empty or whitespace gets `value` = file contents with one trailing newline removed. `file=` is removed from `meta`; if no other title remains, `meta` becomes `title="<basename>"` so Makit shows the file name. Paths resolve against `options.root` (the package root), never against the Markdown file.
- Registered as `markdown.remarkPlugins: [[remarkInclude, { root: fileURLToPath(new URL('.', import.meta.url)) }]]`.

- [ ] **Step 1: Write the failing tests** using `unified().use(remarkParse).use(remarkInclude, { root: <tmp dir> }).use(remarkStringify)`:
  - `inlines the file` — fence ```` ```tsx file=examples/a.tsx ```` with `a.tsx` = `"export {}\n"` → output contains `export {}` and `title="a.tsx"`, not `file=`.
  - `keeps an explicit title` — `file=examples/a.tsx title="Scene"` → meta is `title="Scene"`.
  - `resolves from the root, not the chapter` — same fence processed with `file.data.linkRewriteContext = { currentRelativePath: 'en/docs/01-(x)/02-y.md' }` → still inlines `a.tsx`.
  - `fails on a missing file` — rejects with a message containing `examples/missing.tsx`.
  - `ignores fences without file=` and `ignores fences with a body` — unchanged output.
- [ ] **Step 2:** Run `node --experimental-strip-types --test tests/remark-include.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement with `unist-util-visit` and `readFileSync`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Add a fence with `file=../react/package.json` to `content/en/docs/index.md`, run `site:build`, confirm the JSON appears in `dist/en/docs/index.html`, then remove it.
- [ ] **Step 5:** Commit `feat(website): include example files in code fences`.

### Task 4: Tungsten theme shell

**Files:**
- Create: `packages/website/theme/index.tsx` (re-exports slots), `theme/makit-theme.ts` (manifest), `theme/tungsten.css`, `theme/RootLayout.tsx`, `theme/Header.tsx`, `theme/HeaderMenu.tsx` (client), `theme/Footer.tsx`, `theme/StaticPage.tsx`, `theme/NotFoundPage.tsx`, `theme/Brand.tsx`, `public/favicon.svg` (kept)
- Modify: `makit.config.ts` (`theme: { extends: './theme', colorScheme: 'system', accentColor: '#ffb020', radius: 'small' }`, `header.links`)

**Interfaces:**
- Consumes: `copy(locale)`, `isLocale` (Task 2); `repository` (Task 2).
- Produces: slots `RootLayout`, `Header`, `Footer`, `StaticPage`, `NotFoundPage` per Makit THEME §5–§6 props. CSS custom properties `--tg-bg`, `--tg-panel`, `--tg-line`, `--tg-fg`, `--tg-muted`, `--tg-accent`, `--tg-accent-text`, `--tg-radius` used by every later task; `--makit-color-*` mapped onto them.
- Locale for parts that only get `homeHref`: derive from the first path segment of `homeHref` via `isLocale`, default `en`.

- [ ] **Step 1:** Write `tungsten.css` with the Global Constraints tokens for `:root[data-theme="dark"]`, `:root[data-theme="light"]`, and `prefers-color-scheme` when no `data-theme` is set; base typography (system sans, `ui-monospace` for `.tg-mono`); utility classes `.tg-mono`, `.tg-button`, `.tg-button-secondary`, `.tg-shell` (max width 1200 px, 16 px gutter on phones); `@media (prefers-reduced-motion: reduce)` disables animations.
- [ ] **Step 2:** Implement `Header` (Brand with tally-lamp dot, links Docs `/<l>/docs/`, Showcase `/<l>/showcase/`, Playground `/<l>/#playground`, GitHub ↗, Download ↓, then `actions`), with `HeaderMenu` as a `"use client"` disclosure button under 860 px (`aria-expanded`, `aria-controls`, closes on Escape and on link click). Implement `Footer`, `RootLayout` (THEME §10.3 contract plus skip link to `#main`), `StaticPage` (Header + `<main id="main">` + Footer for `layout: 'default'`; wrap children in `data-pagefind-body` only when `page.search`), `NotFoundPage` (localized `copy.notFound`, link home).
- [ ] **Step 3:** Run `site:build`, then `npx serve dist` (or `site:dev`). Verify in the browser pane at 1280 px and 375 px, light and dark: header, menu toggle by keyboard (Tab, Enter, Escape) and click, footer, `/en/nope/` shows the themed 404.
- [ ] **Step 4:** Commit `feat(website): add the Tungsten theme shell`.

### Task 5: Tungsten documentation slots

**Files:**
- Create: `theme/DocsPage.tsx`, `theme/Sidebar.tsx`, `theme/SidebarDrawer.tsx` (client), `theme/PageHeader.tsx`, `theme/docs.css` (added to manifest `styles`)
- Modify: `theme/index.tsx`, `theme/makit-theme.ts`

**Interfaces:**
- Consumes: Task 4 tokens and `Header`/`Footer` via `components`.
- Produces: slots `DocsPage`, `Sidebar`, `PageHeader`.

- [ ] **Step 1:** `DocsPage`: grid of Sidebar · article · TableOfContents (≥1100 px), Sidebar · article (≥860 px), single column below with `SidebarDrawer`. Breadcrumbs render as a monospace strip (`DOCS / GROUP / PAGE`). After `PrevNextLinks`, render the playground call to action from `copy.docsCta` linking `/<l>/#playground`. Reuse default `PageContent`, `TableOfContents`, `PageActions`, `FallbackNotice`, `PrevNextLinks` from `components`.
- [ ] **Step 2:** `Sidebar`: group titles in uppercase monospace, active link with a 2 px amber left rule and `aria-current="page"`; nested package pages indented. `SidebarDrawer` (`"use client"`): toggle button showing the current page title, `aria-expanded`, closes on Escape and on navigation.
- [ ] **Step 3:** `docs.css`: `.makit-prose` headings, links in `--tg-accent-text`, inline code, tables, `pre.shiki` on `--tg-panel` with `--tg-line` border, `.makit-alert` with amber left rule and `.makit-alert-title` visually hidden (notes carry their own bold title), restyle the default search dialog, TOC, theme toggle, locale switcher.
- [ ] **Step 4:** Add two temporary chapters under `content/en/docs/01-(getting-started)/` with a table, a note (`> [!NOTE]` + `> **Title**`), and a code fence; `site:build`; check desktop and 375 px (drawer by keyboard and touch), light and dark, search dialog. Remove the temporary chapters.
- [ ] **Step 5:** Commit `feat(website): add Tungsten documentation layout`.

### Task 6: Convert the documentation to Markdown

**Files:**
- Create: `content/{en,ja}/docs/index.md` + `index.meta.ts`; for each group `content/{l}/docs/NN-(group)/category.makit.ts`; for each chapter `NN-<slug>.md` + `NN-<slug>.meta.ts`; packages nest as `04-(packages)/01-(math)/01-math.md`, `02-math-noise.md`, `03-math-shaping.md`, `02-(code)/01-code.md`, `02-code-typing.md`, `03-voicevox.md`
- Move: `src/pages/docs/examples/*` → `examples/*`; `src/features/playground/demo/title-scene.tsx` stays until Task 7
- Modify: `tsconfig.examples.json` (`include` → `examples/*.tsx` plus the demo scene path)
- Test: `packages/website/tests/content.test.mjs`
- Scratch only (not committed): the conversion script in the session scratchpad

**Interfaces:**
- Consumes: `remarkInclude` fence syntax (Task 3); note syntax (Task 5).
- Produces: page ids equal to slugs; `category.makit.ts` uses `defineCategory({ title: '<localized group title>' })`; chapter metadata `definePageMetadata({ id, title, description, navigation: { title: navTitle } })` with `navigation` only for `math-noise`, `math-shaping`, `code-typing`, `math`, `code`, `voicevox` where today's `nav-title` differs from the title.

- [ ] **Step 1: Write the failing test** `tests/content.test.mjs`:
  - `both locales have the same 24 chapters in the same groups` — walk `content/<l>/docs`, strip numeric prefixes and Route Group parentheses; compare the ordered slug list to the Global Constraints list for `en` and `ja`, and group directory names to `getting-started, guides, reference, packages, more`.
  - `sub-pages follow their package page` — `math-noise`, `math-shaping` share a directory with `math` and sort after it; `code-typing` after `code`.
  - `internal links point at existing chapters` — every `](/<l>/docs/<slug>/…)` link in a locale's Markdown uses that locale and a slug from the list (or the overview `/<l>/docs/`).
  - `every include exists` — every `file=<path>` resolves from the package root.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** In the scratchpad, write a converter that imports the existing chapter components with Vite SSR (`vite.ssrLoadModule` against the current `vite.config.ts`), renders each chapter for each locale with `renderToStaticMarkup` while every OS picker renders all platforms (patch `useState` initial value per platform and concatenate under `####` headings), and converts HTML → Markdown with `turndown` + `turndown-plugin-gfm`. Rules: `DocCode` label → fence `title="<label>"`; raw-imported example → empty fence with `file=examples/<name>` (repository files: `file=../../examples/editor-demo.celesta.json`, `file=../cli/examples/with-project.tsx`); `Note` → `> [!NOTE]` + `> **Title**`; `docPath(slug)` → `/<l>/docs/<slug>/`; download buttons → links.
- [ ] **Step 4:** Run the converter, then edit the output by hand: chapter titles and descriptions move to `.meta.ts`, headings start at `##`, overview keeps lead, start paths, and workflow strip. Compare each chapter side by side with the old site (`pnpm dev`) in both locales; wording must match.
- [ ] **Step 5:** Run `node --experimental-strip-types --test tests/content.test.mjs`, `pnpm check:examples`, `site:check`, `site:build`. Expected: all pass; `dist/ja/docs/math-noise/index.html` exists; sidebar shows five groups.
- [ ] **Step 6:** Commit `feat(website): convert the documentation to Markdown`.

### Task 7: Playground island

**Files:**
- Create: `playground/vite.config.ts`, `playground/main.ts` (entry), `playground/copy.ts`; move `src/features/playground/*` → `playground/`, `src/pages/showcase/sources.ts` → `playground/showcase-sources.ts`, `plugins/sample-sources.ts` → `playground/sample-sources.ts`, `src/site/showcase-catalog.ts` → `site/showcase-catalog.ts`, playground styles from `src/styles/style.css` → `playground/playground.css` (rewritten on `--tg-*` tokens)
- Create: `pages/_components/PlaygroundMount.tsx` (`"use client"`)
- Modify: `package.json` (scripts `playground:build`, `playground:dev`), `.gitignore` (`public/_playground/`, `public/showcase-assets/`, `public/showcase/`)

**Interfaces:**
- Produces: `mountPlayground(element: HTMLElement, options: { kind: 'home'; locale: Locale } | { kind: 'showcase'; slug: string; locale: Locale }): () => void` exported from `playground/main.ts`. The returned cleanup unmounts the React root, which must terminate the `@celesta/web` engine worker and dispose Monaco models.
- Produces: `public/_playground/manifest.json` = `{ "entry": "/_playground/<hashed>.js", "css": ["/_playground/<hashed>.css"] }`.
- Produces: `<PlaygroundMount options={...} fallback={ReactNode} />` — renders a placeholder sized like the playground with the fallback inside `<noscript>`-equivalent markup, loads CSS links and `import(/* webpackIgnore: true */ entry)` in `useEffect`, calls `mountPlayground`, and calls the cleanup on unmount. Fetches the manifest at `/_playground/manifest.json`.
- `showcase-assets` and posters: the island build copies the directories listed in today's `showcaseAssetDirectories` to `public/showcase-assets/` and each `examples/*/poster.jpg` to `public/showcase/<slug>.jpg`.

- [ ] **Step 1:** Configure Vite library mode (`build.lib.entry: 'playground/main.ts'`, `formats: ['es']`, `outDir: 'public/_playground'`, `base: '/_playground/'`, `build.manifest: true`) with `sampleSources(repoRoot)` and React; a small plugin in `writeBundle` writes the manifest above and copies assets.
- [ ] **Step 2:** Run `pnpm --dir packages/website playground:build`. Expected: `public/_playground/manifest.json` with an entry that exists; Monaco and esbuild WASM files beside it.
- [ ] **Step 3:** Mount it in a temporary `pages/playground-probe.tsx` with `PlaygroundMount` (`kind: 'home'`). `site:build`, serve `dist`, and in the browser pane: edit TSX, play, scrub, export MP4 (download completes, non-empty). Then navigate to a docs page via the header link and back with the browser back button; confirm exactly one `.monaco-editor` exists, playback and export still work, and the console has no errors (Review Focus 1: mount → unmount → mount). Delete the probe page.
- [ ] **Step 4:** Commit `feat(website): build the playground as an island`.

### Task 8: Landing page

**Files:**
- Create: `pages/index.tsx`, `pages/index.meta.ts`, `pages/_components/Timecode.tsx` (client), `pages/_components/DownloadButton.tsx` (client), `site/downloads.ts`, `pages/_components/landing.css` (imported by `index.tsx`)
- Test: `packages/website/tests/downloads.test.mjs`

**Interfaces:**
- Consumes: `copy`, `PlaygroundMount`, `repository`.
- Produces: `downloadLinks(env: Record<string, string | undefined> = process.env): { all: string; macOS: string; Windows: string }` in `site/downloads.ts`; also used by `theme/Header.tsx` for the Download link.

- [ ] **Step 1: Write the failing tests** `tests/downloads.test.mjs`: `defaults to the latest release` (empty env → all three equal `https://github.com/mika-f/Celesta/releases/latest`); `platform links fall back to the general link` (`{ CELESTA_DOWNLOAD_URL: 'u' }` → all `'u'`); `platform links override` (`MACOS: 'm'` → `macOS: 'm'`, `Windows: 'u'`); `empty strings count as unset` (`{ CELESTA_DOWNLOAD_URL: '', CELESTA_DOWNLOAD_URL_MACOS: '' }` → defaults).
- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement `downloadLinks`. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Build `pages/index.tsx` with today's sections (hero meta with development badge and `Timecode`, title, description, `DownloadButton` + "try in browser" link to `#playground`, specs list, `<section id="playground">` with `PlaygroundMount kind="home"`, features grid, ideas, start section) in the Studio layout: ruler with amber playhead under the hero, monospace timecodes. `index.meta.ts`: localized `title`/`description` from `home.metadata.*`, `search: false`.
- [ ] **Step 6:** Verify env reaches prerendering: `CELESTA_DOWNLOAD_URL_MACOS=https://example.com/m.dmg pnpm site:build` then `grep -c example.com/m.dmg dist/en/index.html` ≥ 1. If 0, switch to the fallback in the spec (build script writes `site/downloads.generated.ts`, git-ignored) and re-run.
- [ ] **Step 7:** Browser pane, 1280 px and 375 px, light and dark: `/en/` and `/ja/`, `#playground` anchor from another page scrolls to the playground, download button picks macOS/Windows by user agent.
- [ ] **Step 8:** Commit `feat(website): add the landing page`.

### Task 9: Showcase pages

**Files:**
- Create: `pages/showcase/index.tsx`, `pages/showcase/index.meta.ts`, `pages/_components/ShowcaseEntry.tsx`, and per work `pages/showcase/<slug>.tsx` + `<slug>.meta.ts` for the nine slugs in `site/showcase-catalog.ts`
- Test: extend `tests/content.test.mjs`

**Interfaces:**
- Consumes: `showcase` catalog, `copy`, `PlaygroundMount` (`kind: 'showcase'`), posters at `/showcase/<slug>.jpg`.
- Produces: `ShowcaseEntry({ slug, locale }: { slug: string; locale: Locale })`.

- [ ] **Step 1: Write the failing test** `every showcase work has a page and metadata` — for each catalog slug, `pages/showcase/<slug>.tsx` and `.meta.ts` exist, and no other page files exist in `pages/showcase/`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the gallery (poster cards with index, duration, run/desktop label) and `ShowcaseEntry` (intro, meta, then playground for browser-ready works or the desktop notice for `desktop` works, edition note). Each `<slug>.tsx` renders `<ShowcaseEntry slug="<slug>" locale={locale} />`; `.meta.ts` titles use `showcase.metadata-sample-title`.
- [ ] **Step 4:** Run the test (PASS), `site:build`, and in the browser: gallery, Apex (runs, scrub, export), Prism (desktop notice), language switch keeps the entry.
- [ ] **Step 5:** Commit `feat(website): add showcase pages`.

### Task 10: Cutover

**Files:**
- Delete: `src/`, `index.html`, `docs/index.html`, `showcase/index.html`, `vite.config.ts`, `plugins/site-pages.ts`, `tests/site-pages.test.mjs`, `tests/docs-nav.test.mjs`, `tests/routes.test.mjs`, `src/locales/*`
- Move: `src/site/locales.ts` → `site/locales.ts` (keep `preferredLocale`, `languageRedirect`; drop helpers nothing uses)
- Modify: `package.json` (scripts: `dev` = playground watch + `makit dev`, `build` = `pnpm --filter @celesta/web build && wrangler types && tsc --noEmit && pnpm playground:build && makit build --clean`, `check` = `makit check`; drop `i18next`, `react-i18next`, `@twinkleplop/*`, `@tailwindcss/vite`, `tailwindcss` if unused), `tsconfig.json` (include `site`, `pages`, `theme`, `playground`, `plugins`, `worker.ts`, `makit.config.ts`), `worker.ts` import path, `tests/locales.test.mjs` (drop catalog/`richText` tests, keep negotiation and worker tests), `public/_headers` (add `/_next/static/*` and `/_playground/*` immutable), `.env.example`, `README.md`, `.github/workflows/package.yml` (`VITE_DOWNLOAD_URL*` → `CELESTA_DOWNLOAD_URL*`)

- [ ] **Step 1:** Make the deletions, moves, and edits above.
- [ ] **Step 2:** Run from `packages/website`: `pnpm test`, `pnpm build`, `pnpm check`, `pnpm check:examples`, `pnpm deploy:check`. Expected: all exit 0.
- [ ] **Step 3:** `pnpm preview:cloudflare`: `/` with `Accept-Language: ja` → 302 to `/ja/`; `/docs/export/` → locale gateway → `/en/docs/export/` in an English browser; `/en/nope/` → themed 404 with status 404; `/_playground/manifest.json` served.
- [ ] **Step 4:** Rewrite `README.md` sections: develop (`pnpm dev`), structure (`content/`, `pages/`, `theme/`, `playground/`, `examples/`), adding a chapter (file + `.meta.ts` in both locales), includes, copy files, download variables, deploy, verification.
- [ ] **Step 5:** Commit `feat(website)!: serve the site from Makit`.

### Task 11: Full verification

- [ ] **Step 1:** Browser pane at 1280 px and 375 px, light and dark, against `pnpm preview:cloudflare`: landing; playground edit/play/scrub/MP4 export; showcase gallery, Apex, Prism; docs navigation including package sub-pages; search with a hit (`interpolate`) and no hit (`zzzz`); locale switch on a chapter and on a showcase entry; header menu and sidebar drawer by keyboard; 404.
- [ ] **Step 2:** Run every command from Task 10 Step 2 once more on a clean `dist/` and `.makit/` and record the output in the PR description.
- [ ] **Step 3:** List any Makit gaps worked around, for the user to file upstream.
