# Motion blur and trails (2026-10-14)

Issue #295. `<MotionBlur shutterAngle samples>` averages its children over a
shutter around the frame; `<Trail copies lagInFrames trailOpacity>` draws
earlier, fainter copies beneath them. Both draw the children again at other
moments, through the runtime context, inside one frame request. What this
costs an export is in
[`docs/performance/motion-blur.md`](../performance/motion-blur.md).

## Scene model

- `LayerContent::Group` gained `motion_blur: bool` (`motionBlur` in JSON,
  omitted when false). Each child is one sample; renderers draw every sample
  onto a transparent canvas of its own and average them with equal weights,
  on premultiplied, sRGB-encoded values with no linearization:
  `color = Σ(c·a) / Σa`, `alpha = Σa / N`. The group is always isolated, and
  the average then goes through the mask, the effects, the opacity, and the
  blend mode. The clip applies to every sample.
- A field on `Group` rather than a new `LayerContent` variant, so every
  recursion over group children (static expansion, asset absolutizing,
  animated-image detection, component resolution) reaches the samples without
  changes. `LayerEffects` is untouched.
- The project format cannot author it; only React entries produce it.
- `<Trail>` needs no renderer support: its copies are ordinary groups with
  opacity.

## Renderers

- **GPU** (`crates/gpu-renderer`): `PreparedItem::BeginAverage`,
  `NextSample`, `EndAverage` and the matching `GpuStep`s. The group's canvas
  is planned like an isolated group's, covering what any sample covers. The
  compositor draws each sample onto one reused canvas and adds it into the
  group's canvas through `AveragePipeline` (`average.rs`, `average.wgsl`):
  additive blending weighted by the blend constant `1 / N`. On an adapter
  without blendable `Rgba16Float`, canvases are 8-bit and each weighted
  sample is rounded before it is added.
- **CPU** (`crates/renderer`): `render_average` sums each sample frame in
  `f32` and writes the average into the isolated frame.
- **Web** (`packages/web`): `SampleAverage` sums `getImageData` of each
  sample's surface in a `Float32Array`, with the CPU renderer's formula; a
  `globalAlpha = 1 / N` with `lighter` shortcut would round every sample to
  8 bits first.
- Parity: `crates/gpu-renderer/src/tests/motion_blur.rs` compares GPU and CPU
  (halves, a sliding disc, colors, premultiplied alpha, opacity and blend
  mode, clip, mask, a blended layer inside a sample, nested blurs, no
  samples, a shadow, a cropped canvas); `packages/web/test/motion-blur.test.mjs`
  pins the web average to the CPU test's numbers. A 1920x1080 scene with an
  8-sample blur and a 4-copy trail, drawn in Chrome by `@celesta/web` and by
  the native exporter, differed by at most 62 per channel (230 pixels over
  16, mean 0.083); the same scene without either differed by at most 79
  (2,029 pixels over 16, mean 0.039). The differences are the renderers'
  antialiased edges, which the blur widens and softens.

## React

- **Moments** (`packages/react/src/motion-blur.ts`): `<MotionBlur>` draws at
  the middles of `samples` equal parts of `[t − a/2, t + a/2]`, where `a` is
  `shutterAngle / 360` frames (180°, 8 samples: `t ± 1/32, ± 3/32, …`).
  Moments are clamped to the enclosing window's first and last frames
  (`0` and `durationInFrames − 1` of the innermost `<Sequence>`, or of the
  composition), except past the end when the window is open
  (`openEnd`), so a shot's first and last frames do not fade. `<Trail>`
  copies are at `t − k × lagInFrames`, opacity
  `trailOpacity × (1 − (k − 1) / copies)`, oldest first; copies before the
  window's first frame are dropped, not clamped.
- `samples = 1` or `shutterAngle = 0` renders a plain `group`, with no
  isolation cost.
- Each moment is a `time-sample` host element under a `motion-blur` or
  `trail` host element. Its subtree gets a `CompositionRuntimeContext` with
  the moment's `time` and `frameOffset`, the moment's distance from a whole
  frame. `useCurrentFrame()` returns `round(t·fps − frameOffset) +
  frameOffset`, so it reports `12.25` exactly through nested `<Sequence>`s,
  which a microsecond `Time` alone cannot. Outside, `frameOffset` is absent
  and the hook is unchanged. A function child `{(frame) => …}` receives the
  same value, for props computed outside the blur.
- **Media at the frame's moment:** `WalkContext.mediaTime` is the local time
  `<Video>`, animated images, and host elements (lip sync, blinking) use. It
  is `time` itself outside samples and goes through `<Sequence>`s with the
  same arithmetic as `time` would without samples, so a sample's `<Video>`
  carries exactly the timing the unblurred frame would. The decoder then
  matches its timestamp (`timestamps_match`, 1e-7 s) and decodes once.
  Shifting the sample's time back by its offset instead can land a
  microsecond off after rounding, and every sample would decode again.
- **Ids:** every sample's children are walked with the paths they would have
  without samples, so a layer has the same id in every moment (and a
  `<Video>` keeps one decode session). The sample groups are
  `<id>.sample.<index>`. Duplicate ids within a scene are deliberate here:
  hit testing and `layerSource` return any of them, which are the same JSX.
  Each sample still uploads its own `<Video>` texture.
- **Audio and subtitles** come from one sample: the `<MotionBlur>` moment
  nearest the frame (the earlier of two equally near), or `<Trail>`'s live
  children. The other samples walk with `subtitles: null` and a throwaway
  audio list, and the audio-only sweep (`collectAudio`) takes the same
  sample.
- **Copies:** every `<MotionBlur>` moment and past `<Trail>` copy provides its
  own `FreezeFrameContext` scope and walks with `frozen`, as `<FreezeFrame>`
  does. A `<CharacterView>` inside never attaches its author's ref, and a
  `<Dialogue>` must be in the same copy as its view.
  `<ProjectTimeline />`/`<ProjectTrack />` throw inside, because project
  layers are evaluated for the current frame only. `<Static>` cannot contain
  either element.
- The editor preview draws the same samples as the export; there is no
  preview-only reduction.

## Checks

- `cargo test -p celesta-renderer motion_blur`,
  `cargo test -p celesta-gpu-renderer motion_blur`,
  `pnpm --dir packages/react exec vitest run test/motion-blur.test.mjs`,
  `pnpm --dir packages/cli exec vitest run test/motion-blur.test.mjs`,
  `pnpm --dir packages/web run test`, and the bridge test
  `a_motion_blur_reaches_rust_as_a_group_of_samples_when_node_is_available`.
- `packages/cli/examples/with-motion-blur.tsx` takes `samples`,
  `shutterAngle`, and `copies` as project properties; `--props
  '{"samples":1,"copies":0}'` renders the same scene without either.
