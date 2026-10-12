# Generic layers: smaller frames, layers, and prepared items

Decision: shave per-layer costs that cost nothing in format or API surface
outside the workspace. Frames from the React bridge leave out more defaults,
`Layer` and the GPU renderer's `PreparedItem` shrink, and a frame's
instances are written straight into the upload. Bigger per-layer savings
would need a different wire format (solid paints as plain strings, a
React-side default anchor) and were left out: about 20% at most, against
the React and author code that sets the floor.

## Where 100,000 animated rects spend a frame

Apple M4, Node v26.10.0, release builds, production React. Every rect moves
every frame, so nothing can be reused between frames.

| Step | Time | Note |
| --- | ---: | --- |
| React and the entry's own code | ~60 ms | Creating 100,000 elements, reconciling them, and garbage collection |
| The scene walk | ~10 ms | |
| `compactLayers` in the CLI | ~5 ms | A copy of every layer to drop default transform fields; removed |
| `JSON.stringify` | ~26 ms | 26 MB |
| `serde_json` into `Scene` | ~56 ms | Scales with bytes and keys (~2.2 ms per MB), not with struct size |
| GPU `prepare_draws` | ~17 ms | |

Measured in isolation on a captured frame:

- Boxing `Layer`'s rarely used parts (584 → 296 bytes) took parsing from
  56 ms to 50 ms.
- Leaving out `cornerRadius: 0` saved 1.7 MB and 2.7 ms of parsing.
  Writing solid fills as strings would save about 6 ms more, and leaving
  out React's default anchor 5.5 ms; neither was done.
- `sonic-rs` parsed the same frame in 47 ms against 56 ms. Not adopted.

## Changes

- **Compact frames from the walk.** `renderAt(..., { compact: true })`
  leaves out transform fields at Rust's defaults, an opacity of 1, and a
  rect's corner radius of 0. The CLI asks for it when the bridge sends
  `compactTransforms` and no longer copies the layers. Rust reads a missing
  `opacity` as 1; the JSON Rust writes is unchanged.
- **Smaller `Layer`** (584 → 296 bytes): `Text.style`, `LayerEffects`'s
  `shadow`, `glow` and `shader`, and `Instances.shape` are boxed.
  `layers_stay_small` keeps it at 320 bytes or less.
- **Smaller `PreparedItem`** (304 → 160 bytes or less): `LayerTexture` is
  one `Arc`, and an effect's or mask's spec is boxed.
  `prepared_items_stay_small` guards it.
- **Instances written in place.** `prepare_draws` writes each
  `LayerInstance` into the staging memory `Queue::write_buffer_with` returns
  instead of a `Vec` copied by `write_buffer`, and a run of layers sharing a
  texture no longer clones it per layer.

## Results

Base is the tip of the `Instances` branch (`32ec5a2`); runs alternate base
and new in one sitting. The machine was shared with other work, so single
runs varied by up to 20%; medians are shown.

| Workload | Base | New | Change |
| --- | ---: | ---: | ---: |
| 100,000 rects, React → Rust (`protocol-bench`, 4 runs) | 187.4 ms | 173.2 ms | −7.6% |
| 100,000 rects, GPU render (`dense-geometry-bench`, 5 runs) | 20.1 ms | 15.3 ms | −24% |
| NEBULA, React → Rust | 3.65 ms | 3.56 ms | −2.4% |
| SPECTRA, React → Rust | 0.879 ms | 0.879 ms | 0% |
| reel, React → Rust | 1.115 ms | 1.045 ms | −6.3% |

`celesta-bench` (`nebula spectra rings blur ribbons text shapes images
shaders`, 30 frames, 3 runs) stays within ±2% on every workload, and the
last frame of each is byte-identical to the base's PNG.

The React → Rust target set for this work (135 ms for 100,000 rects) was
not met: the items kept saved about 14 ms, as measured above; the estimate
had counted the wire-format items that were left out. Scenes whose layers
mostly stay the same from frame to frame are the next step: reusing their
walked layers and parsed scenes skips this whole cost rather than trimming
it.
