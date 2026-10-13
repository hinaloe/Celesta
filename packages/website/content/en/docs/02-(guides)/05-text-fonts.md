## Text

`Text` renders its children: strings, numbers, and `<Span>` elements. Style it with `style`:

```tsx title="An outlined, wrapping caption"
<Text x={960} y={900} anchorX={0.5} anchorY={0.5} maxWidth={1400}
  style={{
    fontFamily: 'Hiragino Sans',
    fontSize: 64,
    fontWeight: 700,
    lineHeight: 80,
    align: 'center',
    fill: { type: 'solid', color: '#ffffff' },
    stroke: { paint: { type: 'solid', color: '#57456c' }, width: 8 },
  }}>
  Words that wrap onto a second line when they reach maxWidth.
</Text>
```

- `fontFamily` names a font installed on the computer, or one loaded with `<Font>`. When the family has no face at the requested `fontWeight`, Celesta uses its nearest weight, as CSS does. Characters the font lacks, such as emoji, fall back to another installed font. A JSON project can also bundle a font file as a `font` asset.
- `lang` selects the language used for fallback fonts when `fontFamily` is omitted or lacks a character. Set `<Composition lang="ja-JP">` for the whole composition. Children inherit the nearest `Composition`, `Group`, or `Sequence` with a `lang` prop, including subtitles, project timeline text, `useTextMetrics()`, `useFitText()`, and component previews. These scopes can change language between frames; measurement and rendering use the same value. `<Text lang="zh-Hant">` overrides ancestors, and an explicit `style.lang` takes priority over that prop. An empty `lang` selects the system locale. Tags such as `ja-JP`, `ko-KR`, `zh-Hans`, `zh-Hant`, and `zh-Hant-HK` are supported. When neither sets a language, Celesta uses the system locale; installed or bundled fonts still determine the available glyphs. The browser preview applies `lang` in browsers supporting Canvas language selection.

```tsx title="A Japanese default with a Chinese group"
<Composition width={1920} height={1080} fps={30} durationInFrames={90} lang="ja-JP">
  <Text>漢字とかな</Text>
  <Group lang="zh-Hant">
    <Text y={80}>繁體中文</Text>
    <Text y={160} lang="ko-KR">한국어</Text>
  </Group>
</Composition>
```

`prepare()` runs before `<Composition>` is mounted. Pass `lang` explicitly to `measureText()` when measuring: `measureText('漢字とかな', { lang: 'ja-JP' })`.

To use a font file that is not installed, declare it with `<Font>`. A relative `src` is resolved against the entry file’s folder, and `fontFamily` uses the family name stored inside the file, not the file name. TrueType, OpenType, WOFF, and WOFF2 files all work, and `src` can be an `http://` or `https://` URL.

```tsx title="Load a font file next to the entry"
<Composition width={1920} height={1080} fps={30} durationInFrames={90}>
  <Assets>
    <Font src="./fonts/MPLUSRounded1c-Bold.ttf" />
  </Assets>
  <Text style={{ fontFamily: 'M PLUS Rounded 1c', fontWeight: 700, fontSize: 96 }}>
    Hello
  </Text>
</Composition>
```

`src` can also be a web font stylesheet, such as a Google Fonts CSS link. Celesta loads every font file its `@font-face` rules list, and `fontFamily` can use the stylesheet’s family name. Include every weight you use in the link: a weight the stylesheet does not provide is drawn with the nearest weight it does.

```tsx title="Load a Google Fonts family"
<Assets>
  <Font src="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;700" />
</Assets>
<Text style={{ fontFamily: 'M PLUS Rounded 1c', fontWeight: 700, fontSize: 96 }}>
  こんにちは
</Text>
```

## Mix Latin and Japanese fonts

`fontFamily` also takes a list of families, a font stack. Each character is drawn with the first family in the list that has it, so Latin letters can come from a Latin font and Japanese from a Japanese one. A letter and its accents or variation selector always come from the same font.

