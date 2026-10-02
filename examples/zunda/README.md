# 動画はコードで書くのだ

ずんだもんと四国めたんが Celesta を紹介する、約 2 分の解説動画です。
真っ黒な `<Composition>` から始まり、二人が話すたびに、この動画自身にレイヤーが 1 枚ずつ増えていきます。

- `film.tsx` — Celesta の File → Open… で開く React ソース。映像はこの 1 ファイル。
- `script.ts` — 台本。話者・表情・VOICEVOX のスタイル・読みを 1 行ずつ書く。
- `make-voices.ts` — 台本を VOICEVOX Engine で読み上げ、`voices/*.wav` と `voices.json`（読みがなと長さ）を作る。
- `voices.json` — 生成済みの読みがなと長さ。`film.tsx` はここから全シーンのタイミングを計算する。
- `prepare-assets.ts` — 立ち絵と映像素材を取得して `assets/` に置く（素材はリポジトリに含めない）。
- `make-score.py` — BGM を生成する Python スクリプト。標準ライブラリのみ。

台本を直したら `make-voices.ts` を実行し直すだけで、字幕・口パク・シーンの切り替えが新しい音声の長さに追従します。

## 構成

| 時間 | シーン | 内容 | 主な機能 |
| --- | --- | --- | --- |
| 0:00 | 真っ暗 | 空のコンポジションのコードが打ち込まれ、左上のコードパネルになる | `Sequence`、`interpolate` |
| 0:08 | レイヤーを重ねる | 台詞に合わせて背景が `Rect` → グラデーション → 写真と育つ | `Rect`、線形グラデーション、`Image fit="cover"`、`Camera` |
| 0:31 | エフェクト | タイトルが光り、影が付き、背景がぼける。コードの数値も同時に動く | `glow`・`shadow`・`blur`、`spring` |
| 0:41 | Path で描く | ずんだ餅とえだまめが一筆書きで描かれる | `Path`、`Polyline progress`、`pointOnPolyline` |
| 0:51 | 動画とタイムライン | クリップがトラックに落ち、実写の映像が流れる | `Video`、下帯コンポーネント |
| 1:01 | 声と口パク | ずんだもんの口元に寄り、いまの母音と波形、PSD レイヤー名を表示。表情も次々に切り替わる | `loadLipSync`、`decodeWav`・`buildEnvelope`、PSD 立ち絵、`Camera` |
| 1:20 | フレームは関数 | 過去のシーン 4 つをサムネイルとしてその場で描き直し、前後にスクラブする | `Sequence from` のずらし |
| 1:31 | AI エージェント | この動画を作ったエージェントの作業ログ | |
| 1:53 | おわり | ロゴ、コピー、クレジット | `TextReveal` |

## 本物と演出

- **実際の機能**：VOICEVOX の音声を `Dialogue` で再生し、口の形は `prepare()` 内の `loadLipSync()` が音声と読みがなから作っています。
  立ち絵は公式 PSD をそのまま `Character` の `portrait: { type: 'psd' }` で使い、表情は PSD の表情フォルダ、まばたきは目のレイヤーの切り替えです。
  声のシーンの波形は WAV から読んだ実データです。「フレームは関数」のサムネイルは、録画ではなく過去のシーンのコンポーネントを
  `<Sequence from={現在 - 過去のフレーム}>` で再マウントし、その場で描き直しています。
  タイムラインのシーンのモニターに流れるのは実際の `<Video>` です。
- **演出**：コードパネルの内容は各シーンで実際に使っている API を要約したもので、`film.tsx` の行そのままではありません。
  タイムラインのトラック表示とエージェントのログは機能を説明するための描画です。ログの数字（台本の行数、フレーム数）は
  `script.ts` と `film.tsx` から計算しています。

## 再生成

WAV・MP4 と `assets/` はリポジトリに含めません。クローン後、リポジトリのルートから次の順に実行します。

```sh
node examples/zunda/prepare-assets.ts        # 立ち絵（PSD を縮小して保存）と映像素材。ffmpeg コマンドが必要
docker run -d -p 50021:50021 voicevox/voicevox_engine:cpu-ubuntu20.04-latest
node examples/zunda/make-voices.ts           # 音声 28 本と voices.json
python3 examples/zunda/make-score.py         # BGM
node skills/celesta/scripts/inspect.mjs examples/zunda/film.tsx --every 30
Celesta-export --react examples/zunda/film.tsx zunda.mp4
```

ソースから実行する場合は `Celesta-export` を `cargo run -p celesta-exporter --release --` に置き換えます。
`make-voices.ts` は台本の文とスタイルが変わった行だけを作り直します。Engine の場所は `VOICEVOX_URL` で変えられます。

公式 PSD は 4832 × 9488 ピクセルあり、口の形とまばたきの組み合わせごとにラスタライズされるため、
`prepare-assets.ts` がレイヤーごとに 1/4（めたんは 1/5）に縮小した PSD を書き出します。

`glow`・`shadow`・`blur` は GPU のない環境（ソフトウェアレンダラー）では重く、書き出しに時間がかかります。

## 素材とクレジット

- 音声：VOICEVOX:ずんだもん、VOICEVOX:四国めたん
- 立ち絵：[東北ずん子・ずんだもんプロジェクト 公式イラスト](https://zunko.jp/con_illust.html)（ずんだもん `zunmon008.psd`、四国めたん `met_s214`・`met_s215`・`met_s219`・`met_s220`）。
  [キャラクター利用ガイドライン](https://zunko.jp/guideline.html)に従い、非商用で使用しています。
- 映像素材：[Mixkit](https://mixkit.co/)（[Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree)）。写真として使う静止画も同じ映像から切り出しています。
- フォント：M PLUS Rounded 1c、Dela Gothic One、JetBrains Mono（いずれも SIL Open Font License、Google Fonts から配信）
- BGM・映像：このリポジトリのためのオリジナルの手続き的制作です。
