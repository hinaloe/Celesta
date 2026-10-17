# `fontFallback="loaded"` (#256)

```tsx
<Composition width={1920} height={1080} fps={30} durationInFrames={90}
  lang="ja-JP" fontFallback="loaded">
  <Font google="Noto Sans JP" />
  <Text style={{ fontFamily: 'JetBrains Mono' }}>let 名前 = "値";</Text>
</Composition>
```

`TextStyle.fontFallback` (`'system' | 'loaded'`, Rust `FontFallbackMode`)
lets characters that the `fontFamily` stack lacks come from fonts loaded
with `<Font>` before installed ones. Omitted, or `'system'`, everything
behaves as before. Design:
[`docs/superpowers/specs/2026-10-18-loaded-font-fallback-design.md`](../superpowers/specs/2026-10-18-loaded-font-fallback-design.md).

## React

`<Composition>`, `<Group>`, and `<Sequence>` take `fontFallback` and pass it
down exactly as they pass `lang`: through `CompositionRuntimeContext` for
hooks, and through the walker's context for layers. `withTextLanguage`
became `withInheritedText(style, { lang, fontFallback })` (in
`@celesta/react/internal`), used by `<Text>`, raw project layers,
`useTextMetrics`, `useFitText`, `<TextReveal>`, and `<Dialogue>`
subtitles. `<Static>` caches key on it. It is not part of
`CompositionConfig`; the walker reads it from the `<Composition>` props.
Editor component previews (`createResolver`) do not set it.

## Renderer

- `TextRasterizer` records the families each loaded file added
  (`asset_families`). A font file adds its faces' family names. A
  stylesheet adds one private `celesta-stylesheet-face-…` family per
  `@font-face`. `load_fonts` sets `fallback_families` to the given list's
  families in list order, so the candidates are the frame's `<Font>`s in
  declaration order, not everything loaded so far.
- A changed `fallback_families` clears the shaped-buffer, stack-run, and
  missing-character caches and advances `fonts_revision()`. The GPU
  renderer now compares that, not `loaded_font_count()`, before dropping
  its text textures. Forks copy both.
- `font_stack.rs`: with `Loaded` and a named family, `face_runs` resolves
  clusters even for a single family. `StackFaces.fallback` holds the
  candidates not already in the stack. `cluster_family` tries them after
  the stack's full-coverage pass and before its first-character pass. The
  choice reaches shaping as a `FaceRun`, so measuring and drawing agree.
- `missing_characters` treats glyphs from a fallback family as drawn by
  the requested family when the style is `Loaded`.

## Browser

`loadedFamilies(fonts, resolve)` lists the `FontFace` families each font
URL added. `withLoadedFallback(style, families)` appends them to the
style's stack and each run's, for drawing (`SceneCanvas`) and for
measurement (`engine.worker.ts`). The browser picks fonts per character,
so it can split a cluster that native keeps together.

## Verification

- `cargo test -p celesta-renderer` (`font_fallback_tests`: candidate order,
  stylesheets, re-listing, revision, forks; per-cluster choice, list
  reorder, measuring and wrapping, warnings, regressions without the
  option), `cargo test -p celesta-gpu-renderer`, `cargo test -p
  celesta-composition`, clippy.
- `pnpm run test:runtime` (`packages/react/test/font-fallback.test.mjs`:
  inheritance, overrides, raw layers, `useTextMetrics`, validation,
  `<Static>`), `pnpm --dir packages/web test` and typecheck.
- Native export (macOS, `target/release/celesta-exporter --react … --frame 0`):
  IBM Plex Mono from a file and DotGothic16 from Google Fonts, `lang="ja-JP"`.
  With `fontFallback="system"`, Japanese is drawn with Hiragino Sans and the
  export warns that Plex Mono has no glyph for it. With `"loaded"`, it is
  drawn with DotGothic16 and nothing is reported. Latin text is identical.
  The PR shows both frames.
