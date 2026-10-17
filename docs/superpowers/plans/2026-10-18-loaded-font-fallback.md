# Loaded Font Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `fontFallback: 'loaded'`, characters the `fontFamily` stack lacks are drawn from fonts loaded with `<Font>`, in the frame's font-list order, before installed fonts.

**Architecture:** A new `TextStyle.fontFallback` field, filled by React from `<Composition>`/`<Group>`/`<Sequence>` exactly as `lang` is. The renderer records the families each loaded font file contributes, sets the frame's ordered candidate list in `load_fonts`, and `font_stack.rs` picks a candidate per grapheme cluster as a `FaceRun`, so measurement and drawing share one choice. The browser runtime appends the loaded families to the CSS font list.

**Tech Stack:** Rust 2024 (cosmic-text, fontdb, ts-rs), TypeScript (React reconciler, vitest, node:test).

**Spec:** `docs/superpowers/specs/2026-10-18-loaded-font-fallback-design.md`

## Global Constraints

- Default behavior is unchanged: without `fontFallback: 'loaded'`, every code path produces exactly today's output.
- Values: `'system'` (default) and `'loaded'`. Rust enum `FontFallbackMode { System, Loaded }` (not `FontFallback`, which is the renderer's warning struct).
- Only text with a `fontFamily` (its own or a run's) is affected.
- Candidates are the current font list's families (`scene.fonts`, or a measurement request's `fonts`) in list order, never "everything loaded so far".
- cosmic-text's fallback lists are not modified.
- Build with FFmpeg 8: `PKG_CONFIG_PATH=$(brew --prefix ffmpeg@8)/lib/pkgconfig` for any cargo command that builds `celesta-media` dependents.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A font list whose order changes between frames without a new file loading (a `<Font>` inside a `<Sequence>`): cached runs, shaped buffers, and GPU text textures must re-resolve. Pinned in Task 2 (`reordering_the_font_list_swaps_the_fallback`) and Task 2's `fonts_revision` test.
- The same font file referenced by two stylesheets, or a stylesheet whose path was loaded earlier: its families must still be listed. Pinned in Task 2 (`a_stylesheet_loaded_twice_keeps_its_families`).
- The named family is itself one of the loaded fonts: it must not appear twice or change which family is primary. Pinned in Task 3 (`a_loaded_family_in_the_stack_is_not_repeated`).
- `fontFallback: 'loaded'` on text without `fontFamily`: nothing changes. Pinned in Task 3 (`text_without_a_family_ignores_loaded_fallback`).
- A forked rasterizer (GPU text workers) draws the same as the original. Pinned in Task 2 (`a_fork_keeps_the_fallback_families`).

---

### Task 1: `FontFallbackMode` in the composition model

**Files:**
- Modify: `crates/composition/src/style.rs` (enum beside `LineBreak`; field on `TextStyle` after `lang`)
- Modify: `crates/composition/src/lib.rs:12-15` (re-export)
- Regenerate: `packages/react/src/generated/FontFallbackMode.ts`, `TextStyle.ts` (gitignored)
- Modify: `packages/react/src/scene.ts` and `packages/react/src/index.ts` (export the type like `LineBreak`)

**Interfaces:**
- Produces: `celesta_composition::FontFallbackMode { System (default), Loaded }`, serde `"system"`/`"loaded"`; `TextStyle.font_fallback: Option<FontFallbackMode>`; TS `type FontFallbackMode = 'system' | 'loaded'` and `TextStyle.fontFallback?: FontFallbackMode`.

- [ ] **Step 1: Write the failing test** in a new `#[cfg(test)] mod tests` at the end of `style.rs`:

```rust
#[test]
fn font_fallback_reads_and_omits_like_other_optional_fields() {
    let style: TextStyle = serde_json::from_str(r#"{"fontFallback":"loaded"}"#).unwrap();
    assert_eq!(style.font_fallback, Some(FontFallbackMode::Loaded));
    assert_eq!(serde_json::to_string(&TextStyle::default()).unwrap(), "{}");
    assert!(serde_json::from_str::<TextStyle>(r#"{"fontFallback":"fonts"}"#).is_err());
}
```

- [ ] **Step 2: Run** `cargo test -p celesta-composition font_fallback` — expect a compile failure (no `font_fallback`).
- [ ] **Step 3: Implement** the enum (same derives and doc style as `LineBreak`, doc comment from the spec's API block) and the field with `#[serde(default, skip_serializing_if = "Option::is_none")]`. Fix every `TextStyle { .. }` literal that does not use `..Default::default()` (`cargo check --workspace --tests`).
- [ ] **Step 4: Run** `cargo test -p celesta-composition` — PASS. Run `pnpm --dir packages/react run codegen` and check `packages/react/src/generated/TextStyle.ts` has `fontFallback?: FontFallbackMode`.
- [ ] **Step 5: Commit** `feat(composition): add TextStyle.fontFallback (#256)`.

### Task 2: The frame's fallback candidates in `TextRasterizer`

**Files:**
- Modify: `crates/renderer/src/fonts.rs` (`TextRasterizer` fields, `new`, `fork`, `load_fonts`, `load_font_data`)
- Modify: `crates/gpu-renderer/src/prepare.rs:42-48`, `crates/gpu-renderer/src/renderer.rs:142-144` (use the revision)
- Create: `crates/renderer/src/font_fallback_tests.rs`; register in `crates/renderer/src/lib.rs` beside `font_stack_tests`

**Interfaces:**
- Produces:
  - `pub(crate) fallback_families: Arc<[Arc<str>]>` on `TextRasterizer`: for the font list of the last `load_fonts` call, each file's families in list order, without duplicates.
  - `asset_families: HashMap<PathBuf, Vec<Arc<str>>>` (private): keyed by font file path and by stylesheet path.
  - `load_font_data(...) -> Result<Vec<Arc<str>>, RenderError>`: the families it added. With an alias, each face's private `celesta-stylesheet-face-…` name. Without one, each face's `families[0]`, deduplicated. Existing callers ignore the value.
  - `pub fn fonts_revision(&self) -> u64`: incremented on every loaded font and every change of `fallback_families`. `fork` copies `fallback_families`, `asset_families`, and the revision.
  - When `fallback_families` changes, `load_fonts` clears `stacked_runs`, `shaped_buffers`, and `missing_characters`.
- GPU renderer: `text_font_count: usize` becomes `text_fonts_revision: u64`, compared against `fonts_revision()`.

- [ ] **Step 1: Write the failing tests** in `font_fallback_tests.rs`. Copy `BebasNeue-Regular.ttf` and `IBMPlexMono-Regular.ttf` from `examples/prism/assets/fonts` into a tempdir (as `font_tests.rs::stylesheet_subsets_select_each_file_for_its_glyphs_including_stacks_and_forks` does), with a `file_font(path)` helper like `font_tests.rs:146`.

```rust
#[test]
fn fallback_families_follow_the_font_list() {
    // load [bebas, plex]
    assert_eq!(names(&r.fallback_families), ["Bebas Neue", "IBM Plex Mono"]);
    // load [plex, bebas] — nothing new loads, order still follows the list
    assert_eq!(names(&r.fallback_families), ["IBM Plex Mono", "Bebas Neue"]);
    // load [plex] — Bebas stays loaded but is no candidate
    assert_eq!(names(&r.fallback_families), ["IBM Plex Mono"]);
}

#[test]
fn a_stylesheet_lists_one_private_family_per_face() {
    // split.css with two @font-face rules (Bebas, Plex) under 'Celesta Split'
    assert_eq!(r.fallback_families.len(), 2);
    assert!(r.fallback_families.iter().all(|f| f.starts_with("celesta-stylesheet-face-")));
}

#[test]
fn a_stylesheet_loaded_twice_keeps_its_families() {
    // load [split.css], then [bebas], then [split.css] again
    // the third list equals the first
}

#[test]
fn fonts_revision_changes_with_the_list_order_only_when_it_changes() {
    // [bebas, plex] -> rev a; same list again -> a; [plex, bebas] -> > a
}

#[test]
fn a_fork_keeps_the_fallback_families() {
    // fork().fallback_families == original's
}
```

- [ ] **Step 2: Run** `cargo test -p celesta-renderer font_fallback_tests` — expect compile failures.
- [ ] **Step 3: Implement** the fields and methods above. In `load_fonts`, build the new list while iterating `fonts`. Look up `asset_families` for paths already loaded, including stylesheet face paths that another stylesheet loaded, and store the stylesheet path's concatenation on its first load. Compare the new list with the old one before replacing it.
- [ ] **Step 4: Switch the GPU renderer** to `fonts_revision()` and update the doc comment on the field.
- [ ] **Step 5: Run** `cargo test -p celesta-renderer` and `PKG_CONFIG_PATH=$(brew --prefix ffmpeg@8)/lib/pkgconfig cargo test -p celesta-gpu-renderer` — PASS.
- [ ] **Step 6: Commit** `feat(renderer): track the frame's loaded font families (#256)`.

### Task 3: Choosing loaded fonts per cluster, and warnings

**Files:**
- Modify: `crates/renderer/src/font_stack.rs` (`face_runs`, `StackFaces`, `stack_faces`, `cluster_family`)
- Modify: `crates/renderer/src/fonts.rs` (`missing_glyphs` key at line ~370, `missing_characters`)
- Modify: `crates/renderer/src/shaping.rs:32-46` (add `style.font_fallback` to the shaped-buffer key)
- Test: `crates/renderer/src/font_fallback_tests.rs`

**Interfaces:**
- Consumes: `fallback_families` and `FontFallbackMode` from Tasks 1–2.
- Produces: no new public API. `face_runs` returns runs naming a candidate family for clusters the stack cannot cover, when `style.font_fallback == Some(Loaded)`.

Selection rules (spec "Choosing a family"):
- `face_runs` resolves clusters when it does today, or when the mode is `Loaded`, `fallback_families` is non-empty, and the text or a run names a family. Add `style.font_fallback` to the `stacked_runs` key.
- `StackFaces.fallback`: each candidate's `matched_face(name, weight)`, skipping names already in `faces`. Fill it only when the mode is `Loaded`.
- `cluster_family` order: stack color emoji → first stack face covering every visible character → **first fallback face covering every visible character** → first stack face with the first character → primary. The early returns for an empty stack and a single-face stack must not skip the fallback step.
- `missing_characters`: a glyph whose face has a family in `fallback_families` counts as drawn by the requested family when the mode is `Loaded`. Add `style.font_fallback` to the `missing_characters` key.

- [ ] **Step 1: Write the failing tests.** Load Bebas and Plex as separate files in `two_family_rasterizer` order. `bebas(48.0)` comes from `font_run_tests`. Only Plex has Б.

```rust
fn loaded(style: TextStyle) -> TextStyle { TextStyle { font_fallback: Some(FontFallbackMode::Loaded), ..style } }

#[test]
fn a_character_the_family_lacks_comes_from_a_loaded_font() {
    // families_by_point (as in font_stack_tests) of "AБ" with loaded(bebas(48.0)):
    // [(0, "Bebas Neue"), (1, "IBM Plex Mono")]
    // with bebas(48.0): point 1's family != "IBM Plex Mono"
}

#[test]
fn reordering_the_font_list_swaps_the_fallback() {
    // two stylesheets a.css ('Fallback A', url(plex-a.ttf)) and b.css ('Fallback B', url(plex-b.ttf)),
    // both copies of IBMPlexMono-Regular.ttf, plus BebasNeue-Regular.ttf.
    // list [bebas, a.css, b.css]: the glyph for Б has a face whose families include "Fallback A";
    // list [bebas, b.css, a.css]: "Fallback B".
}

#[test]
fn measuring_matches_drawing_with_loaded_fallback() {
    // measure("AБAБ", loaded(bebas(48.0)), Some(w)) — width and line_starts equal the
    // layout from shaped_buffer with the same style and width, and the width equals
    // advance("A", bebas) + advance("Б", plex) twice, within 0.5.
}

#[test]
fn loaded_fallback_characters_are_not_reported_missing() {
    // missing_glyphs("layer", "AБ", &loaded(bebas(48.0))) is empty;
    // missing_glyphs with bebas(48.0) reports ['Б'] for ["Bebas Neue"] at 400.
}

#[test]
fn characters_no_loaded_font_has_are_still_reported() {
    // a CJK character (日) with loaded(bebas(48.0)) and only Bebas/Plex loaded: reported.
}

#[test]
fn a_loaded_family_in_the_stack_is_not_repeated() {
    // fontFamily ["Bebas Neue"] with loaded fallback over [bebas, plex]: face_runs equals
    // the plain-name case; the primary family is still "Bebas Neue".
}

#[test]
fn text_without_a_family_ignores_loaded_fallback() {
    // face_runs("AБ", loaded(TextStyle::default())) is empty, as without it.
}

#[test]
fn without_the_option_runs_are_unchanged() {
    // for bebas(48.0) and font_stack_tests' bebas_then_mono(48.0), face_runs with
    // font_fallback None and Some(System) equal each other and today's expected runs.
}
```

- [ ] **Step 2: Run** `cargo test -p celesta-renderer font_fallback_tests` — the new tests FAIL.
- [ ] **Step 3: Implement** the selection rules above.
- [ ] **Step 4: Run** `cargo test -p celesta-renderer` — all PASS, including the existing `font_stack_tests` and `font_run_tests`.
- [ ] **Step 5: Run** `cargo clippy -p celesta-renderer --tests -- -D warnings` and `cargo fmt --check`.
- [ ] **Step 6: Commit** `feat(renderer): fall back to loaded fonts with fontFallback "loaded" (#256)`.

### Task 4: React props and inheritance

**Files:**
- Modify: `packages/react/src/hooks.ts` (`CompositionRuntimeContextValue.fontFallback`, `resolveFontFallback`)
- Modify: `packages/react/src/text-measure.ts:64-67,147-149` (replace `withTextLanguage`)
- Modify: `packages/react/src/components.ts` (`CompositionProps`, `GroupProps`, `SequenceProps`; `Composition`, `Group`, `Sequence`, `FreezeFrame` providers)
- Modify: `packages/react/src/render.ts` (composition config parse ~284-305, `runtimeValue` ~1465, `WalkContext` and `rootWalkContext`, group/sequence walk ~1263, text content ~672, `inheritTextLanguage` ~1418, sequence/freeze child contexts ~983/~1018, resolver ~1807, static key ~1365)
- Modify: `packages/react/src/static.ts` (`StaticContext.fontFallback`, compared like `lang`)
- Modify: `packages/react/src/internal.ts` (export the new helpers instead of `withTextLanguage`)
- Modify: `packages/character/src/components.ts:396`, `packages/text/src/text-fit.ts:87`, `packages/text/src/text-motion.ts:136`
- Test: `packages/react/test/font-fallback.test.mjs` (pattern: `packages/react/test/text.test.mjs`)

**Interfaces:**
- Consumes: TS `FontFallbackMode` from Task 1.
- Produces:
  - `resolveFontFallback(value: unknown, inherited?: FontFallbackMode): FontFallbackMode | undefined` in `hooks.ts`. It throws `Celesta components require \`fontFallback\` to be 'system' or 'loaded'` for any other defined value.
  - `withInheritedText(style: TextStyle, inherited: { lang?: string; fontFallback?: FontFallbackMode }): TextStyle`. It fills `lang` and `fontFallback` where the style has `null`/`undefined`, and returns `style` itself when it fills nothing. It replaces `withTextLanguage` at every call site, passing the runtime context (or walk context) directly.
  - `inheritTextLanguage` is renamed `inheritText(layers, inherited)` with the same object.
  - `fontFallback?: FontFallbackMode` on `CompositionProps`, `GroupProps`, `SequenceProps`, `CompositionRuntimeContextValue`, `WalkContext`, `StaticContext`, and `CompositionConfig`. It sits beside `lang` everywhere `lang` is passed, with doc comments matching the `lang` ones ("Where characters `fontFamily` lacks are drawn from; inherited when omitted.").

- [ ] **Step 1: Write the failing tests** (render an entry with the CLI as `text.test.mjs` does, and read layer styles):
  - `<Composition fontFallback="loaded">` → a `<Text>` layer's `style.fontFallback === 'loaded'`; a `<Text>` without the prop → `fontFallback` absent.
  - `<Group fontFallback="system">` inside it overrides for its children; `<Sequence fontFallback="loaded">` sets it for its children.
  - `style={{ fontFallback: 'system' }}` on a `<Text>` under a `loaded` composition stays `'system'`.
  - Project timeline text (`rawLayers`) inherits it.
  - `useTextMetrics` inside the composition receives a request whose style has `fontFallback: 'loaded'` (install a recording measurer as `text-metrics.test.mjs` does).
  - `<Composition fontFallback="fonts">` throws the message above.
  - A `<Static>` subtree re-walks when an ancestor's `fontFallback` changes (pattern: `static.test.mjs`'s `lang` case, if present; otherwise compare layer styles across two frames).
- [ ] **Step 2: Run** `pnpm --dir packages/react exec vitest run test/font-fallback.test.mjs` after `pnpm run build:runtime` — FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** `pnpm run build:runtime && pnpm run test:runtime` — PASS (covers `@celesta/text` and `@celesta/character`).
- [ ] **Step 5: Commit** `feat(react): inherit fontFallback like lang (#256)`.

### Task 5: Browser runtime

**Files:**
- Modify: `packages/web/src/fonts.ts` (`loadedFamilies`)
- Modify: `packages/web/src/text-layout.ts` (`withLoadedFallback`)
- Modify: `packages/web/src/types.ts` (`TextStyle.fontFallback`)
- Modify: `packages/web/src/scene-canvas.ts` (apply before laying out a text layer; font list from `scene.fonts` and `this.src`)
- Modify: `packages/web/src/engine.worker.ts:88` (apply to measurement requests with `request.fonts` and `resolveFont`)
- Test: `packages/web/test/text-layout.test.mjs`, `packages/web/test/fonts.test.mjs`

**Interfaces:**
- Produces:
  - `loadedFamilies(assets: Asset[], resolve: (asset: Asset) => string): string[]`: for each asset in order, the `family` of each `FontFace` its URL added (`loaded.get(url)?.faces`), without duplicates. Unresolvable assets contribute nothing.
  - `withLoadedFallback(style: TextStyle, families: readonly string[]): TextStyle`: when `style.fontFallback === 'loaded'` and `families` is non-empty, it returns a style whose `fontFamily`, and each `fontRuns[i].fontFamily` that is set, becomes the original list followed by the families not already in it. Otherwise it returns `style` unchanged. `cssFont` itself is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `withLoadedFallback({ fontFamily: 'JetBrains Mono', fontFallback: 'loaded' }, ['Noto Sans JP'])` → `cssFont` gives `400 32px "JetBrains Mono", "Noto Sans JP", system-ui, sans-serif`.
  - Same style without `fontFallback`, or without `fontFamily` → returned unchanged (`===`).
  - A family already in the stack is not repeated; a run's stack gets the same tail.
  - `loadedFamilies` after `loadFonts` with a stubbed CSS response of two `@font-face` rules returns their families in order (use `fonts.test.mjs`'s existing stubs).
- [ ] **Step 2: Run** `pnpm --dir packages/web test` — FAIL.
- [ ] **Step 3: Implement** and wire into `scene-canvas.ts` and `engine.worker.ts`.
- [ ] **Step 4: Run** `pnpm --dir packages/web test` and `pnpm --dir packages/web exec tsc --noEmit` — PASS.
- [ ] **Step 5: Commit** `feat(web): append loaded fonts with fontFallback "loaded" (#256)`.

### Task 6: Documentation, handoff, and visual check

**Files:**
- Modify: `skills/celesta/references/text.md`
- Modify: `packages/website/content/en/docs/02-(guides)/05-text-fonts.md` (line 21 `lang` bullet, line 107 paragraph) and `packages/website/content/ja/docs/02-(guides)/05-text-fonts.md` (same places)
- Create: `docs/handoff/2026-10-18-loaded-font-fallback.md`
- Create (not committed): before/after PNGs of one scene

- [ ] **Step 1: Docs.** Replace "Fonts loaded with `<Font>` are never used as fallbacks, so list them in the stack" with: by default they are not; `fontFallback="loaded"` on `<Composition>`, `<Group>`, or `<Sequence>` (or `style.fontFallback`) searches them first, in `<Font>` order, and only for text with a `fontFamily`. Characters drawn this way are not reported as missing. The browser preview appends the loaded families to the CSS list, so it chooses per character rather than per cluster. Listing the font in the stack remains the explicit way. Write the same in ja, in the existing tone of each page.
- [ ] **Step 2: Handoff note** with what changed, where the candidate list lives, the cache invalidation, and validation results (commands run, screenshots).
- [ ] **Step 3: Screenshots.** Build `celesta-exporter` from source, then export one frame of this entry twice, without and with `fontFallback="loaded"` on `<Composition>`: `lang="ja-JP"`, `<Font src="https://fonts.googleapis.com/css2?family=Noto+Sans+JP" />`, `<Text style={{ fontFamily: 'IBM Plex Mono', fontSize: 96 }}>let 名前 = "値";</Text>` with Plex loaded from `examples/prism/assets/fonts`. The kana and kanji must visibly differ: Hiragino before, Noto Sans JP after. Save both under the scratchpad for the PR.
- [ ] **Step 4: Full check:** `cargo test --workspace` (with the FFmpeg 8 `PKG_CONFIG_PATH`), `pnpm run test:runtime`, `pnpm --dir packages/web test`.
- [ ] **Step 5: Commit** `docs: document fontFallback="loaded" (#256)` and `docs: handoff for fontFallback (#256)`.
