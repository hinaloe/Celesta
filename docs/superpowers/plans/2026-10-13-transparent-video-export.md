# Transparent Video Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export ProRes 4444 `.mov` and VP9-alpha `.webm` with transparent undrawn areas, from the CLI, the MCP server and the app.

**Architecture:** The GPU renderer gains a 16-bit straight-alpha readback; the exporter clears to transparent for alpha formats and feeds `rgba64le` to `prores_ks` / `libvpx-vp9` through libswscale (BT.709), then muxes PCM or Opus audio. A `VideoFormat` chosen by output extension threads through `ExportOptions`, the CLI, MCP, the app and the `--json` report.

**Tech Stack:** Rust 2024, wgpu/WGSL, ez-ffmpeg 0.18 (FFmpeg 8.1), clap 4, GitHub Actions, vcpkg/Homebrew.

**Spec:** `docs/superpowers/specs/2026-10-13-transparent-video-export-design.md`

## Global Constraints

- Build with FFmpeg 8: `PKG_CONFIG_PATH="$(brew --prefix ffmpeg@8)/lib/pkgconfig"` on macOS (the default `ffmpeg` formula is 9 and breaks the build).
- `Mp4` output stays byte-for-byte as before: libx264, AAC 192k, `movflags=+faststart`, untagged BT.601.
- `Mov`: `prores_ks`, `profile=4444`, `alpha_bits=16`, `vendor=apl0`, `yuva444p10le`; audio `pcm_s24le`, `movflags=+faststart`.
- `Webm`: `libvpx-vp9`, `crf=20`, `b=0`, `row-mt=1`, `yuva420p`; audio `libopus` `b=192k` at 48000 Hz, no `movflags`.
- `Mov` and `Webm`: video filter `scale=out_color_matrix=bt709:out_range=tv`, codec options `colorspace=bt709`, `color_primaries=bt709`, `color_trc=bt709`, `color_range=tv`; background `Color::TRANSPARENT`; readback `Rgba16Straight`.
- Extension matching is case-insensitive everywhere (`.MOV` is `Mov`).
- `--json` video entries gain `"format": "mp4" | "mov" | "webm"` and `"alpha": bool`; a missing encoder is error code `encoder_unavailable`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit signing goes through 1Password; on "failed to fill whole buffer", ask the user to unlock it, never bypass signing.

## Review Focus

- An upper-case extension (`clip.MOV`, `clip.WebM`) is accepted as that format by the exporter, the CLI, MCP and the app — pinned in Tasks 2, 5 and 6.
- A React entry with no `<Audio>` exported to `.webm` publishes the video-only file (no mux stage) and reports `audio: false` — pinned in Task 3.
- A project whose sample rate is not 48 kHz (8 kHz, 44.1 kHz) exported to `.webm` gets 48 kHz Opus instead of an encoder error — pinned in Task 3.
- `--output-format webm` together with `--frame`/`--every`/`--contact-sheet` is a usage error, not a silent PNG export — pinned in Task 4.
- With `--json`, the H.264-flag and format/extension mismatches print a JSON usage report on stdout, not clap's stderr text — pinned in Task 4.

---

### Task 1: Straight-alpha 16-bit readback

**Files:**
- Modify: `crates/gpu-renderer/src/types.rs:141-170` (`ReadbackFormat`)
- Modify: `crates/gpu-renderer/src/quantize.wgsl`, `crates/gpu-renderer/src/quantize.rs`
- Modify: `crates/gpu-renderer/src/readback.rs:99-160`, `crates/gpu-renderer/src/renderer.rs:406-420,695`, `crates/gpu-renderer/src/encode.rs:58`
- Test: `crates/gpu-renderer/src/tests.rs` (next to `reads_frames_back_in_sixteen_bits`)

