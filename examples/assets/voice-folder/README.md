# Voice folder assets

Fixtures for `packages/cli/examples/with-voice-folder.tsx`: a folder laid out
the way VOICEROID, A.I.VOICE, or an AquesTalk front end exports speech, one
`name.wav` beside a `name.txt` transcript for each line.

| Path | What | License |
| --- | --- | --- |
| `shizuku/*.txt` | UTF-8 transcripts, the subtitles | Same as this repository (MIT OR Apache-2.0) |
| `shizuku/*.wav` | 16 kHz PCM recordings of the transcripts, made with the macOS "Kyoko" system voice, like `examples/assets/voices/001.wav` | Same as `001.wav` |
| `shizuku/manifest.json` | Line ids, kana `spokenText` for lip sync, and expressions | Same as this repository |
| `generate.sh` | Regenerates the WAVs from the transcripts (macOS only) | Same as this repository |

The names show natural ordering: `voice-10` plays after `voice-2`. The
folder lies outside the example's directory on purpose, to show that the
editor watches it anyway.
