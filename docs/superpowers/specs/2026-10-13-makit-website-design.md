# Website on Makit design

## Goal

Rebuild `packages/website` on [Makit](https://github.com/mika-f/makit) 0.9, using its static
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
| Theme | New design, "Noir": white on pure black with one electric blue (`#3d7bff`), solid headlines, Chrome-shaped components with square corners, natural-case labels, lucide icons, no gradients; light mode follows the OS. Replaced the earlier Tungsten (amber on graphite) design, which the user rejected as too subdued. |

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
├── plugins/                       # remark plugins: file includes, download links, arrow icons
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
| OS picker (`macOS` / `Windows` / `Linux` buttons) | Makit tabs: `::::tabs[<the picker's aria-label>]{default="macOS"}` with one `:::tab[<button label>]` per platform, exactly as the old buttons read (`macOS`, `Windows`, `Linux`; the per-platform subheadings such as Installation's "Windows x64" are dropped, and the tab body keeps the `x64` filenames). Each tab holds exactly what that platform showed, with the `DocCode` labels as fence titles; text shared by every platform stays outside. Where a picker only swaps a command (Create a project, Export), each tab holds its own paragraph and fence; Export's commands run across three sections, so it has one tab group per command run (five groups) |
| `<details>` / `<summary>` | Makit toggles: Troubleshooting's nine questions are `::::accordion[Troubleshooting]{multiple}` (ja `トラブルシューティング`, the chapter title) with one `:::toggle[<summary>]` each, the first `{open}` as before; Timelines' three "View the complete …" blocks are `:::toggle[<summary>]` around their fence, closed |
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

A refinement round after the user approved the look added four more rules, all binding:

- **No uppercase labels** (they also read as AI-made). Only the wordmark "CELESTA" is set in
  capitals; every other label is in natural case.
- **Square corners everywhere** (`--nr-radius: 0`, `theme.radius: 'none'`), including Makit's
  default parts. The only round shape left is the playground's 6 px status dot.
- **lucide icons, never arrow or symbol glyphs**, which some platforms draw as emoji.
- **No letterbox**: the header starts at the very top of the page.

`theme/index.tsx` exports these slots; all others fall back to Makit's defaults:

| Slot | Role |
| --- | --- |
| `RootLayout` | `<html>`/`<body>` contract, skip link, font stacks |
| `Header` | Crescent mark + wordmark, Docs / Showcase / Playground / GitHub as tabs, search, locale switch, theme toggle, download; menu button below 860 px |
| `Footer` | Links, license, repository |
| `DocsPage` | Sidebar · article · table of contents grid; breadcrumbs separated by chevron icons; playground call to action after the pager |
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
default parts follow. Light is the `:root` default; the dark values (and `color-scheme: dark`, which
the playground's editor reads) apply under `data-theme="dark"`, and under a dark OS while
`data-theme` is unset (before Makit's script runs, or without JavaScript). The two dark blocks
carry the same values; `light-dark()` is not used, so older browsers keep the palette. Shipped
values, with WCAG contrast on `bg` / `panel`:

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
  opacity) fixed behind all content with `pointer-events: none`, hidden in print. There is no
  letterbox strip: the sticky header starts at the top of the page.
- **Type**: `"Helvetica Neue", ui-sans-serif, system-ui, -apple-system, "Hiragino Sans",
  "Hiragino Kaku Gothic ProN", sans-serif`. Display headings weight 800, tracking −0.045em,
  line height ≈ 0.98, solid `fg`; Japanese headings relax to about −0.02em and 1.12–1.2.
  Eyebrows, section and feature numbers, sidebar captions, breadcrumbs, table heads, and other
  labels are sans in natural case (12.5–13 px, normal tracking); eyebrows and numbers are
  `accent-text`. Monospace is kept where it carries meaning: timecodes and the rail's time row,
  code, keyboard hints (`⌘K`, `Esc`), file names (code-block titles, rail clips, the playground's
  file bar), durations, and the `EN / JA` codes, at 0.02–0.04em tracking.
- **Header**: the wordmark (700, 0.08em, the one uppercase label) beside the crescent; nav items
  as square tabs (5 × 10 px), the current section with a faint fill and 1 px inner hairline;
  search with `⌘K`, `EN / JA`, theme toggle, and a solid `fg` Download button (download icon
  first) on the right; below 860 px a square menu button with lucide `Menu` / `X`.
- **Buttons**: primary is a flat `fg` fill with `on-fg` text; secondary is a hairline border on a
  faint fill; square; no highlight or colored shadow.
- **Rail** (landing hero, 404): a 30 px square track (panel, hairline) with three square clips —
  the first solid accent, the others `raised` with a hairline — a 2 px playhead (white in dark,
  `fg` in light) that sweeps with `transform: translateX()` in container units, and a mono
  timecode row (start · live timecode in `accent-text` · end). Nothing is drawn with gradients.
- **Docs**: sans sidebar captions; active item = 2 px accent left rule on `tint`, `fg` text;
  breadcrumbs `Docs › Guides › Page` with lucide chevrons; weight-800 headings; code blocks on
  the panel with a hairline and a 40 px header row (title or language as written, left; Makit's
  Copy button right); notes = 2 px accent rule on `tint`; hairline pager cards with arrow icons;
  the playground call to action as a panel card.
- **Corners**: 0 everywhere — buttons, tabs, search, inputs, cards, code, notes, the rail, the
  sidebar's active item, dialogs, playground panels, showcase cards, the 404. Makit's default
  parts that hard-code Tailwind `rounded-*` classes (search dialog, its field, results, and Esc;
  page actions and their menu; copy button; theme toggle; fallback notice) are squared in
  `theme/noir.css` and `theme/docs.css`. The playground's status dot is the only circle.
- **Icons**: `lucide-react`, pinned in `package.json` to the version Makit 0.9.0 depends on
  (0.468.0), so the theme, the static pages (resolved through Makit's module alias), and the Vite
  island share one copy. 14 px beside small labels and 16 px (stroke 1.75) in buttons,
  `aria-hidden`, `currentColor`: `ArrowUpRight` for external links, `ArrowRight` for forward links
  and calls to action, `ArrowLeft` for back and previous, `Download`, `Menu` / `X`, `ChevronRight`
  between breadcrumbs, `Play` / `Pause` in the playground. Copy strings carry no glyphs; the slot
  or the JSX beside the string renders the icon. Makit's search results draw their arrow as a
  `→` glyph, which CSS hides and replaces with a masked lucide arrow.
- **Arrows in Markdown**: the sources keep their arrows (`[… on GitHub ↗](…)`, `**Start here →**`,
  `File → Open…`). `plugins/remark-arrow-icons.ts`, registered after the other remark plugins,
  replaces each `→ ← ↗ ↓ ↑` in a text node with
  `<span class="nr-icon nr-icon-<lucide name>" aria-hidden="true">`, inside the link or emphasis
  that held it. Between words the spaces stay (`File <span> Open…` reads "File Open…" to screen
  readers, Pagefind, and copy-paste); a glyph at the very start or end of its text node drops the
  adjacent space and is marked `nr-icon-at-start` / `nr-icon-at-end`, which CSS gives a 0.25em
  margin on the text side. Inline code and code blocks keep their arrows. `theme/docs.css` draws the spans
  as 1em lucide outlines with `mask-image` over `currentColor`, and drops Makit's automatic
  external-link icon from a link that already ends in one. The `.md` endpoints and
  `llms-full.txt` keep the plain arrows.
- **Tabs and toggles** (Makit's Markdown tabs and native `details` toggles): a hairline frame on
  the page background, so code blocks inside keep their own panel and header. Tabs are sans
  13.5 px in natural case, inactive `muted`, active `fg` over a 2 px `accent` underline that covers
  the tab row's hairline; panels pad 18 × 20 px. A toggle's summary is `fg` 600 behind a 16 px
  lucide `ChevronRight` (masked like `.nr-icon`, `muted`) that turns 90° when open, without the
  transition under `prefers-reduced-motion`; the native marker is hidden. An accordion's toggles
  share its frame, split by hairlines. Focus is the 2 px `accent-text` ring inset by 2 px. Without
  JavaScript and in print, Makit shows every panel under its label, set like a tab, and opens
  every toggle.
- **Favicon**: the crescent and its star in white (`#ffffff`) on the existing near-black tile, so
  it reads on light and dark tab strips alike and needs no `prefers-color-scheme` style.

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
  Group, with the 24 slugs pinned as today; sub-pages follow their package page; both locales
  have the same tabs and toggles per chapter, at the pinned counts, with no flattened platform
  lists or `(macOS)` fence suffixes left.
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
