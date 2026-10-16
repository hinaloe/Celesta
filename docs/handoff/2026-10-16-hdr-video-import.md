# HDR video in SDR compositions (2026-10-16)

Issue #258, stage A: HDR footage (PQ, HLG) is probed, decoded, and tone
mapped to SDR the way Chrome draws it. Stages B (HDR export) and C (HDR
authoring) are not started.

## Before

`ez-ffmpeg` 0.18's `FrameExtractor` refuses every stream tagged BT.2020
primaries or matrix, PQ, or HLG (`HdrRequiresToneMapping`), at open time and
again per frame. So an iPhone clip failed to render at all; the issue's note
about PQ code values passing through as sRGB predates that check.

## Probe

`VideoStream.color: VideoColor { primaries, transfer, matrix }`, FFmpeg's
names for the tags (`crates/media/src/color.rs`, read from
`StreamInfo::Video`'s raw values). `dynamic_range()` is `Sdr`, `Pq`, or
`Hlg`. `preloadMedia()` reports `video.color` (when anything is tagged) and
`video.hdr: 'pq' | 'hlg'`; `inspect.mjs` answers the same from `ffprobe`.
The editor's asset info shows "HDR (PQ)" / "HDR (HLG)".

## Decode

`VideoColor::conversion()` picks the path. Untagged and BT.709-like streams
keep `FrameExtractor` and its packed RGBA, byte for byte. PQ, HLG, and SDR
BT.2020 streams go through `ConvertedFrames` (`converted.rs`): an
`FfmpegContext` built like the extractor's (input seek + trim, a null output
with passthrough vsync, a frame sink on the output pipeline), whose graph
scales to `rgb48le` with the tagged matrix and range. The sink converts each
frame with `ToneMapper` on FFmpeg's output thread, so conversion overlaps
rendering. `FrameRun` (`sequential.rs`) hides the two behind one
`next_frame()`; one-shot and sequential decoding both use it. Everything
after the decoder (CPU and GPU renderers, export) is unchanged: they still
get 8-bit sRGB RGBA.

The peak luminance comes from each frame's side data: MaxCLL, else the
mastering display's peak, else 1000 nits, as Skia picks it. The tone mapper
is rebuilt when it changes. `AVContentLightMetadata` and
`AVMasteringDisplayMetadata` are missing from `ffmpeg-sys-next`'s bindings,
so `converted.rs` declares their C layouts.

## The curve: what Chrome does

`@celesta/web` draws video with Canvas 2D `drawImage`, so the target is what
Chrome does when it draws HDR video onto an SDR canvas. Chromium's
`ui/gfx/tone_map_util.cc` hands this to Skia
(`skhdr::Metadata::makeToneMapColorFilter`, `src/codec/SkHdrAgtm.cpp`):

1. Linearize relative to an HDR reference white of 203 nits. PQ: nits / 203.
   HLG: inverse OETF, then the BT.2100 OOTF for a 1000-nit display
   (`E · Y^0.2`, Y from BT.2020 luminance), times 1000 / 203
   (`SkColorSpaceXformSteps`).
2. With no AGTM metadata, Skia builds the Reference White Tone Mapping
   Operator (SMPTE ST 2094-50 Annex C, `PopulateUsingRwtmo`) from the
   baseline headroom `log2(peak / 203)`, and a canvas targets headroom 0.
   The gain applies to maxRGB in linear BT.2020: up to the reference white
   it is a constant `y_white = 1 − 0.5 · min(H / log2(1000/203), 1)` (0.5
   for a 1000-nit peak), then a Bézier shoulder sampled into 8 Hermite
   control points reaches 1.0 at the peak, and clips past it.
3. BT.2020 → BT.709 linear, clip, sRGB.

So the reference white lands at half of SDR white's light (sRGB 188), and a
white `<Rect>` beside HDR footage is brighter than the footage's white. That
is deliberate: it is what the browser shows. Chrome treats BT.709, BT.601,
and BT.2020 SDR transfers as sRGB (`color_space.cc`), and so does
`Transfer::Srgb`. Safari and Firefox do something else; nothing here
follows them.

`ToneMapper` uses tables for the transfer (12-bit index), the OOTF's
`Y^0.2` (indexed by the float's top bits), the gain curve, and the sRGB
encode, with rows split across rayon. Measured for one 4K frame on this
machine under load: HLG about 12 ms, PQ 8 ms, SDR BT.2020 6 ms; a 4K HLG
clip decodes sequentially at about 28–34 ms per frame (SDR 10-bit HEVC:
10 ms).

## How close it is

Test patches (lossless 10-bit HEVC, 16×9 patches of 40 px: gray, primary,
and random ramps; PQ with MaxCLL 1000, 4000, and none; HLG) were drawn by
Chrome 152 (the desktop app's browser pane) onto a canvas and decoded
natively. The tolerance this stage settles on, per pixel, the largest
channel difference in 8-bit codes, away from patch edges:

| | mean | p99 | max |
| --- | --- | --- | --- |
| HDR, native vs `@celesta/web` | 0.96 | 6 | 21 |
| SDR, same patches, for scale | 0.70 | 2 | 3 |

The few large values are saturated colors whose clipped channel lands near
zero, where sRGB is steep; Chrome itself departs from the exact formulas
there (a 2000-nit gray comes out 249,255,251), most likely from its
half-float pipeline. At patch edges both HDR and SDR differ by about 9 on
average, from Chrome's different 4:2:0 chroma upsampling; that predates this
change. `color.rs`'s tests pin the Chrome values for grays and primaries.

## Not done

- A rotated video (portrait iPhone footage) fails for SDR and HDR alike:
  the probe reports the coded size, autorotated frames do not match it.
  Separate issue.
- Dolby Vision metadata (RPU) is ignored; profile 8.4 decodes as its HLG
  base layer. Not yet checked against real iPhone footage.
- Stage B (16-bit float compositing, HDR10 / HLG export) and stage C.
