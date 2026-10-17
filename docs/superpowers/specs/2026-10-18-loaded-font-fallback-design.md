# Loaded fonts as fallback (`fontFallback="loaded"`) design (issue #256)

## Goal

A font loaded with `<Font>` is never chosen as a fallback. A character that
no family of `fontFamily` (or of its stack, #204) has is drawn with an
installed font picked for `lang`. On macOS, `fontFamily: 'JetBrains Mono'`
with `lang="ja-JP"` and Noto Sans JP loaded through `<Font>` draws Japanese
with Hiragino Sans, not Noto Sans JP.

The workaround is to list the loaded font in the stack
(`fontFamily: ['JetBrains Mono', 'Noto Sans JP']`). Forgetting it makes the
glyphs depend on the fonts installed where the video is exported. This adds
an opt-in that searches loaded fonts before installed ones, so a composition
can say once that loaded fonts come first.

Default behavior stays as it is: turning loaded fonts into fallbacks for
every project would change how existing single-family projects draw
Japanese.

```tsx
<Composition id="main" width={1920} height={1080} fps={30} durationInFrames={90}
  lang="ja-JP" fontFallback="loaded">
  <Font src="https://fonts.googleapis.com/css2?family=Noto+Sans+JP" />
  <Text style={{ fontFamily: 'JetBrains Mono' }}>let 名前 = "値";</Text>
</Composition>
```

## Decisions

- Where: both a `TextStyle` field and an attribute of `<Composition>`,
  `<Group>`, and `<Sequence>`, inherited like `lang`.
- Order: the order the frame's font list gives (`<Font>` declaration order).
- Missing-glyph warnings: characters drawn with a loaded fallback font are
  not reported.
- Text without `fontFamily`: unaffected. Only characters that the named
  family or stack lacks are searched for in loaded fonts.

Out of scope: `<Code>` (`@celesta/code`, #223 is closed), the editor
property panel, and fallback among installed fonts.

## API

```ts
export interface TextStyle {
  // ...existing fields
  /**
   * Where characters the `fontFamily` stack has no glyph for are drawn
   * from. `'system'` (the default): installed fonts chosen for `lang`.
   * `'loaded'`: fonts loaded with `<Font>` first, in declaration order,
   * then installed fonts. Has no effect without `fontFamily`.
   */
  fontFallback?: 'system' | 'loaded';
}

export interface CompositionProps { /* ... */ fontFallback?: 'system' | 'loaded'; }
export interface GroupProps       { /* ... */ fontFallback?: 'system' | 'loaded'; }
export interface SequenceProps    { /* ... */ fontFallback?: 'system' | 'loaded'; }
```

An explicit `style.fontFallback` wins; otherwise the nearest ancestor's
attribute applies; otherwise `'system'`. `<Span>` has no `fontFallback`:
the option belongs to the whole text, like `lang`.

Project JSON gets the same optional `fontFallback` on a text layer's style;
`TextStyle` deserializes it with serde, so the project loader needs no
change.

## Data flow

### Composition model (`crates/composition/src/style.rs`)

```rust
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontFallbackMode { #[default] System, Loaded }

pub struct TextStyle {
    // ...
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_fallback: Option<FontFallbackMode>,
}
```

`FontFallbackMode` avoids a clash with the renderer's `FontFallback`
warning. The TypeScript type comes from ts-rs codegen.

### React (`packages/react`)

`lang` reaches text today through `CompositionRuntimeContext.lang`, group
and sequence props in `walkNode`, `inheritTextLanguage` for raw layers, and
`withTextLanguage` for measurement. `fontFallback` takes the same paths:

- `withTextLanguage(style, lang)` becomes `withInheritedText(style, inherited)`
  with `inherited = { lang, fontFallback }`, filling each field the style
  leaves unset. `inheritTextLanguage` likewise fills both.
- `CompositionRuntimeContext` and the walker's context gain `fontFallback`,
  set from `<Composition>`, `<Group>`, and `<Sequence>` exactly where `lang`
  is. `render.ts` validates the `<Composition>` prop (`'system' | 'loaded'`).
- Measurement (`useTextMetrics`, `measureText()`, `useFitText`, `TextBox`,
  `<TextReveal>`) reads it from the context with `lang`, so measured and drawn
  styles match.
- The static-subtree cache (`static.ts`) keys on `fontFallback` beside `lang`.

### Renderer candidates (`crates/renderer/src/fonts.rs`)

The candidates are the fonts of the current font list: `scene.fonts` when
rendering, the request's `fonts` when measuring. Both come from the same
`collectFonts` walk, in declaration order. "Everything loaded so far" is not
used, because then the result would depend on the order a preview
seeked through the timeline.

- `load_font_data` records the families of each loaded file:
  `asset_families: HashMap<PathBuf, Vec<Arc<str>>>`. A font file contributes
  its faces' first family names, without duplicates. A stylesheet contributes
  each face's private family (`celesta-stylesheet-face-…`) in `@font-face`
  order, so each `unicode-range` subset is its own candidate, as in stacks.
- `load_fonts` sets `fallback_families: Arc<[Arc<str>]>`, the
  concatenation for the list it was given, without duplicates. It is replaced
  on every call, including when nothing new loads. `fork` copies both.

### Choosing a family (`crates/renderer/src/font_stack.rs`)

`face_runs` resolves clusters when the text or a run has a stack (today),
or when `font_fallback == Loaded`, a family is named, and
`fallback_families` is not empty. The run cache key adds the mode and the
candidate list.

`StackFaces` gains `fallback: Vec<(Arc<str>, Arc<Font>)>`: for each candidate
family, its face at the stack's weight (`matched_face`), skipping families
already in the stack. `cluster_family` then:

1. As today, an emoji takes a color emoji font of the stack.
2. As today, the first stack face that covers every visible character.
3. New, only with `Loaded`: the first fallback face that covers every
   visible character.
4. As today, the first stack face with the first character, otherwise the
   primary family, where the system's fallback fonts draw it.

A stack with no installed face (today: drawn as `family.first()` with
system fallback) still tries step 3, so a misspelled family with loaded
fonts draws from them. `font_fallback()` still reports the missing family.

The chosen family reaches shaping as a `FaceRun`, the same way a stack family
does, so measurement, wrapping, baselines, and drawing all use one choice.
Without `Loaded`, `face_runs` takes exactly today's path.

### Missing-glyph warnings

In `missing_characters`, a glyph also counts as drawn by its requested
family when the style is `Loaded` and the glyph's face belongs to one of
`fallback_families`. A character no loaded font has, and that an installed
font draws, is still reported. The `missing_characters` cache key adds the
mode and the candidate list.

### Browser (`packages/web`)

`fonts.ts` already loads each `@font-face` as a `FontFace`. It keeps the
families each font URL added, in order. When a scene's style has
`fontFallback: 'loaded'` and a `fontFamily`, `cssFont` inserts those
families, in the scene's font order and without duplicates, before
`system-ui, sans-serif`.

The browser picks fonts per character, not per grapheme cluster. A base
character and its combining mark can end up in different fonts where native
keeps them together. The docs say so.

## Testing

Rust (`crates/renderer`, with the repository's Bebas Neue and IBM Plex Mono,
of which only Plex Mono has Cyrillic):

- With `Loaded`, `fontFamily: 'Bebas Neue'` draws Б from the loaded
  IBM Plex Mono; with the default, not from it (glyph families, as the
  existing stack tests check).
- Order: a stylesheet fixture that loads Plex Mono under two families; the
  first in the font list draws Б, and reordering the list swaps it.
- Measurement and drawing agree: `measure_text` widths and line starts match
  the drawn layout with `Loaded`, including wrapping.
- `missing_glyphs` leaves out characters drawn by loaded fonts and reports
  ones only an installed font has.
- Cache: changing the mode or the font list re-resolves.
- Without the option, `face_runs` output is unchanged for single families
  and stacks.

TypeScript:

- `@celesta/react`: inheritance from `<Composition>`, `<Group>`, and
  `<Sequence>`; `style.fontFallback` overrides; raw project layers inherit;
  `useTextMetrics` sees the inherited value; invalid `<Composition>` value
  throws.
- `@celesta/web`: `cssFont` output with and without `'loaded'`.

Rendering change: the PR includes before/after screenshots of the same
scene (JetBrains Mono + `lang="ja-JP"` + Noto Sans JP via `<Font>`).

## Documentation

- `skills/celesta/references/text.md`: `fontFallback`, its order, the
  warning behavior, and the browser difference. Keep listing the font in the
  stack as the explicit alternative.
- Website (en and ja): the text page's font-fallback section and the
  `<Composition>` / `<Group>` / `<Sequence>` props.
- `docs/handoff/2026-10-18-loaded-font-fallback.md`: implementation notes and
  validation results.
