# Audio fade-in and fade-out (2026-10-20)

`<Audio fadeIn fadeOut>` (seconds) and project `audio` items' `fadeIn` /
`fadeOut` (times) ramp a clip from silence and back (issue #440).

- `AudioClip` carries `fade_in` / `fade_out` as `Time`, left out of JSON at
  zero. `AudioClip::fade()` turns them into an `AudioFade`, whose `gain(local
  seconds)` both mixer paths (`mix.rs` and `stretch.rs`) and the editor's
  level envelope (`clip_level_envelope`) multiply into `volume`.
- Each fade is a linear ramp on clip-local timeline seconds against
  `range.duration`. So the fade-out follows the clip's end when a
  `<Sequence>` changes length, and `loop`, `playbackRate`, and `pitch` do not
  move or stretch either fade. When the source ends before the range, the
  fade-out falls on silence.
- Fades that overlap multiply. A ducking curve (#87) can join as another
  factor of the same product.
- React fades sit at the edges of the audible window (`start` / `start +
  duration` of the descriptor). Unlike keyframes, they are not shifted by the
  head an outer sequence clips. `collectAudioClip` throws on a negative or
  non-finite value and omits zero fades, so descriptors without fades are
  unchanged. `<Video>` soundtracks and dialogue voices have no fades.
- `@celesta/web`'s `exportMp4` chains one `GainNode` per fade after the
  volume gain (`fadeGains` in `audio-support.ts`). Separate nodes give the
  same product as the native mixer when fades overlap.
- Only linear fades exist. A curve option would be a field on `AudioClip`
  that `AudioFade::gain` and `fadeGains` both read.
- Tests: RMS of the head, middle, and tail on synthetic sines in
  `crates/media` (both mixer paths, keyframed volume, loop at rate 2, two
  sequence lengths), a real MP4 export in the exporter's integration tests,
  and `packages/cli/examples/with-audio-fade.tsx` collected through the
  bridge.
