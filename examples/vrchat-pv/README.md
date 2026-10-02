# OKAERI — VRChat 非公式 PV（プライベートテスト）

68 秒・1920×1080・30 fps。Celesta の React コンポジションで作った、VRChat の非公式ファンメイド PV です。
画面はすべて 120 BPM のグリッド（1 拍 = 15 フレーム、1 小節 = 60 フレーム）で切っています。

> 素材の権利処理はしていません。プライベートなテスト用途に限ります。

## コンセプト

灰色の帰りの電車から始まり、スマホが光ってログインし、もうひとつの「帰る場所」に着く話です。
右上の時計は 22:47 から深夜 2 時まで進み、左上のステータスは
`OFFLINE → ONLINE → JOIN ME → OFFLINE` と切り替わって、ひと晩を描きます。
画面に出す色は VRChat のトラストランク色（New User 青／User 緑／Known User 橙／Trusted User 紫）だけです。

| 時間 | フレーム | シーン |
| --- | --- | --- |
| 0:00–0:08 | 0–240 | 帰りの電車をモノクロで。「今日も、ちゃんと『ふつう』をやった。」スマホが光って画面が白くなる |
| 0:08–0:12 | 240–360 | ログイン。円形マスクの中にポータル、`Joining world: Home`、ワープ |
| 0:12–0:28 | 360–840 | マニフェスト。2 拍ごとに 1 ショット 1 フレーズ（ヒーロー／縦書き／ストリップ／ウィンドウ／タイル） |
| 0:28–0:38 | 840–1140 | アバター選択のカルーセル。「見た目は、じぶんで決める。」→「なりたい自分で、いい。」 |
| 0:38–0:48 | 1140–1440 | ゲーム内カメラ。シャッターのたびにポラロイドが右下に積もる。「ワールドは、ぜんぶ だれかの手づくり。」 |
| 0:48–0:56 | 1440–1680 | 焚き火にネームプレートを浮かべ、最後に自撮り。「ひとりで来ても、帰るときは、ひとりじゃない。」 |
| 0:56–1:00 | 1680–1800 | 1 拍ごとに 8 ワールドを切り替え。「今夜も 世界の どこかで だれかが『ただいま』って 言ってる。おかえり。」 |
| 1:00–1:04 | 1800–1920 | 夕焼けの桟橋で、みんなが順にログアウト。「おやすみ。」「また、あした。」 |
| 1:04–1:08 | 1920–2040 | ロゴ。「あなたの、もうひとつの帰る場所。」 |

## ファイル

- `film.tsx`：本編。Celesta で開くとプレビューできます。
- `make-score.py`：BGM の合成スクリプト（numpy と scipy、乱数シード固定）。王道進行（IV–V–iii–vi）の D メジャー、120 BPM。冒頭はヘッドホン越しのようにこもった音にしています。
- `make-clips.py`：トレーラーから使うショットを 30 fps の短いクリップに切り出し、ポラロイド用の静止画も書き出します。
- `fetch-assets.sh`：第三者の素材（Steam のスクリーンショットとトレーラー、公式サイトの画像とロゴ）を `assets/photos/` と `assets/src/` に取得します。これらは再配布しないので、Git の管理対象外です。
- `assets/fonts/`：Google Fonts（SIL OFL、ライセンス文を同梱）。Dela Gothic One、Zen Kaku Gothic New、Space Grotesk、JetBrains Mono、DotGothic16。
- `assets/clips/`、`assets/score.wav`、`okaeri.mp4`：生成物なので Git の管理対象外です。下の手順で作り直します。

## 再現手順

リポジトリのルートで実行します。必要なものは ffmpeg、Python 3（numpy と scipy）、ビルド済みの exporter と React ランタイムです。

```sh
# 1. 写真とトレーラーを取得する（Steam ストア、hello.vrchat.com）
sh examples/vrchat-pv/fetch-assets.sh

# 2. クリップと BGM を作る
python3 examples/vrchat-pv/make-clips.py
python3 examples/vrchat-pv/make-score.py

# 3. 確認して書き出す
node skills/celesta/scripts/inspect.mjs examples/vrchat-pv/film.tsx --every 30
target/release/celesta-exporter --overwrite --crf 18 \
  --react examples/vrchat-pv/film.tsx examples/vrchat-pv/okaeri.mp4
```

Linux では FFmpeg 8.1 の開発ライブラリが必要です。手元では `./configure --enable-gpl --enable-libx264 --enable-static --disable-shared --enable-pic --disable-programs --disable-autodetect` でビルドし、
`PKG_CONFIG_PATH=<prefix>/lib/pkgconfig cargo build -p celesta-exporter --release` としました。
GPU がない環境では Mesa の lavapipe（`mesa-vulkan-drivers`）で描画でき、速度は 1 fps 前後です。

## 素材の出典

- 映像：Steam ストアの VRChat トレーラー「VRChat: Create, Share, Play」と「VRChat Animated Trailer」
- 静止画：Steam ストアのスクリーンショット（app 438100）、hello.vrchat.com の画像、VRChat ロゴ
- 作中のアバター名、ワールド名、インスタンス情報はすべて架空のものです。
