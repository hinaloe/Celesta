# Website on Makit design

## Goal

Rebuild `packages/website` on [Makit](https://github.com/mika-f/makit) 0.8, using its static
pages for the landing page and showcase, with a custom theme named **Tungsten**. The site keeps
its English and Japanese content, its URLs, its Cloudflare Workers deployment, and the browser
playground.

What the move buys:

- Documentation is Markdown rendered to HTML at build time. Today every page renders on the
  client from TSX plus i18next catalogs, and `#root` is empty until JavaScript runs.
- Full-text search (Pagefind), sitemap, `hreflang`, `llms.txt`, previous/next links, and table
  of contents come from Makit instead of `plugins/site-pages.ts`, `docs-nav.ts`, and
  `DocsPage.tsx`.
- Prose lives in one file per chapter and language instead of message keys spread across a
  1,110-line catalog and TSX slot arrays.

## Decisions

| Topic | Decision |
| --- | --- |
| Approach | Replace `packages/website` in place. No parallel package. |
| Playground | Keep it a Vite build ("island") mounted by a client component in static pages. |
| URLs | Keep `/en/…` and `/ja/…`. Locales are configured as `en` and `ja`. |
| Legacy URLs | `/docs/<slug>/` goes through Makit's locale gateway (browser language, not forced English). `/docs/#<chapter>` hash redirects are dropped. |
| Theme | New design, "Studio" layout with the Tungsten palette (amber `#ffb020` on graphite), light and dark. |

## Layout

```text
packages/website/
├── makit.config.ts
├── content/                       # Makit sourceDir
│   ├── en/docs/
│   │   ├── index.md               → /en/docs/            (overview)
│   │   ├── 01-(getting-started)/
│   │   │   ├── category.makit.ts
│   │   │   ├── 01-installation.md → /en/docs/installation/
│   │   │   └── …
│   │   ├── 02-(guides)/…
│   │   ├── 03-(reference)/…
│   │   ├── 04-(packages)/
│   │   │   ├── 01-(math)/01-math.md, 02-math-noise.md, 03-math-shaping.md
│   │   │   ├── 02-(code)/01-code.md, 02-code-typing.md
│   │   │   └── 03-voicevox.md
│   │   └── 05-(more)/…
│   └── ja/docs/…                  # same tree, Japanese
├── pages/                         # Makit static pages
│   ├── index.tsx + index.meta.ts  → /en/, /ja/
│   ├── showcase/index.tsx         → /en/showcase/
│   ├── showcase/<slug>.tsx        → /en/showcase/<slug>/ (one thin file per work)
│   └── _components/               # shared parts
├── site/                          # copy, links, downloads, locales, showcase catalog
├── theme/                         # Tungsten (theme.extends: "./theme")
├── playground/                    # Vite island → public/_playground/
├── examples/                      # documentation example sources (moved from src/pages/docs/examples)
├── plugins/remark-include.ts      # code-fence file includes
├── public/                        # favicon, _headers, built island
├── worker.ts, wrangler.jsonc
└── tests/
```

`src/`, `index.html`, `docs/index.html`, `showcase/index.html`, `plugins/site-pages.ts`, and the
i18next catalogs are removed once their content has moved.

The chapter list and grouping are the same as `src/site/docs-nav.ts` today (24 chapters in five
groups). A group is a Route Group directory with a `category.makit.ts` that holds the localized
group title, so the sidebar groups chapters while URLs stay `/<locale>/docs/<slug>/`. Package
sub-pages (`math-noise`, `math-shaping`, `code-typing`) sit in a nested Route Group under their
package and keep their flat URLs. Each chapter's `.meta.ts` sets a stable `id` (the slug), the
title, description, and a short `navTitle` where the current navigation uses one.

## Documentation content

A one-off conversion script renders each chapter with the existing React components for each
locale, with every platform branch of the OS pickers expanded, and converts the HTML to Markdown.
The result is reviewed and cleaned by hand; the script is not committed.

Conversions:

| Today | Markdown |
| --- | --- |
| `<h3>`, `<p>`, lists, `<code>`, `<kbd>`, `<strong>`, links via `docPath()` | Markdown equivalents; links are root-absolute per locale (`/ja/docs/export/`) |
| OS picker (`macOS` / `Windows` / `Linux` buttons) | `####` subsections per platform, in order |
| `DocCode` with a label | Fenced code block with the label as the file name (```` ```sh "macOS dependencies" ````) |
| `DocCode` with a raw-imported example | ```` ```tsx file=examples/first-scene.tsx ```` (see below) |
| `Note` | GitHub alert `> [!NOTE]` followed by `> **Title**`; the theme hides Makit's generic alert label |
| `Api` table | GFM table |
| Download buttons in Installation | Plain links to the download URLs |

`plugins/remark-include.ts` is a remark plugin registered in `markdown.remarkPlugins`. A code
fence whose meta contains `file=<path>` and whose body is empty is replaced by the file's
contents, resolved relative to the package root (Makit does not pass the Markdown file's path to
remark plugins). A missing file fails the build. This keeps
examples in real files, so `pnpm check:examples` still type-checks them against
`@celesta/react` and `@celesta/voicevox`. The JSON timeline example keeps pointing at
`examples/editor-demo.celesta.json` in the repository, and the CLI example at
`packages/cli/examples/with-project.tsx`.

The overview (`index.md`) keeps the lead, the two starting paths, and the workflow strip as
Markdown; the per-group index of chapters is replaced by the sidebar. The "try it without
installing" call to action at the end of each chapter moves into the theme's `DocsPage`.

The custom topic search (title/description/keyword filter) is replaced by Pagefind. Search
keywords currently in the catalogs are dropped; Pagefind indexes the full text.

## Static pages

`pages/index.tsx` (landing) and the showcase pages are Server Components rendering the same
sections as today: hero with running timecode, specs list, playground, features, "good for"
tags, and getting started. The timecode is a small client component.

Copy moves from the i18next catalogs (`home.*`, `showcase.*`, `common.*`) to
`site/copy/en.ts` and `site/copy/ja.ts` (shared by `pages/` and `theme/`): plain typed objects where `ja` must satisfy the
type of `en`. Rich text is written as JSX-returning functions where a sentence contains code or
links. `i18next` and `react-i18next` are removed.

Showcase: `pages/showcase/index.tsx` lists `showcase-catalog.ts` with posters; each
`pages/showcase/<slug>.tsx` is a three-line file that renders a shared `ShowcaseEntry` with its
slug. Desktop-only works show the existing notice instead of the playground. Posters are copied
to `public/showcase/` by the island build so static pages can reference them by URL.

Download links: Vite no longer builds these pages, so `VITE_DOWNLOAD_URL*` become
`CELESTA_DOWNLOAD_URL`, `CELESTA_DOWNLOAD_URL_MACOS`, and `CELESTA_DOWNLOAD_URL_WINDOWS`, with the
same defaults (latest GitHub release). `site/downloads.ts` reads them from
`process.env` in Server Components, which run in Node while Makit prerenders the static export;
the resolved URLs are passed as props to the client-side, platform-aware download button. The
header's download link uses the same module. The first implementation step verifies that the
variables reach prerendering; if Makit's Next.js process does not inherit them, the build script
writes the resolved URLs to `site/downloads.generated.ts` (git-ignored) before
`makit build` instead. `.env.example`, the README, and the release workflow's `deploy-website`
job are updated to the new names.

## Playground island

`playground/` contains today's `Playground.tsx`, `SourceEditor.tsx`, the demo scene, the
showcase source loader (`import.meta.glob` over `examples/`), and the `sampleSources` Vite
plugin, unchanged except for imports. Its entry exports:

```ts
mountPlayground(element: HTMLElement, options:
  | { kind: "home"; locale: "en" | "ja" }
  | { kind: "showcase"; slug: string; locale: "en" | "ja" }): () => void;
```

`playground/vite.config.ts` builds it as an ES library with hashed chunks (Monaco workers,
esbuild WASM, `@celesta/web` worker) into `public/_playground/`, and writes a manifest naming the
entry file. The playground's own strings (`playground.*`, showcase loading and error text) move
into the island as a small per-locale object.

`pages/_components/PlaygroundMount.tsx` is a `"use client"` component that renders a sized
placeholder with a no-JavaScript fallback, then in `useEffect` loads the entry with a module
`<script>`/dynamic `import()` of the URL from the manifest and calls `mountPlayground`, and calls
the returned cleanup on unmount. `/showcase-assets/…` paths are produced by copying the same
repository directories into `public/showcase-assets/` during the island build.

Builds run in order from `pnpm build`: `@celesta/web` → island (Vite) → `makit build`.
`pnpm dev` runs the island in watch mode next to `makit dev`.

## Tungsten theme

`theme/index.tsx` exports these slots; all others fall back to Makit's defaults:

| Slot | Role |
| --- | --- |
| `RootLayout` | `<html>`/`<body>` contract, skip link, font stacks |
| `Header` | Crescent mark + wordmark with a tally lamp, Docs / Showcase / Playground / GitHub, download, search, locale switch, theme toggle; menu button below 860 px |
| `Footer` | Links, license, repository |
| `DocsPage` | Sidebar · article · table of contents grid; breadcrumbs as a timecode-style strip; playground call to action after the pager |
| `Sidebar` | Grouped navigation with amber active marker; mobile drawer |
| `PageHeader` | Chapter title and description |
| `StaticPage` | Header + full-width `<main>` + Footer; `data-pagefind-body` only when `page.search` |
| `NotFoundPage` | Localized 404 in the theme |
| `PrevNextLinks` | Pager with localized "Previous" / "Next" labels |
| `TableOfContents` | Client table of contents with a localized heading and active-section marker |

The header's search, locale switch, and theme toggle are one shared `HeaderActions` part used by
docs and static pages; the docs locale switch targets the same page id in the other locale.
`SearchDialog`, `ThemeToggle`, `PageActions`, and `PageContent` keep the default implementations
and are restyled in CSS. Their built-in labels stay English (Makit's messages cover only
`fallbackNotice` and `home`); this is a known Makit gap.

`theme/tungsten.css` (listed in the theme manifest `styles`) defines the palette as tokens for
light and dark and maps them onto `--makit-color-*` so Makit's prose and default parts follow:

| Token | Dark | Light |
| --- | --- | --- |
| background | `#111110` | `#f4f2ed` |
| panel | `#1a1917` | `#eae7e0` |
| line | `#2c2a26` | `#d8d3c8` |
| text | `#efe9df` | `#1a1916` |
| muted | `#958e82` | `#6b655b` |
| accent | `#ffb020` | `#945700` (text), `#ffb020` (fills) |

Motifs: monospace timecodes and labels, a ruler with a playhead under the hero, square-ish
corners (3–4 px), tally-lamp dot. Notes (`.makit-alert`) get an amber left rule.
Code blocks use Shiki's `vitesse-dark` / `vitesse-light`. Respects `prefers-reduced-motion`.

## Routing and deployment

`makit.config.ts`: `title: "Celesta"`, `siteUrl: "https://celesta.natsuneko.cat"`,
`sourceDir: "content"`, `i18n` with `en` (default) and `ja`, `root.behavior: "detect"`,
`llms.enabled: true`, `github.repository: "mika-f/Celesta"`.

`worker.ts` and `languageRedirect` stay: `/` and `/index.html` redirect by `Accept-Language`;
everything else is served from `dist/`. `wrangler.jsonc` keeps `assets.directory: "./dist"` and
`not_found_handling: "404-page"`. `public/_headers` keeps immutable caching for hashed assets
and adds `/_playground/*`.

## Testing

- `tests/locales.test.mjs`: keep the Accept-Language and worker tests.
- `tests/copy.test.mjs`: `ja` copy has every `en` key.
- `tests/content.test.mjs`: every chapter slug exists in both locales under the same Route
  Group, with the 24 slugs pinned as today; sub-pages follow their package page.
- `tests/remark-include.test.mjs`: file include, relative resolution, missing-file failure.
- `makit check`, `pnpm build`, `pnpm check:examples`, `pnpm deploy:check` pass.
- Manual, desktop and mobile widths, light and dark: landing, playground edit/play/scrub/MP4
  export, showcase list and a browser-ready entry, a desktop-only entry, docs navigation,
  search (hit and no hit), locale switch on docs and static pages, 404, `/` redirect through
  `wrangler dev`.

The README is rewritten for the new layout, commands, and the download variables.

## Out of scope

- Changing documentation wording beyond what conversion requires.
- Moving the playground into Makit's Next.js build.
- Changes to Makit itself. Gaps found during implementation are reported as Makit issues and
  worked around in this package.
