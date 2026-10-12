> [!NOTE]
> **非推奨**
> JSON プロジェクトは非推奨です。新規制作は React コンポジションを使ってください。この章は既存の `.celesta.json` プロジェクト向けに残しています。

`.celesta.json` は、既存プロジェクトの設定、素材、キャラクター、トラック、プロパティを定義する形式です。互換性のために読み込み機能は残っていますが、新しく作る場合は React コンポジションを使ってください。

- `settings` はサイズ、フレームレート、音声のサンプルレート、任意の長さを定義します。
- `assets` は `video`、`audio`、`image`、`font` の素材を ID で登録します。ローカルファイルと HTTP(S) の URL を指定でき、リモートのファイルはネイティブの素材キャッシュを使います。
- `tracks` は映像・音声・オーバーレイ・台詞のトラックと、その項目を持ちます。
- 各項目は開始と長さを持つ `range`、内容、任意の `transform`、`opacity`、`blendMode` を持ちます。

時刻は `{ value, timescale }` で表し、値を timescale で割ると秒数になります。たとえば `{ "value": 10, "timescale": 1 }` は 10 秒です。

以下をプロジェクト内の `project.celesta.json` にコピーし、**File → Open…** で開きます。

内蔵のタイトルプロジェクト全体を見る

```json file=../../examples/editor-demo.celesta.json title="examples/editor-demo.celesta.json"
```

`examples/minimal.celesta.json` は空のひな形です。表示を確認するには上のタイトルプロジェクトからはじめ、テキストを変えて保存します。**File → Reload** でプレビューを更新します。

```sh title="既存の JSON プロジェクトを書き出す"
celesta-exporter project.celesta.json output.mp4
```

## キーフレームで動かす

JSON の変換では `position` が項目の中心を配置します。変換の各値、`opacity`、音声の `volume` は固定値またはキーフレームです。時刻は項目の開始を基準にし、`easing` がそのキーフレームへ向かう曲線を定めます。

```json title="0.5 秒かけてフェードイン"
"opacity": {
  "type": "keyframes",
  "keyframes": [
    { "time": { "value": 0, "timescale": 30 }, "value": 0 },
    { "time": { "value": 15, "timescale": 30 }, "value": 1, "easing": "ease-out" }
  ]
}
```

イージング名は React の `Easings` を kebab-case にしたもので、`ease-in-out-cubic` や `ease-out-back` などです。

## JSON プロジェクトの台詞

JSON は `characters` にキャラクターを、`dialogue` トラックの項目に台詞を宣言します。立ち絵と字幕の変換は中心を配置します。

JSON の台詞プロジェクト全体を見る

```json file=examples/dialogue.celesta.json title="dialogue.celesta.json"
```

JSON の台詞にも口パクを付けられます。立ち絵の `lipSync` に口画像の素材 ID を追加し、台詞に `"lipSync": [{ "time": { "value": 0, "timescale": 30 }, "shape": "a" }]` のような時間付きの形を並べます。時刻は台詞の開始が基準です。音声から自動で時間を生成するには React の `loadLipSync()` を使います。

## プロジェクトと React を組み合わせる

React コンポジションには `<ProjectTimeline />` を含められます。書き出し時に対応する JSON プロジェクトを渡して、タイムラインを解決します。

```sh title="React と関連する JSON プロジェクトを書き出す"
celesta-exporter --react with-project.tsx --project project.celesta.json output.mp4
```

対応する React コンポジション全体を見る

```tsx file=../cli/examples/with-project.tsx title="with-project.tsx"
```

このコードを JSON と同じフォルダに `with-project.tsx` として保存してください。上のコマンドは celesta-exporter に PATH が通っている場合の例です。インストール先の実行ファイルのパスは[動画を書き出す](/ja/docs/export/)を参照してください。ひとつのトラックだけを描く場合は `<ProjectTrack id="…" />` を使います。
