# Seamless loops (2026-10-12)

The Skill explains how to make a video whose last frame runs into its first,
and how to check it (issue #229).

- Guide: `skills/celesta/references/loops.md`, linked from `SKILL.md`,
  `animation.md`, `math.md`, and `verify.md`.
- `@celesta/math` adds `loopNoise(seed, t, period)` and `loopFbm`
  (`packages/math/src/noise.ts`). `loopNoise` is `noise`'s value noise with
  `max(2, round(period))` lattice steps around the period, indices wrapped,
  so it has `noise`'s range and pace; with a whole-number period it equals
  `noise` until the last unit. `loopFbm` runs each octave on the same period.
- `inspect.mjs --loop` evaluates frames N and N + 1 (N = `durationInFrames`)
  and compares their Scenes with frames 0 and 1. Scene `time` and layer
  `id`s are skipped; numbers may differ by one part in a million and hex
  colors by one step per channel. Audio is not compared.
- Frames past the end need runtime support: a frame request may carry
  `openEnd: true` (`packages/cli/src/cli.ts`), and the response echoes it so
  inspect.mjs can refuse an older runtime. `renderAt(time, project,
  { openEnd })` puts `openEnd` on the root `CompositionRuntimeContext` and
  `WalkContext`. Then a `<Sequence>` whose own window ends with the
  composition (`endsWithComposition`, `time.ts`, within half a frame) stays
  open; one that ends later keeps its own end, so the second copy of an event
  carried across the seam does not linger. `Sequence` (`components.ts`) and
  `childSequenceContext` (`render.ts`) must decide alike: the walker tracks
  the unclipped, unextended window end as `WalkContext.windowEndSec`, which
  is what `<Sequence>` computes from its parent's `durationInFrames`. A window
  with an explicit duration ending exactly at the end also stays open, as it
  cannot be told apart from the last `Series` scene. `durationInFrames` in
  `useVideoConfig()` is unchanged, so loop math sees the real length. Inside
  a `<FreezeFrame>`, `openEnd` is false.
- `--loop --native`: the exporter's `--inspect` (`crates/exporter/src/inspect.rs`)
  accepts `openEnd` on a request and calls `ReactBridge::evaluate_past_end`,
  which sends the flag and fails with `ReactBridgeError::OpenEndUnsupported`
  (a non-fatal `requestError`) when the runtime sends no echo. Preview and
  export never send it.
- Tests: `packages/math/test/math.test.mjs`,
  `packages/react/test/sequence.test.mjs`, `packages/cli/test/open-end.test.mjs`,
  `crates/react-bridge/src/tests.rs`, `crates/exporter/tests/inspect_integration.rs`.
