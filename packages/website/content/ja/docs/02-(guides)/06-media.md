`Image`、`Video`、`Audio` は `src` からファイルを読み込みます。相対パスはコンポジションのファイルが基準なので、プロジェクト内でメディアを隣に置いてください。

`src` には `http://` または `https://` の URL も指定できます。ネイティブのプレビュー、書き出し、`preloadMedia()` は初回にダウンロードし、ローカルにキャッシュします。以後は更新確認をせずに再利用するため、内容が変わった場合は URL を変更するかキャッシュを削除してください。

```tsx file=examples/media.tsx title="media.tsx"
```

- `Image` と `Video` は自身のピクセルサイズで描画されます。`x` / `y` とアンカーで配置し、`scale` または `Fit` で拡縮します。画像は PNG、JPEG、WebP、GIF、PNM に対応します。
- アニメーション GIF・APNG・アニメーション WebP は、親シーケンスの時計に合わせて各フレームをその表示時間どおりに描き、ループします。`startFrom` と `playbackRate` は `Video` と同じように使えます。`loop={false}` で最後のフレームのまま止まります。`preloadMedia()` は尺を `animation.durationSeconds` で返します。
- `Video` と `Audio` は `startFrom`（ファイル内の開始秒）、`playbackRate`、`volume`、`muted` を取ります。`Video` は動画の音声も鳴らすので、音を聞くために同じファイルの `Audio` を並べる必要はありません。映像だけにするときは `muted` を指定します。
- `Video` と `Audio` に `loop` を指定すると、再生がファイルの終わりに達したところで先頭から繰り返します。`Video` は映像と音声がそろって戻ります。指定しなければ、最後のフレームのまま止まり、音は鳴りやみます。
- `Sequence` 内のメディアはシーケンスの開始と同時に始まり、終了時に止まります。
- `volume` と音声の `playbackRate` には数値またはキーフレームを使えます。時刻は親シーケンスの開始からの秒数で、`{ value, timescale }` の形式です。

frameKeyframes(keys, { fps, origin? }) は、フレーム番号から音量や再生速度のキーフレームを作ります。時刻は Audio を囲む Sequence の時計で (frame - origin) / fps 秒となり、origin の既定値は 0 です。音声のフェードなどに使えます。ブラウザでの書き出しは、固定の音量と再生速度に限られます。

## メディアに合わせてシーンの長さを決める

任意の `prepare()` エクスポートは描画前に一度だけ実行され、`async` にできます。この例は `preloadMedia()` で動画の長さを取得し、`mediaDurationInFrames()` でフレーム数に変換するので、エンドカードが常に映像の直後に来ます。

## 音に合わせて動かす

`loadAudioSpectrum()` は `prepare()` の中で音声ファイル（または動画の音声）をデコードし、全体を解析します。描画中は `useAudioSpectrum()` が現在のフレームの周波数帯と音量を返すので、バーやリング、光を音楽や声に合わせて動かせます。

```tsx file=examples/audio-spectrum.tsx title="audio-spectrum.tsx"
```

- `bands` は低い周波数から高い周波数への各帯の強さで、それぞれ 0〜1 です。帯の強さは FFT のパワーの平均を、フルスケールの正弦波を基準とした dB で表し、`minDecibels`（既定 −80）から `maxDecibels` を 0〜1 に対応させたものです。`maxDecibels` の既定は `'auto'` で、ファイル全体でいちばん大きい帯の強さが上限になるので、どれだけ大きな音量に仕上げたファイルでも 1 に届くのはいちばん大きいところだけです。複数のファイルを同じ尺度で並べたいときなどは、`maxDecibels: -6` のように数値で上限を決められます。`rms` はサンプルの二乗平均平方根で、フルスケールの正弦波ではおよそ 0.707 になります。
- `fftSize` は 1 回の FFT のサンプル数（2 の累乗、既定 2048）です。`bands` は帯の数（既定 32）、`scale` は `minFrequency`（20 Hz）から `maxFrequency`（16 kHz）までの分け方です。`'log'`（既定）は 1 オクターブごとに同じ数の帯、`'linear'` は Hz で同じ幅、`'mel'` は聴感上の音の高さに沿って分けます。
- `smoothing` は秒数、または立ち上がりと立ち下がりを分けた `{ attack, release }` で指定します。その時間がたつと、値は変化のおよそ 63% まで進みます。既定の 0 では平滑化しません。
- ファイルは `hopSeconds`（既定 1/240 秒）ごとに先頭から順に一度だけ解析されます。窓はハン窓で、各時刻を中心に置きます。2 回の解析の間にあるフレームは、その間を補間します。そのため、フレームの値は fps にも描画の順序にもよらず、プレビューと書き出しで同じになります。
- hook は `Audio` と同じく、囲んでいる `Sequence` の時計に従います。`Audio` に `startFrom` があるときは同じ値を `startFrom` に渡してください。`playbackRate` には追従しません。ファイルの前後では、すべての値が 0 です。
- `spectrumAt(spectrum, seconds)` はコンポーネントの外で同じ値を返し、`analyzeAudioSpectrum({ sampleRate, samples }, options)` は手元のサンプルを解析します。
- 複数のチャンネルは平均し、ファイル本来のサンプルレートのまま解析します。相対パスと URL は `preloadMedia()` と同じように解決されます。
