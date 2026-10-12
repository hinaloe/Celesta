`@celesta/voicevox` converts the AudioQuery used by VOICEVOX synthesis into a LipSyncTrack. Dialogue components, WAV-based lip sync, and LipSyncTrack are in `@celesta/character`. Import the adapter from its own package; @celesta/character does not re-export it.

The desktop app and CLI bundle this package separately. Building the runtime builds it too, and File → Set Up TypeScript includes its declarations and import mapping. It is private and is not published to npm. The browser playground does not support it.

## Drive a dialogue line from its synthesis query

Use the exact AudioQuery that produced the WAV, including speed and pause settings. Pass the track to Dialogue or CharacterView as lipSync, or read it with useLipSync(). It does not synthesize audio or call a VOICEVOX server. Save that AudioQuery as voicevox-query.json beside voicevox.tsx, and use your own voice and mouth images in the example below.

```tsx file=examples/voicevox.tsx title="voicevox.tsx"
```

**@celesta/voicevox**

| API | Use it for |
| --- | --- |
| `lipSyncFromVoicevox(query, options?)` | Convert an AudioQuery into a LipSyncTrack, with time zero at the start of the WAV, including leading silence. |
| `voicevoxVowelShape(vowel)` | Map a phoneme to a/i/u/e/o/closed. Uppercase devoiced vowels keep their shape; N, cl, pau, sil, and unknown values map to closed. |

**Timing options**

| API | Use it for |
| --- | --- |
| `frameRate` | Defaults to 93.75 Hz, the VOICEVOX phoneme frame grid. Set null for unrounded lengths or the engine’s own rate; this is not the composition’s fps. |
| `interrogativeUpspeak` | Defaults to true. Set false when the WAV was synthesized with interrogative upspeak disabled. |

Exports also include VoicevoxAudioQuery, VoicevoxAccentPhrase, VoicevoxMora, and VoicevoxLipSyncOptions. LipSyncTrack is imported from @celesta/character.
