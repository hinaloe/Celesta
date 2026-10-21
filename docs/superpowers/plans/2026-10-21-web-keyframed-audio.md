# Keyframed audio volume and playback rate in browser export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@celesta/web`'s `exportMp4` plays clips whose `volume` or `playbackRate` is keyframed, matching the native mixer, instead of throwing.

**Architecture:** A dependency-free TypeScript port of `evaluate_f64` / `integrate_f64` (`packages/web/src/keyframes.ts`) is pinned to the Rust implementation by one JSON fixture that a Rust integration test and a node test both read. A pure function turns an animated value into Web Audio automation events; `scheduleClip` in `audio-support.ts` builds each clip's node graph from them, and `mixAudio` in `export.ts` only decodes and calls it. A manual browser harness measures how closely Web Audio follows the curves, and the result is written into the spec.

**Tech Stack:** TypeScript (node `--experimental-strip-types` tests, esbuild-wasm for bundling a module under test), Web Audio (`OfflineAudioContext`), Rust (`celesta-composition`, serde_json).

**Spec:** `docs/superpowers/specs/2026-10-21-audio-ducking-design.md`, section "Prerequisite: animated volume and playback rate in the browser".

## Global Constraints

- The Rust code in `crates/composition/src/animation.rs` is the reference. The TypeScript port follows it formula for formula, including its quirks. Do not port from `Easings` in `packages/react/src/animation.ts`: its `easeInOut` is quadratic, while the keyframe `ease-in-out` is smoothstep (#460).
- Easing belongs to the destination keyframe of a segment. Before the first key and after the last one, the value is clamped to that key's value. Two keys at the same time are a cut: the value at that time is the first key's, and the value just after it is the second key's.
- Numeric integration for the non-polynomial easings uses composite Simpson's rule with `STEPS = 128`, exactly as Rust does. The closed forms are used for `linear`, `ease-in`, `ease-out`, and `ease-in-out`.
- Volume values are clamped to `[0, 16]`, as `mix.rs` does.
- Pitch stays unsupported in the browser. A clip with `pitch` other than 0, or with `preservePitch` and a `playbackRate` that is not the constant 1, is rejected with the existing message `Audio pitch and preservePitch are not supported by browser export yet.`
- A playback rate must stay positive everywhere it is scheduled. Otherwise the clip is rejected with the existing message `Audio playback rate must be positive.` (Web Audio would play a negative rate backwards, while the native mixer plays silence.)
- `packages/web/src/keyframes.ts` has no runtime imports; type-only imports from `./types` are fine. That way node can import it directly in tests. Modules with runtime imports are tested through an esbuild bundle, as `test/scene-canvas.test.mjs` does.
- Run commits and tests as separate steps. Never amend a commit.

## Review Focus

- A rate eased with an overshooting curve (`ease-out-back`) between positive keys can dip to or below 0. Expected: rejected with the rate message, not played backwards. (Task 2)
- A clip whose `start` is before 0: automation cannot be scheduled before context time 0, so it starts from the value the curve has reached by then, as the fades do. (Task 2)
- A rate keyframe before the clip's local 0 (React emits these when an outer `<Sequence>` clips the head). `integrate_f64` restarts such a segment at 0 with the earlier key's value instead of its true mid-segment value. The port reproduces this, and the fixture pins it. Web Audio follows the true curve, so playback differs from native for such clips. That is a known divergence in the Rust code, outside this PR. (Task 1)
- A very long eased segment (ten minutes) must not produce hundreds of thousands of automation events. (Task 2)
- `loop` with a keyframed rate: the source is stopped at the clip's timeline end, not after a buffer-time duration computed from a constant rate. (Task 2)

---

### Task 1: Keyframe evaluation, pinned to Rust by a shared fixture

**Files:**
- Create: `crates/composition/tests/fixtures/keyframe-evaluation.json`
- Create: `crates/composition/tests/keyframe_fixture.rs`
- Create: `packages/web/src/keyframes.ts`
- Create: `packages/web/test/keyframes.test.mjs`
- Modify: `packages/web/src/types.ts` (the `AudioClip` type, around line 120)

**Interfaces:**
- Produces, in `packages/web/src/types.ts`:
  ```ts
  /** Kebab-case names of `crates/composition`'s `Easing`, all 34. */
  export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | /* …the other 30 */;
  export type Keyframe = { time: { value: number; timescale: number }; value: number; easing?: KeyframeEasing };
  export type AnimatedNumber = number | { type: 'keyframes'; keyframes: Keyframe[] };
  ```
  `AudioClip.playbackRate`, `volume`, and `pitch` become `AnimatedNumber`.
- Produces, in `packages/web/src/keyframes.ts`:
  - `evaluateAnimated(value: AnimatedNumber, seconds: number): number`, the port of `evaluate_f64`.
  - `integrateAnimated(value: AnimatedNumber, seconds: number): number`, the port of `integrate_f64`: the integral from local 0 to `seconds`, where a `seconds` below 0 counts as 0.
  - Both throw `Error('animation has no keyframes')` for an empty list, and `Error('unknown easing: <name>')` for a name outside `KeyframeEasing`.

- [ ] **Step 1: Write the fixture's cases, without expected numbers**

  `keyframe-evaluation.json` holds `{ "cases": [{ "name", "animation", "samples": [{ "time": { "value", "timescale": 1000000 }, "value": null, "integral": null }] }] }`. `animation` uses the same JSON as an `Animatable<f64>` (a number, or `{ "type": "keyframes", "keyframes": [...] }`). Cases:
  - One per easing (all 34): keys `0 s → 0` and `1 s → 1` with that easing. Samples at 0.25, 0.5, 0.8, and 1.5 s.
  - `static`: the number `2.5`. Sample at 0.5 s.
  - `single-key`: one key `1 s → 42`. Samples at 0 and 2 s.
  - `before-first`: keys `1 s → 5` and `2 s → 7` (linear). Samples at 0.5 and 1.5 s.
  - `cut`: keys `0 → 0`, `1 s → 1` (linear), `1 s → 3`, `2 s → 3`. Samples at 1 s and 1.5 s.
  - `pre-zero-rate`: keys `-1 s → 1` and `1 s → 3` (linear). Sample at 1 s. Rust gives the integral 2, not the true 2.5; that is the quirk to pin.

- [ ] **Step 2: Write the Rust test `keyframe_fixture_matches_the_evaluator` in `crates/composition/tests/keyframe_fixture.rs`**

  It reads the fixture with `include_str!` and `serde_json`. For each sample, it computes `evaluate_f64` and `integrate_f64` at `Time::new(value, timescale)`. It collects every sample whose expected `value` or `integral` is null, or differs by more than `1e-9`, into lines of the form `"<case> @ <value>/<timescale>: value <v>, integral <i>"`, and panics with all of them if there are any.

- [ ] **Step 3: Run it and fill in the fixture**

  Run: `cargo test -p celesta-composition --test keyframe_fixture`
  Expected: FAIL, listing every sample's computed `value` and `integral`. Copy those numbers into the fixture (full `f64` precision), then run it again.
  Expected: PASS.

  Check the hand-known values while copying: `ease-in-out` at 0.25 s is `0.15625` (smoothstep, not the quadratic `0.125`); `static` integral at 0.5 s is `1.25`; `cut` is `1` at 1 s and `3` at 1.5 s; `pre-zero-rate` integral is `2`.

- [ ] **Step 4: Write the node test `packages/web/test/keyframes.test.mjs`**

  - `every fixture sample matches the Rust evaluator`: it reads `../../../crates/composition/tests/fixtures/keyframe-evaluation.json` and asserts, for every sample, `|evaluateAnimated(animation, value / timescale) − value| ≤ 1e-9` and the same for `integrateAnimated` and `integral`.
  - `empty keyframes throw`: `evaluateAnimated({ type: 'keyframes', keyframes: [] }, 0)` throws `/animation has no keyframes/`.
  - `an unknown easing throws`: a key with `easing: 'wobble'` throws `/unknown easing: wobble/`.

- [ ] **Step 5: Run it to verify it fails**

  Run: `pnpm --dir packages/web test`
  Expected: FAIL in `keyframes.test.mjs`, because `../src/keyframes.ts` does not exist.

- [ ] **Step 6: Implement `packages/web/src/keyframes.ts` and the types in `types.ts`**

  Port `evaluate_f64`, `integrate_f64`, `apply_easing`, `ease_out_bounce`, `easing_integral`, and `integrate_numerically` line by line. Time is `value / timescale` seconds.

- [ ] **Step 7: Run the tests and type-check**

  Run: `pnpm --dir packages/web test`
  Expected: PASS.
  Run: `pnpm --dir packages/web exec tsc -p tsconfig.json --noEmit`
  Expected: no errors.

- [ ] **Step 8: Commit**

  ```bash
  git add crates/composition/tests packages/web/src/keyframes.ts packages/web/src/types.ts packages/web/test/keyframes.test.mjs
  git commit -m "feat(web): evaluate audio keyframes as the native mixer does (#87)"
  ```

### Task 2: Schedule keyframed volume and playback rate in browser export

**Files:**
- Modify: `packages/web/src/keyframes.ts` (add `automationEvents`)
- Modify: `packages/web/src/audio-support.ts`
- Modify: `packages/web/src/export.ts:7-34` (`mixAudio`)
- Modify: `packages/web/test/keyframes.test.mjs`
- Modify: `packages/web/test/audio-support.test.mjs`
- Modify: `packages/website/content/en/docs/02-(guides)/06-media.md:15`, `packages/website/content/ja/docs/02-(guides)/06-media.md:15`, `packages/website/content/en/docs/03-(reference)/01-reference.md:46`, `packages/website/content/ja/docs/03-(reference)/01-reference.md:46`

**Interfaces:**
- Consumes: `evaluateAnimated` and `AnimatedNumber` from Task 1.
- Produces, in `keyframes.ts`:
  ```ts
  export type AutomationEvent = { kind: 'set' | 'ramp'; value: number; time: number };
  export const AUTOMATION_STEP_SECONDS = 0.001;
  export const MAX_POINTS_PER_SEGMENT = 1024;
  /** Events for an AudioParam following `value`, whose local 0 is context time `start`, up to context time `end`. */
  export function automationEvents(value: AnimatedNumber, start: number, end: number, range?: { min: number; max: number }): AutomationEvent[];
  ```
- Produces, in `audio-support.ts`:
  - `applyEvents(param: Pick<AudioParam, 'setValueAtTime' | 'linearRampToValueAtTime'>, events: AutomationEvent[]): void`
  - `scheduleClip(context: Pick<BaseAudioContext, 'createBufferSource' | 'createGain' | 'destination'>, clip: AudioClip, buffer: AudioBuffer, total: number): void`, which builds one clip's graph. `total` is the mix's length in seconds.
  - `assertBrowserMixable(clip)` keeps its name. It no longer narrows `volume` or `playbackRate` to numbers.

`automationEvents` builds the events this way (`l` is local seconds, `t0 = max(0, start)`):

1. A static value is one `set` of the (clamped) value at `t0`.
2. Otherwise, start with `set(evaluateAnimated(value, t0 − start), t0)`.
3. Walk the keyframe windows in order. Skip a window that ends at or before local `t0 − start`; stop at the first window that starts at or after local `end − start`. For a window ending at local `lt`:
   - zero length (a cut): `set(to.value, start + lt)`;
   - linear or no easing: `ramp(to.value, start + lt)`;
   - any other easing: from `a = max(window start, t0 − start)`, take `n = min(ceil((lt − a) / AUTOMATION_STEP_SECONDS), MAX_POINTS_PER_SEGMENT)` points at `a + (lt − a)·k/n` for `k = 1..n`, each a `ramp` to `evaluateAnimated` at that point.
4. Clamp every value to `range` when it is given.

`scheduleClip` does what `mixAudio`'s loop body does today, with these changes:
- `end = clip.start + clip.duration`.
- The rate events are `automationEvents(clip.playbackRate, clip.start, end)`. Any value that is not finite or not above 0 throws `Audio playback rate must be positive.` The events go onto `source.playbackRate` with `applyEvents`.
- The volume events are `automationEvents(clip.volume, clip.start, end, { min: 0, max: 16 })`, applied to the volume gain. The fade gains chain after it, as today.
- It calls `source.start(Math.max(0, clip.start), offset)` with two arguments, then `source.stop(Math.min(end, total))`. It schedules nothing when `clip.start >= total` or `end <= Math.max(0, clip.start)`.

`mixAudio` keeps decoding, the `muted` skip, and the skip for a *static* `volume` of 0, and calls `scheduleClip` for each clip.

- [ ] **Step 1: Write the failing `automationEvents` tests in `keyframes.test.mjs`**

  - `a static value is one set at the clip start`: `automationEvents(0.5, 2, 4)` deep-equals `[{ kind: 'set', value: 0.5, time: 2 }]`.
  - `linear keys become one ramp each`: keys `0 → 0`, `1 s → 2` (linear) with `start 3, end 10` deep-equal `[set 0 @ 3, ramp 2 @ 4]`.
  - `an eased segment is sampled every millisecond`: keys `0 → 1`, `0.3 s → 0.3` (`ease-in-out`) with `start 0, end 1` give 1 `set` plus 300 `ramp`s. Each ramp's value equals `evaluateAnimated` at its local time, and the last ramp is `0.3 @ 0.3`.
  - `a cut is a set at the same time`: the `cut` keys from the fixture give `set 3 @ 1` right after `ramp 1 @ 1`.
  - `a clip starting before 0 starts from where the curve has got to`: keys `0 → 0`, `2 s → 2` (linear) with `start −1, end 5` deep-equal `[set 1 @ 0, ramp 2 @ 1]`.
  - `a long eased segment is capped`: keys `0 → 0`, `600 s → 1` (`ease-in-out-sine`) with `start 0, end 600` give exactly `1 + MAX_POINTS_PER_SEGMENT` events.
  - `windows past the end are not scheduled`: keys `0 → 0`, `1 s → 1`, `5 s → 0` (all linear) with `start 0, end 2` produce no event later than 5 s, and none for the window starting at 5 s.
  - `values are clamped to the range`: keys `0 → 0.1`, `1 s → 1` (`ease-in-back`, which dips below 0) with `range { min: 0, max: 16 }` have no value below 0.

- [ ] **Step 2: Run them to verify they fail**

  Run: `pnpm --dir packages/web test`
  Expected: FAIL: `automationEvents` is not exported.

- [ ] **Step 3: Implement `automationEvents` in `keyframes.ts`**

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `pnpm --dir packages/web test`
  Expected: PASS for the `automationEvents` tests.

- [ ] **Step 5: Change `audio-support.test.mjs` to import a bundle, and write the failing tests**

  Bundle `../src/audio-support.ts` with esbuild-wasm into a temp directory under `../node_modules/`, as `scene-canvas.test.mjs` does (lines 8–13), and import `assertBrowserMixable`, `fadeGains`, `applyEvents`, and `scheduleClip` from it. Extend the `recording` context with `createBufferSource()`, which returns a node whose `playbackRate` records `set` / `ramp` and whose `start(...args)` / `stop(...args)` record their arguments, and with `destination`. Tests:
  - Replace `existing checks still apply` with `keyframed volume and rate are mixable`: `assertBrowserMixable` accepts a keyframed `volume` and a keyframed `playbackRate`, and still rejects a static rate of 0 with `/playback rate must be positive/`.
  - `preservePitch with a keyframed rate is rejected`: it throws the pitch message.
  - `scheduleClip starts with two arguments and stops at the clip end`: a clip with `start 1, duration 3, loop: true` and a keyframed rate records `start(1, 0)` and `stop(4)`. With `total 2.5`, it records `stop(2.5)`.
  - `scheduleClip schedules the rate and volume curves`: the source's `playbackRate` and the first gain's `gain` record exactly the `automationEvents` for the clip's rate and for its volume (clamped).
  - `a rate that overshoots below 0 is rejected`: keys `0 → 1`, `1 s → 0.05` (`ease-out-back`) make `scheduleClip` throw `/playback rate must be positive/`.
  - `a clip after the end of the mix is not scheduled`: with `clip.start >= total`, no source is created.
  - The existing fade tests keep passing unchanged.

- [ ] **Step 6: Run them to verify they fail**

  Run: `pnpm --dir packages/web test`
  Expected: FAIL in `audio-support.test.mjs` (`scheduleClip` and `applyEvents` missing; keyframed clips still rejected).

- [ ] **Step 7: Implement `applyEvents`, `scheduleClip`, and the new `assertBrowserMixable` in `audio-support.ts`; reduce `mixAudio` in `export.ts` to decoding and calling `scheduleClip`**

- [ ] **Step 8: Run the tests and type-check**

  Run: `pnpm --dir packages/web test`
  Expected: PASS, all files.
  Run: `pnpm --dir packages/web exec tsc -p tsconfig.json --noEmit`
  Expected: no errors.

- [ ] **Step 9: Update the four website lines**

  In English, replace "The browser exporter supports only constant volume and playback rate, and does not support pitch." with "The browser exporter supports keyframed volume and playback rate, but not pitch." In Japanese, replace 「ブラウザでの書き出しは、固定の音量と再生速度に限られ、ピッチは使えません。」 with 「ブラウザでの書き出しは、音量と再生速度のキーフレームにも対応しますが、ピッチは使えません。」.

- [ ] **Step 10: Commit**

  ```bash
  git add packages/web packages/website/content
  git commit -m "feat(web): play keyframed volume and playback rate in browser export (#87)"
  ```

### Task 3: Measure how closely Web Audio follows the curves

**Files:**
- Create: `packages/web/test/manual/audio-automation.html`
- Create: `packages/web/test/manual/audio-automation.ts`
- Modify: `docs/superpowers/specs/2026-10-21-audio-ducking-design.md` (the "Prerequisite" section)
- Create: `docs/handoff/2026-10-21-web-keyframed-audio.md`

**Interfaces:**
- Consumes: `evaluateAnimated`, `integrateAnimated` (Task 1); `scheduleClip` (Task 2).

The harness page runs two measurements in an `OfflineAudioContext` (2 channels, 48 kHz), through `scheduleClip`, so it measures the shipped code path. It prints one JSON object with both results and `navigator.userAgent` to the page and the console.

- **Volume:** the source is a 4 s buffer of 1.0 at a constant rate of 1, so each output sample equals the gain. Volume keys: `0 → 1`, `0.5 s → 0.3` (`ease-in-out`), `2 s → 0.3`, `2 s → 0.8` (a cut), `3 s → 1` (`ease-in-out-cubic`). It reports the largest `|output − evaluateAnimated(volume, i / 48000)|`, and, away from the cut (±2 samples), the largest step between neighboring samples next to the largest step of the exact curve.
- **Rate:** the source is a 12 s buffer with a one-sample impulse every 0.05 s of source time. Rate keys: `0 → 1`, `4 s → 2` (linear), `8 s → 0.5` (`ease-in-out`); 10 s are rendered. It finds each impulse in the output (samples above 0.5). For the impulse at source second `s`, it finds the expected time by bisection on `integrateAnimated(rate, t) = s`. It reports the largest timing error in milliseconds.

`playbackRate` on an `AudioBufferSourceNode` is k-rate: it takes one value per 128-frame quantum. For this rate curve, expect an error of the order of 1–2 ms. Tens of milliseconds mean the scheduling is wrong (for example, events not offset by `clip.start`).

- [ ] **Step 1: Write the harness**

- [ ] **Step 2: Run it in Chrome**

  Run: `pnpm --dir packages/web exec vite`, then open `http://localhost:5173/test/manual/audio-automation.html`.
  Expected: a JSON result. The volume error is below `1e-4`. No volume step is larger than the exact curve's largest step plus `1e-4`. The rate error is a few milliseconds at most.

- [ ] **Step 3: Write the measured numbers into the spec**

  In the spec's "Prerequisite" section, replace the sentence that says the tolerance is measured in this step with the measured volume error, step, and rate timing error, with the browser and version. Also state the tolerances that PR ② uses to compare browser and native ducking (the measured values, rounded up).

- [ ] **Step 4: Write the handoff note `docs/handoff/2026-10-21-web-keyframed-audio.md`**

  In the style of `docs/handoff/2026-10-20-audio-fade.md`, cover: the port and its fixture, the automation scheme (the 1 ms step and the 1024-point cap), `start` / `stop`, the rejected cases, the measured numbers, and the pre-0 rate-key divergence.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/web/test/manual docs/superpowers/specs/2026-10-21-audio-ducking-design.md docs/handoff/2026-10-21-web-keyframed-audio.md
  git commit -m "test(web): measure keyframed audio against the native curves (#87)"
  ```
