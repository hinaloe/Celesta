# Dithered quantization against gradient banding (2026-10-12)

Issue #241: dark, gentle gradients banded in PNG exports, and about three
times wider in MP4. The GPU renderer now composites in half floats and
rounds each frame to 8 bits once, with an ordered dither.

## What changed

- **Canvases are `Rgba16Float`** where the adapter can render, blend, filter
  and copy it (`canvas_format` in `texture.rs`); otherwise `Rgba8Unorm` as
  before, which still bands. The root canvas, group, effect, mask, shader and
  backdrop canvases, and the readback slots' render targets all use it. Layer
  textures (images, text, video) stay `Rgba8Unorm`.
- **One quantization, with a dither.** `dither.wgsl` holds an 8x8 Bayer
  offset scaled to 7/8 of a code (±0.43): it depends on the pixel position
  only, so a frame always reads back the same, and a value within 1/16 of a
  whole code (a half float's rounding error) keeps that code, so solid fills
  are unchanged. It is prepended to:
  - `quantize.wgsl` (`Quantizer`): RGBA readback (`render`, `submit` with
    `ReadbackFormat::Rgba8`) and preview targets (`render_to_target`, via
    `encode_frame` and a cached `target_canvas`). Alpha is dithered too;
    color is clamped to alpha so a premultiplied pixel stays valid.
  - `yuv420p.wgsl`: each of Y, U and V is rounded with the dither from the
    frame's own precision. A solid color whose Y/U/V falls between codes now
    alternates between them (within one code of libswscale); white, black,
    and neutral chroma are whole codes and unchanged.
- **Gradients are not rounded to whole codes** on the GPU (`sample_stops`,
  the stroke/fill mix in `rect_color`), unlike the CPU renderer's. Rect and
  clip coverage are rounded to 1/255 steps instead (`coverage_steps`): the
  interpolated scene position left fully covered pixels a hair short of 1
  (about 0.07 of a code), which the dither then rounded down.
- `fs_main`/`fs_blend` clamp their output to 0-1, which an 8-bit target did
  implicitly and a float one does not.
- The encoder conversion (`--color-conversion encoder`, libswscale) gets the
  dithered 8-bit RGBA frame; it does not dither its own 8-to-8-bit rounding.

Not changed: the macOS native preview (NV12 through IOSurface) still draws
onto an 8-bit target and rounds without a dither; the CPU renderer is
unchanged. 10-bit output (issue item 3, optional) is not implemented.

## Results

`examples/shorts-tips` (PR #219's branch), `--props-file
variants/en/transition.json`, frame 20, the row 60 px from the top
(1080 px), measured as in the issue. MP4: `--from 0.5 --to 1`, frame 5 of
the clip (frame 20 of the film), decoded with ffmpeg; "Y" is the stored
luma plane.

| Output | Changes (before → after) | Longest flat run |
| --- | --- | --- |
| PNG | 39 → 884 | 54 → 16 px |
| MP4, GPU conversion (default), RGB | 39 → 560 | 154 → 40 px |
| MP4, GPU conversion (default), Y | 17 → 372 | 154 → 83 px |
| MP4, encoder conversion, RGB | 39 → 298 | 154 → 66 px |
| MP4, encoder conversion, Y | 17 → 287 | 154 → 70 px |

Along a single row a Bayer pattern still leaves runs of about half a code
(each row holds 8 of the 64 thresholds); over 8 rows it averages out.

Over the whole PNG frame, 89% of channel values are unchanged, 10.8% differ
by 1 (gradients) and 0.014% by 2, all where text and shapes composite over
the demo panel's linear gradient. Exporting the frame twice gives identical
PNGs.

## Performance

The change costs time: half floats double the canvases' bandwidth, and
every frame takes one more full-frame pass (quantize or the dithered YUV
passes, the latter replacing the undithered ones).

`scripts/bench.py compare` (RGBA readback), Apple M4 (Metal), 1920x1080,
120 frames after 10 warmup, 10 rounds, seed 1393010974, base `7b764dc`:

| Workload | Base (ms/frame) | Head (ms/frame) | Change |
| --- | ---: | ---: | ---: |
| nebula | 4.671 | 5.095 | +9.05% [+4.7, +18.6] |
| spectra | 3.034 | 3.320 | +9.43% [+1.4, +21.5] |
| rings | 1.291 | 1.337 | +3.60% [-1.9, +11.7] |
| blur | 4.760 | 5.163 | +8.46% [+4.7, +17.8] |
| ribbons | 0.691 | 0.833 | +20.48% [-28.5, +43.4] |
| text | 0.563 | 0.683 | +21.41% [-4.8, +68.9] |
| shapes | 1.102 | 1.183 | +7.31% [+3.9, +13.6] |
| images | 0.629 | 0.724 | +15.16% [+6.3, +21.0] |
| shaders | 1.852 | 2.047 | +10.57% [+0.6, +20.3] |

`ribbons` and `text` are within noise (their intervals span zero). Expect
the CI instruction count (lavapipe) to flag every workload: the extra pass
and half-float blending are counted as CPU work there. The regression is
intended.

The whole `shorts-tips` film (24 s, 720 frames, default MP4 settings, GPU
yuv420p conversion) exported in a median 6.1 s before and 7.2 s after over
six alternating runs each (noisy: 5.2–7.1 s and 4.6–10.5 s). The MP4 grew
from 1.78 MB to 2.28 MB (+28%) at the same CRF 18: x264 spends bits keeping
the dither.

## Tests

- `dithers_gentle_gradients_and_keeps_solid_fills`: an 8-code gradient over
  256 px no longer bands (runs ≤ 20 px instead of 32), each 32x8 block's
  mean is within 0.15 of the ideal, an opaque solid rect is exact, and two
  renders are identical.
- `dithers_gentle_gradients_converted_to_yuv420p`: the same through the GPU
  yuv420p conversion.
- The yuv420p tests now allow a code of difference where libswscale's value
  is not a whole code; `decodes_and_rotates_a_nested_image_on_the_gpu`
  allows one code at its filtered edge texels.
- The dither tests skip when the adapter cannot composite in half floats.
