# Animated images (2026-10-14)

Issue #288. `<Image>` reads GIF, and an animated GIF, APNG, or WebP plays
in step with the composition: the frame showing at the layer's time is
drawn, in the app, in export, and in `@celesta/web`.

- Scene model: `LayerContent::Image` gained `animation:
  Option<ImageAnimation { source_time_seconds, loop }>` (JSON `animation:
  { sourceTimeSeconds, loop }`, omitted when absent). Absent, an animated
  image draws its first frame; a still image ignores it.
- React: `<Image>` takes `startFrom` (seconds, default 0), `playbackRate`
  (default 1), and `loop` (default true). The walker always sends
  `sourceTimeSeconds = startFrom + local time × playbackRate`, as for
  `<Video>`, since it cannot know whether the file is animated, except
  inside `<Static>`, which cannot depend on the time (first frame).
- Bridge: `AnimatedImages` (`crates/react-bridge/src/animated_images.rs`)
  drops `animation` from every image whose file is not animated, checked
  once per asset from its header (`image_source::is_animated`; a GIF's first
  two frames). Still images therefore keep the scene JSON they had before,
  so loop checks (`inspect.mjs --loop`, MCP) and caches see no change from
  frame to frame. An unreadable file keeps its time and is retried.
- Projects: a timeline `image` item plays from the item's start, looping.
  Dialogue portraits and mouths stay still (`animation: None`).
- Decoding: `celesta_renderer::image_source::decode_animation` decodes
  every frame up front with the `image` crate, which composites them
  through their disposal and blending, so scrubbing anywhere is a lookup.
  Frames are kept as `Arc<RgbaImage>` (capped at 1 GiB per animation, an
  error past it) with their end times in microseconds. Two quirks of
  `image-webp` are worked around: disposed frames only clear when a
  background color is set (set to transparent, as browsers do, instead of
  the file's hint), and a file whose VP8X header lacks the alpha flag
  would come out opaque black where no frame drew, so the flag is set on a
  copy before decoding. Its blending rounds opaque over transparent to 254
  as libwebp's `anim_decode.c` does.
- Frame choice (`animation_frame`, mirrored by `animationFrame` in
  `packages/web/src/animated-image.ts` with the same test cases): the time
  is rounded to microseconds; before the start is the first frame; past
  the end it wraps with `loop` or holds the last frame. Delays of 10 ms or
  less show for 100 ms, as browsers show them.
- Renderers: `ImageSources::render` takes the animation and returns the
  frame index in `DisplayImage::frame`; the GPU texture cache key and the
  CPU fit-render layout key include it, so a still image's keys are
  unchanged.
- `preloadMedia()`: the bridge asks `image_source::probe_animation` before
  FFmpeg (which cannot read animated WebP: it reports a 0x0 stream). An
  animated image answers `durationSeconds`, `video: { width, height,
  durationSeconds }`, and `animation: { frameCount, durationSeconds }`.
  The probe reads 16 bytes first, so a video is not read whole.
  `inspect.mjs`'s Node-only fallback still uses ffprobe and reports no
  `animation`.
- Web: `SceneCanvas` decodes animated frames once per asset with WebCodecs'
  `ImageDecoder` into `ImageBitmap`s (released by `dispose()`). Without
  `ImageDecoder` (or for a still image) it draws the `<img>` as before,
  which shows an animation's first frame.

Validation: `cargo test` for `celesta-renderer` (`image_source` GIF
disposal Keep/Previous/Background and transparent pixels, APNG
dispose/blend ops, WebP disposal, looping, holding, fit), `celesta-gpu-renderer`
(`animated_images_draw_the_frame_at_their_time_as_the_cpu_does`),
`celesta-evaluator`, `celesta-react-bridge` (unit, and the live
`animated_images_report_their_length_and_play_when_node_is_available`
with `packages/cli/examples/with-animated-image.tsx`), `@celesta/react`
(`test/image.test.mjs`), and `@celesta/web` (`test/animated-image.test.mjs`,
with a mocked `ImageDecoder`; Node has none).
