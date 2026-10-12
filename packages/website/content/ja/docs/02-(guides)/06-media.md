`Image`、`Video`、`Audio` は `src` からファイルを読み込みます。相対パスはコンポジションのファイルが基準なので、プロジェクト内でメディアを隣に置いてください。

`src` には `http://` または `https://` の URL も指定できます。ネイティブのプレビュー、書き出し、`preloadMedia()` は初回にダウンロードし、ローカルにキャッシュします。以後は更新確認をせずに再利用するため、内容が変わった場合は URL を変更するかキャッシュを削除してください。

```tsx file=examples/media.tsx title="media.tsx"
```

- `Image` と `Video` は自身のピクセルサイズで描画されます。`x` / `y` とアンカーで配置し、`scale` または `Fit` で拡縮します。画像は PNG、JPEG、WebP、PNM に対応します。
- `Video` と `Audio` は `startFrom`（ファイル内の開始秒）と `playbackRate` を取ります。`Audio` は `volume` と `muted` も取ります。
- `Sequence` 内のメディアはシーケンスの開始と同時に始まり、終了時に止まります。
- `volume` と音声の `playbackRate` には数値またはキーフレームを使えます。時刻は親シーケンスの開始からの秒数で、`{ value, timescale }` の形式です。

frameKeyframes(keys, { fps, origin? }) は、フレーム番号から音量や再生速度のキーフレームを作ります。時刻は Audio を囲む Sequence の時計で (frame - origin) / fps 秒となり、origin の既定値は 0 です。音声のフェードなどに使えます。ブラウザでの書き出しは、固定の音量と再生速度に限られます。

## メディアに合わせてシーンの長さを決める

任意の `prepare()` エクスポートは描画前に一度だけ実行され、`async` にできます。この例は `preloadMedia()` で動画の長さを取得し、`mediaDurationInFrames()` でフレーム数に変換するので、エンドカードが常に映像の直後に来ます。
