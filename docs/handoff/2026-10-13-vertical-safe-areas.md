# Vertical safe areas and debug guides in PNG exports (2026-10-13)

Safe areas can describe the UI that Shorts, TikTok, and Reels draw over a
vertical video, and the debug guides that show them can be checked in PNG
exports (issue #222).

- `@celesta/layout` (`packages/layout/src/layout.ts`): a safe area is a
  number, per-edge `Insets` (missing edges are 0), or a `SafeAreaPreset`.
  `'vertical-social'` is fractions of the canvas: top 0.1 and bottom 0.2 of
  the height, right 0.185 and left 1/15 of the width, rounded to pixels
  (192 / 200 / 384 / 72 px at 1080×1920, the values `examples/shorts-type`
  used). The numbers are a rough guide and are not kept in step with the
  platforms. `safeAreaInsets(area, width, height)` resolves any value;
  `<SafeArea padding>` resolves a preset against the composition canvas
  (`useVideoConfig()`), not the inherited layout bounds.
- `@celesta/debug` now depends on `@celesta/layout`. `<DebugOverlay
  safeArea>` takes the same values, shades the canvas outside the safe area
  (`shade`, default `#00e5ff26`, `false` for none), and scales line widths,
  the center cross, and the label by `round(min(width, height) / 540)` so
  they survive a contact sheet's downscaling. Insets wider than the canvas
  are clamped edge by edge.
- `useDebugGuides()` (`packages/react/src/hooks.ts`) is true when
  `CompositionRuntimeContext.preview` or `.debugGuides` is. `DebugOverlay`
  and `DebugBounds` use it instead of `useIsPreview()`, which is unchanged.
  A frame request may carry `debugGuides: true` (`packages/cli/src/cli.ts`);
  `renderAt(time, project, { debugGuides })` puts it on the root runtime
  context, and `<Sequence>`/`<FreezeFrame>` keep it by spreading the context.
- `ReactBridge::set_debug_guides` (`crates/react-bridge/src/bridge.rs`) adds
  the flag to later frame requests (`submit_frame`, `evaluate_past_end`);
  component resolutions already run with `preview: true`. An older runtime
  ignores the flag.
- Exporter: `PngExport::debug_guides` and `--debug-guides` (requires
  `--react` and PNG output; an MP4 request is a usage error). Only
  `export_react_png_with` turns the flag on, so video exports cannot draw
  guides. JSON projects have no guides to draw.
- The editor's whole-`.tsx` preview evaluates frames like an export
  (`preview: false`), so guides never appeared there and `useIsPreview()`
  was false. Frame requests now carry `preview: true` too
  (`ReactBridge::set_preview`, `renderAt(..., { preview })`), and only the
  editor's preview bridge sets it (`crates/editor/src/preview.rs`), which
  turns on `useIsPreview()` and so the guides. Exporter and inspect paths
  never set it. A `<Static>` that reads `useIsPreview()` is walked again when
  it changes, since its host nodes change (`packages/cli/test/preview.test.mjs`).
- `examples/shorts-type` and `examples/shorts-type-en` take `SAFE` from
  `safeAreaInsets('vertical-social', W, H)` and end with
  `<DebugOverlay safeArea={SAFE} />`, replacing their own `SafeGuide`
  component and `guides` project property.
- Docs: `skills/celesta/references/react-core.md` (vertical video, debug
  guides), `verify.md` (checking a vertical video's safe area),
  `animation.md`, `export.md`, `SKILL.md`, and the website's preview, layout,
  export, and reference chapters.
- Tests: `packages/layout/test/layout.test.mjs`,
  `packages/debug/test/debug.test.mjs`, `crates/react-bridge/src/tests.rs`,
  `crates/react-bridge/tests/node_integration.rs`,
  `crates/exporter/tests/png_integration.rs`. `packages/cli/test/
  migrate-packages.test.mjs` lists the layout exports that never were in
  `@celesta/react`.
