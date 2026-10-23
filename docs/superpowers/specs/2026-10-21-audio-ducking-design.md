# Audio ducking design (issue #87)

## Goal

Commentary videos turn the BGM down while someone speaks and bring it back
up in the silences. Today authors write that by hand as `volume` keyframes,
for example `scoreVolume()` in `examples/feature-tour/audio.ts` and the
example-local `speechIntervals` + `duckVolume` recipe in
`packages/cli/examples/with-voice-level-matching.tsx` (#404). Each time the
script or the voices change, the keyframes have to follow.

Ducking makes that a declaration: mark the voices, say what ducks under
them, and the mixer builds the curve from where the voices actually are.

```tsx
<Dialogue character={zunda} audio="./voices/v1.wav">…</Dialogue>   // duckGroup "voice" by default
<Audio src="./bgm.wav" volume={0.55} duck={{ under: 'voice' }} />
<Video src="./game.mp4" duck={{ under: 'voice', to: { db: -6 } }} />
```

A plan-based helper builds the same curve as keyframes in `prepare()`, for
authors who want to shape the volume themselves.

### Anti-goals

Ducking fails, even if it technically works, when the result

- changes level abruptly (the bed bobs up and down between lines),
- distorts, or
- adds noise, such as clicks or zipper noise from a gain that moves in steps.

The defaults below are chosen against the first. Ducking only ever lowers
a clip, so it cannot cause clipping on its own. Every implementation
(native mixer, browser export) evaluates the gain per sample, or at a
resolution fine enough that no step is audible, and the tests check for it.

### Scope change from #149

The 0.5.0 plan (#149) limited #87 to a helper that builds keyframes from
`planDialogue()`, and left out "automatic processing by collecting every
`<Audio>` into groups". This design brings that declarative form in, and
keeps the helper as well. Realtime sidechain compression stays out.

## Authoring API

### Marking clips: `duckGroup`

```ts
export interface AudioProps {
  // ...existing props
  /** The group this clip's sound belongs to, for other clips' `duck.under`. */
  duckGroup?: string;
  /** Turn this clip down while clips of another group play. */
  duck?: AudioDuck;
}
```

- `<Audio>` and `<Video>` take `duckGroup` and `duck`. A `<Video>`'s
  soundtrack is mixed as a clip like any `<Audio>`, so it is marked and
  ducked the same way.
- Dialogue voices (`<Dialogue audio>`, and lines of a `DialogueSeries`)
  belong to the group `"voice"` unless they say otherwise. `duckGroup` on
  a dialogue line takes a string to use another group, or `null` to belong
  to none. Nothing ducks until some clip says `duck`, so existing videos
  sound exactly as before.
- A clip belongs to at most one group. `duckGroup` must be a non-empty
  string.
- Dialogue lines take `duckGroup` only, not `duck`: a voice marks where
  speech is and is not itself ducked. The character package does not pass
  a line's `duck` on to the clip, and project `dialogue` items have no
  `duck` field, so one is ignored as any unknown field is. Allowing it later
  would be purely additive.

### Ducking a clip: `duck`

```ts
export interface AudioDuck {
  /** The group, or groups, to duck under. With several, their intervals are joined. */
  under: string | string[];
  /** The gain under them: a multiplier from 0 to 1, or `{ db }` at or below 0. Defaults to 0.3. */
  to?: number | { db: number };
  /** Seconds the gain takes to come down, ending as the voice starts. Defaults to 0.15. */
  attack?: number;
  /** Seconds the gain takes to come back up, starting as the voice ends. Defaults to 0.4. */
  release?: number;
  /** Silences shorter than this many seconds stay ducked. Defaults to 0.6. */
  holdGap?: number;
}
```

- A clip has at most one `duck`. It cannot give each group its own level.
- `to: { db: -10 }` is the multiplier `10^(-10 / 20)`. A multiplier above 1,
  a `db` above 0, or a non-finite value is an error.
- `attack`, `release`, and `holdGap` must be finite and not negative.
- `attack: 0` or `release: 0` switches the gain instantly. The docs for
  both say so, and that an instant switch can click on some material. The
  value is used as written, not raised to a minimum, the same as
  `fadeIn` / `fadeOut`.
- `under` must be a non-empty string or a non-empty array of them. A group
  with no clips in it ducks nothing and is not an error (a video may have
  no lines yet).

### Project JSON

`audio` and `video` items take `duckGroup` and `duck` with the same
fields, in camelCase. `attack`, `release`, and `holdGap` are times, like
the items' `fadeIn` / `fadeOut`. `dialogue` items with `audio` belong to
`"voice"` unless their `duckGroup` says otherwise (`null` for none).
Validation rejects the cases listed above, at
`{path}.content.duck.<field>` and `{path}.content.duckGroup`.

## The ducking curve

One definition, used by the native mixer, the browser export, and the
helper.

### Input

- A list of intervals `[start, end]` in seconds on the composition clock
  (where the voices are).
- The resolved parameters: `to` as a multiplier `g`, `attack` `a`,
  `release` `r`, `holdGap` `h`.

### Building it

1. Drop intervals with `end <= start`. Sort by `start`.
2. Join intervals into runs. The next interval joins the current run when
   the silence between them (`next.start - run.end`) is shorter than `h`,
   or shorter than `a + r` (so a release and the next attack never
   overlap). Overlapping intervals join too. A joined run ends at the later
   `end`.
3. With no runs, the curve is the constant 1.
4. For each run `[s, e]`, the curve is 1 until `s - a`, eases down to `g`
   at `s`, holds `g` until `e`, and eases back up to 1 at `e + r`. Both
   ramps use the keyframe easing `ease-in-out`, the piecewise quadratic
   curve of `Easings.easeInOut` (`2t²` up to the middle, then
   `1 − 2(1 − t)²`), the curve the #404 recipe plays. Until #460 the
   keyframe `ease-in-out` was smoothstep (`t²(3 − 2t)`); it now matches
   `Easings`. They move the multiplier itself, not decibels, so `to: 0`
   works.

The curve is written as `Animatable<f64>` keyframes, so `evaluate_f64` on
the Rust side and the same evaluation on the TypeScript side give the
same values. A zero `attack` or `release` is two keys at the same time,
which the keyframe model already treats as a cut.

### Where the voices are

For the declarative form, a marked clip's interval runs from its
`range.start` to the earlier of

- its `range.end`, and
- when it does not `loop`, the timeline time at which its source position
  (`sourceStart + ∫ playbackRate`) reaches the end of the source
  (`sourceDuration`, or the decoded length).

Muted clips do not count. Leading and trailing silence inside the file
counts as playing; trimming silence is the helper's job (below).

### Applying it

A ducked clip's gain at timeline time `t` is

```
volume(local) × fade(local) × duck(t)
```

where `duck(t)` is the curve built from the intervals of every clip in its
`under` groups, except the clip itself. The curve is on the timeline like
the fades from #440: a clip's own `playbackRate`, `loop`, and `pitch` do
not move it.

Groups do not chain. A clip's interval comes from its range alone, so a
marked clip that is itself ducked still marks its whole interval. Cycles
(A ducks under B's group while B ducks under A's) are allowed and need no
special handling.

## Data flow

### Composition model (`crates/composition/src/model.rs`)

`AudioClip` gains

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub duck_group: Option<String>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub duck: Option<AudioDuck>,
```

`AudioDuck` holds resolved values: `under: Vec<String>`, `to: f64` (the
multiplier, after any dB conversion), and `attack`, `release`, `hold_gap`
as `Time`. Defaults and dB are resolved by the input layers (React,
project), so the mixer reads one shape. Clips without either field
serialize byte-identically. `ts-rs` regenerates the TypeScript types.

The curve construction (intervals and parameters to keyframes) is a pure
function in `crates/composition`, next to `AudioFade`, so the mixer, the
editor, and tests share it.

### React (`packages/react`, `crates/react-bridge`)

`collectAudioClip` in `render.ts` emits `duckGroup` and the resolved `duck`
on the descriptor, only when set, for `<Audio>` and `<Video>`. The
character package's `dialogue` host element passes `duckGroup: "voice"`
unless the line sets it. `ReactAudioClipDescriptor` (`types.rs`) reads
both, and `react_audio_clips` (`audio.rs`) copies them into `AudioClip`.
`merge_react_audio_clips` needs no change: the fields are part of a clip's
identity.

### Project (`crates/project`, `crates/evaluator`)

`TimelineContent::Audio` and `Video` gain `duck_group` and `duck`;
`Dialogue` gains `duck_group` only.
The evaluator resolves defaults and dB and fills `AudioClip`; dialogue
voice clips get `duck_group = Some("voice")` unless the item says
otherwise.

### Mixer (`crates/media`)

Both the editor preview and every export path call
`mix_audio_graph_cancellable`, so the curve is built there and preview and
export match by construction.

1. Before mixing, decode every clip that belongs to a group some other
   clip ducks under, and compute its interval.
2. For each clip with `duck`, build its curve from the intervals of its
   `under` groups, excluding itself.
3. Both mixer paths (`mix.rs` and `stretch.rs`) multiply `duck(t)` into the
   gain per sample, next to `fade.gain(...)`.

Clips without `duck` mix bit-identically to today. The editor's level
envelope (`clip_level_envelope` in `crates/editor/src/waveform.rs`)
multiplies the curve in as it does the fades. MCP scene summaries name a
clip's group and duck, as they name its fades.

### Browser export (`packages/web`)

`exportMp4` builds the same curves with the shared TypeScript function
(below) and chains one more `GainNode` per ducked clip after its fades,
as `fadeGains` does. The node's automation follows the curve finely
enough that no step is audible (see the anti-goals). Interval ends use the
decoded buffer's duration and the integrated `playbackRate`.

## Plan-based helper

For authors who want keyframes in hand, for example to combine ducking
with their own volume shaping.

- `@celesta/media-utils`: `duckEnvelope(intervals, duck, { origin })`
  returns the curve above as an `AnimatedNumber` of keyframes in seconds
  from `origin` (the composition time the `<Audio>`'s sequence starts on),
  ready for `volume`. `duck` takes the same fields as `AudioDuck` without
  `under`, plus `volume`: the constant level with nobody speaking
  (defaults to 1). The keyframe values are the curve times `volume`, so a
  bed at 0.8 ducked with `to: 0.3` sits at 0.8 and dips to 0.24; `to` is
  relative to `volume`, as it is to `volume` in the declarative form.
  Scaling by a constant keeps the curve exact. This is the one TypeScript
  implementation of the curve; the browser export uses it too.
- `@celesta/character`: builds intervals from a dialogue plan, and a
  convenience that feeds them to `duckEnvelope`. Lines without `audio` and
  muted lines are skipped. With a `VoiceLevelReport` from
  `matchVoiceLevels()`, each line's interval is trimmed to the speech the
  analysis found (`speechStartSeconds` to `speechEndSeconds`), as the #404
  recipe does; without one, a line's interval is its planned `from` and
  `durationInFrames`.

Given the same intervals and parameters, the helper and the declarative
form produce the same gain. They differ only in where the intervals come
from: the declarative form uses clip ranges, the helper the plan and,
optionally, the analysis.

## Prerequisite: animated volume and playback rate in the browser

`@celesta/web` throws on keyframed `volume` and `playbackRate` today
(`assertBrowserMixable`), so any keyframed volume, the helper's included,
cannot be exported in the browser. The first implementation step removes
that limit for both:

- A TypeScript evaluation and integration of `Animatable` keyframes that
  matches `evaluate_f64` / `integrate_f64` in `crates/composition` formula
  for formula, with the integrals. The Rust code is the reference. Every
  keyframe easing is the curve of the same name in `Easings`
  (`packages/react/src/animation.ts`); #460 changed the keyframe
  `ease-in-out` from smoothstep to its piecewise quadratic `easeInOut`,
  and the ducking curve with it.
- `volume` drives the clip's gain node; `playbackRate` drives the source's
  rate, so the source position follows the integral.
- Pitch and `preservePitch` stay unsupported in the browser, with the
  existing error.

Measured with `packages/web/test/manual/audio-automation.html` in
Chromium 152 (`OfflineAudioContext`, 48 kHz), before #460, while the
keyframe `ease-in-out` was still smoothstep:

- Volume: the largest difference from `evaluate_f64` is 2.1 × 10⁻⁶, and the
  largest step between neighboring samples (4.37 × 10⁻⁵) is no larger than
  the exact curve's own. Away from a cut, the gain never jumps.
- Playback rate: pulses land at most 1.32 ms from where the integral puts
  them, over a rate going 1 → 2 (linear) → 0.5 (`ease-in-out`) in 8 s.
  `playbackRate` takes one value per 128-frame quantum, so this is the
  expected size.

Comparisons of browser and native output in later steps allow 1 × 10⁻⁵
in gain and 2 ms in timing.

## Delivery

A stack of pull requests (`gh stack`), bottom first:

0. This design.
1. Browser export plays keyframed `volume` and `playbackRate`.
2. Ducking itself: the composition and project fields, the evaluator, the
   mixer, the React props and dialogue default, the shared TypeScript
   curve, the browser export, and tests that the Rust and TypeScript
   curves match.
3. The plan-based helper; replacing the #404 recipe in
   `with-voice-level-matching.tsx` and `scoreVolume()` in
   `examples/feature-tour`; docs.

## Testing

- `crates/composition`: the curve from interval lists: no intervals, one,
  overlapping, a gap under `holdGap`, a gap under `attack + release`, a gap
  long enough to recover, zero attack and release, `to: 0`.
- `crates/media`, on synthetic sines: RMS under and between voices; no
  change for clips without `duck`; both mixer paths; a marked clip whose
  source ends before its range; a looping marked clip; a muted marked
  clip; self-exclusion; a cycle; no step in the gain on a ramp (the
  sample-to-sample change of the gain stays within what the ease-in-out
  curve allows).
- `crates/project`: validation of every rule above, and round-trips
  without the fields unchanged.
- Evaluator and bridge: fields reach `AudioClip`; dialogue voices default
  to `"voice"`, take another group, or none with `null`.
- `packages/react` / `packages/character`: descriptors carry the resolved
  fields only when set.
- Rust and TypeScript curves agree on a shared set of interval fixtures.
- `packages/web`: keyframed volume and rate export; ducked export matches
  the native mixer within the measured tolerance.
- An exporter integration test exporting dialogue over ducked BGM.

## Docs

- `skills/celesta/references/react-core.md`, `project-json.md`, and
  `dialogue.md` (replacing the "until #87 lands" paragraph).
- The website media and dialogue guides and the reference (ja, en),
  including the instant-switch note on `attack` / `release`.

## Out of scope

Realtime sidechain compression; curve shapes other than `ease-in-out`; a
`lookahead` separate from `attack`; per-group levels on one clip; a clip
in more than one group; trimming silence inside files in the declarative
form; editing ducking in the editor's property panel; pitch in the
browser.

## Left to the builder

Internal names of the Rust and TypeScript functions, how the browser
export samples the curve into automation (as long as no step is audible),
and the exact names of the `@celesta/character` helpers.
