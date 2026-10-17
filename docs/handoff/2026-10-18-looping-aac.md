# Looping AAC sound (2026-10-18)

`celesta-exporter --loop` (MCP `export_video` `loop: true`) writes an MP4
whose sound runs from its end into its start, for videos played on repeat
(issue #228). Without it, the AAC encoder starts from silence and smears a
hit on frame 0 for about 10 ms.

- `ExportOptions::looping` (`crates/exporter/src/options.rs`). Only
  `mux_audio` (`render.rs`) reads it, and only for MP4: it stages
  `loop_lead_in(audio)`, the mix's last `LOOP_LEAD_IN_FRAMES` (16 × 1024)
  sample frames, cycled when the mix is shorter, ahead of the mix, and adds
  `asetpts=PTS-<frames>/SR/TB` to the audio output. The lead-in's packets
  then have negative timestamps, and the MP4 muxer writes them into the edit
  list next to the encoder's 1024 priming samples (`media_time` 17408).
  ez-ffmpeg 0.18 has no `-itsoffset`; this one-pass form gives the same
  packets and edit list as `render.py`'s old two-pass workaround.
- Why sixteen frames: with four, a loud first hit at 48 kHz still came out
  worse than with no lead-in, since the encoder settles its bit allocation
  over its first frames. From sixteen on, the first hit's SNR equals the same
  hit's later in the file.
- `examples/shorts-loop` (12.8 s, 48 kHz): bar-head SNR (first 1024 samples
  against `score.wav`) was 17.5 / 33.7 / 34.3 / 32.2 dB without `--loop` and
  30.7 / 36.1 / 34.3 / 32.1 dB with it. FFmpeg and Apple's decoder (afinfo,
  afconvert) both decode 614 400 samples, the video's length.
- FFmpeg's decoder does not trim the last AAC frame's padding, with or
  without `--loop`, so a mix that is not a whole number of 1024-sample
  frames decodes slightly long there; the stream's duration (edit list) and
  Apple's decoder are exact.
- The CLI rejects `--loop` with `.mov`, `.webm`, stills, and subtitles-only
  runs, and the MCP tool rejects `loop` with `.mov` and `.webm` or without an
  output. Without the option, `mux_audio` is unchanged.
- `examples/shorts-loop/render.py` is gone; its README exports with `--loop`.
- Tests: `a_loop_lead_in_is_the_end_of_the_mix` (`src/tests.rs`),
  `a_looping_mp4_starts_its_sound_from_its_end` (`tests/export_integration.rs`:
  start 0, duration exactly 1 s, the first hit's error below the later hits'
  and under a third of the unlooped one's), `loop_applies_to_mp4_only`
  (`main.rs`), and `a_looping_mp4_is_asked_for_with_loop` (`crates/mcp`).
- Docs: `skills/celesta/references/export.md` (Looping video),
  `loops.md`, `SKILL.md`, and the website's Export guide (en/ja).
