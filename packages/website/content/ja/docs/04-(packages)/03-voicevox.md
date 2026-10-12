`@celesta/voicevox` は、VOICEVOX の音声合成に使った AudioQuery を LipSyncTrack に変換します。会話のコンポーネント、WAV から作る口パク、LipSyncTrack は `@celesta/character` にあります。変換機能は独立したパッケージから読み込んでください。@celesta/character からは再エクスポートされません。

デスクトップアプリと CLI に同梱されています。ランタイムのビルド時にこのパッケージもビルドされ、File → Set Up TypeScript で型定義と読み込み設定が追加されます。非公開パッケージのため npm では配布していません。ブラウザのプレイグラウンドには対応していません。

## 音声合成の情報に合わせて口を動かす

WAV の生成に使った AudioQuery を、速度や間の設定も含めてそのまま使ってください。トラックは Dialogue や CharacterView の lipSync に渡すか、useLipSync() で読み取れます。このパッケージ自体は音声を合成せず、VOICEVOX サーバへの通信も行いません。 AudioQuery を voicevox.tsx と同じフォルダに voicevox-query.json として保存し、以下の例の音声と口の画像は手元の素材に置き換えてください。

```tsx file=examples/voicevox.tsx title="voicevox.tsx"
```

**@celesta/voicevox**

| API | 用途 |
| --- | --- |
| `lipSyncFromVoicevox(query, options?)` | AudioQuery を LipSyncTrack に変換します。先頭の無音も含め、WAV の開始時点が 0 秒です。 |
| `voicevoxVowelShape(vowel)` | 音素を a/i/u/e/o/closed に対応付けます。大文字の無声化した母音も同じ形になり、N、cl、pau、sil、未知の値は closed になります。 |

**タイミングの設定**

| API | 用途 |
| --- | --- |
| `frameRate` | 既定は VOICEVOX の音素の時間刻みである 93.75 Hz です。丸めない場合は null、別のエンジンではその時間刻みを指定します。動画の fps とは別の設定です。 |
| `interrogativeUpspeak` | 既定は true です。疑問文の語尾上げを無効にして音声を合成した場合は false を指定してください。 |

VoicevoxAudioQuery、VoicevoxAccentPhrase、VoicevoxMora、VoicevoxLipSyncOptions もエクスポートされます。LipSyncTrack は @celesta/character から読み込みます。
