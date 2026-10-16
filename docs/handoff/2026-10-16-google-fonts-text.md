# Google Fonts `text` (#364)

```tsx
<Font google="Noto Sans JP" weights={[500, 700]} text={strings.join('')} />
```

`<Font google>` and `googleFont()` take `text`, the characters to load. The
URL is the CSS2 API with `&text=`; characters are deduplicated and sorted by
UTF-16 code unit, so the same set shares one remote-cache entry. Google
returns one file per weight with only those glyphs. Characters left out are
drawn by the next family in the stack or a system fallback, and the existing
missing-glyph warning names them.

`text` with a non-empty `subsets` throws: `subsets` only works on the v1 API,
and `text` already narrows the request further. An empty `text` throws rather
than silently loading the whole family. `<Font src>` rejects `text` at the
type level, as it does `weights` and `subsets`.

No native or browser loader change was needed: both already accepted CSS2
URLs with `text=` (DELTA used one through `<Font src>`).

DELTA 0.6.0 and 0.7.0 now load Noto Sans JP with `<Font google text>`.
`japaneseText()` keeps their choice of only characters above U+2000, so the
generated URLs are byte-identical to the previous hand-built ones.

## Verification

- React runtime build and React tests: passed (154 tests), including
  canonical ordering, encoding of `&`, `=`, `+`, spaces and astral characters,
  the `text`/`subsets` and empty-text errors, and `<Font google text>` sharing
  the asset with `googleFont()` in `<Font src>`.
- DELTA 0.6.0 film and 0.7.0 `<Fonts />` rendered through the React CLI at
  frame 0 before and after: identical `scene.fonts` URLs.
- A real `Noto Sans JP` 500/700 `text=` stylesheet fetched without a browser
  user agent: two `@font-face` rules, one file per weight.
- `pnpm typecheck:examples` and the website `makit check`: passed.
