# Custom shader filters: the `shaders` workload

Decision: no further optimization for now. A custom shader costs one
full-screen-triangle pass over the layer's canvas, plus the canvas the layer
draws onto first, which every effect already needs. The cost is in line with
the other effects and well below `blur`. Scenes without shaders take the
same code paths as before; the CI instruction counts check that on every
pull request that touches the renderer.

## Workload

`shaders` (`crates/bench/src/workloads.rs`) draws two custom shaders from
the design (`docs/superpowers/specs/2026-10-10-custom-shader-filter-design.md`):

- a color grade over a full-screen copy of the `images` workload's image:
  desaturation that changes every frame, a tint, and a vignette. Every
  pixel of the frame goes through it;
- six text lines, each with a ripple whose padding lets it push pixels past
  the text's edge.

The shaders compile while the warmup frames render, so the measured frames
reuse cached pipelines.

## Measurements

Apple M4, Metal, 1920x1080, 120 measured frames after the default warmup,
three runs in one session. Absolute times vary between sessions, so compare
the within-run ratios.

| Workload | ms/frame (median of 3) |
| --- | --- |
| `shaders` | 1.922 |
| `blur` | 4.683 |
| `text` | 0.519 |
| `images` | 0.578 |

| Run | `shaders` / `text` | `shaders` / `images` | `shaders` / `blur` |
| --- | --- | --- | --- |
| 1 | 3.76 | 3.35 | 0.41 |
| 2 | 3.68 | 3.30 | 0.41 |
| 3 | 3.70 | 3.33 | 0.41 |

`shaders` draws a full-screen image and six text lines as `images` and
`text` do, plus seven canvases and seven shader passes. One of those
passes covers the whole frame, and the grade samples one texel per pixel.

## Reproduce

```sh
pnpm install --frozen-lockfile
cargo run --release -p celesta-bench -- run --frames 120 --size 1920x1080 shaders blur text images
```

Add `--dump out/` to save each workload's last frame and check the pictures.

## Chains: the `shader-chain` and `shader-nest` workloads

A layer's `shader` takes an array (2026-10-13). The shaders run one pass
each, through two pooled canvases in turn (`EffectProcessor::take_canvas`
and `recycle`): each pass reads the canvas the one before it wrote and
writes the other, so a chain of any length holds one canvas more than the
layer's own, as a single shader does. Every pass clears its target and
writes only the content box grown by the paddings so far.

`shader-chain` is `shaders` with the grade split into three shaders in a
row (desaturate, tint, vignette) on the full-screen image; `shader-nest`
draws the same picture the way it took before, with a group nested around
each shader. The three workloads' last frames match within one code value.

Apple M4, Metal, 1920x1080, 120 measured frames after 10 warmup, 10
rounds (`scripts/bench.py compare --base main`, medians):

| Workload | ms/frame | vs `shaders` |
| --- | ---: | ---: |
| `shaders` (one grade pass), main | 1.716 | |
| `shaders` (one grade pass) | 1.719 | +0.2% |
| `shader-chain` (three grade passes) | 1.838 | +6.9% |
| `shader-nest` (three passes, nested groups) | 2.553 | +48.5% |

Each extra full-screen pass costs about 0.06 ms here. Nesting costs about
seven times that per level: each group draws its canvas onto its parent's
in a pass of its own, on a canvas of its own (here the size of the scene). Scenes with
one shader per layer take the same work as before (`shaders`, and `blur`,
`text`, and `images` were within ±0.6% of main in the same comparison).

```sh
cargo run --release -p celesta-bench -- run --frames 120 --size 1920x1080 --dump out/ shaders shader-chain shader-nest
```