**Interfaces:**
- Produces: `ReadbackFormat::Rgba16Straight` — same `rgba64le` layout as `Rgba16`, color divided by alpha, zero-alpha pixels `(0,0,0,0)`. `is_yuv()` is `false` for it.
- Produces (crate-internal): `enum QuantizeOutput { Premultiplied, Straight }`; `Quantizer::ensure_pipeline(&mut self, device, format: wgpu::TextureFormat, output: QuantizeOutput)` and `Quantizer::encode(&self, encoder, frame, target, format, output)`; pipelines keyed by `(wgpu::TextureFormat, QuantizeOutput)`. `Straight` is only used with `Rgba16Uint`. `RgbaReadback` stores its `output`.

- [ ] **Step 1: Write the failing tests**

`reads_frames_back_with_straight_alpha`: renderer with `background: Color::TRANSPARENT`, skip unless `composites_in_half_floats`; scene of a red rectangle at opacity 0.5 covering part of the frame (build it the way the neighbouring tests build scenes). After `set_readback_format(ReadbackFormat::Rgba16Straight)`, `submit` + `drain`:
```rust
assert_eq!(frame.format(), ReadbackFormat::Rgba16Straight);
// inside the rectangle: straight red, half alpha
assert!(inside[0].abs_diff(65535) <= 64 && inside[1] <= 64 && inside[2] <= 64);
assert!(inside[3].abs_diff(32768) <= 64);
// outside: nothing drawn
assert_eq!(outside, [0, 0, 0, 0]);
```
`straight_alpha_matches_premultiplied_divided_by_alpha`: render the same scene containing an antialiased (rotated) edge twice, once with `Rgba16` and once with `Rgba16Straight`; for every pixel with premultiplied alpha `a >= 4096`, each straight channel equals `premultiplied * 65535 / a` within `65535 / a + 1` codes (half a code of premultiplied rounding, scaled up by the division).

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p celesta-gpu-renderer straight_alpha`
Expected: FAIL to compile — no variant `Rgba16Straight`.

- [ ] **Step 3: Implement**

`quantize.wgsl`: add `@fragment fn rgba16_straight(...) -> @location(0) vec4<u32>`: clamp to `[0,1]`; if `a > 0` divide `rgb` by `a` and clamp again, else all zero; `floor(x * 65535.0 + 0.5)`. Update the file header comment. `quantize.rs`: key pipelines by `(format, output)`, entry point `"fragment"` / `"rgba16"` / `"rgba16_straight"`. `readback.rs`: `Rgba16Straight` also uses `Rgba16Uint`. `renderer.rs::set_readback_format`: ensure the `Straight` pipeline for `Rgba16Straight`; pass the slot's `output` at line 695. Update `ReadbackFormat` docs.

- [ ] **Step 4: Run the crate's tests**

Run: `cargo test -p celesta-gpu-renderer`
Expected: PASS (all, including `reads_frames_back_in_sixteen_bits`).

- [ ] **Step 5: Commit** — `feat(gpu-renderer): read frames back with straight alpha`

---

### Task 2: `VideoFormat`, output validation, encoder check and report fields

**Files:**
- Modify: `crates/exporter/src/options.rs`, `crates/exporter/src/lib.rs`
- Modify: `crates/exporter/src/render.rs:326-334` (`validate_output`)
- Modify: `crates/exporter/src/error.rs`, `crates/exporter/src/control.rs:35-53`, `crates/exporter/src/report.rs`
- Modify: `crates/exporter/src/exporter.rs`, `crates/exporter/src/react_entry.rs` (call sites only)
- Test: `crates/exporter/src/tests.rs`, `crates/exporter/src/report.rs` (its `tests` module)

**Interfaces:**
- Produces:
  - `pub enum VideoFormat { #[default] Mp4, Mov, Webm }` (`Clone, Copy, Debug, Default, PartialEq, Eq`), with `ALL`, `as_str(self) -> &'static str` (`"mp4"`/`"mov"`/`"webm"`), `from_extension(path: &Path) -> Option<Self>` (case-insensitive), `has_alpha(self) -> bool`, `Display`, `FromStr<Err = UnknownVideoFormat>`, and `pub(crate) fn encoders(self) -> [&'static str; 2]` (`["libx264","aac"]`, `["prores_ks","pcm_s24le"]`, `["libvpx-vp9","libopus"]`). Exported from `lib.rs` with `UnknownVideoFormat`.
  - `ExportOptions::video_format: VideoFormat`.
  - `ExportedFile::Video { .., format: VideoFormat }`.
  - `ExportError::EncoderUnavailable { format: VideoFormat, encoder: &'static str }`; `UnsupportedOutput(PathBuf)` gains the expected format: `UnsupportedOutput { path: PathBuf, format: VideoFormat }`.
  - `pub(crate) fn validate_output(output: &Path, format: VideoFormat, overwrite: bool) -> Result<(), ExportError>`.
  - `pub(crate) fn ensure_encoders(format: VideoFormat) -> Result<(), ExportError>` in `render.rs`, using `ez_ffmpeg::capabilities::is_encoder_available`.

- [ ] **Step 1: Write the failing tests**

In `tests.rs`:
```rust
#[test]
fn video_formats_follow_the_extension() {
    assert_eq!(VideoFormat::from_extension(Path::new("a.mp4")), Some(VideoFormat::Mp4));
    assert_eq!(VideoFormat::from_extension(Path::new("a.MOV")), Some(VideoFormat::Mov));
    assert_eq!(VideoFormat::from_extension(Path::new("a.WebM")), Some(VideoFormat::Webm));
    assert_eq!(VideoFormat::from_extension(Path::new("a.gif")), None);
    assert!(!VideoFormat::Mp4.has_alpha() && VideoFormat::Mov.has_alpha() && VideoFormat::Webm.has_alpha());
}
```
Extend the existing `validate_output` test (around line 316): `video.mov` with `Mov` and `VIDEO.MOV` with `Mov` are `Ok`; `video.mov` with `Mp4` and `video.webm` with `Mov` are `Err(UnsupportedOutput { .. })`; existing file without overwrite still `OutputExists`.
`linked_ffmpeg_has_every_format_encoder`: `ensure_encoders` is `Ok` for all of `VideoFormat::ALL` (fails loudly on a build missing libvpx/libopus, which is the point).

In `report.rs` tests: the existing video-entry test (around line 436) passes `format: VideoFormat::Mov` and expects `"format": "mov", "alpha": true` in the JSON; a new case maps `EncoderUnavailable { format: Webm, encoder: "libvpx-vp9" }` to code `"encoder_unavailable"` with a message naming both. Update `mcp_hints_name_tool_arguments` for the new `UnsupportedOutput` shape.

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p celesta-exporter --lib`
Expected: FAIL to compile — `VideoFormat` not found.

- [ ] **Step 3: Implement**

`UnsupportedOutput` message: `export output must use the .{format} extension: {path}`; CLI hint `write video to a .mp4, .mov or .webm path, or select frames with --frame or --every for PNG`; MCP hint `write video to a .mp4, .mov or .webm path with export_video, or render PNG frames with render_frames`. `EncoderUnavailable` message: `this FFmpeg build has no {encoder} encoder, which {format} export needs`, no hint. Call `validate_output(.., self.options.video_format, ..)` then `ensure_encoders(self.options.video_format)` at both export entry points (`exporter.rs:79`, `react_entry.rs:132`), and set `format` on both `ExportedFile::Video`. `report.rs::Output::Video` gains `format: &'static str` and `alpha: bool`.

- [ ] **Step 4: Run tests**

Run: `cargo test -p celesta-exporter --lib && cargo build --workspace`
Expected: PASS; the workspace builds (MCP/editor/CLI still compile with defaults).

- [ ] **Step 5: Commit** — `feat(exporter): add video formats and report them`

---

### Task 3: Encode and mux ProRes 4444 and VP9 alpha

**Files:**
- Modify: `crates/exporter/src/render.rs` (`export_renderer`, `open_video_writer`, `mux_audio`, both `render_*video` call sites)
- Modify: `crates/exporter/src/exporter.rs:117-125`, `crates/exporter/src/react_entry.rs:193-200,248-255` (temporary file names)
- Modify: `crates/exporter/src/tests.rs:176` (existing `open_video_writer` call)
- Test: `crates/exporter/tests/export_integration.rs`

**Interfaces:**
- Consumes: `ReadbackFormat::Rgba16Straight` (Task 1); `VideoFormat`, `ExportOptions::video_format`, `ensure_encoders` (Task 2).
- Produces: `export_renderer(asset_root, frame_rate, format: VideoFormat, color_conversion, bit_depth, render_quality, driver)` and `open_video_writer(width, height, frame_rate, format: VideoFormat, encoding: VideoEncoding, input: ReadbackFormat, output)`; `mux_audio` reads `self.options.video_format`.

- [ ] **Step 1: Write the failing integration tests**

Shared fixture `transparent_project(dir) -> Project`: `examples/minimal.celesta.json` at 64x64, 2 fps, 1 s, `sample_rate = 8_000`, one image item from a 64x64 PNG filled with straight `(255, 0, 0, 128)` (built like `png_integration.rs:270-320`; an image is centered on the canvas origin, so it covers the top-left 32x32 quadrant). Helper `decode_rgba64(path, decoder: Option<&str>) -> Vec<u16>` transcodes the first frame with `FfmpegContext` to `rawvideo`/`rgba64le` (setting `Input::set_video_codec(decoder)` when given) and returns the samples. Both tests skip on `GpuRenderError::RequestAdapter` like the existing ones.

`exports_transparent_prores_4444`: export to `clip.mov` with `video_format: Mov`, then
```rust
// video: codec "prores", bt709 tags (AVCOL_SPC/PRI/TRC_BT709 == 1)
assert_eq!(codec_name, "prores");
assert_eq!((color_space, color_primaries, color_transfer), (1, 1, 1));
// audio: codec "pcm_s24le", sample rate 8000
let pixels = decode_rgba64(&output, None);
let (inside, outside) = (pixel(&pixels, 8, 8), pixel(&pixels, 48, 48));
assert!(inside[3].abs_diff(128 * 257) <= 2 * 257, "{inside:?}");
assert!(inside[0].abs_diff(65535) <= 3 * 257 && inside[1] <= 3 * 257, "{inside:?}");
assert_eq!(outside[3], 0);
```
`exports_transparent_vp9_webm`: the same scene to `clip.webm` with `Webm`; video `codec_name == "vp9"`, stream metadata `alpha_mode == "1"`, BT.709 tags; audio `codec_name == "opus"` and `sample_rate == 48_000` (resampled from 8 kHz); `decode_rgba64(&output, Some("libvpx-vp9"))` with the same pixel assertions but a tolerance of `6 * 257` (4:2:0 chroma).
`exports_a_silent_react_entry_to_webm`: an `.tsx` entry with no `<Audio>` (reuse whichever React fixture the existing React export tests use) exported to `.webm`; it succeeds, has a `vp9` stream and no audio stream, and the reported `ExportedFile::Video` has `audio: false` and `format: Webm`. Skip as the existing React export tests do when Node is unavailable.

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p celesta-exporter --test export_integration transparent`
Expected: FAIL — the export writes H.264 (or fails on the extension).

- [ ] **Step 3: Implement**

`export_renderer`: for `format.has_alpha()` build `GpuRenderOptions { background: Color::TRANSPARENT, driver, .. }` and set `ReadbackFormat::Rgba16Straight`; `Mp4` unchanged. `open_video_writer`: `Rgba16Straight` maps to `"rgba64le"`; branch the `Output` on format with the Global Constraints values (keep the CRF check for `Mp4` only). Temporary files: `video.{ext}` and `.suffix(".{ext}")` from `format.as_str()`. `mux_audio`: per format codec/options from Global Constraints; `Webm` adds `set_audio_sample_rate(48_000)` and drops `movflags`.

- [ ] **Step 4: Run tests**

Run: `cargo test -p celesta-exporter`
Expected: PASS, including the existing `converting_colors_on_the_gpu_matches_the_encoder_conversion` and MP4 tests unchanged.

- [ ] **Step 5: Commit** — `feat(exporter): encode ProRes 4444 and VP9 with alpha`

---

### Task 4: CLI formats, H.264 flag checks and dashboard labels

**Files:**
- Modify: `crates/exporter/src/main.rs` (`Cli`, `OutputFormat`, `main`, `png_output`, `export`, `AFTER_HELP`)
- Modify: `crates/exporter/src/progress.rs` (`Settings`, labels at lines 69, 349-353, 447-470, 632-642, 734)
- Test: `crates/exporter/src/main.rs` (new `#[cfg(test)] mod tests`)
- Create: `crates/exporter/tests/cli_formats.rs` (runs the built binary)

**Interfaces:**
- Consumes: `VideoFormat` (Task 2).
- Produces: `OutputFormat { Png, Mp4, Mov, Webm }`; `fn output_choice(cli: &Cli, explicit: &dyn Fn(&str) -> bool) -> Result<Option<VideoFormat>, String>` — `None` means PNG; `progress::Settings::format: VideoFormat`.

- [ ] **Step 1: Write the failing tests**

Parse with `Cli::try_parse_from` + the matches (see Step 3) and assert on `output_choice`:
- `out.mov` → `Some(Mov)`; `out.WEBM` → `Some(Webm)`; `out.mp4` → `Some(Mp4)`; `--output-format webm out.webm` → `Some(Webm)`.
- `--output-format mp4 out.mov` → `Err` containing `"does not match"`.
- `out.mov --crf 20`, `out.webm --preset fast`, `out.mov --bit-depth 10`, `out.webm --color-conversion gpu` → `Err` naming the flag and `"H.264"`.
- `out.mp4 --crf 20` → `Ok(Some(Mp4))`.
- `--output-format webm --frame 0 out.png` and `--output-format mov --contact-sheet --every 5 out.png` → `Err` (`require PNG output`).
- `out.gif` → `Err` (`.mp4, .mov or .webm`).
`tests/cli_formats.rs::json_reports_h264_flags_on_mov_as_usage_errors` runs `env!("CARGO_BIN_EXE_celesta-exporter")` with `--json <workspace>/examples/minimal.celesta.json <tempdir>/out.mov --crf 20` and asserts a failing exit status, empty stderr, and exactly one stdout line parsing to `"status": "error"`, `"error": { "code": "usage", .. }` whose message mentions `--crf`; a second case does the same for `--output-format mp4 <tempdir>/out.mov`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p celesta-exporter --bin celesta-exporter --test cli_formats`
Expected: FAIL to compile — `output_choice` not found.

- [ ] **Step 3: Implement**

In `main`, parse with `let matches = Cli::command().try_get_matches()` and `Cli::from_arg_matches(&matches)`, keeping today's error handling; `explicit = |id| matches.value_source(id) == Some(ValueSource::CommandLine)`. `output_choice` replaces `png_output`, keeps its PNG rules, and returns usage errors through `usage_error(cli.json, ..)`. `export` sets `ExportOptions::video_format`. `--output-format` help: `Output format; PNG is implied by a frame selection, video formats by the extension`. Add to `AFTER_HELP`:
```
A .mov output is ProRes 4444 with 24-bit PCM audio and a .webm output VP9
with Opus; both keep transparency where nothing is drawn (straight alpha,
BT.709). --preset, --crf, --bit-depth and --color-conversion apply to MP4 only.
```
Dashboard: header `MOV / ProRes 4444 + PCM`, `WEBM / VP9 alpha + Opus`; Encode line `ProRes 4444` / `VP9 CRF 20`; the color line for alpha formats ` Alpha    straight, BT.709`; footer format strings likewise; stage label `Muxing` (no container name); the plain-log `muxing` line likewise.

- [ ] **Step 4: Run tests**

Run: `cargo test -p celesta-exporter`
Expected: PASS, including the existing progress tests (update their `Settings` literals with `format: VideoFormat::Mp4`).

- [ ] **Step 5: Commit** — `feat(exporter): choose MOV and WebM output in the CLI`

---

### Task 5: MCP `export_video` accepts `.mov` and `.webm`

**Files:**
- Modify: `crates/mcp/src/args.rs:87-105,303-345`, `crates/mcp/src/server.rs:207-209` (tool description)
- Test: `crates/mcp/src/args.rs` (`tests`)

**Interfaces:**
- Consumes: `VideoFormat::from_extension` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `outputs_need_the_right_extension`: `a.png` error now mentions `.mp4, .mov or .webm`. New `transparent_formats_follow_the_extension`: `a.mov` → `job.options.video_format == Mov`; `a.WEBM` → `Webm`; `{ "output": "a.mov", "crf": 20 }`, `{ "output": "a.webm", "preset": "fast" }`, `{ "output": "a.mov", "bitDepth": 10 }` are rejected with a message containing the field name and `"MP4"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p celesta-mcp args`
Expected: FAIL — `.mov` is rejected.

- [ ] **Step 3: Implement**

Derive the format with `VideoFormat::from_extension`; for alpha formats reject any `Some` of `preset`/`crf`/`bit_depth` (`"{field} applies to MP4 output only"`). Field doc on `output`: `The .mp4, .mov (ProRes 4444 with alpha) or .webm (VP9 with alpha) to write.` Tool description: `Export a React entry or JSON project as an H.264/AAC MP4, a ProRes 4444 MOV or a VP9 WebM (both transparent where nothing is drawn), all of it or the start/end span. …` (keep the rest of the existing sentence).

- [ ] **Step 4: Run tests**

Run: `cargo test -p celesta-mcp`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(mcp): export transparent MOV and WebM`

---

### Task 6: App keeps `.mov` / `.webm` from the save dialog

**Files:**
- Modify: `crates/editor/src/helpers.rs` (new function), `crates/editor/src/export_control.rs:74-77,111-118`, `crates/editor/src/export_worker.rs:12-19,57-62`
- Test: `crates/editor/src/tests.rs`

**Interfaces:**
- Consumes: `VideoFormat` (Task 2).
- Produces: `pub(crate) fn export_output(path: PathBuf) -> (PathBuf, VideoFormat)` in `helpers.rs`; `ExportRequest::format: VideoFormat`.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn export_output_keeps_video_extensions() {
    let case = |path: &str| export_output(PathBuf::from(path));
    assert_eq!(case("a.mov"), (PathBuf::from("a.mov"), VideoFormat::Mov));
    assert_eq!(case("a.WebM"), (PathBuf::from("a.WebM"), VideoFormat::Webm));
    assert_eq!(case("a.mp4"), (PathBuf::from("a.mp4"), VideoFormat::Mp4));
    assert_eq!(case("a"), (PathBuf::from("a.mp4"), VideoFormat::Mp4));
    assert_eq!(case("a.gif"), (PathBuf::from("a.mp4"), VideoFormat::Mp4));
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p celesta-editor export_output`
Expected: FAIL to compile — `export_output` not found.

- [ ] **Step 3: Implement**

`export_control.rs` calls `export_output` in place of the `.mp4` check and passes the format through `start_export` into `ExportRequest`; the worker sets `ExportOptions::video_format`.

- [ ] **Step 4: Run tests**

Run: `cargo test -p celesta-editor`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(editor): export MOV and WebM chosen in the save dialog`

---

### Task 7: FFmpeg builds and licensing

**Files:**
- Modify: `.github/actions/setup-ffmpeg/action.yml:4,31,50,93`
- Modify: `scripts/build-ffmpeg-linux.sh:8-11,34-47`, `packaging/linux/Dockerfile:20,61-68`
- Modify: `README.md:71,84`, `HANDOFF.md:21`, `packaging/windows/README.md:11`, `packaging/linux/README.md`, `packaging/macos/README.md:146-158`, `packaging/GPL-SOURCE-OFFER.md`
- Modify: `packages/website/content/{en,ja}/docs/05-(more)/03-build-from-source.md:26,37`

- [ ] **Step 1: Update the builds**

- vcpkg: `ffmpeg[x264,vpx,opus]:x64-windows-static-md` everywhere it is named; the cache key prefix becomes `vcpkg-$env:VCPKG_TAG-ffmpeg-x264-vpx-opus-x64-windows-static-md-…`.
- Linux: `--enable-libvpx --enable-libopus` in `configure`, and `libvpx-dev libopus-dev` in the script's comment, `action.yml`'s apt line, the Dockerfile's build stage and the README/website apt lines. Update the configure comment: libvpx and libopus are BSD-licensed. The Dockerfile's runtime stage adds `libvpx9 libopus0` next to `libx264-164`, and its comment says which libraries are linked dynamically.
- The Linux FFmpeg cache key hashes `build-ffmpeg-linux.sh`, so it rebuilds by itself.

- [ ] **Step 2: Update licensing text**

`GPL-SOURCE-OFFER.md`: the bundled FFmpeg also links libvpx and libopus (BSD-3-Clause), whose sources are offered on the same terms and listed with upstream URLs (`https://chromium.googlesource.com/webm/libvpx`, `https://opus-codec.org/`) and the vcpkg port names. macOS README: Homebrew's `ffmpeg@8` already includes them; their notices are collected with the other Homebrew license files. Windows README: their copyright files ship under `licenses/native` (the packaging script copies vcpkg's `share` tree, so no script change). Linux README: Debian's copyright files for `libvpx9`/`libopus0` ship in the image.

- [ ] **Step 3: Verify locally**

Run: `bash -n scripts/build-ffmpeg-linux.sh && grep -rn "ffmpeg\[x264\]" --exclude-dir=node_modules --exclude-dir=target --exclude-dir=docs . ; echo done`
Expected: no syntax error and no remaining `ffmpeg[x264]` outside `docs/`. Windows and Linux builds are confirmed by CI on the PR.

- [ ] **Step 4: Commit** — `build: link libvpx and libopus into FFmpeg`

---

### Task 8: Export documentation

**Files:**
- Modify: `packages/website/content/en/docs/02-(guides)/09-export.md`, `packages/website/content/ja/docs/02-(guides)/09-export.md`, `skills/celesta/references/export.md`

- [ ] **Step 1: Write the "Transparent video" section** in each (Japanese for `ja`, matching the page's existing tone and heading levels): the format follows the extension (`.mov` ProRes 4444 + 24-bit PCM, `.webm` VP9 + Opus) or `--output-format mov|webm`; only undrawn areas are transparent, so a full-frame background layer makes the output opaque; straight alpha, BT.709; `--preset`, `--crf`, `--bit-depth`, `--color-conversion` are MP4-only; in the app, pick the extension in the save dialog; `--json` reports `format` and `alpha`. The skill reference also covers the MCP `export_video` extensions.

- [ ] **Step 2: Verify the website still builds**

Run: `pnpm -C packages/website test`
Expected: PASS (the content tests read every docs page).

- [ ] **Step 3: Commit** — `docs: describe transparent video export`

---

### Task 9: End-to-end verification and PR material

- [ ] **Step 1: Full test run**

Run: `PKG_CONFIG_PATH="$(brew --prefix ffmpeg@8)/lib/pkgconfig" cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --check`
Expected: all pass.

- [ ] **Step 2: Export a real example three ways** with the built `celesta-exporter` (a short `--from/--to` span of a caption-style example under `examples/`): `.mp4` (before), `.mov`, `.webm`. Confirm with `ffprobe` that `.mov` is `prores` 4444 `yuva444p10le` + `pcm_s24le` and `.webm` is `vp9` `alpha_mode=1` + `opus` 48 kHz, both tagged BT.709, and that `--json` shows `format`/`alpha`.

- [ ] **Step 3: Visual check and screenshots** — open the `.mov` in QuickTime and the `.webm` in the built-in browser as a `<video>` over a checkerboard page (scratchpad HTML); capture the before (MP4, opaque) and after (transparent over checkerboard) of the same frame for the PR (AGENTS.md).

- [ ] **Step 4: PR checklist for the maintainer** — alpha reads correctly in DaVinci Resolve, Premiere Pro and Final Cut Pro for both files; CI's Windows and Linux builds have the new encoders (`linked_ffmpeg_has_every_format_encoder`).

- [ ] **Step 5: Follow-ups** — ask the user before filing issues for: MP4 BT.601/BT.709 tagging, VP9-alpha WebM import losing alpha, preview checkerboard.
