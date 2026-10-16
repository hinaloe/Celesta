# Audio pitch and preservePitch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `<Audio pitch preservePitch>` (and the project-JSON `audio` item) transposes a clip in semitones and can keep its pitch while `playbackRate` changes its speed, identically in the editor preview and every export.

**Architecture:** `AudioClip` gains `pitch: Animatable<f64>` and `preserve_pitch: bool`, fed from both the project evaluator and the React bridge. The shared mixer `mix_audio_graph_cancellable` keeps its current per-sample loop for clips that need no pitch work (bit-identical) and sends every other clip through a new `stretch.rs` module built on Signalsmith Stretch. `@celesta/web` rejects the new props with an error.

**Tech Stack:** Rust (celesta-composition, -project, -evaluator, -react-bridge, -media, -exporter), `signalsmith-stretch` 0.1.3 crate, TypeScript (`@celesta/react`, `@celesta/web`), vitest / `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-16-audio-pitch-design.md`

## Global Constraints

- `pitch` is semitones, default `0`, valid range `[-24, 24]`, fractions allowed; animatable (`Animatable<f64>` / `AnimatedNumber`).
- `preservePitch` / `preserve_pitch` is a boolean, default `false`.
- Heard transposition: `factor(t) = 2^(clamp(pitch(t), -24, 24) / 12) × (preserve_pitch ? 1 : playback_rate(t))`. Source position stays `source_start + ∫ playback_rate`.
- Fast path (unchanged code, bit-identical output) iff `pitch == Animatable::Static(0.0)` and (`!preserve_pitch` or `playback_rate == Animatable::Static(1.0)`).
- Stretch path block size: `BLOCK = 512` output frames; cancellation checked once per block.
- Serialized JSON without the new fields must stay byte-identical: `pitch` omitted when `Static(0.0)`, `preservePitch` omitted when `false` — in `AudioClip`, `TimelineContent::Audio`, `ReactAudioClipDescriptor` and the TS `AudioClipDescriptor` (render.ts emits `pitch` only when it is not the static `0`, and `preservePitch: true` only when set, like `loop`).
- `<Video>` sound and `<Dialogue>` voices always get `pitch = 0`, `preserve_pitch = false`.
- Browser export error text, verbatim: `Audio pitch and preservePitch are not supported by browser export yet.`
- Dependency: `signalsmith-stretch = "0.1.3"` (MIT), added under `[workspace.dependencies]` and used by `crates/media` only.
- Builds: export `PKG_CONFIG_PATH` for Homebrew `ffmpeg@8` before any `cargo` command (default ffmpeg 9 breaks the build).
- Commits are signed through 1Password; if signing fails with "failed to fill whole buffer", stop and ask the user to unlock — never bypass signing.

## Review Focus

1. **Out-of-range pitch from React** — the React path has no project validation, so `pitch={48}` reaches the mixer; it must sound like `24`, not panic or alias. (Task 4: `clamps_pitch_beyond_two_octaves`.)
2. **Clip shorter than the stretcher's latency** (a few ms) — no panic, nothing written outside the clip's frames. (Task 4: `short_stretched_clip_stays_inside_its_range`.)
3. **Clip starting before timeline 0** (`range.start < 0`) — the first output frame must play the source at `-range.start × rate`, not the source start. (Task 4: `stretched_clip_starting_before_zero_plays_from_its_offset`.)
4. **Keyframed `playbackRate` with `preservePitch`** — block input counts vary; rounding must not drift, so a source marker lands where `∫ rate` says. (Task 4: `animated_rate_with_preserved_pitch_does_not_drift`.)
5. **Slowing down with `preservePitch`** (`rate = 0.5`) — fewer input frames than output per block; the result must stay continuous at the original pitch. (Task 4: `slow_rate_with_preserved_pitch_keeps_pitch_and_stays_continuous`.)

---

### Task 1: `AudioClip` pitch fields

