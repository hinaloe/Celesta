# Audio spectrum and loudness (#299)

```tsx
import { loadAudioSpectrum, useAudioSpectrum } from '@celesta/media-utils';
import type { AudioSpectrum } from '@celesta/media-utils';

let music: AudioSpectrum;
export async function prepare() {
  music = await loadAudioSpectrum('./score.mp3', { bands: 32, smoothing: { attack: 0.01, release: 0.2 } });
}
// In a component: const { bands, rms } = useAudioSpectrum(music);
```

## Analysis

`analyzeAudioSpectrum({ sampleRate, samples }, options)` in
`packages/media-utils/src/spectrum.ts` is the one implementation every
runtime uses. It analyzes the whole file once, in order, every `hopSeconds`
(default 1/240 s): a Hann window of `fftSize` samples (default 2048) centered
on the hop's time, zero outside the file, a radix-2 FFT, and per-bin power
scaled so a full-scale sine centered on a bin reads 0 dB (DC and Nyquist are
not doubled). The result is plain data: every hop's band levels and RMS.

- Bands divide `minFrequency` (20 Hz) to `maxFrequency` (16 kHz, capped at
  Nyquist) into equal steps on the `scale`: `'log'` (default), `'linear'`, or
  `'mel'` (2595·log10(1 + f/700)). A band's power is the mean of the bins in
  [low, high), the last band's upper edge included; a band narrower than a
  bin interpolates the power at its center between the two nearest bins.
- Levels are 10·log10(power) mapped from `minDecibels` (−80) to
  `maxDecibels` (−20) onto 0–1 and clamped. The defaults were chosen from the
  example's score, where bass peaks near the top and the highs reach about a
  third. RMS is linear, over the same window without the Hann weighting.
- `smoothing` is one time constant in seconds or `{ attack, release }`,
  applied hop by hop as y += (1 − exp(−hop/τ))·(x − y), with τ chosen by
  whether the value rises or falls. Levels are smoothed after the dB mapping,
  so a release falls evenly in dB. Smoothing starts from 0 at the first hop.
- `spectrumAt(spectrum, seconds)` interpolates linearly between the two
  hops around the time; outside [0, duration] it returns zeros. Because
  everything stateful happened in `prepare()`, a frame's value is a pure
  function of its time: independent of fps and of render order.
- `useAudioSpectrum(spectrum, { startFrom })` reads `useCurrentTime()`, the
  enclosing `<Sequence>`'s clock, plus `startFrom`. `playbackRate` is not
  followed.

`decodeAudio()` in `@celesta/react/internal` caches the decoding promise by
resolved path until the runtime installs a decoder again, and
`loadAudioSpectrum(src, options)` caches analyses on that promise, so the
browser Worker, which lives across compiles, drops both when it recompiles.
There is no persistent cache: the editor's several runtime processes per
entry each decode and analyze once. At the defaults a 3-minute file is
43,201 FFTs of 2048 points; the only timing taken was on a machine under a
load average of 60 to 100, where it took 40 s, so it is not a guide to the
usual cost.

## Decoding

The samples are mono, the mean of the channels, at the stream's own sample
rate, so neither runtime resamples.

- Native: `prepare()` asks Rust with a new handshake request,
  `{"decodeAudio":{"path"}}` (`crates/react-bridge/src/decode.rs`). Rust
  fetches a URL through `RemoteAssetCache`, probes the stream, and decodes it
  with `FfmpegBackend::decode_audio`, the decoder the preview and export mix
  with: a mono stream as mono (FFmpeg would spread it over two channels at
  −3 dB), anything else as stereo, then averages. The samples go to a
  temporary file of little-endian f32 because a song's worth of JSON would be
  tens of megabytes on one stdin line, which the CLI reads 4 KiB at a time.
  The file is created exclusively under a random name with owner-only
  permissions, so nothing placed in a shared `/tmp` is written through. The
  reply is `{"audio":{"path","sampleRate","frames"}}`; the CLI reads the
  file before it sends anything else, and Rust removes the file when the next
  handshake message arrives or the handshake ends.
- `@celesta/web`: the Worker installs a decoder that reads the bytes from
  `CompileOptions.assets` (the uploaded files given to `SceneCanvas`), then
  `baseURL`, then an http(s) URL, and decodes the primary audio track with
  Mediabunny's `AudioSampleSink`, placing samples by timestamp and trimming
  to the track's computed duration. PCM decodes everywhere; compressed codecs
  need WebCodecs support for them in that browser.
- `inspect.mjs` without the exporter answers `decodeAudio` with the `ffmpeg`
  command, the same way it answers `probeMedia` with `ffprobe`.

For the committed 16-bit mono WAV, FFmpeg's samples equal
`@celesta/character`'s `decodeWav` (the live bridge test checks this) and
Mediabunny's (the web worker test), so all three give identical values.
Other PCM layouts are expected to match but are not tested; compressed files
may differ slightly between native and web because the decoders differ.
`Engine.compile` times out after 30 s, which also bounds decoding a long
compressed file in the Worker.

## Example

`examples/resonance` analyzes its generated score three ways (64 log bands
with a fast release for a mirrored ring, 48 mel bands for a floor, RMS with
a slow release for a meter and glow). `make-score.py` writes the WAV with
Python's standard library; it is ignored by Git like the other examples'
scores.

## Verification

- `packages/media-utils` tests: 0 dB for a bin-centered full-scale sine, the
  loudest band holding a tone, RMS ≈ 0.707, silence and out-of-range zeros,
  identical results regardless of read order, hop interpolation,
  attack/release time constants, band edges for each scale and the Nyquist
  cap, sub-bin bands, option errors, the loader's cache, and the hook on a
  `<Sequence>` clock with `startFrom`.
- `crates/react-bridge` unit tests: downmix, decoding the committed WAV to a
  temporary file that is removed, fresh owner-only temporary files, and an
  undecodable path.
- Live bridge test `audio_spectrum_is_the_same_in_preview_and_export_when_node_is_available`:
  two runtimes, one with `set_preview(true)` reading frames in reverse
  order, return identical band levels and RMS, equal to the values from the
  JavaScript WAV parser.
- `@celesta/web` worker test: an uploaded WAV decoded by Mediabunny gives
  the same values as `decodeWav`; a recompile with a different file under the
  same name reads the new file; a missing file reports `Missing audio file`.
- Also run: `cargo test --workspace` (no failures or skipped live tests),
  `pnpm run test:runtime`, `@celesta/web` build and tests, website tests and
  `check:examples`, `typecheck:examples`, templates, and `inspect.mjs` on the
  example with and without the exporter. The machine was heavily loaded;
  `packages/cli` tests needed `--testTimeout` to avoid 5 s timeouts.
- `cargo clippy -p celesta-react-bridge --all-targets --no-deps -D warnings`
  is clean. Without `--no-deps` it stops in the existing
  `clippy::needless_range_loop` in `crates/budoux`, and `cargo fmt --check`
  reports existing differences in files this change does not touch.
