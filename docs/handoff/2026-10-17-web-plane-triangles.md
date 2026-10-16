# Browser planes drawn as affine triangles (2026-10-17)

Follow-up to `2026-10-16-skew-3d-transform.md` (issue #300). `@celesta/web`
drew a perspective layer's canvas onto its parent with `warp`
(`packages/web/src/projection.ts`), a per-pixel JavaScript copy of
`layer.wgsl`'s footprint filter: about 120 ms per frame for the example's floor
in Chrome. `drawPlane` (`packages/web/src/plane-pieces.ts`) now draws it with
Canvas 2D `drawImage`, and `warp` draws only what that cannot.

## How it works

- `planePieces` clips the canvas to `w >= NEAR_W` and to the target box (exact
  half-planes, as `planeRaster`), fans the polygon into triangles, and halves
  them across a side (in source space, so every corner is a projected point
  and the triangles tile the image exactly) until each is a leaf:
  - **Affine error.** An affine map interpolating a side `p, q` strays from the
    homography by at most `|√w_p − √w_q| / (√w_p + √w_q)` of the side's
    length (closed form); with the centroid's stray, every leaf stays within
    `AFFINE_ERROR` (0.5 target pixels). A test samples 1000+ leaves.
  - **Filter.** The GPU averages up to 8×8 bilinear taps over each pixel's
    footprint. A leaf reads a copy of the canvas halved `kx` times across and
    `ky` down (exact two-pixel boxes; drawn with `imageSmoothingQuality
    'low'`), plus 1, 2, or 4 sub-pixel passes along each side of the target
    pixel. `filterAt` picks, at the leaf's centre, the copy and passes whose
    2×2 spread (covariance), compared in target pixels, is within
    `COPY_RATIO` (1.25, as a ratio of standard deviations) of the GPU's,
    fewest passes first; passes may be no farther apart than two copy pixels,
    or they alias. A filter wider than the GPU's is compared with a quarter
    pixel of slack (`SPREAD_SLACK`), so a skewed, thin footprint can take a
    copy that blurs a little across it; a narrower one has none, as it would
    alias. The leaf's corners must be within `BLUR_RATIO` (1.35).
  - A band `NEAR_BAND` (3) pixels wide along the near clip, and any leaf no
    filter fits, go to `warp`, which overwrites a mask of their pixels
    (grown by `WARP_REACH`) in a read-back of the target, reading only the
    source rectangle their footprints reach.
- `drawPlane` draws leaves without passes straight onto the target, each
  clipped to its triangle grown by 1 pixel (`OVERLAP`, a Minkowski sum with a
  square, so slivers do not spike) with `globalCompositeOperation = 'copy'`.
  Leaves with passes are grouped by pass count; each pass draws onto a layer
  of its own (grown by 2), the layers are averaged pairwise (halve with
  `destination-out` at alpha 0.5, then `lighter` at 0.5), and the average
  replaces the group's region of the target through one union clip
  (`destination-out` then `lighter`, so the clip's coverage blends it).
- Why not add triangles with `lighter` and complementary antialiasing:
  Chrome's clip coverage along long edges is quantized (it changed only every
  4 pixels along a row on this Mac, likely half-float edge equations), so
  adjacent triangles left seams with alpha about 190. Overlap plus `copy` makes
  coverage errors only blend two near-equal samples.
- Why pairwise averaging: adding n layers at alpha `1/n` rounds each share to
  8 bits the same way on a flat color: `#2B3A55` came out `40,56,88` with 8
  layers and `44,60,84` with 4, as visible bands. Pairwise it is within 1.
- Why no `1/√2` copies: a bilinear shrink by `1/√2` aliases the finest detail
  (a test of one-texel stripes strayed from grey more than the GPU), while a
  halving's two-pixel box cancels it.

## Differences from the GPU, by design

- Edges can sit up to 0.5 target pixels off, so a straight line in the plane
  becomes a polyline with kinks of up to half a pixel where triangles meet;
  visible at 2× zoom on the floor's gap lines, not at 1×.
- The plane's outline is antialiased. The GPU (and `warp`) draws a pixel only
  where its centre maps into the canvas, so a minified plane's outline is
  aliased there.
- Minified regions are filtered within the ratios above, not tap for tap;
  the far side can be a little softer or sharper, and smoother at the
  horizon, where the GPU's 8-tap cap aliases.

## Measurements

Chrome (the desktop app's browser pane) on Apple silicon, the example
`packages/cli/examples/with-3d-transform.tsx` built as a scene by hand and
drawn by `SceneCanvas` bundled from the parent commit (`old`) and this
branch (`new`); medians of 10 draws, each ending in a 1-pixel `getImageData`
to wait for the GPU:

| | old | new |
| --- | --- | --- |
| Floor plane only (`warp` vs `drawPlane`, 3780×2193 raster onto 1920×428) | 120–132 ms | 31–38 ms |
| Whole frame 0 / 45 / 120 | 132 / 131 / 145 ms | 36 / 37 / 39 ms |

`planePieces` takes about 8 ms of the floor's 31–38 ms (1793 triangles; about
6150 `drawImage` calls). Timings rose for old and new alike over long runs in
one page (memory pressure in that pane), not with repeated draws of new alone
(72 → 52 ms over 60 draws with other large canvases alive). Against `warp` on
the floor, 90% of pixels are within 2 of 255 (premultiplied), 1.3% differ by
more than 32 (gap and letter edges, and the far edge where the GPU aliases).

## Tests

`packages/web/test/plane-pieces.test.mjs` runs the real `drawPlane` on
`test/software-canvas.mjs`, a software Canvas 2D (8-bit premultiplied pixels,
bilinear clamped taps, exact antialiased convex clips, 8×8-sampled union
clips, `source-over`/`lighter`/`copy`/`destination-out`, rounding after each
draw). Against `warp` over 12 random planes of smooth content (outline ring
excluded): mean < 2, 99th percentile ≤ 6, largest ≤ 24 (a run over 40 such
planes measured 1.2, 4, and 16).
Also the affine bound, tiling by area, one-texel stripes on a minified floor
(no farther from grey than the GPU), the near clip (nothing past it, the band
within 1 of `warp`), and a flat `#2B3A55` plane without seams or bands (within
2; it fails with the `1/n` sum). The emulator's antialiasing is exact, so
Chrome's coverage quantization was found only in the browser.

## Not done

- Caching a static plane's result across frames (the example's floor redraws
  the same pixels every frame).
- Firefox and Safari not checked; their `imageSmoothingQuality = 'low'` should
  be bilinear, and the overlap-and-`copy` scheme does not depend on exact
  coverage.
