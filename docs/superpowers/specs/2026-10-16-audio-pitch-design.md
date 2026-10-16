# `<Audio pitch preservePitch>` design (issue #312)

## Goal

An audio clip's pitch is tied to its speed: `playbackRate` reads the source
faster or slower, so `playbackRate={1.25}` also raises the pitch, like tape.
There is no way to transpose a clip, or to change its speed without changing
its pitch.

It has to serve voices (dialogue pitch, faster narration that keeps
its voice), music (transposing BGM, fitting BGM to a length without changing
its key), and effects (variations of one sound, a pitch that rises over time).
Music rules out a simple algorithm; effects need pitch to be animatable.

```tsx
<Audio src="bgm.mp3" playbackRate={1.25} preservePitch pitch={-2} />
```

## API

```ts
export interface AudioProps {
  // ...existing props
  /**
   * Transposition in semitones, -24 to 24. Fractions are cents (0.5 is 50
   * cents). Defaults to 0. Either a plain number or a generated
   * `KeyframeAnimation` over seconds-into-the-sequence times, like
   * `playbackRate`.
   */
  pitch?: AnimatedNumber;
  /**
   * When true, `playbackRate` changes only how long the clip takes, and the
   * pitch is set by `pitch` alone. Defaults to false: speed and pitch move
   * together, as before.
   */
  preservePitch?: boolean;
}
```

The heard transposition at a local time `t` is

```
factor(t) = 2^(pitch(t) / 12) × (preservePitch ? 1 : playbackRate(t))
```

and the source position at `t` is unchanged: `sourceStart + ∫ playbackRate`.
With `pitch = 0` and `preservePitch = false` this is today's behavior exactly.

Project JSON gets the same two fields on `content.type = "audio"`:
`pitch: Animatable<f64>` and `preservePitch: bool`, both optional.

Out of scope: `<Video>` audio, `<Dialogue>` / character voice props, the
editor property panel, and pitch in the browser runtime (`@celesta/web`).

## Data flow

### Composition model (`crates/composition/src/model.rs`)

`AudioClip` gains:

```rust
#[serde(default = "zero_pitch", skip_serializing_if = "is_zero_pitch")]
pub pitch: Animatable<f64>,           // static 0.0 by default
#[serde(default, skip_serializing_if = "is_false")]
pub preserve_pitch: bool,
```

Serialized clips without pitch stay byte-identical. `ts-rs` regenerates
`packages/react/src/generated/AudioClip.ts` (and `TimelineContent.ts`).

### Project JSON (`crates/project`)

`TimelineContent::Audio` gains `pitch: Option<Animatable<f64>>` and
`preserve_pitch: Option<bool>`. Validation rejects a `pitch` (static value or
any keyframe value) that is not finite or lies outside `[-24, 24]`, at
`{path}.content.pitch`. The evaluator maps them onto `AudioClip`, shifting
keyframes like `playback_rate`; video clips get `pitch = 0`,
`preserve_pitch = false`.

### React (`packages/react`, `crates/react-bridge`)

`AudioProps` gains `pitch` and `preservePitch`. `render.ts` collects them
next to `playbackRate`: `pitch` goes through `animatedNumber` and
`shiftAnimated(pitch, -clipped)` like `volume`; `preservePitch` is emitted
only when true. `<Video>`'s collector never sets them. The bridge's
`AudioClipDescriptor` (`types.rs`) reads them with defaults and `audio.rs`
copies them into `AudioClip`.

## Mixer (`crates/media/src/mix.rs`)

Both the editor preview (`crates/editor/src/audio.rs`) and every export path
call `mix_audio_graph_cancellable`, so implementing pitch there makes preview
and export identical by construction.

### Fast path

A clip whose `pitch` is `Static(0.0)` and that has either
`preserve_pitch = false` or `playback_rate = Static(1.0)` goes through the
existing per-sample interpolation loop, unchanged. Every existing project
mixes bit-identically.

### Stretch path

Every other clip goes through Signalsmith Stretch via the
[`signalsmith-stretch`](https://crates.io/crates/signalsmith-stretch) crate
(MIT; the C++ library is MIT too). It builds with `cc` and `bindgen`;
`ffmpeg-sys-next` already needs libclang for `bindgen`, so the build gains
no new system requirement. Tested in an isolated new module,
`crates/media/src/stretch.rs`, that `mix.rs` calls per clip.

For a clip covering output frames `start..end`:

1. Create `Stretch::preset_default(2, sample_rate)`.
2. Walk the output in blocks of `BLOCK = 512` frames. For block
   `[a, b)`, with local times `ta`, `tb`:
   - source positions `sa = source_start + ∫₀^ta rate`,
     `sb = source_start + ∫₀^tb rate` (seconds → frames);
   - input frame count `n_in = round(sb·sr) − round(sa·sr)` (rounding the
     endpoints, not the difference, so blocks never drift);
   - `set_transpose_factor(factor(ta))`;
   - read `n_in` input frames starting at `round(sa·sr)` and `process` them
     into `b − a` output frames.
3. Input reads honor the same rules as the fast path: wrap modulo the
   source length when `loop`; silence past `source_duration` and past the
   end of the file; silence before 0.
4. Latency: before the first block, `seek` with the `input_latency()` frames
   that precede `round(s0·sr)`, at the clip's first rate, so the first
   output frame corresponds to the clip's first source frame. The output is
   not delayed relative to the fast path.
5. Each output frame is multiplied by `volume(t)` and added into the mix,
   exactly as the fast path does.

Cancellation is checked once per block. Transposition changes per block
(~10 ms at 48 kHz), which is smooth enough for animated pitch.

A rate of 0 or below cannot be stretched; the stretch path treats a block
with `n_in ≤ 0` as silence, matching how the fast path drops non-finite or
negative source positions.

## Browser runtime (`packages/web/src/export.ts`)

`AudioClip` in `types.ts` gains the two optional fields. `mixAudio` throws
`Audio pitch and preservePitch are not supported by browser export yet.`
when a clip's `pitch` is not 0, or `preservePitch` is true and its
`playbackRate` is not 1, mirroring the existing animated-rate error.

## Testing

- Existing mixer, exporter and bridge tests pass unchanged (fast path is
  bit-identical).
- `crates/media` unit tests with a synthetic 440 Hz sine source:
  - `pitch = 12` → measured frequency ≈ 880 Hz, length unchanged;
  - `playbackRate = 2, preservePitch` → length halves, frequency ≈ 440 Hz;
  - `playbackRate = 2, pitch = 0, preservePitch = false` stays on the fast
    path;
  - `playbackRate = 2, pitch = -12, preservePitch = false` → ≈ 440 Hz;
  - keyframed pitch 0 → 12 → frequency rises over the clip;
  - onset alignment: a source whose first non-silent frame is known starts
    at the same output frame (± a few ms) on both paths;
  - `loop` and `sourceDuration` limits hold on the stretch path;
  - cancellation stops the stretch path.
- `crates/project` validation: out-of-range and non-finite pitch rejected,
  keyframes checked, round-trip without the fields unchanged.
- Evaluator / bridge tests: fields reach `AudioClip`, keyframes shifted by
  the sequence clip offset.
- `packages/react` test: `<Audio pitch preservePitch>` produces the
  descriptor fields; `<Video>` does not.
- Exporter integration test exporting a clip with `pitch` and
  `preservePitch`.
- `packages/web`: export rejects pitch with the error above.

## Docs

- Website media guide and reference (ja, en): the two props and the
  `factor(t)` rule, with the browser-runtime limitation.
- `skills/celesta/references/react-core.md` and `project-json.md`.
