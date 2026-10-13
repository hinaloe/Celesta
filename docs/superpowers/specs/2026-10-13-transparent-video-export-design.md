# Transparent video export design

Issue: [mika-f/Celesta#287](https://github.com/mika-f/Celesta/issues/287)

## Goal

Video export writes only H.264 MP4, which has no alpha channel, so captions
and logo animations cannot be exported as overlay material for other
editing software. Celesta should also export:

- **ProRes 4444 in `.mov`**, the usual intermediate for editing software.
- **VP9 with alpha in `.webm`**, for browsers and web tooling.

Wherever nothing is drawn, the exported video is transparent, and
semi-transparent edges composite correctly in the receiving software.

## Non-goals

- An opaque ProRes (or opaque VP9) mode. `.mov` and `.webm` always carry
  alpha.
- Encoder tuning for the new formats (ProRes profile, VP9 quality). The
  settings are fixed; options can be added later.
- Transparent PNG stills. PNG export keeps its opaque background.
- Changing MP4's color handling. MP4 stays untagged BT.601 (see
  [Follow-ups](#follow-ups)).
- A checkerboard behind transparent areas in the editor preview.
- Importing VP9-alpha WebM as a media asset with its alpha.
- A format picker in the app. The save dialog's extension selects it.

## Format model

`celesta-exporter` gets a `VideoFormat` enum, held in
`ExportOptions::video_format` (default `Mp4`):

| `VideoFormat` | Extension | Video | Pixel format | Audio |
|---|---|---|---|---|
| `Mp4` | `.mp4` | `libx264` (unchanged) | `yuv420p` / `yuv420p10le` | AAC 192k (unchanged) |
| `Mov` | `.mov` | `prores_ks`, profile 4444 | `yuva444p10le` | `pcm_s24le` |
| `Webm` | `.webm` | `libvpx-vp9` | `yuva420p` | `libopus` 192k, 48 kHz |

`VideoFormat` has `as_str` (`"mp4"`, `"mov"`, `"webm"`), `from_extension`
(case-insensitive), `has_alpha` (`Mov`, `Webm`) and the `FromStr`/`Display`
pair the other option enums have.

`VideoEncoding` (preset, CRF, bit depth, color conversion) stays H.264
only. `Mov` and `Webm` do not read it.

`validate_output` checks that the output's extension is the one
`video_format` names, case-insensitively, and returns
`ExportError::UnsupportedOutput` otherwise.

## Alpha handling

The renderer composites in premultiplied alpha. ProRes 4444 and VP9 alpha
are read as straight (unassociated) alpha by FFmpeg and by editing
software, so frames are converted to straight alpha before encoding. The
conversion runs on the GPU at 16-bit precision, so dark, semi-transparent
edges do not band.

### Renderer (`celesta-gpu-renderer`)

- `ReadbackFormat::Rgba16Straight`: the same layout as `Rgba16`
  (`rgba64le`, 8 bytes per pixel), with color divided by alpha. A pixel
  with zero alpha reads back as `(0, 0, 0, 0)`.
- `quantize.wgsl` gets an `rgba16_straight` fragment entry point:
  clamp to `[0, 1]`, divide `rgb` by `a` when `a > 0`, round to 16-bit
  codes. No dither, the same as `rgba16`.
- The quantizer's pipelines are keyed by target texture format today. Both
  16-bit entry points render to `Rgba16Uint`, so the key becomes
  (texture format, entry point).
- `set_readback_format(Rgba16Straight)` ensures that pipeline, the same
  way `Rgba16` does.

### Export renderer

`export_renderer` takes the `VideoFormat`. For `Mov` and `Webm` it:

- clears to `Color::TRANSPARENT` instead of the default opaque background
  (`GpuRenderOptions::background`), and
- reads back `Rgba16Straight`, never a YUV format.

`Mp4` is unchanged. Project exports and React entry exports share
`export_renderer`, so both get transparent output.

A composition that fills the frame with an opaque layer exports opaque;
only what is left undrawn becomes transparent.

## Encoding

`open_video_writer` takes the `VideoFormat`. For `Mov` and `Webm` the
input pixel format is always `rgba64le`, and libswscale converts it to the
output pixel format.

`Mov`:

- `set_video_codec("prores_ks")`
- codec options `profile=4444`, `alpha_bits=16`, `vendor=apl0`
- `set_pix_fmt("yuva444p10le")`

`Webm`:

- `set_video_codec("libvpx-vp9")`
- codec options `crf=20`, `b=0` (constant quality), `row-mt=1`
- `set_pix_fmt("yuva420p")`

Both convert with the BT.709 matrix in limited range and tag the stream as
BT.709, since editing software assumes BT.709 for untagged HD material:

- `set_video_filter("scale=out_color_matrix=bt709:out_range=tv")`
- codec options `colorspace=bt709`, `color_primaries=bt709`,
  `color_trc=bt709`, `color_range=tv`

The exact option names are checked against `ez-ffmpeg`'s `Output` during
implementation; the requirement is that `ffprobe` reports BT.709 for the
color space, primaries and transfer.

## Muxing

The audio-less video is written to a temporary file in the output's
container (`video.mov` or `video.webm`), and the final temporary file
uses the output's extension as its suffix.

`mux_audio` branches on the format:

- `Mp4`: unchanged (AAC 192k, `movflags=+faststart`).
- `Mov`: `pcm_s24le`, `movflags=+faststart`.
- `Webm`: `libopus` at 192k, `set_audio_sample_rate(48000)` (libopus does
  not accept 44.1 kHz, so FFmpeg resamples), no `movflags`.

The audio mixdown still runs on its own thread while frames render.

## Errors

Before rendering, the exporter checks that the format's video and audio
encoders exist in the linked FFmpeg (`avcodec_find_encoder_by_name` or
`ez-ffmpeg`'s equivalent). A missing encoder fails with a new
`ExportError::EncoderUnavailable { format, encoder }`, whose message names
both, and whose `--json` error code is `encoder_unavailable`.

## CLI

- `--output-format` accepts `mov` and `webm` in addition to `png` and
  `mp4`.
- Without `--output-format`, a video export's format comes from the output
  extension (`.mp4`, `.mov`, `.webm`). An `--output-format` that disagrees
  with the extension is a usage error. PNG selection keeps its current
  rules.
- For `.mov` and `.webm`, explicitly passing `--preset`, `--crf`,
  `--bit-depth` or `--color-conversion` is a usage error. Explicit use is
  detected with clap's `ArgMatches::value_source`, so the defaults stay as
  they are.
- `--help` and `AFTER_HELP` describe the transparent formats in one short
  paragraph.

## `--json` report

The `video` output entry gains two fields:

```json
{ "type": "video", "path": "...", "format": "mov", "alpha": true, ... }
```

`format` is `"mp4"`, `"mov"` or `"webm"`; `alpha` is `true` for `mov` and
`webm`. `ExportedFile::Video` carries the `VideoFormat` so the report can
fill them in.

## App (`crates/editor`)

- The save dialog's chosen extension is kept when it is `mp4`, `mov` or
  `webm` (case-insensitive); any other extension, or none, becomes `.mp4`
  as today. This logic moves into a small function so it can be tested.
- `ExportRequest` carries the `VideoFormat` derived from the extension,
  and the export worker puts it into `ExportOptions`.
- The suggested file name stays `<name>.mp4`. No new UI.

## MCP (`crates/mcp`)

- `export_video` accepts `.mov` and `.webm` outputs as well as `.mp4`,
  choosing the format by extension.
- `preset`, `crf` and `bitDepth` with a `.mov` or `.webm` output are
  argument errors. The tool's schema description says so.
- The result carries `format` and `alpha` through the shared report.

## FFmpeg builds and licensing

| Platform | FFmpeg | Change |
|---|---|---|
| macOS | Homebrew `ffmpeg@8` | None: `prores_ks`, `libvpx-vp9` and `libopus` are enabled. |
| Windows | vcpkg | `ffmpeg[x264]` becomes `ffmpeg[x264,vpx,opus]`; the vcpkg cache key changes with it. |
| Linux | `scripts/build-ffmpeg-linux.sh` | Add `--enable-libvpx --enable-libopus`; add `libvpx-dev libopus-dev` to the apt dependencies. |

Places that name the FFmpeg build and its dependencies are updated
together: `.github/actions/setup-ffmpeg/action.yml`,
`scripts/build-ffmpeg-linux.sh`, `packaging/linux/Dockerfile`,
`README.md`, `HANDOFF.md`, `packaging/windows/README.md`, and the website's
build-from-source page (en and ja).

Licensing: `prores_ks` is part of FFmpeg (LGPL); libvpx and libopus are
BSD-3-Clause. The bundled FFmpeg is already GPL as a whole because of
x264, so the package's license does not change. `GPL-SOURCE-OFFER.md` and
the packaging READMEs list libvpx and libopus among the bundled
components, and their license files are included with the others (macOS
collects Homebrew's license files already; Windows and Linux packaging add
them).

## Documentation

`packages/website/content/{en,ja}/docs/02-(guides)/09-export.md` and
`skills/celesta/references/export.md` gain a transparent export section:
the format follows the extension; undrawn areas are transparent, so a
full-frame background layer makes the output opaque; alpha is straight;
color is BT.709; the audio formats; the H.264 options do not apply.

## Testing

Unit tests:

- `VideoFormat`: extension parsing, `--output-format` and extension
  disagreement, H.264 options rejected for `mov`/`webm` (including the
  `value_source` check), `validate_output` for all three formats.
- Report: the `video` entry's `format` and `alpha`.
- MCP arguments: `.mov`/`.webm` accepted; `crf`, `preset`, `bitDepth`
  rejected with them.
- App: the extension keep-or-replace function.

Renderer (`gpu-renderer/src/tests.rs`):

- `Rgba16Straight` over a transparent background: a half-transparent red
  rectangle reads back as straight red with alpha near 32768, undrawn
  pixels as `(0, 0, 0, 0)`.
- On an antialiased edge, `Rgba16Straight` equals the `Rgba16` readback
  divided by its alpha, within one code, for pixels whose alpha is at
  least 1/16 (below that, the premultiplied codes are too coarse to
  compare).

Integration (`exporter/tests/export_integration.rs`), on a scene with a
transparent background and a semi-transparent rectangle:

- `.mov`: `prores`, `yuva444p10le`, profile 4444, `pcm_s24le` audio,
  BT.709 tags; decoded, undrawn pixels have zero alpha and the rectangle
  has its expected alpha and straight color.
- `.webm`: `vp9`, `yuva420p`, `alpha_mode=1`, Opus at 48 kHz; decoded with
  the `libvpx-vp9` decoder (FFmpeg's native VP9 decoder drops alpha), the
  same pixel checks.
- A React entry export to one transparent format, if the existing helpers
  make it cheap.
- When an encoder is missing, the test is skipped with a message naming
  it, never passed silently.

Manual verification:

- On macOS: `ffprobe`, QuickTime/Finder preview of the `.mov`, and the
  `.webm` in Chrome's `<video>` over a checkerboard.
- Before/after screenshots of the same scene for the PR (AGENTS.md): the
  current opaque MP4 and the transparent output over a checkerboard.
- The maintainer checks the alpha in editing software (DaVinci Resolve,
  Premiere Pro, Final Cut Pro); the PR carries a checklist for it.

## Follow-ups

Proposed as separate issues:

- MP4 is untagged and converted with BT.601, while HD players assume
  BT.709.
- Importing VP9-alpha WebM keeps no alpha, because the native VP9 decoder
  drops it.
- A checkerboard behind transparent areas in the preview.
