# Keyframed audio in browser export (2026-10-21)

`@celesta/web`'s `exportMp4` plays clips whose `volume` or `playbackRate` is
keyframed, instead of throwing. This is the first step of audio ducking
(#87, `docs/superpowers/specs/2026-10-21-audio-ducking-design.md`).

- `packages/web/src/keyframes.ts` ports `evaluate_f64` / `integrate_f64` from
  `crates/composition/src/animation.rs`, all 34 easings and the Simpson
  integration included. The Rust code is the reference, not `Easings` in
  `@celesta/react`: the keyframe `ease-in-out` is smoothstep, the React one
  quadratic (#460). `crates/composition/tests/fixtures/keyframe-evaluation.json`
  pins both: `keyframe_fixture.rs` checks Rust against it, and
  `keyframes.test.mts` checks the port.
- `automationEvents` turns an animated value into AudioParam calls: one
  ramp per linear segment, a set at a cut, and ramps through points 1 ms
  apart (at most 1024 per segment) along an eased segment. A clip starting
  before context time 0 begins from where its curve has got to.
- `scheduleClip` in `audio-support.ts` builds one clip's graph: rate and
  volume automation (volume clamped to 0–16, as in `mix.rs`), then the
  fades. It starts the source with two arguments and stops it at the
  clip's end on the timeline; `start()`'s third argument is in source
  seconds and was only right for a constant rate.
- Rejected: a rate that would reach 0 or below anywhere (Web Audio would
  play it backwards, the native mixer plays silence), and pitch or
  `preservePitch` with a rate that is not the constant 1.
- Measured in Chromium 152 with `packages/web/test/manual/audio-automation.html`
  (run `pnpm --dir packages/web exec vite` and open it): volume within
  2.1 × 10⁻⁶ of `evaluate_f64` with no step larger than the curve's own;
  playback-rate timing within 1.32 ms, from `playbackRate` being k-rate.
- Known divergence: `integrate_f64` integrates a segment that starts before
  the clip's local 0 as if it started at 0 with the earlier key's value
  (keys `-1 s → 1`, `1 s → 3` give 2 at 1 s, not 2.5). React emits such
  keys when an outer `<Sequence>` clips a clip's head. The port reproduces
  it and the fixture pins it, but Web Audio follows the true curve, so such
  clips play slightly differently in the browser.
- The two new test files are TypeScript under Vitest (#458); the other web
  tests still run under `node --test`, and `pnpm test` runs both.
