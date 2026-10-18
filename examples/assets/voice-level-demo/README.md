# Voice level demo assets

Assets for `packages/cli/examples/with-voice-level-matching.tsx`, which
matches two voices recorded at different levels with `matchVoiceLevels()` and
ducks BGM and game audio under the speech.

| Path | What | License |
| --- | --- | --- |
| `script.json` | Lines, speakers, and kana readings (for lip sync and voice length) | Same as this repository (MIT OR Apache-2.0) |
| `voices/*.wav` | One synthetic speech-shaped voice per line (generated, not committed) | Same as this repository |
| `bgm.wav`, `game.wav` | A synthetic BGM loop and game-audio bed (generated, not committed) | Same as this repository |

The portraits come from `../dialogue-demo/portraits`.

## Generating

```sh
node packages/cli/scripts/make-voice-level-fixtures.mjs
```

The voices are synthesized (a harmonic buzz per mora, not real speech), with
しずく recorded about 16 dB louder than こむぎ. Each voice's length follows
its `reading`, so after editing `script.json`, run the script again: the
example's timing, gains, and ducking follow the new voices.
