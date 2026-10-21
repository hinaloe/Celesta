# Audio ducking (2026-10-21)

A clip in a duck group makes the clips that duck under that group dip while
it plays (issue #87). Design: `docs/superpowers/specs/2026-10-21-audio-ducking-design.md`.

- **Authoring.** `<Audio>` and `<Video>` take `duckGroup` and `duck`
  (`under`, `to`, `attack`, `release`, `holdGap`); project `audio` and
  `video` items take the same, with times. Dialogue voices are in `"voice"`
  unless `duckGroup` says otherwise (`null` for none), and never take a
  `duck`.
- **One resolution, one curve.** `AudioDuck::resolve` in
  `crates/composition/src/duck.rs` applies the defaults (0.3, 0.15 s,
  0.4 s, 0.6 s), converts `{ db }`, and checks the rules for the evaluator,
  project validation, the bridge, and the exporter. `duck_curve` builds the
  keyframes: runs joined across silences shorter than
  `max(holdGap, attack + release)`, an `ease-in-out` dip reaching `to` as
  each run starts. `@celesta/media-utils/duck` (`resolveDuck`,
  `duckEnvelope`) is the TypeScript port; `tests/fixtures/duck-curves.json`
  pins both.
- **Where a voice is.** A marked clip counts from its range start to its
  range end, or earlier where its source runs out unless it loops
  (`audible_end` in `crates/media`, `audibleEnd` in `@celesta/web`). Muted
  clips do not count; a clip never counts toward its own curve; groups do
  not chain.
- **Mixing.** The native mixer decodes every source first, then multiplies
  each ducked clip by its curve, per sample, on both paths, following the
  curve with `KeyframeCursor` so long curves stay cheap. Clips without
  `duck` mix bit-identically. The editor's level envelope uses
  `duck_curves_for`. Browser export builds the same curves and plays each
  on a gain after the fades.
- **React** passes `duckGroup` / `duck` through after checking they are
  finite and well-shaped: JSON would turn `NaN` into `null` and a default.
  The bridge resolves them; an invalid value fails with the clip's `src`
  and the field.
- **Plan-based helper.** `speechIntervals(plan, { levels? })` and
  `duckingVolume(plan, duck, { levels?, origin? })` in `@celesta/character`
  build the curve as keyframes in `prepare()`, trimmed to the speech a
  `matchVoiceLevels()` report found. `with-voice-level-matching.tsx` uses
  them; `examples/feature-tour` uses `<Audio duck>`.
- **Not done:** realtime sidechain compression, curve shapes other than
  `ease-in-out`, per-group levels on one clip, and an automated browser vs
  native comparison (the tolerances are in the spec). The editor recomputes
  curves after each mix instead of taking the mixer's.
