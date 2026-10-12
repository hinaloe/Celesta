# Website refactor design

## Goal

`packages/website` grew page by page. Pages, Node-side logic, shared components, the
Playground, documentation content, and styles sit side by side in one flat `src/`, and every
page builds its own header and footer. This refactor makes the source easy to navigate and
gives every page the same header and footer, without changing the documentation content or
the URLs the site serves.

## Current state

- `src/` holds 25 files in one directory. `vite.config.ts`, `worker.ts`, and
  `tests/locales.test.mjs` load `locales.ts`, `catalog.ts`, `i18n.ts`, `docs-nav.ts`, and
  `showcase-catalog.ts` directly in Node, so these modules must stay free of DOM, CSS, and
  `import.meta.env` access at import time.
- URL parsing exists three times: `route()` in `vite.config.ts`, `currentSlug()` in
  `Docs.tsx`, and a regular expression in `Showcase.tsx`.
- `vite.config.ts` contains two plugins (about 180 lines): raw example sources for the
  editor, and per-locale HTML generation for every page.
- The pages render on the client only. Generated HTML localizes `<head>`; `#root` is empty.
- Headers differ per page:

  | Page | Items | Narrow screens |
  | --- | --- | --- |
  | Home | Why Celesta, Playground, Docs, GitHub, Download, Showcase, language | Menu button |
  | Docs | Brand + "Documentation", Showcase, language, Website, GitHub | Items hidden by CSS |
  | Showcase | Showcase, Docs, language | Menu button |

  Navigation copy is one positional-slot message per page
  (`home.why-celesta-playground-docs-github-download`), so items cannot be shared.
- Footers also differ: Home has brand, tagline, and links; Docs has a one-line footer inside
  the article column; Showcase has three links.
- `currentLocale`, `homePath`, `docGroups`, the default of `docPath()`, the documentation
  `contents` object, and `visitorPlatform` are computed from `window`/`navigator` when their
  modules load.

## Decisions

1. **Stacked pull requests** (`gh stack`), one concern per layer:
   1. `claude/website-refactor-plan` — this design and its implementation plan.
   2. `claude/website-reorg` — source reorganisation, no behavior change.
   3. `claude/website-site-chrome` — shared `SiteHeader` and `SiteFooter`.
2. **Layout by page.** `src/site/` (Node-importable logic), `src/components/` (shared UI),
   `src/features/playground/`, `src/pages/{home,docs,showcase}/`, `src/styles/`. Catalogs
   stay in `src/locales/`. The two Vite plugins move to `plugins/`.
3. **One route module.** `src/site/routes.ts` owns `parseRoute()`, `docPath()`, and
   `showcasePath()`; the build plugin and both pages use it.
4. **Header items on every page:** Docs, Showcase, Playground (`/<locale>/#playground`),
   GitHub ↗, Download, and the language switcher, in that order. The current section is
   marked with `aria-current`. Every page gets the collapsible menu on narrow screens.
   "Why Celesta" is a Home anchor and leaves the navigation. The docs-only "Documentation"
   label next to the brand is removed; `aria-current` shows the section instead.
5. **Footer on every page:** Home's footer (brand, tagline, Documentation, Showcase, GitHub,
   Releases, Issues, and the build/licence line) replaces the docs and showcase footers.
6. **Framework decision deferred.** Candidates are TanStack Start and
   [makit](https://github.com/mika-f/makit) (after makit gains fixed pages). The work to make
   the pages render outside the browser (locale passed through context instead of read from
   `window` when modules load) depends on that choice and is not part of this refactor.

## Constraints

- The set of built files is unchanged. Comparing `dist/` before and after the
  reorganisation, with content hashes masked, shows the same file list and identical HTML.
- Documentation prose, chapter order, and catalog messages are unchanged, except the
  navigation and footer messages the second layer replaces. `en.json` and `ja.json` keep
  identical key sets.
- No new dependencies. No restyling beyond the header and footer rules the second layer
  needs.
- Modules loaded by Node (`src/site/*`, `plugins/*`, `vite.config.ts`, `worker.ts`) import
  with explicit `.ts` extensions; browser modules keep extensionless imports.
- Vite-specific imports (`?raw`, `?worker`, `import.meta.glob`) stay in the Playground,
  showcase sources, and documentation content, so these parts can move to another host later.

## Non-goals

- Changing documentation content or splitting `docs-content.tsx` by chapter.
- Server rendering or prerendering page bodies.
- Redirecting the unprefixed legacy `/docs/<slug>/` and `/showcase/<slug>/` pages.
- Loading catalogs per language.
