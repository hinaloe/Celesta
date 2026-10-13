# Website on Makit design

## Goal

Rebuild `packages/website` on [Makit](https://github.com/mika-f/makit) 0.8, using its static
pages for the landing page and showcase, with a custom theme named **Noir**. The site keeps
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
| Theme | New design, "Noir": white on pure black with one electric blue (`#3d7bff`), solid headlines, Chrome-shaped components, no gradients; light mode follows the OS. Replaced the earlier Tungsten (amber on graphite) design, which the user rejected as too subdued. |

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
├── theme/                         # Noir (theme.extends: "./theme")
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
| OS picker (`macOS` / `Windows` / `Linux` buttons) | Subsections one level below the chapter's section heading, per platform, in order; where a picker only swaps a command (Create a project, Export), a `**macOS:**` / `**Windows:**` list and paired fences titled `<label> (macOS)` / `<label> (Windows)` |
| `DocCode` with a label | Fenced code block with the label as the file name (```` ```sh "macOS dependencies" ````) |
| `DocCode` with a raw-imported example | ```` ```tsx file=examples/first-scene.tsx ```` (see below) |
| `Note` | GitHub alert `> [!NOTE]` followed by `> **Title**`; the theme hides Makit's generic alert label |
| `Api` table | GFM table |
| Download buttons in Installation | Links to `celesta:download/macos`, `celesta:download/windows`, `celesta:download/all`, rewritten at build time to the download variables by a remark plugin |

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

## Noir theme

The first design, Tungsten (an amber tally lamp on warm graphite), was rejected as too subdued.
After three rounds of mockups the user chose **Noir with solid headlines and Chrome-shaped
components**, with one hard rule: **no gradients anywhere** (they read as AI-made) — no gradient
fills, text, borders, or masks, and no glossy or glowing buttons. Light mode stays and follows the
OS (`colorScheme: 'system'`).

`theme/index.tsx` exports these slots; all others fall back to Makit's defaults:

| Slot | Role |
| --- | --- |
| `RootLayout` | `<html>`/`<body>` contract, skip link, font stacks |
| `Header` | Crescent mark + wordmark, Docs / Showcase / Playground / GitHub as tabs, search, locale switch, theme toggle, download; menu button below 860 px |
| `Footer` | Links, license, repository |
| `DocsPage` | Sidebar · article · table of contents grid; breadcrumbs as a mono uppercase strip; playground call to action after the pager |
| `Sidebar` | Grouped navigation with a blue active marker; mobile drawer |
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

`theme/noir.css` (listed in the theme manifest `styles`) defines the palette as `--nr-*` tokens for
light and dark and maps them onto `--makit-color-*` (and `--makit-radius`) so Makit's prose and
default parts follow. Shipped values, with WCAG contrast on `bg` / `panel`:

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `bg` | `#000000` | `#fafafa` | page |
| `panel` | `#0d0d0f` | `#f0f0f2` | cards, code blocks, the rail's track |
| `raised` | `#161618` | `#ffffff` | rail clips, surfaces lifted off the panel |
| `line` | `#1c1c1e` | `#e2e2e6` | hairlines |
| `line-strong` | `#2c2c2e` | `#cfcfd4` | control borders |
| `fg` | `#f5f5f7` (19.3 / 17.8) | `#0a0a0b` (19.0 / 17.4) | headings, primary text, primary-button fill |
| `soft` | `#a1a1a6` (8.2 / 7.6) | `#55555a` (7.1 / 6.5) | body copy |
| `muted` | `#86868b` (5.8 / 5.4) | `#6b6b70` (5.1 / 4.7) | labels, secondary text |
| `accent` | `#3d7bff` | `#3d7bff` | fills, rules, the first rail clip |
| `accent-text` | `#7aa7ff` (8.8 / 8.1) | `#1d59f0` (5.4 / 4.9) | links, eyebrows, timecodes, focus ring |
| `on-fg` | `#000000` (19.3) | `#fafafa` (19.0) | text on `fg`-filled buttons |
| `on-accent` | `#000000` (5.5) | `#000000` (5.5) | text on blue fills (white is 3.8:1) |
| `tint` | `#3d7bff14` | `#3d7bff14` | active sidebar item, notes |

The brief's light `muted` `#6e6e73` (4.46:1 on the panel) was darkened to `#6b6b70`, and the light
`accent-text` is `#1d59f0`, the lightest shade near `#1f5fff` that reaches 4.5:1 on `bg`, `panel`, and
`tint` (`#1f5fff` itself is 4.46:1 on the panel). Every text color also passes on `tint` and on the
faint header-tab fill. The 2 px accent rule reaches 3:1 as non-text UI (3.4:1 on the light panel).

Component vocabulary:

- **Atmosphere**: 1 px hairlines; static film grain (an SVG `feTurbulence` data URI at 5–6 %
  opacity) fixed behind all content with `pointer-events: none`, hidden in print; a 10 px
  letterbox strip with a bottom hairline above the header.
- **Type**: `"Helvetica Neue", ui-sans-serif, system-ui, -apple-system, "Hiragino Sans",
  "Hiragino Kaku Gothic ProN", sans-serif`. Display headings weight 800, tracking −0.045em,
  line height ≈ 0.98, solid `fg`; Japanese headings relax to about −0.02em and 1.12–1.2.
  Eyebrows, labels, timecodes, and breadcrumbs are monospace capitals with 0.2–0.22em tracking.
- **Header**: wordmark (700, 0.08em, uppercase) beside the crescent; nav items as rounded tabs
  (5 × 10 px, 7 px radius), the current section with a faint fill and 1 px inner hairline;
  search with `⌘K`, `EN / JA`, theme toggle, and a solid `fg` Download button on the right.
- **Buttons**: primary is a flat `fg` fill with `on-fg` text; secondary is a hairline border on a
  faint fill; 8 px radius; no highlight or colored shadow.
- **Rail** (landing hero, 404): a 30 px track (panel, hairline, 7 px radius) with three clips —
  the first solid accent, the others `raised` with a hairline — a 2 px playhead (white in dark,
  `fg` in light), and a mono timecode row (start · live timecode in `accent-text` · end). Ruler
  ticks are gone; nothing is drawn with gradients.
- **Docs**: mono uppercase sidebar captions; active item = 2 px accent left rule on `tint`, `fg`
  text; breadcrumbs `DOCS / GUIDES / PAGE`; weight-800 headings; code blocks on the panel with a
  hairline and a 40 px header row (title left, Makit's Copy button right); notes = 2 px accent rule
  on `tint`; hairline pager cards; the playground call to action as a panel card.
- Radius 8 px for buttons, cards, and code; 7 px for header tabs and the rail.

Code blocks use Shiki's `github-dark-high-contrast` / `github-light-high-contrast`. Re-measured on
the Noir panels (`#0d0d0f` / `#f0f0f2`), every dark token color is ≥ 11:1 and every light one
≥ 7.0:1, except the light comment grey `#66707b` (4.43:1), overridden to `#5a626c` (5.43:1; 4.67:1
on a highlighted line) in `theme/docs.css`. The playground's Monaco themes (`noir-dark`,
`noir-light`) use the same token colors on `bg` with `panel` as the line highlight. Respects
`prefers-reduced-motion` (the playhead and timecode stand still).

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
