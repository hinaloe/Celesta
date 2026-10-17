# Expression cues within a dialogue line (#239)

```ts
const timing = timingFromVoicevox(query);
{ id: 'psd-2', speaker: 'kiritan', audio: './voices/psd-2.wav', text: '…',
  lipSync: lipSyncFromVoicevox(timing),
  expression: [{ at: 0, expression: 'smile' }, { at: timing.pauses[0].start, expression: 'smug' }] }
```

`DialogueLine.expression` and `<Dialogue expression>` take a name, as
before, or `ExpressionCue[]` (`{ at, expression }`, `at` in seconds from
the start of the line). `<Dialogue>` resolves the cues itself from
`useCurrentTime()`, the clock its `lipSync` reads, and hands the host
element a plain name, so render.ts and the view override are unchanged.
Before the first cue the view's own expression shows; the last cue holds to
the end of the `<Dialogue>`'s sequence, which under `holdThroughGap`
includes the gap. Held subtitle lines (`holdSubtitle`) still carry no
expression. Cues must have finite `at` >= 0 and be in order (ties allowed,
the later wins); otherwise `expressionAt()` throws naming the cue.

`expressionAt(expression, seconds)` is the same lookup, exported for parts
that follow the face (a panel, an effect). There is no new VOICEVOX helper:
the clause boundary #239 asked for is `timing.pauses[i].start`, which #226's
`timingFromVoicevox()` (and `timingFromAivisSpeech()`) already return.

`examples/shorts-explainer` now passes its per-clause faces as cues and lets
`<DialogueSeries holdThroughGap>` drive the portrait; `Stage` no longer sets
`expression`, and `faceAt()` (for the 04 panel) wraps `expressionAt()`.
The one visible change: in a scene's 0.3 s lead-in the previous speaker now
shows the portrait's own face instead of keeping the last line's, as
`DialogueSeries` does everywhere else.

Not covered: `.celesta.json` dialogue items still take one `expression`.

## Verification

- `@celesta/character` tests: cues before/at/after each boundary through
  `<DialogueSeries>` with and without `holdThroughGap`, a hand-placed
  `<Dialogue>` counting from its own `<Sequence>`, and `expressionAt()`
  lookups and errors. `pnpm run test:runtime` and `typecheck:examples` pass;
  shorts-explainer type-checks against the staged project types.
- shorts-explainer exported with the source-built exporter, voices from the
  VOICEVOX Engine 0.25.2 Docker image: the psd-2 face switches between frames
  883 and 884 (pause at 1.2373 s). Frames inside lines and gaps (860, 883,
  884, 944) are byte-identical to the previous `faceAt()` + `Stage` version;
  lead-in frames 428, 950, and 1170 differ by 725, 5, and 5 pixels.
