# `<TextReveal maxWidth>` (#237)

```tsx
<TextReveal x={540} y={700} align={0.5} maxWidth={880} lineHeight={150}
  style={{ fontSize: 120, lineBreak: 'phrase' }}>
  {getProjectProperty('headline')}
</TextReveal>
```

With `maxWidth`, `<TextReveal>` measures the whole text once during render
with the synchronous measurer (the same request `useTextMetrics` sends:
style with runs and `lang`, no color), reads `lineStarts`, and cuts the text
and its runs into one single-line `Text` per visual line. `\n` still breaks.
The `\n` ending a line and the whitespace before a soft wrap belong to no
line, so `align` pivots only the visible glyphs; this matches where
`<Text maxWidth style.align>` puts each line. A span color change does not
measure again. Without `maxWidth` nothing is measured and the output is
unchanged.

`lineStarts` was already reported by the native measurer. The browser
measurer (`@celesta/web`) now reports it too, from the ranges it wraps; it
still ignores `lineBreak`, so preview breaks can differ from export. A
measurer that reports no `lineStarts` makes `<TextReveal maxWidth>` throw.

Each line is still placed at `x` with `anchorX={align}`; `maxWidth` does not
add a box, and `style.align` does not move lines.

## Verification

- `@celesta/text` tests: wrapped lines and runs, spaces at wraps, the
  measurement request (`maxWidth`, `lineBreak`, `lang`, no color), reuse
  across color changes, no measurement without `maxWidth`, and errors.
- `@celesta/web` tests and typecheck; CLI motion and rich-text tests;
  `pnpm typecheck:examples`.
- Native export (lavapipe), 1080×1920: Japanese with `lineBreak: 'phrase'`
  at `maxWidth={760}` breaks exactly where `<Text maxWidth>` does; before
  this change the same scene ran off the frame on one line. Latin text with
  `align={0.5}` lines up with `<Text maxWidth style.align="center">`.
