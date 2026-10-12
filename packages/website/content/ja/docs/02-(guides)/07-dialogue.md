台詞のシーンは 3 つのコンポーネントで構成され、React と JSON の両方で使えます。

- **キャラクター**は表情ごとの画像やレイヤー付き PSD の立ち絵、任意の口パク用の口、字幕の見た目を定義します。
- **キャラクタービュー**は立ち絵を画面に配置します。
- **台詞**は字幕を表示し、音声を再生し、表示中のビューの表情や口を変更できます。

## React で最初の会話を作る

以下のファイルの隣に、立ち絵 2 枚と音声 2 本を保存します。

```tsx file=examples/dialogue.tsx title="dialogue.tsx"
```

1. **キャラクターを宣言**する場所は `<Assets>` の内側です。ref を通じてビューから参照します。`subtitle` は `Text` と同じ位置・スタイルを取ります。
2. `<CharacterView>` で**ビューを配置**します。台詞が指定しない間は `defaultExpression` を表示します。ほかのレイヤーと同じく `x`、`y`、`scale`、アンカーを取ります。
3. `<Dialogue>` を `Sequence` で囲み、**各台詞の時間を指定**します。有効な間だけ字幕、音声、`expression` が適用され、その後ビューは既定の状態に戻ります。

> [!NOTE]
> **ひとつのビューに複数の台詞**
> `Dialogue` はキャラクターではなくビューを指すので、台詞を変えても同じ立ち絵が同じ場所に残ります。2 人の会話には、2 つ目の `Character` とビューを追加します。

`Audio` と同様に `volume`、`startFrom`、`playbackRate`、`muted` で台詞を調整します。`Dialogue` の `x`、`y`、`opacity` は字幕を移動・フェードさせ、`Transition` の中で便利です。

`Dialogue` の子の中で `<Span>` を使うと、台詞の一部を強調できます。`subtitle.render` には書いたままの台詞が `content` として渡されるので、`<Text style={style}>{content}</Text>` と描けば強調が保たれます。`text` は同じ台詞のただの文字列です。

## 自動の口パク

`loadLipSync()` は音声を分析し、発話区間に文字起こしの母音を配分して、各時点の口の形（`a`、`i`、`u`、`e`、`o`、`closed`）を生成します。`prepare()` から呼び出し、`Dialogue` または `CharacterView` に `lipSync` として渡します。

```tsx file=examples/lip-sync.tsx title="lip-sync.tsx"
```

- **音声**は非圧縮 WAV が必要です。母音を読めるよう、文字起こしはかなまたはローマ字で書いてください。漢字はスキップされます。
- **PSD の立ち絵**は `face/mouth/a` のようなパスで口のレイヤーを指定します。立ち絵ファイルは全フォルダが非表示のことが多いので、`layers` にレイヤーパス配列、PSDTool の状態文字列、または `loadPsdPreset()` で読み込んだ `.pfv` のお気に入りを指定して表示レイヤーを選びます。
- **画像の立ち絵**も口パクできます。`portrait.lipSync` に、形ごとに立ち絵と同じサイズの透明な口画像を指定します。こうすると重ねたときに位置が揃います。
- 手動で口を動かすには、`CharacterView` または `Dialogue` に `mouth="a"`（または別の形）を渡します。`useLipSync(track)` で現在の形を取得し、別の場所で使えます。

## 会話を自動で並べる

prepare() で planDialogue(lines, { fps, gap, sceneLeadIn }) を呼ぶと、音声の長さを測って台詞を順に並べます。durationInFrames を指定した台詞は計測しません。gap と leadIn は秒、durationInFrames はフレーム単位です。各台詞には audio または正の durationInFrames が必要です。Composition の長さを plan から設定し、DialogueSeries の views で話者名と表示先を対応付けます。演出のタイミングには plan の line()、startOf()、range()、scene() を使えます。

```tsx file=examples/dialogue-series.tsx title="dialogue-series.tsx"
```

holdThroughGap は、台詞の後の間も字幕と表情を保持します。holdSubtitle は、subtitle.render で描く字幕の背景を台詞の間も表示し、held でその状態を判別できます。subtitle.render には text、character（displayName を含む）、metrics、style、maxWidth、frame、durationInFrames が渡されるので、文字の大きさに合う字幕パネルを作れます。全体の例はリポジトリの with-dialogue-series.tsx を参照してください。

VOICEVOX で生成した音声には、WAV からタイミングを推測する代わりに、合成に使った AudioQuery と [@celesta/voicevox](/ja/docs/voicevox/) を利用できます。

## 実際の素材で確認

`packages/cli/examples/with-dialogue-series.tsx` は音声の長さに合わせた会話、`packages/cli/examples/with-lip-sync.tsx` は PSD 立ち絵の口パクを示すサンプルです。[GitHub](https://github.com/mika-f/Celesta) の **Code → Download ZIP** からソースを取得し、素材を含むアーカイブ全体を展開して、**File → Open…** で開いてください。ソースからのビルドは不要です。