```tsx title="A Latin and a Japanese font in one line"
<Composition width={1920} height={1080} fps={30} durationInFrames={90} lang="ja-JP">
  <Assets>
    <Font src="https://fonts.googleapis.com/css2?family=Inter:wght@500" />
    <Font src="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500" />
  </Assets>
  <Text style={{ fontFamily: ['Inter', 'Noto Sans JP'], fontWeight: 500, fontSize: 64 }}>
    Celesta 0.5.0 で字幕の組版を改善
  </Text>
</Composition>
```

Families that are not installed or loaded are skipped. The first family that is sets the baselines, so a paragraph keeps even line spacing whether or not a line has Japanese. Characters that no family in the list has fall back to an installed system font chosen for `lang`. Fonts loaded with `<Font>` are never used as fallbacks, so list them in the stack. Measuring and wrapping follow the stack, and `<Code>` takes one too: `style={{ fontFamily: ['JetBrains Mono', 'Noto Sans JP'] }}`. `<Span style={{ fontFamily }}>` accepts a stack as well. The export warns when no family in the stack is installed or loaded, and names the characters that none of them has. The browser preview passes the list to the browser as a CSS font-family list, so characters that no family has can look different from the export.

- `maxWidth` wraps text at word boundaries, and `align` positions each line within that width. Use `\n` in a string to break a line yourself.
- Japanese normally wraps between most characters, splitting a word such as フレーム, while line-break rules keep punctuation such as 、 and 。 off the start of a line. Set `lineBreak: 'phrase'` in the style to wrap only between phrases, found with [BudouX](https://github.com/google/budoux)’s Japanese model; `lang` currently selects fallback fonts only. A phrase wider than `maxWidth` wraps inside itself as normal text does. The browser preview ignores `lineBreak` and wraps only at whitespace.
- Single-line text is anchored vertically by its visible glyphs, so `anchorY={0.5}` centers the letters themselves rather than an invisible line box. Its width is the advance width, so leading and trailing spaces still take up room. Text with several lines, broken with a newline or wrapped at maxWidth, is anchored by its line boxes instead, where measureText puts them.
- `anchorY="baseline"` anchors text on its first line’s baseline instead. Text layers with the same `y` then share a baseline, whatever their letters or font sizes.

## Emphasize part of a text

`<Span>` changes the `fill`, `fontWeight`, or `fontFamily` of part of a text. The whole text is still laid out as one paragraph: it wraps, aligns, and measures as one, and its baseline stays where the text’s own letters put it. Spans nest; a weight the family lacks uses its nearest weight.

```tsx title="An emphasized word in one paragraph"
<Text style={{ fontSize: 48, fill: { type: 'solid', color: '#ffffff' } }}>
  速い、<Span style={{ fill: '#28A34A', fontWeight: 700 }}>カンタン</Span>、頼もしい。
</Text>
```

Spans work in `<Text>`, `<TextBox>`, `<TextReveal>`, and `<Dialogue>`, in `DialogueSeries` lines, and in `useTextMetrics()`, `measureText()`, `useFitText()`, `fitText()`, and `useTypewriter()`; pass the typed length to `visibleCharacters` to type rich text without changing its layout. A component that returns a span cannot be used inside text. Set `lang` on Japanese, Chinese, or Korean text with spans: a span splits shaping, and without a language the characters next to it can fall back to a different font. The browser preview draws each span with its own font and can differ slightly from export at span edges.

## Measure and fit text

In the desktop app and CLI, measureText(text, style, options) runs asynchronously in prepare(); useTextMetrics(text, style, options) measures during rendering. Both return width, height, lines, baseline metrics, and glyph positions using the same shaping as Text. Pass maxWidth for wrapping. In prepare(), supply font files through options.fonts because Font declarations have not mounted yet. Hooks inherit the current language and declared fonts.

In the desktop app and CLI, TextBox chooses a font size between minFontSize and maxFontSize to fit width, height, and optional maxLines. Its x/y is the box’s top-left; verticalAlign is top, middle, or bottom. If the text does not fit at the minimum size, overflow is clip (default), visible, or error. For the fitted style and a fits flag without drawing, use fitText() in prepare() or useFitText() while rendering.

```tsx file=examples/fitted-text.tsx title="fitted-text.tsx"
```
