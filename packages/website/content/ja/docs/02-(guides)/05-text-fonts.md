## テキスト

`Text` の子は文字列、数値、`<Span>` 要素です。`style` で装飾します。

```tsx title="輪郭付きで折り返すキャプション"
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

- `fontFamily` はインストール済み、または `<Font>` で読み込んだフォントのファミリー名です。指定した `fontWeight` がなければ、CSS と同様に最も近いウェイトを使います。絵文字など不足する文字は別のインストール済みフォントにフォールバックします。JSON プロジェクトでは `font` 素材として同梱することもできます。
- `lang` は `fontFamily` が省略された場合や文字が不足する場合のフォールバック言語を選びます。全体には `<Composition lang="ja-JP">` を設定します。子は `lang` を持つ最も近い `Composition`、`Group`、`Sequence` を継承します。字幕、タイムラインのテキスト、`useTextMetrics()`、`useFitText()`、コンポーネントのプレビューにも適用されます。フレームごとに変更でき、計測と描画は同じ言語を使います。`<Text lang="zh-Hant">` は祖先より優先し、明示的な `style.lang` はさらに優先します。空の `lang` はシステムのロケールを選びます。`ja-JP`、`ko-KR`、`zh-Hans`、`zh-Hant`、`zh-Hant-HK` などに対応します。未設定時はシステムのロケールを使い、使用可能な文字はフォントによって決まります。Canvas の言語選択に対応したブラウザでは `lang` を適用します。

```tsx title="日本語を既定にして中国語のグループを配置"
<Composition width={1920} height={1080} fps={30} durationInFrames={90} lang="ja-JP">
  <Text>漢字とかな</Text>
  <Group lang="zh-Hant">
    <Text y={80}>繁體中文</Text>
    <Text y={160} lang="ko-KR">한국어</Text>
  </Group>
</Composition>
```

`prepare()` は `<Composition>` が描画される前に実行されます。計測時の言語は `measureText()` に `lang` として明示してください。例：`measureText('漢字とかな', { lang: 'ja-JP' })`。

未インストールのフォントファイルは `<Font>` で宣言します。相対パスの `src` はエントリーファイルのフォルダから解決され、`fontFamily` はファイル名ではなく内部のファミリー名を使います。TrueType、OpenType、WOFF、WOFF2 に対応し、`src` は `http://` / `https://` の URL でも構いません。

```tsx title="エントリーの隣のフォントを読み込む"
<Composition width={1920} height={1080} fps={30} durationInFrames={90}>
  <Assets>
    <Font src="./fonts/MPLUSRounded1c-Bold.ttf" />
  </Assets>
  <Text style={{ fontFamily: 'M PLUS Rounded 1c', fontWeight: 700, fontSize: 96 }}>
    Hello
  </Text>
</Composition>
```

`src` には Google Fonts の CSS リンクなど、ウェブフォントのスタイルシートも指定できます。`@font-face` にある全ファイルを読み込み、`fontFamily` でファミリー名を使えます。リンクに必要なウェイトをすべて含めてください。不足する場合は提供された最も近いウェイトで描画します。

```tsx title="Google Fonts のファミリーを読み込む"
<Assets>
  <Font src="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;700" />
</Assets>
<Text style={{ fontFamily: 'M PLUS Rounded 1c', fontWeight: 700, fontSize: 96 }}>
  こんにちは
</Text>
```

## 欧文と和文で書体を分ける（和欧混植）

`fontFamily` には書体名の並び（font stack）も指定できます。各文字は、並びの先頭から順に見て、その文字を持つ最初の書体で描かれます。英数字は欧文書体、かなと漢字は和文書体、という組み方ができます。文字と、それに付く結合文字や異体字セレクターは、常に同じ書体で描かれます。

