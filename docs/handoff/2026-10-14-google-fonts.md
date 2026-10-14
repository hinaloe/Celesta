# Google Fonts by family name (#305)

```tsx
import { Assets, Font, googleFont, measureText } from '@celesta/react';

<Assets>
  <Font google="Noto Sans JP" weights={[400, 700]} subsets={['japanese']} />
</Assets>
```

`googleFont(family, options)` returns the same CSS URL for `src` or
`measureText(..., { fonts: [url] })`. Weights and subsets are sorted and
deduplicated so equivalent requests share the existing URL cache. Static
weights are 100–900 in steps of 100, defaulting to 400. The v1 CSS API
documents script subsets; Google may include every range for modern
clients. Existing CSS URLs still support italic styles and variable axes.

No new cache or network dependency is introduced. Native rendering caches
the stylesheet and every font file, so later processes work offline once
the request has loaded completely. Google HTTP 400 responses identify an
unknown family or unavailable weights. Browser Google Fonts errors also
reject the load and allow retry; other font URLs retain their fallback
behavior. Browser HTTP caching does not guarantee offline use.

Testing real Japanese split WOFF2 files exposed a native rendering bug:
cosmic-text selects only the first face within a family, then falls back
to system fonts. Each loaded stylesheet face now also receives a private
family name. The existing grapheme-based font stack selection chooses a
face containing the requested characters, at the family's matched weight.
The public CSS family remains on each face for diagnostics. Locale changes,
parallel rasterizer forks, font stacks, and rich text share this path.

Font licenses remain separate from Celesta's licenses. The user guide
documents license and copyright notices for redistribution and that the
cache does not download license files:
[Text and fonts](../../packages/website/content/en/docs/02-%28guides%29/05-text-fonts.md).

## Verification

- React runtime build and React tests: passed (105 tests).
- Browser tests: passed (29 tests); worker and browser TypeScript checks passed.
- Remote asset tests: passed (11 tests), including a closed local server
  followed by cached CSS and split-file reads in a new cache instance.
- Renderer library tests: passed (170 tests), including disjoint glyph
  coverage under one CSS family, stacks, locale changes, and forks.
- Remote crate strict Clippy: passed. Renderer strict Clippy stops in an
  existing `clippy::needless_range_loop` in `crates/budoux/src/lib.rs:107`.
  With dependency lints skipped, strict renderer checks also encounter
  existing unused imports, constant-size pixel chunk lints, and a manual clamp.
  Non-strict renderer Clippy passed with those 21 pre-existing warnings;
  the changed renderer files have no Clippy diagnostics.
- Native exporter built with `PKG_CONFIG_PATH=/opt/homebrew/opt/ffmpeg@8/lib/pkgconfig`;
  the default Homebrew FFmpeg 9 is incompatible with the locked FFmpeg 8 bindings.
- Real `M PLUS Rounded 1c` at 400/700 loaded by name, and a subsequent process
  with all proxy addresses set to `http://127.0.0.1:1` rendered successfully
  from cache with no warnings. An unknown family produced the Google Fonts error.
- Real `Noto Sans JP` Japanese/Latin subsets: nine WOFF2 faces fetched from
  Google's modern-client stylesheet, referenced by a local CSS file under
  the alias `Celesta Split JP` to prevent system-family matches. Before the
  fix, glyphs used system fallbacks and emitted a missing-glyph warning;
  afterward the same frame rendered with no warnings.
