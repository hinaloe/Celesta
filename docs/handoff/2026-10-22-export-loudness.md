# Export loudness (2026-10-22)

Every video export measures its mix's integrated loudness and true peak,
and `--loudness` brings the mix to a target (issue #441).

- **Measuring.** `measure_loudness` in `crates/media/src/loudness.rs`:
  integrated loudness from the `ebur128` crate (BS.1770 gating, exact block
  energies), true peak from Celesta's own 8x interpolator (32-tap
  Kaiser-windowed sinc, β 8). The crate's own 4x/48-tap true peak read the
  apex score 0.3 dB under a 16x FFmpeg resample, so a limiter built on it let
  peaks through; at 8x the reading matches FFmpeg's 16x within 0.01 dB.
  `measures_as_ffmpeg_ebur128_does` runs FFmpeg's `ebur128` filter through
  the linked libraries (`ametadata=print` to a file) and compares.
- **Normalizing.** `normalize_loudness` applies one gain to the unclipped
  mix (`mix_audio_graph_unclipped_cancellable`), so a mix over full scale
  comes down instead of being clipped first. `PeakHandling::Lower` caps that
  gain at the ceiling minus the input's true peak. `PeakHandling::Limit`
  (default) runs `Limiter`: per frame, the highest true peak within ±5 ms;
  the gain a frame may take is what keeps those peaks at the ceiling,
  averaged over ±5 ms (still under every bound, since each averaged frame's
  window covers this frame's peak) and released with a 100 ms time
  constant. Limiting lowers the loudness, so the gain is searched: the first
  pass ignores the limiter, then an extrapolated step (at most twice the
  error), then Illinois false position between a gain that fell short and
  one that went over, until within 0.05 LU (at most 8 passes, about 4 for a
  heavily limited mix). Any peak the meter still finds over the ceiling is
  taken off the whole mix. Silence or a mix under 400 ms has no integrated
  loudness and is left alone.
- **Determinism.** Everything is arithmetic in a fixed order; the rayon
  passes compute independent frames and reduce with `max`. Two exports of
  the same project hash the same (`ffmpeg -f md5`).
- **Exporter.** `ExportOptions::loudness: Option<LoudnessTarget>`;
  `finish_mix` (`crates/exporter/src/loudness.rs`) normalizes, clips to ±1,
  measures, and returns warnings; it runs on the project export's audio
  thread, alongside rendering. `ExportedFile::Video::loudness` carries
  `AudioLoudness` (`None` without an audio stream), and the JSON report's
  video output has `loudness` (`integratedLufs`, `truePeakDbtp`, `gainDb`
  with a target), rounded to 0.01. Dropping `Eq` from `ExportOptions`,
  `ExportProgress` and `ExportedFile` was needed for the `f64` fields.
- **Surfaces.** CLI `--loudness <LUFS|streaming|broadcast>`, `--true-peak`,
  `--peak-handling`; MCP `export_video` `loudness`, `truePeak`,
  `peakHandling`; `@celesta/exporter` the same names. The app's Export… is a
  save panel with no settings, so it sets no target; its finish notice shows
  the measured loudness. Setting a target there would need an export
  settings UI first.
- **Measured on the apex score (40–50 s).** MOV: ours -14.00 LUFS /
  -1.00 dBTP, FFmpeg `ebur128` -14.0 / -1.0, `loudnorm` -14.18 / -1.00.
  AAC and Opus move the loudness by about 0.1 LU and the true peak by about
  ±0.6 dB, which the docs mention with `--true-peak -2` for headroom.
  Measuring 10 minutes of stereo takes 0.85 s; limiting it, 4.4 s.