```tsx title="一行の中で欧文書体と和文書体を使い分ける"
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

インストールも読み込みもされていない書体は飛ばします。基準線は、並びのうち使える最初の書体が決めます。そのため、和文を含む行と含まない行で行間が変わりません。並びのどの書体にもない文字は、`lang` に応じて選ばれる OS の書体にフォールバックします。`<Font>` で読み込んだ書体はフォールバック先には選ばれないので、並びに加えてください。計測と折り返しも並びに従います。`<Code>` にも並びを指定できます（`style={{ fontFamily: ['JetBrains Mono', 'Noto Sans JP'] }}`）。`<Span style={{ fontFamily }}>` も並びを受け付けます。書き出し時は、並びのどの書体もないときと、並びのどの書体にもない文字があるときに警告します。ブラウザーのプレビューは並びを CSS の font-family としてブラウザーに渡します。そのため、並びのどの書体にもない文字は、書き出しと見た目が変わることがあります。

- `maxWidth` は単語の境界で折り返し、`align` はその幅の中に各行を配置します。文字列に `\n` を入れると任意の位置で改行できます。
- 日本語は通常、多くの文字の間で折り返すため「フレーム」のような単語も分かれます。禁則処理により「、」「。」などは行頭に来ません。スタイルに `lineBreak: 'phrase'` を指定すると、[BudouX](https://github.com/google/budoux) の日本語モデルで検出した句の境界だけで折り返します。`lang` は現在フォールバックフォントの選択だけに使われます。句が `maxWidth` より長い場合は通常どおり内部で折り返します。ブラウザのプレビューは `lineBreak` を無視し、空白でのみ折り返します。
- 単一行のテキストは見える字形を縦方向の基準にするので、`anchorY={0.5}` は見えない行ボックスではなく文字自体を中央に置きます。幅は送り幅なので、前後の空白も幅を持ちます。改行や maxWidth での折り返しで複数行になったテキストは、measureText と同じ行ボックスを基準にします。
- `anchorY="baseline"` は最初の行のベースラインをアンカーにします。同じ `y` を持つテキストは、文字やサイズによらずベースラインが揃います。

## 文章の一部を強調する

`<Span>` は文章の一部の `fill`、`fontWeight`、`fontFamily` を変えます。文章全体は一つの段落として組まれたままで、折り返し・揃え・計測も一つの段落として行われ、基準線は文章自身の文字が決める位置から動きません。Span は入れ子にでき、書体にないウェイトは最も近いウェイトで描かれます。

```tsx title="一つの段落の中で一語を強調する"
<Text style={{ fontSize: 48, fill: { type: 'solid', color: '#ffffff' } }}>
  速い、<Span style={{ fill: '#28A34A', fontWeight: 700 }}>カンタン</Span>、頼もしい。
</Text>
```

Span は `<Text>`、`<TextBox>`、`<TextReveal>`、`<Dialogue>`、`DialogueSeries` の台詞と、`useTextMetrics()`、`measureText()`、`useFitText()`、`fitText()`、`useTypewriter()` で使えます。打鍵の長さを `visibleCharacters` に渡すと、組版を変えずに装飾付きの文章を打鍵表示できます。Span を返すコンポーネントは文章の中では使えません。日本語・中国語・韓国語の文章で Span を使うときは `lang` を指定してください。Span は shaping を分割するため、言語の指定がないと、Span の隣の文字が別の書体で描かれる場合があります。ブラウザーのプレビューは Span ごとにその書体で描くため、Span の境目で書き出し結果とわずかに異なる場合があります。

## 文字を測る・枠に収める

デスクトップアプリと CLI では、prepare() 内で非同期の measureText(text, style, options)、描画中に useTextMetrics(text, style, options) を使えます。どちらも Text と同じ組版で、幅、高さ、行数、ベースライン、文字ごとの位置を返します。折り返す幅は maxWidth で指定します。prepare() の時点では Font がまだ読み込まれていないため、options.fonts にフォントファイルを指定してください。フックは現在の言語設定と Font の宣言を引き継ぎます。

デスクトップアプリと CLI で利用できます。TextBox は、width、height、必要に応じて maxLines に収まるよう、minFontSize から maxFontSize の範囲で文字サイズを選びます。x/y は枠の左上、verticalAlign は top、middle、bottom です。最小サイズでも収まらない場合の overflow は clip（既定）、visible、error から選べます。描画せずに調整後のスタイルと fits を得るには、prepare() で fitText()、描画中に useFitText() を使います。

```tsx file=examples/fitted-text.tsx title="fitted-text.tsx"
```
