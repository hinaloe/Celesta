# Audio ducking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clip marked with `duckGroup` makes every clip whose `duck.under` names that group dip while it plays, in the native mixer (preview and export, React and project JSON) and in browser export.

**Architecture:** `crates/composition` owns the data types, the resolution of authored values (defaults, dB, validation), and the curve: intervals in, `Animatable<f64>` keyframes out. `crates/media` finds each marked clip's interval from its decoded source and multiplies the curves in both mixer paths; the editor's level envelope uses the same curves. React and project JSON only carry the authored values to Rust. `@celesta/media-utils` has the one TypeScript port of the resolution and the curve (`duckEnvelope`), which browser export uses. A JSON fixture pins the Rust and TypeScript curves to each other.

**Tech Stack:** Rust (`celesta-composition`, `celesta-media`, `celesta-project`, `celesta-evaluator`, `celesta-react-bridge`, `celesta-exporter`, `celesta-editor`, `celesta-mcp`), TypeScript (`@celesta/react`, `@celesta/character`, `@celesta/media-utils`, `@celesta/web`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-audio-ducking-design.md` (everything except "Plan-based helper", which is the next step).

## Global Constraints

- Defaults: `to` 0.3, `attack` 0.15 s, `release` 0.4 s, `holdGap` 0.6 s. `to` is a multiplier in `[0, 1]` or `{ db }` with `db ≤ 0` (`10^(db / 20)`). `attack`, `release`, `holdGap` are finite and not negative. `under` is a non-empty string or a non-empty array of non-empty strings. `duckGroup` is a non-empty string.
- Dialogue voices belong to `"voice"` unless their `duckGroup` says otherwise; `null` means no group. Dialogue lines take no `duck`.
- The curve (spec, "The ducking curve"): drop intervals with `end <= start`, sort by start, join into runs when the silence before the next one is shorter than `max(holdGap, attack + release)` or negative; per run `[s, e]`, keys `(s − attack, 1)`, `(s, to, ease-in-out)`, `(e, to)`, `(e + release, 1, ease-in-out)`; no runs → the constant 1. Key times are seconds rounded to microseconds (`Time { value, timescale: 1_000_000 }`), as React's seconds already are.
- A marked clip's interval: from `range.start` to the earlier of its range end and, unless it loops, the timeline time its source position (`sourceStart + ∫ playbackRate`) reaches the source end (`sourceDuration`, else the decoded length). Find that time in closed form for a static rate and by bisection on the integral (64 steps) for a keyframed one. Muted clips do not count. A clip never counts toward its own curve. Groups do not chain.
- A ducked clip's gain is `volume(local) × fade(local) × duck(timeline)`. Clips without `duck` mix bit-identically to today.
- Resolution of authored values happens in Rust for the native paths (one function shared by the evaluator and the bridge) and in `@celesta/media-utils` for the browser. React does not resolve or validate them; it passes them through.
- New and largely rewritten TypeScript tests are `.test.mts` under Vitest, importing `../src/*.js` and type-checked by `test/tsconfig.json`, per #458.
- Run commits and tests as separate steps. Never amend.

## Review Focus

- A dialogue line held through the gap (`holdThroughGap`): its clip range runs past the voice, so the interval must stop where the source ends. (Task 2)
- `under` naming a group no clip has: nothing ducks, nothing throws. (Task 1)
- A ducked clip that is itself in the group it ducks under: its own interval is excluded, so a lone clip never ducks itself. (Task 1)
- `to: { db: -Infinity }` or `NaN` values from JSON: rejected with the field's path, not turned into a silent clip. (Tasks 1, 3)
- Browser export with a marked clip that is muted, or whose source fails to decode: the muted one does not count; a decoding failure fails the export as before, not silently. (Task 6)

---

### Task 1: Composition types, resolution, and the curve

**Files:**
- Create: `crates/composition/src/duck.rs`
- Modify: `crates/composition/src/model.rs` (`AudioClip`, around line 1176), `crates/composition/src/lib.rs`
- Create: `crates/composition/tests/fixtures/duck-curves.json`, `crates/composition/tests/duck_fixture.rs`
- Test: `crates/composition/src/tests.rs`

**Interfaces:**
- Produces, in `duck.rs` (re-exported from the crate root; `ts-rs` exports where marked):
  ```rust
  #[serde(untagged)] pub enum DuckGroups { One(String), Many(Vec<String>) }        // ts
  #[serde(untagged)] pub enum DuckLevel { Gain(f64), Db { db: f64 } }              // ts
  pub struct AudioDuck { pub under: Vec<String>, pub to: f64, pub attack: Time, pub release: Time, pub hold_gap: Time } // ts, camelCase
  pub enum DuckError { Group, Under, To, Attack, Release, HoldGap }               // Display: the rule broken
  impl AudioDuck {
      pub fn resolve(under: &DuckGroups, to: Option<DuckLevel>, attack: Option<Time>, release: Option<Time>, hold_gap: Option<Time>) -> Result<AudioDuck, DuckError>;
  }
  pub fn check_duck_group(group: &str) -> Result<(), DuckError>;
  pub fn duck_curve(intervals: &[(f64, f64)], duck: &AudioDuck) -> Result<Animatable<f64>, TimeError>;
  /// One curve per clip (None for a clip without `duck`), from each clip's audible end in timeline seconds.
  pub fn duck_curves(clips: &[AudioClip], audible_ends: &[f64]) -> Result<Vec<Option<Animatable<f64>>>, TimeError>;
  ```
- `AudioClip` gains `duck_group: Option<String>` and `duck: Option<AudioDuck>`, both `#[serde(default, skip_serializing_if = "Option::is_none")]`.
- `DuckError`'s messages are the ones the other layers show: `"must be a non-empty name"` (Group, Under), `"must be a multiplier from 0 to 1, or { db } at or below 0"` (To), `"must be finite and not negative"` (Attack, Release, HoldGap).

- [ ] **Step 1: Write the fixture `duck-curves.json`**

  `{ "cases": [{ "name", "intervals": [[s, e], ...], "duck": { "to"?, "attack"?, "release"?, "holdGap"? }, "curve": <Animatable JSON> }] }`, `duck` in seconds as authored (fields may be missing; `to` may be `{ "db": n }`). Write the expected curves by hand from the Global Constraints rule. Cases:
  - `none`: no intervals → `1`.
  - `one`: `[[2, 4]]`, defaults → keys `1.85 → 1`, `2 → 0.3 (ease-in-out)`, `4 → 0.3`, `4.4 → 1 (ease-in-out)`.
  - `overlap`: `[[1, 3], [2, 5]]` → one run `[1, 5]`.
  - `short-gap`: `[[1, 2], [2.5, 3]]` (gap 0.5 < holdGap 0.6) → one run `[1, 3]`.
  - `ramps-do-not-fit`: `[[1, 2], [2.5, 3]]` with `holdGap: 0`, `attack: 0.2`, `release: 0.4` (gap 0.5 < 0.6) → one run.
  - `long-gap`: `[[1, 2], [4, 5]]`, defaults → two runs.
  - `unsorted-and-empty`: `[[4, 5], [3, 3], [1, 2]]` → the two runs of `long-gap`.
  - `instant`: `[[1, 2]]`, `attack: 0`, `release: 0`, `to: 0` → keys `1 → 1`, `1 → 0 (ease-in-out)`, `2 → 0`, `2 → 1 (ease-in-out)`.
  - `decibels`: `[[1, 2]]`, `to: { db: -20 }` → the dip is `0.1`.

- [ ] **Step 2: Write `duck_fixture_matches_duck_curve` in `tests/duck_fixture.rs`**

  For each case: convert the authored seconds to `Time` at microseconds, `AudioDuck::resolve(&DuckGroups::One("voice"), …)`, `duck_curve(&intervals, &duck)`, and compare keyframe by keyframe (time exactly, value to 1e-12, easing exactly) with `curve`.

- [ ] **Step 3: Write the unit tests in `src/tests.rs`**

  - `resolve_applies_defaults_and_decibels`: `to` absent → 0.3; `{ db: -6 }` → `10^(-6/20)`; attack/release/holdGap absent → 0.15 / 0.4 / 0.6 s.
  - `resolve_rejects_invalid_values`: `Gain(1.5)`, `Gain(-0.1)`, `Gain(NaN)`, `Db { db: 1.0 }`, `Db { db: -inf }` → `To`; negative attack → `Attack`; `Many(vec![])` and `One("")` → `Under`; `check_duck_group("")` → `Group`.
  - `duck_curves_follow_marked_clips_only`: three clips — voice A (`duck_group "voice"`, 1–2 s), voice B muted (3–4 s), BGM (`duck under ["voice"]`, 0–6 s) — give the BGM the curve of `[(1, 2)]` and `None` to the others.
  - `duck_curves_exclude_the_clip_itself`: a clip with `duck_group "voice"` and `duck under voice` alone → its curve is the constant 1.
  - `duck_curves_use_the_audible_end`: a voice whose range is 1–5 s with `audible_ends[i] = 2.5` gives the interval `(1, 2.5)`.
  - `duck_curves_ignore_unknown_groups`: `under ["sfx"]` with no `sfx` clip → constant 1.
  - `clips_without_ducking_serialize_as_before`: an `AudioClip` without the fields serializes with neither key; one with them round-trips.

- [ ] **Step 4: Run them to verify they fail**

  Run: `cargo test -p celesta-composition`
  Expected: FAIL to compile (`AudioDuck`, `duck_curve` missing).

- [ ] **Step 5: Implement `duck.rs` and the `AudioClip` fields; add `duck_group: None, duck: None` where crates construct `AudioClip` literally (they fail to compile otherwise)**

- [ ] **Step 6: Run the tests**

  Run: `cargo test -p celesta-composition` then `cargo check --workspace --all-targets`
  Expected: PASS; the workspace compiles.

- [ ] **Step 7: Commit** — `feat(composition): duck one clip under the sound of others (#87)`

### Task 2: The mixer and the editor's level envelope

**Files:**
- Create: `crates/media/src/duck.rs`
- Modify: `crates/media/src/mix.rs`, `crates/media/src/stretch.rs`, `crates/media/src/lib.rs`, `crates/editor/src/waveform.rs` (`clip_level_envelope`), `crates/editor/src/audio.rs:155-180`
- Test: `crates/media/src/tests.rs`, `crates/editor/src/tests.rs`

**Interfaces:**
- Consumes: `duck_curves`, `AudioDuck` (Task 1).
- Produces, in `crates/media`:
  ```rust
  /// Timeline seconds at which `clip` stops sounding, given its decoded source.
  pub fn audible_end(clip: &AudioClip, source: &AudioBuffer) -> Result<f64, AudioMixError>;
  /// The ducking curve of every clip in `graph` (None without `duck`), decoding marked clips through `decoder`.
  pub fn duck_curves_for(graph: &AudioGraph, asset_root: &Path, decoder: &mut impl AudioDecoder) -> Result<Vec<Option<Animatable<f64>>>, AudioMixError>;
  ```
- `clip_level_envelope(waveform, clip, duck: Option<&Animatable<f64>>)` multiplies `duck` evaluated at `range.start + local`.

`mix_audio_graph_cancellable` decodes every non-muted clip first (keeping its cancellation checks), computes the curves from that cache with `audible_end` and `duck_curves`, then mixes. Both the per-sample loop and `mix_stretched_clip` multiply `evaluate_f64(curve, project_time)` into the gain next to the fade. Only clips in a group some clip ducks under need `audible_end`.

- [ ] **Step 1: Write the failing tests in `crates/media/src/tests.rs`**

  Add a `MapDecoder(HashMap<String, AudioBuffer>)` keyed by the asset path, and a `mix_left_graph(clips, sources, duration_s)` helper beside `mix_left`. Tests, on 48 kHz sines:
  - `ducking_dips_the_bed_under_the_voice`: BGM 440 Hz over 0–6 s with `duck under voice` (defaults); a 880 Hz voice clip 2–4 s with `duck_group voice` and volume 0 (so only the bed is measured). RMS of the bed: full in 0–1.5 s and 5–6 s; `0.3 ×` full in 2.1–3.9 s; half way along the attack (1.925 s ± 0.02) about `0.65 ×` full.
  - `clips_without_ducking_mix_bit_identically`: the `fades_ramp_…` setup with a marked clip added that nothing ducks under produces the same samples as without it.
  - `stretched_clips_duck_too`: the same as the first test with the bed at `pitch 2`.
  - `the_voice_counts_until_its_source_ends`: a voice clip with range 2–5 s whose source is 1 s long: the bed is back to full by 3.5 s.
  - `a_looping_voice_counts_for_its_whole_range`: the same with `loop: true`: the bed stays ducked until 5 s.
  - `a_muted_voice_does_not_duck`.
  - `audible_end_follows_a_keyframed_rate`: a clip at 0 s over 0–4 s, 2 s source, rate `1 → 2` linear over 2 s: the source runs out where `t + t²/4 = 2`, at `√12 − 2 ≈ 1.4641` s; `audible_end` matches within 1e-6.

- [ ] **Step 2: Run them to verify they fail** — `cargo test -p celesta-media --lib duck` → FAIL (missing functions).

- [ ] **Step 3: Implement `crates/media/src/duck.rs`, the mixer changes, and the stretch change**

- [ ] **Step 4: Run them** — `cargo test -p celesta-media` → PASS, including every existing test.

- [ ] **Step 5: Editor**

  Test `level_envelope_dips_with_the_duck_curve` in `crates/editor/src/tests.rs`: `clip_level_envelope(&[0.8; 4], &clip, Some(&curve))` with a curve at 0.5 over the clip's second half gives `[0.8, 0.8, 0.4, 0.4]`. Watch it fail, then pass the curves from `duck_curves_for(&request.graph, …, &mut decoder)` in `audio.rs`'s envelope loop (a failure leaves curves out, as a failed waveform does). Run `cargo test -p celesta-editor`.

- [ ] **Step 6: Commit** — `feat(media): duck clips in the mixer and the level envelope (#87)`

### Task 3: Project JSON and the evaluator

**Files:**
- Modify: `crates/project/src/timeline.rs` (`TimelineContent::Audio`, `Video`, `Dialogue`), `crates/project/src/validation.rs`, `crates/evaluator/src/lib.rs` (the audio/video/dialogue clip construction, lines ~140-190 and `media_clip`)
- Test: `crates/project/src/tests.rs`, `crates/evaluator/src/tests.rs`

**Interfaces:**
- Consumes: `DuckGroups`, `DuckLevel`, `AudioDuck::resolve`, `check_duck_group`, `DuckError` (Task 1).
- `TimelineContent::Audio` and `Video` gain `duck_group: Option<String>` and `duck: Option<ProjectDuck>`; `Dialogue` gains `duck_group: Option<Option<String>>` (absent → `"voice"`, `null` → none; deserialize with a `deserialize_some` helper so `null` is `Some(None)`; ts type `duckGroup?: string | null`).
  ```rust
  pub struct ProjectDuck { pub under: DuckGroups, pub to: Option<DuckLevel>, pub attack: Option<Time>, pub release: Option<Time>, pub hold_gap: Option<Time> } // camelCase, ts
  ```

- [ ] **Step 1: Write the failing tests**
  - project: `parses_ducking_fields` (a string and an array `under`, `to` as a number and as `{ db }`, times; a dialogue with `"duckGroup": null` and one without); `rejects_invalid_ducking` — each `DuckError` case reported at `tracks[0].items[0].content.duck.<to|attack|release|holdGap|under>` and `.content.duckGroup`, with the `DuckError` message.
  - evaluator: `audio_items_carry_resolved_ducking` (defaults and dB resolved into `AudioClip.duck`); `dialogue_voices_belong_to_voice_unless_told_otherwise` (absent → `Some("voice")`, `null` → `None`, `"narrator"` → `Some("narrator")`).

- [ ] **Step 2: Run them to verify they fail** — `cargo test -p celesta-project -p celesta-evaluator` → FAIL.

- [ ] **Step 3: Implement the fields, validation (reusing `AudioDuck::resolve` and `check_duck_group` so the rules live once), and the evaluator mapping**

- [ ] **Step 4: Run them, then regenerate the TypeScript types**
  Run: `cargo test -p celesta-project -p celesta-evaluator` → PASS. Run: `pnpm --dir packages/react run codegen` → the generated types include `duckGroup` / `duck`.

- [ ] **Step 5: Commit** — `feat(project): duck audio and video items, with dialogue in "voice" (#87)`

### Task 4: React, the bridge, the exporter, the dialogue default, and MCP summaries

**Files:**
- Modify: `packages/react/src/components.ts` (`AudioProps` ~line 882, `VideoProps`), `packages/react/src/render.ts` (`AudioClipDescriptor` ~line 116, `collectAudioClip` ~line 1172), `packages/react/src/index.ts`
- Modify: `packages/character/src/components.ts` (`DialogueProps` ~line 327), `packages/character/src/dialogue-series.ts` (`DialogueLine`, the props built ~line 385), `packages/character/src/render.ts:296-300`
- Modify: `crates/react-bridge/src/types.rs` (`ReactAudioClipDescriptor`), `crates/react-bridge/src/audio.rs` (`react_audio_clips` returns `Result<Vec<AudioClip>, DuckError>`), its callers (`bridge.rs:606`, `examples/audio-bench.rs`, `tests/node_integration.rs`), `crates/exporter/src/project.rs:77-104`, `crates/mcp/src/summary.rs:~520`
- Create: `packages/react/test/audio-duck.test.mts`, `packages/react/test/tsconfig.json`; modify `packages/react/vitest.config.mjs` (include `.mts`), `packages/react/package.json` (`"test": "tsc -b test && vitest run"`)
- Create: `packages/character/test/dialogue-duck.test.mts`
- Test: `crates/react-bridge/src/tests.rs`, `crates/exporter/src/tests.rs`, `crates/mcp/src/summary.rs` tests

**Interfaces:**
- `@celesta/react` exports `type AudioDuck = { under: string | string[]; to?: number | { db: number }; attack?: number; release?: number; holdGap?: number }` (seconds). `AudioProps` and `VideoProps` gain `duckGroup?: string` and `duck?: AudioDuck`. The descriptor gains `duckGroup?: string` and `duck?: AudioDuck`, present only when set, passed through unchanged.
- `DialogueProps.duckGroup?: string | null` and `DialogueLine.duckGroup?: string | null`, documented as defaulting to `"voice"`. The `dialogue` host element collects `duckGroup: 'voice'` when the prop is `undefined`, no group when it is `null`, and never a `duck`.
- `ReactAudioClipDescriptor` gains `duck_group: Option<String>` and `duck: Option<ReactDuck>` with `under: DuckGroups`, `to: Option<DuckLevel>`, and `attack`, `release`, `hold_gap: Option<f64>` seconds. `react_audio_clips` and the exporter resolve them with `AudioDuck::resolve`; a failure names the clip's `src` and the `DuckError`.
- MCP clip summaries add `, in duck group "<g>"` and `, ducking under <a, b> to <to>` (the authored `to`; `"<n> dB"` for `{ db }`).

- [ ] **Step 1: Write the failing tests**
  - `audio-duck.test.mts` (React, from `../src/index.js` and `../src/render.js`): `<Audio duckGroup duck>` and `<Video duckGroup duck>` report both fields unchanged; a clip without them reports neither key.
  - `dialogue-duck.test.mts` (character): a `<Dialogue audio>` reports `duckGroup: 'voice'`; `duckGroup: 'narrator'` reports it; `duckGroup: null` reports none; a `duck` passed in props is not reported; a `DialogueSeries` line's `duckGroup` reaches the clip.
  - bridge: `react_audio_clips_resolve_ducking` (defaults, dB) and `react_audio_clips_reject_invalid_ducking` (the error names `src`).
  - exporter: `build_audio_graph` carries resolved ducking.
  - mcp: a descriptor with `duckGroup` and `duck` is summarized as above.

- [ ] **Step 2: Run them to verify they fail**
  Run: `pnpm --dir packages/react test`, `pnpm --dir packages/character test`, `cargo test -p celesta-react-bridge --lib -p celesta-exporter --lib -p celesta-mcp`.
  Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run all of the above**, plus `cargo check --workspace --all-targets` → PASS.

- [ ] **Step 5: Commit** — `feat(react): mark and duck <Audio>, <Video>, and dialogue voices (#87)`

### Task 5: The TypeScript curve in `@celesta/media-utils`

**Files:**
- Create: `packages/media-utils/src/duck.ts`, `packages/media-utils/test/duck.test.mts`, `packages/media-utils/test/tsconfig.json`
- Modify: `packages/media-utils/src/index.ts` (re-export), `packages/media-utils/package.json` (`"./duck"` export; `"test": "tsc -b test && vitest run"`), `packages/media-utils/vitest.config.mjs` (include `.mts`)

**Interfaces:**
- Consumes: `type AudioDuck` from `@celesta/react` (type-only; `duck.ts` has no runtime imports, so browser export can load it alone).
- Produces, from `@celesta/media-utils` and `@celesta/media-utils/duck`:
  ```ts
  export interface ResolvedDuck { to: number; attack: number; release: number; holdGap: number }
  export function resolveDuck(duck: Omit<AudioDuck, 'under'>): ResolvedDuck;   // throws Error(`duck.<field> <DuckError message>`)
  export function duckEnvelope(
    intervals: ReadonlyArray<readonly [number, number]>,
    duck: Omit<AudioDuck, 'under'> & { volume?: number },
    options?: { origin?: number },
  ): AnimatedNumber;
  ```
  `duckEnvelope` keys are at `time − origin` seconds (microsecond `Time`), values times `volume` (default 1, finite, not negative). With no runs it returns the number `volume`.

- [ ] **Step 1: Write the failing tests in `duck.test.mts`**
  - `every fixture curve matches Rust`: reads `../../../crates/composition/tests/fixtures/duck-curves.json`; `duckEnvelope(intervals, duck)` deep-equals `curve` (values to 1e-12).
  - `origin shifts the keys onto the sequence clock`: the `one` case with `origin: 1.5` has its first key at `0.35 s`.
  - `volume scales the curve`: `volume: 0.8`, `to: 0.3` dips to `0.24`; no intervals → `0.8`.
  - `invalid values throw` with the field name: `to: 1.5`, `to: { db: 3 }`, `attack: -1`, `volume: -1`.

- [ ] **Step 2: Run them to verify they fail** — `pnpm --dir packages/media-utils test` → FAIL.

- [ ] **Step 3: Implement `duck.ts`, the export map, and the test setup**

- [ ] **Step 4: Run them** — PASS.

- [ ] **Step 5: Commit** — `feat(media-utils): build ducking curves in TypeScript (#87)`

### Task 6: Browser export

**Files:**
- Modify: `packages/web/src/types.ts` (`AudioClip`), `packages/web/src/audio-support.ts`, `packages/web/src/export.ts` (`mixAudio`), `packages/web/vite.config.ts` and `packages/web/vitest.config.mjs` (alias `@celesta/media-utils/duck` to its source), `packages/web/test/tsconfig.json` (reference `../../media-utils`)
- Test: `packages/web/test/audio-support.test.mts`

**Interfaces:**
- Consumes: `duckEnvelope` (Task 5), `integrateAnimated`, `automationEvents` (PR ①).
- `AudioClip` gains `duckGroup?: string` and `duck?: AudioDuck` (as authored).
- Produces, in `audio-support.ts`:
  ```ts
  export function audibleEnd(clip: AudioClip, sourceSeconds: number): number;
  export function duckCurves(clips: AudioClip[], sourceSeconds: number[]): (AnimatedNumber | undefined)[]; // clip-local, origin = clip.start
  export function scheduleClip(context, clip, buffer, total, duck?: AnimatedNumber): void; // one more gain after the fades
  ```
  `audibleEnd` and `duckCurves` follow the Global Constraints rules exactly as Task 1 and Task 2 do.

`mixAudio` decodes every non-muted clip first, computes the curves, then schedules each clip with its curve.

- [ ] **Step 1: Write the failing tests** in `audio-support.test.mts`, mirroring Task 1's and Task 2's cases: `duckCurves` gives the bed the curve of the voice's interval and nothing to the voice; a muted voice and the clip itself do not count; `audibleEnd` stops at the source end, ignores it for `loop`, and follows a keyframed rate; `scheduleClip` with a curve chains one more gain carrying `automationEvents(curve, start, end)`.

- [ ] **Step 2: Run them to verify they fail** — `pnpm --dir packages/web test` → FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run them, and type-check** — `pnpm --dir packages/web test` → PASS; `pnpm --dir packages/web exec tsc -p tsconfig.json --noEmit` → clean.

- [ ] **Step 5: Commit** — `feat(web): duck clips in browser export (#87)`

### Task 7: An end-to-end export

**Files:**
- Modify: `crates/exporter/tests/integration/export.rs` (beside `exports_an_audio_clip_with_fades`, line ~856)

- [ ] **Step 1: Write `exports_a_bed_ducked_under_a_voice`**: a project with a 440 Hz `audio` item over 0–1 s with `duck: { under: "voice" }` and a `dialogue`-less voice `audio` item (`duckGroup: "voice"`, volume 0) over 0.4–0.6 s; export to MP4; the decoded RMS in 0.45–0.55 s is about `0.3 ×` the RMS in 0.05–0.15 s (within 10 %). This checks the finished pipeline end to end, so it is written after the units it covers.

- [ ] **Step 2: Run it** — `cargo test -p celesta-exporter --test integration exports_a_bed_ducked_under_a_voice` → PASS (or skipped, as the fade test is, where FFmpeg is missing).

- [ ] **Step 3: Commit** — `test(exporter): export a bed ducked under a voice (#87)`