**Files:**
- Modify: `crates/composition/src/model.rs` (`AudioClip`, near line 1113; helpers near `is_false` line 393)
- Modify (add `pitch: Animatable::Static(0.0), preserve_pitch: false` to every literal): `crates/evaluator/src/lib.rs:140,155`, `crates/react-bridge/src/audio.rs:65`, `crates/exporter/src/project.rs:87`, `crates/media/src/tests.rs:432,510`, `crates/editor/src/tests.rs:165,215,286`
- Regenerate: `packages/react/src/generated/AudioClip.ts`
- Test: `crates/composition/src/tests.rs`

**Interfaces:**
- Produces: `AudioClip { …, pub pitch: Animatable<f64>, pub preserve_pitch: bool }`; JSON names `pitch`, `preservePitch`.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn audio_clip_pitch_fields_default_and_stay_out_of_json() {
    let json = r#"{"id":"a","asset":{"id":"a","location":{"type":"file","path":"a.wav"}},"range":{"start":{"value":0,"timescale":1},"duration":{"value":1,"timescale":1}},"sourceStart":{"value":0,"timescale":1},"playbackRate":1.0,"volume":1.0,"muted":false}"#;
    let clip: AudioClip = serde_json::from_str(json).unwrap();
    assert_eq!(clip.pitch, Animatable::Static(0.0));
    assert!(!clip.preserve_pitch);
    assert_eq!(serde_json::to_string(&clip).unwrap(), json);

    let shifted = AudioClip { pitch: Animatable::Static(-2.5), preserve_pitch: true, ..clip };
    let text = serde_json::to_string(&shifted).unwrap();
    assert!(text.contains(r#""pitch":-2.5"#) && text.contains(r#""preservePitch":true"#));
    assert_eq!(serde_json::from_str::<AudioClip>(&text).unwrap(), shifted);
}
```

Adjust the `json` literal's `Time` / `AssetLocation` encoding to whatever the existing serde shape is (serialize an existing clip once to see it); the assertions stay as written.

- [ ] **Step 2: Run it and see it fail**

Run: `cargo test -p celesta-composition audio_clip_pitch_fields`
Expected: compile error, no field `pitch` on `AudioClip`.

- [ ] **Step 3: Add the fields**

`#[serde(default = "zero_pitch", skip_serializing_if = "is_zero_pitch")] pub pitch: Animatable<f64>` and `#[serde(default, skip_serializing_if = "is_false")] pub preserve_pitch: bool`, with doc comments taken from the spec's API section. `fn zero_pitch() -> Animatable<f64>` returns `Static(0.0)`; `fn is_zero_pitch(&Animatable<f64>) -> bool` is true only for `Static(0.0)`. Update every literal listed under Files.

- [ ] **Step 4: Run the tests and regenerate the TS types**

Run: `cargo test -p celesta-composition && cargo build --workspace --tests && pnpm --dir packages/react run codegen`
Expected: tests pass; `packages/react/src/generated/AudioClip.ts` gains optional `pitch` / `preservePitch` (match how `loop` comes out).

- [ ] **Step 5: Commit**

```bash
git add crates packages/react/src/generated
git commit -m "feat(composition): add pitch and preservePitch to AudioClip (#312)"
```

---

### Task 2: Project JSON `audio` items carry pitch

**Files:**
- Modify: `crates/project/src/timeline.rs:165-175` (`TimelineContent::Audio`)
- Modify: `crates/project/src/validation.rs:277-286` (Audio arm)
- Modify: `crates/evaluator/src/lib.rs:127-150` (split the shared `Video | Audio` arm)
- Modify every `TimelineContent::Audio { … }` literal (`crates/evaluator/src/tests.rs:301`, others found by `cargo build --tests`)
- Regenerate: `packages/react/src/generated/TimelineContent.ts`
- Test: `crates/project/src/tests.rs`, `crates/evaluator/src/tests.rs`

**Interfaces:**
- Consumes: Task 1's `AudioClip.pitch`, `AudioClip.preserve_pitch`.
- Produces: `TimelineContent::Audio { …, pitch: Option<Animatable<f64>>, preserve_pitch: Option<bool> }` (both `#[serde(default, skip_serializing_if = "Option::is_none")]`).

- [ ] **Step 1: Write the failing tests**

In `crates/project/src/tests.rs`, building on the `examples/voiceroid.celesta.json` fixture the other validation tests use (replace an item's content with an `Audio` item referencing an audio asset in that file):

```rust
#[test]
fn validates_audio_pitch_range() {
    // Static pitch 24.5 → error at "<item path>.content.pitch".
    // Static f64::NAN → same path.
    // Keyframes with one value -25.0 → same path.
    // Static -24.0 and keyframes [0.0, 24.0] → project.validate() is Ok.
}

#[test]
fn audio_items_without_pitch_round_trip_unchanged() {
    // Serialize the fixture, parse, serialize again: identical strings,
    // and neither contains "pitch" nor "preservePitch".
}
```

In `crates/evaluator/src/tests.rs`, next to `audio_graph_preserves_source_range_and_playback_mapping`:

```rust
#[test]
fn audio_graph_carries_pitch_and_preserve_pitch() {
    // Audio content with pitch: Some(Static(-3.0)), preserve_pitch: Some(true)
    // → clips[0].pitch == Static(-3.0), clips[0].preserve_pitch == true.
    // Same content with both None → Static(0.0), false.
    // A Video item → Static(0.0), false.
}
```

Write the bodies with real assertions on exactly these values.

- [ ] **Step 2: Run and see them fail**

Run: `cargo test -p celesta-project validates_audio_pitch && cargo test -p celesta-evaluator audio_graph_carries_pitch`
Expected: compile errors on the missing fields.

- [ ] **Step 3: Implement**

- Add the two fields to `TimelineContent::Audio`.
- In the validation Audio arm, when `pitch` is `Some`, call `self.animatable(&format!("{path}.content.pitch"), pitch, |v| v.is_finite() && (-24.0..=24.0).contains(v), "must be finite and between -24 and 24")`.
- In the evaluator, split the arm: Audio maps `pitch.clone().unwrap_or(Animatable::Static(0.0))` and `preserve_pitch.unwrap_or(false)`; Video sets `Static(0.0)` / `false`. Keep the rest of the mapping shared, using a small helper rather than duplicating it.

- [ ] **Step 4: Run the tests and regenerate**

Run: `cargo test -p celesta-project -p celesta-evaluator && cargo build --workspace --tests && pnpm --dir packages/react run codegen`
Expected: all pass; `TimelineContent.ts` gains the optional fields.

- [ ] **Step 5: Commit**

```bash
git add crates packages/react/src/generated
git commit -m "feat(project): accept pitch and preservePitch on audio items (#312)"
```

---

### Task 3: `<Audio pitch preservePitch>` through React and the bridge

**Files:**
- Modify: `packages/react/src/components.ts:729-760` (`AudioProps`; not `VideoProps`)
- Modify: `packages/react/src/render.ts:105-125` (`AudioClipDescriptor`), `:1123-1158` (`collectAudioClip`)
- Modify: `crates/react-bridge/src/types.rs:87` (`ReactAudioClipDescriptor`), `crates/react-bridge/src/audio.rs:65-80`
- Modify: `crates/exporter/src/project.rs:87-100`
- Modify every `ReactAudioClipDescriptor { … }` literal (`crates/react-bridge/src/tests.rs:455`, `crates/exporter/src/tests.rs:64`, others found by the build)
- Test: `packages/react/test/video-audio.test.mjs`, `crates/react-bridge/src/tests.rs`, `crates/exporter/src/tests.rs`

**Interfaces:**
- Consumes: Task 1's `AudioClip` fields.
- Produces: TS `AudioClipDescriptor.pitch?: AnimatedNumber`, `AudioClipDescriptor.preservePitch?: true`; Rust `ReactAudioClipDescriptor { …, pitch: Animatable<f64> /* serde default Static(0.0), skipped when Static(0.0) */, preserve_pitch: bool /* default false, skipped when false */ }`.

- [ ] **Step 1: Write the failing tests**

`packages/react/test/video-audio.test.mjs`:

```js
test('<Audio> pitch and preservePitch reach its clip, shifted like volume', () => {
  const pitch = frameKeyframes([{ frame: 0, value: 0 }, { frame: 30, value: 12 }], { fps: 30 });
  const composition = mount(root(60,
    h(Sequence, { from: -15 }, h(Audio, { src: './a.wav', pitch, preservePitch: true, playbackRate: 2 })),
    h(Audio, { src: './b.wav', pitch: -3 }),
    h(Audio, { src: './c.wav', pitch: 0 })));
  const [a, b, c] = at(composition, 0).audio;
  expect(a.preservePitch).toBe(true);
  expect(a.pitch).toEqual(/* pitch shifted by -0.5 s, as volume is in the existing clipped-sequence tests */);
  expect(b).toMatchObject({ pitch: -3 });
  expect(b.preservePitch).toBeUndefined();
  expect('pitch' in c).toBe(false);
});

test('<Video> never reports pitch', () => {
  const composition = mount(root(30, h(Video, { src: './clip.mp4', playbackRate: 2 })));
  const [clip] = at(composition, 0).audio;
  expect('pitch' in clip || 'preservePitch' in clip).toBe(false);
});
```

Compute the expected shifted keyframes by calling the same `shiftAnimated` behavior the existing volume tests assert (copy their expectation style).

`crates/react-bridge/src/tests.rs`: `react_audio_clips_carry_pitch` — a descriptor with `pitch: Static(5.0), preserve_pitch: true` gives an `AudioClip` with the same values; `deserializes_audio_clips_from_a_frame_response`-style JSON without the keys gives `Static(0.0)` / `false`.

`crates/exporter/src/tests.rs`: extend `builds_a_react_audio_graph_with_ranges_and_keyframed_volume` (or add `builds_a_react_audio_graph_with_pitch`) asserting the built clip's `pitch` and `preserve_pitch`; and that `merge_react_audio_clips` keeps two reports differing only in `pitch` as two entries.

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @celesta/react build && pnpm --filter @celesta/react test -- video-audio` and `cargo test -p celesta-react-bridge -p celesta-exporter pitch`
Expected: failures on missing `pitch` fields.

- [ ] **Step 3: Implement**

- `AudioProps`: add the two props with the spec's doc comments.
- `collectAudioClip`: when `!video`, `const pitch = animatedNumber(props.pitch, 0)`; spread `...(pitch !== 0 ? { pitch: shiftAnimated(pitch, -clipped) } : {})` and `...(props.preservePitch === true ? { preservePitch: true } : {})`.
- Rust descriptor: add the fields with the serde attributes above (reuse a `zero_pitch` / `is_zero_pitch` helper — export them from `celesta-composition` if that is simpler than duplicating).
- `audio.rs` and `exporter/src/project.rs`: copy both fields into `AudioClip`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @celesta/react build && pnpm --filter @celesta/react test && cargo test -p celesta-react-bridge -p celesta-exporter --lib`
Expected: all pass, including every existing `toEqual` descriptor test unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/react crates
git commit -m "feat(react): pitch and preservePitch props on <Audio> (#312)"
```

---

### Task 4: Stretch path in the mixer

**Files:**
- Modify: `Cargo.toml` (`[workspace.dependencies]`: `signalsmith-stretch = "0.1.3"`), `crates/media/Cargo.toml`
- Create: `crates/media/src/stretch.rs`
- Modify: `crates/media/src/lib.rs` (`mod stretch;`), `crates/media/src/mix.rs:73-121`
- Test: `crates/media/src/tests.rs`

**Interfaces:**
- Consumes: Task 1's `AudioClip` fields.
- Produces (crate-private):
  - `pub(crate) fn needs_stretch(clip: &AudioClip) -> bool` — the Global Constraints fast-path condition, negated.
  - `pub(crate) fn mix_stretched_clip(clip: &AudioClip, source: &AudioBuffer, sample_rate: u32, frames: std::ops::Range<i64>, output: &mut [f32], is_cancelled: &mut impl FnMut() -> bool) -> Result<(), AudioMixError>` — adds the clip's stereo output for timeline frames `frames` (already clamped to the timeline, as `start..end` in `mix.rs`) into the interleaved `output`.

- [ ] **Step 1: Write the test helpers and failing tests**

Helpers in `tests.rs`: `struct BufferDecoder(AudioBuffer)` implementing `AudioDecoder` by cloning; `fn tone(hz: f64, from_s: f64, to_s: f64, total_s: f64) -> AudioBuffer` (48 kHz stereo, amplitude 0.5, silence outside `[from_s, to_s)`); `fn clip(range_start_s: f64, duration_s: f64) -> AudioClip` (static rate 1, volume 1, pitch 0); `fn mix_left(clip: AudioClip, source: AudioBuffer, duration_s: f64) -> Vec<f32>` (left channel at 48 kHz); `fn frequency(left: &[f32], from_s: f64, to_s: f64) -> f64` (rising zero crossings ÷ duration); `fn onset(left: &[f32]) -> Option<usize>` (first `|x| > 0.05`); `fn rms(left: &[f32], from_s: f64, to_s: f64) -> f32`.

Tests (frequency tolerance ±2 %, onset tolerance ±240 frames = 5 ms):

| Test | Setup | Assertions |
|---|---|---|
| `fast_path_is_chosen_without_pitch_work` | `needs_stretch` on: default; rate 2; rate 2 + pitch 0 + preserve false; rate 1 + preserve true | all `false`; `pitch = Static(1.0)` → `true`; rate 2 + preserve → `true` |
| `pitch_up_an_octave_doubles_frequency` | 440 Hz tone 0–1 s, clip 1 s, `pitch = 12` | `frequency(0.2, 0.8) ≈ 880` |
| `preserved_pitch_at_double_rate_halves_length` | tone 0–0.5 s of a 1 s source, clip 1 s, rate 2, preserve | `frequency(0.05, 0.2) ≈ 440`; `rms(0.3, 1.0) < 0.01`; `rms(0.05, 0.2) > 0.2` |
| `tape_rate_with_pitch_down_an_octave_cancels` | 440 Hz 0–2 s, clip 1 s, rate 2, `pitch = -12`, preserve false | `frequency(0.2, 0.8) ≈ 440` |
| `keyframed_pitch_rises_over_the_clip` | 440 Hz 0–1 s, clip 1 s, pitch keyframes 0 → 12 over 0–1 s | `frequency(0.05, 0.15) < frequency(0.85, 0.95)`; last ≈ 440·2^(0.9·12/12) ±3 % |
| `stretched_onset_matches_the_fast_path` | 440 Hz 0.25–1 s, clip 1 s, `pitch = 1` vs. `pitch = 0` | onsets within 240 frames of each other |
| `stretched_clip_honors_loop_and_source_duration` | 440 Hz 0–0.25 s source of 0.25 s, `loop`, pitch 12 → `rms(0.85, 0.95) > 0.2`; 1 s tone with `source_duration = 0.25 s`, pitch 12 → `rms(0.35, 1.0) < 0.01` | as stated |
| `cancels_a_stretched_clip_between_blocks` | 440 Hz 0–2 s, clip 2 s, pitch 12, `is_cancelled` true from its 4th call | `AudioMixError::Cancelled` |
| `clamps_pitch_beyond_two_octaves` | 110 Hz tone, pitch 48 vs. pitch 24 | frequencies equal ±2 % (≈ 440) |
| `short_stretched_clip_stays_inside_its_range` | clip 0.1 s → 0.105 s (240 frames), pitch 12, 0.2 s timeline | no panic; `rms(0, 0.099) == 0` and `rms(0.106, 0.2) == 0` |
| `stretched_clip_starting_before_zero_plays_from_its_offset` | 440 Hz 0.5–1 s of a 1 s source, `range.start = -0.5 s`, duration 1 s, pitch 1 | onset within 240 frames of frame 0 |
| `animated_rate_with_preserved_pitch_does_not_drift` | 440 Hz 1.5–3 s of a 3 s source, rate keyframes 1 → 2 over 0–2 s, preserve, clip 2 s | onset at the frame where `integrate_f64(rate, t) = 1.5` (compute it in the test) ±240 frames |
| `slow_rate_with_preserved_pitch_keeps_pitch_and_stays_continuous` | 440 Hz 0–1 s, rate 0.5, preserve, clip 2 s | `frequency(0.2, 1.8) ≈ 440`; every 50 ms window in 0.1–1.9 s has `rms > 0.2` |

- [ ] **Step 2: Run and see them fail**

Run: `cargo test -p celesta-media stretch` (and the other new names)
Expected: compile errors on `needs_stretch` / missing module.

- [ ] **Step 3: Implement `stretch.rs` and hook it into `mix.rs`**

In `mix.rs`, after `start`/`end` are computed, `if needs_stretch(clip) { mix_stretched_clip(clip, source, graph.sample_rate, start..end, &mut output, &mut is_cancelled)?; continue; }`. The existing loop is untouched.

`mix_stretched_clip`, with `sr = sample_rate`, `range_start_frame = sample_ceil(clip.range.start, sr)` (unclamped; same rounding as `mix.rs`), `Lin = input_latency()`, `Lout = output_latency()`, and `S(k)` = the source frame for clip-local output frame `k` = `round((source_start + integrate_f64(rate, local_time(k))) · sr)` where `local_time(k) = Time::samples(range_start_frame + k, sr) − range.start` (valid for any `k`, including past the clip end):

```text
n        = frames.end - range_start_frame        // clip-local frames to produce, from the clip's own frame 0
skip     = frames.start - range_start_frame      // > 0 when the clip starts before the timeline
stretch  = Stretch::preset_default(2, sr)
stretch.seek(read(S(0), Lin), evaluate_f64(rate, local_time(0)))        // centre the stretcher on S(0), like Signalsmith's own exact()
for each block [j0, j1) over stream frames 0 .. n + Lout, step BLOCK:
    check is_cancelled → Err(Cancelled)
    n_in = S(j1) - S(j0)
    if n_in <= 0 { continue }                    // non-positive rate: silence
    k   = max(j0 - Lout, 0)                      // clip-local frame this block is heard at
    stretch.set_transpose_factor(factor(local_time(k)), None)
    stretch.process(read(S(j0) + Lin, n_in), block_out[(j1 - j0) frames])
    for each stream frame j in [j0, j1): heard frame k = j - Lout;
        if k >= skip && k < n: output[range_start_frame + k] += block_out[j - j0] · volume(local_time(k))
```

`read(first, count)` returns `count` interleaved stereo frames; frame `f` is silence if `f < 0` or `source_duration` puts `f` at or past `S_end`, then wraps `f.rem_euclid(len)` when `loop`, otherwise silence when `f >= len`. `volume` is `evaluate_f64(...).clamp(0.0, 16.0)` like the fast path. `factor` uses the Global Constraints formula with `pitch` clamped to `[-24, 24]`. Skipping whole blocks whose heard frames all fall before `skip` is an allowed optimisation, but the stretcher must still be fed so its state stays continuous.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p celesta-media && cargo test -p celesta-editor -p celesta-exporter --lib`
Expected: all new tests pass; `mixes_audio_at_exact_timeline_and_source_offsets` and `loops_audio_from_the_start_of_the_source_past_its_end` pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock crates/media
git commit -m "feat(media): pitch-shift and time-stretch audio clips with Signalsmith Stretch (#312)"
```

---

### Task 5: Export a pitched clip end to end

**Files:**
- Test: `crates/exporter/tests/export_integration.rs`

**Interfaces:**
- Consumes: Tasks 2 and 4 (project `Audio` item with `pitch` / `preserve_pitch`, mixer stretch path); existing helpers `transparent_project`, `export_as`, `decoded_audio_seconds`.

- [ ] **Step 1: Write the test**

`exports_a_pitched_audio_clip`:
- Write `tone.wav` into the temp dir with `FfmpegContext` and a lavfi input `sine=frequency=440:sample_rate=8000:duration=2`.
- Add `Asset::Audio { source: File "tone.wav" }` and an `Audio` track with one 1 s item: `playback_rate: Some(Static(2.0))`, `pitch: Some(Static(12.0))`, `preserve_pitch: Some(true)`.
- Export as MP4 with `export_as` (returning early when it yields `None`, as the other tests do).
- Decode to f32 mono the way `decoded_audio_seconds` does, and assert that the rising zero-crossing frequency over 0.2–0.8 s is 880 Hz ±3 %.

Factor the decode step out of `decoded_audio_seconds` into `fn decoded_audio(path) -> (Vec<f32>, u32)` and reuse it in both.

- [ ] **Step 2: Run it**

Run: `cargo test -p celesta-exporter --test export_integration exports_a_pitched_audio_clip`
Expected: PASS (it exercises code already built in Tasks 2 and 4). If it fails, debug the stretch path rather than loosening the tolerance.

- [ ] **Step 3: Commit**

```bash
git add crates/exporter/tests/export_integration.rs
git commit -m "test(exporter): export a pitch-shifted audio clip (#312)"
```

---

### Task 6: Browser export rejects pitch

**Files:**
- Create: `packages/web/src/audio-support.ts`
- Modify: `packages/web/src/types.ts:100-110` (`AudioClip`), `packages/web/src/export.ts:11-15`
- Test: `packages/web/test/audio-support.test.mjs`

**Interfaces:**
- Produces: `export function assertBrowserMixable(clip: AudioClip): void`. It throws the existing animated-rate/volume error, the existing non-positive-rate error, and (new) the Global Constraints pitch error when `pitch` is present and not `0`, or when `preservePitch === true` and `playbackRate !== 1`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertBrowserMixable } from '../src/audio-support.ts';

const base = { src: 'a.wav', sourceStart: 0, playbackRate: 1, volume: 1, muted: false, start: 0, duration: 1 };
const message = /Audio pitch and preservePitch are not supported by browser export yet\./;

test('plain clips, and preservePitch at rate 1, are mixable', () => {
  assertBrowserMixable(base);
  assertBrowserMixable({ ...base, preservePitch: true });
  assertBrowserMixable({ ...base, pitch: 0 });
});
test('pitch or preservePitch with a rate change is rejected', () => {
  assert.throws(() => assertBrowserMixable({ ...base, pitch: 2 }), message);
  assert.throws(() => assertBrowserMixable({ ...base, pitch: { type: 'keyframes', keyframes: [] } }), message);
  assert.throws(() => assertBrowserMixable({ ...base, playbackRate: 2, preservePitch: true }), message);
});
test('existing checks still apply', () => {
  assert.throws(() => assertBrowserMixable({ ...base, playbackRate: 0 }), /playback rate must be positive/);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @celesta/web test`
Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement**

Add `pitch?: number | { type: 'keyframes'; keyframes: unknown[] }` and `preservePitch?: boolean` to `AudioClip`. Move the two existing checks in `mixAudio` into `assertBrowserMixable`, add the new one, and call it from `mixAudio` where the old checks were.

- [ ] **Step 4: Run the tests and build**

Run: `pnpm --filter @celesta/web test && pnpm --filter @celesta/web exec tsc -p tsconfig.json --noEmit`
Expected: pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): reject audio pitch in browser export (#312)"
```

---

### Task 7: Docs

**Files:**
- Modify: `packages/website/content/en/docs/02-(guides)/06-media.md`, `packages/website/content/ja/docs/02-(guides)/06-media.md`
- Modify: `packages/website/content/en/docs/03-(reference)/01-reference.md`, `packages/website/content/ja/docs/03-(reference)/01-reference.md` (the `frameKeyframes` row: pitch keyframes too; browser exporter limitation)
- Modify: `skills/celesta/references/react-core.md` (`<Audio>` prop table near line 583), `skills/celesta/references/project-json.md` (audio item near lines 169–174, validation list near line 309)

- [ ] **Step 1: Write the docs**

In the media guide (both languages), next to `playbackRate`, add a "Pitch" section with:
- the spec's example `<Audio src="bgm.mp3" playbackRate={1.25} preservePitch pitch={-2} />`;
- what each prop does and its default;
- the range ±24 and that fractions are cents;
- keyframes via `frameKeyframes`;
- the note that `@celesta/web` export rejects them.

In the skill references, add the two rows / fields and the validation rule `pitch` finite within −24…24. Follow each file's existing tone and table format.

- [ ] **Step 2: Verify the website builds**

Run: `pnpm --filter "./packages/website" build` (or the website's own build script name from its `package.json`)
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add packages/website skills
git commit -m "docs: document Audio pitch and preservePitch (#312)"
```
