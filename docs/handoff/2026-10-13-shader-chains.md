# Several shaders on one layer (2026-10-13)

Issue #286. A layer's `shader` prop takes one `ShaderEffect` or an array of
them, run in the order given, each filtering the result of the one before.
A single shader works as before.

- Scene model: `LayerEffects.shader: Option<Box<LayerShader>>` became
  `shaders: Vec<LayerShader>` (JSON `shaders`, omitted when empty). The
  React runtime and the renderer ship together, so the old single `shader`
  key is not read; `skills/celesta/scripts/inspect.mjs` still shows it,
  since the skill can be newer than an installed app.
- Semantics: a chain draws as nesting a group around each shader would
  (`[a, b]` is `<Group shader={b}><X shader={a} /></Group>`), checked by
  `a_chain_draws_as_groups_nested_around_each_shader_do`. Every shader sees
  the layers' shape box as `celesta.content`/`uv`; an earlier shader's
  padding spreads the pixels, not the box. Each shader writes what the one
  before wrote grown by its own padding, so `EffectSpec::shaded_bounds`
  grows the content by the paddings' sum (each still clamped to 512).
- GPU: `ShaderProcessor::use_shaders` records a layer's uses contiguously
  and returns a `ShaderChain` (first use, count, summed padding), which
  keeps `EffectSpec` `Copy`. `Compositor::draw_group` runs one pass per use
  and swaps canvases with `take_canvas`/`recycle`, so a chain holds two
  canvases at a time whatever its length. Measurements:
  `docs/performance/custom-shaders.md` (`shader-chain`, `shader-nest`).
- React: `CommonProps.shader?: ShaderEffect | readonly ShaderEffect[]`. The
  walker refuses any element that is not a `ShaderEffect`, including holes
  and `null`; an empty array adds no effect.
- `inspect.mjs` prints `shader name(param=value, …) pad N → …` from the
  scene's `shaders` (#227's format, extended to chains). Parameters declared
  as `color` show as the four numbers the shader gets: the scene keeps only
  their WGSL type.
- #285 (built-in color corrections): the chain is the natural place for
  them. If each correction is a built-in `ShaderSource` (or a variant of
  the list's entries naming a built-in pass), it runs through the same
  ping-pong passes and the author decides its order relative to custom
  shaders; `blur`, `shadow`, and `glow` stay after the list.
