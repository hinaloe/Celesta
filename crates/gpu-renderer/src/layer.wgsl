// One instance per layer, drawn in painter's order. Consecutive layers that
// sample the same texture (every rect shares a placeholder) are one draw.
struct LayerInstance {
    @location(0) matrix: vec4<f32>,
    @location(1) translation_size: vec4<f32>,
    // anchor.xy, opacity, and the content kind: 0 samples `source_texture`,
    // 1 shades the rect described by `rect`/`fill`/`stroke`.
    @location(2) anchor_opacity_kind: vec4<f32>,
    // canvas width, height
    @location(3) canvas: vec4<f32>,
    // half width, half height, corner radius, stroke width (0 without one)
    @location(4) rect: vec4<f32>,
    // Straight-alpha RGBA in 0-255 code values.
    @location(5) fill: vec4<f32>,
    @location(6) stroke: vec4<f32>,
};

@group(0) @binding(0)
var source_texture: texture_2d<f32>;

@group(0) @binding(1)
var source_sampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    // size.xy, opacity, kind
    @location(1) @interpolate(flat) size_opacity_kind: vec4<f32>,
    @location(2) @interpolate(flat) rect: vec4<f32>,
    @location(3) @interpolate(flat) fill: vec4<f32>,
    @location(4) @interpolate(flat) stroke: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32, layer: LayerInstance) -> VertexOutput {
    let coordinates = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(1.0, 1.0),
    );
    let uv = coordinates[vertex_index];
    let size = layer.translation_size.zw;
    let anchor = layer.anchor_opacity_kind.xy;
    let local = (uv - anchor) * size;
    let world = vec2<f32>(
        layer.matrix.x * local.x + layer.matrix.z * local.y + layer.translation_size.x,
        layer.matrix.y * local.x + layer.matrix.w * local.y + layer.translation_size.y,
    );
    let clip = vec2<f32>(
        world.x / layer.canvas.x * 2.0 - 1.0,
        1.0 - world.y / layer.canvas.y * 2.0,
    );
    return VertexOutput(
        vec4<f32>(clip, 0.0, 1.0),
        uv,
        vec4<f32>(size, layer.anchor_opacity_kind.zw),
        layer.rect,
        layer.fill,
        layer.stroke,
    );
}

// Inigo Quilez's rounded-box signed distance, as in `celesta-renderer`.
fn rounded_box(p: vec2<f32>, half_size: vec2<f32>, radius: f32) -> f32 {
    let q = abs(p) - half_size + vec2<f32>(radius);
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

// The pixel `celesta_renderer::rasterize_rect` would have produced for the
// texel under `uv`, so drawing a rect here matches uploading its rasterized
// texture and sampling it with the nearest-neighbour sampler.
fn rect_color(input: VertexOutput) -> vec4<f32> {
    let size = input.size_opacity_kind.xy;
    let texel = min(floor(input.uv * size), size - vec2<f32>(1.0)) + vec2<f32>(0.5);
    let half_size = input.rect.xy;
    let radius = input.rect.z;
    let stroke_width = input.rect.w;
    let p = texel - half_size;
    let outer = clamp(0.5 - rounded_box(p, half_size, radius), 0.0, 1.0);
    var color = input.fill;
    if stroke_width > 0.0 {
        let inner = clamp(
            0.5 - rounded_box(
                p,
                max(half_size - vec2<f32>(stroke_width), vec2<f32>(0.0)),
                max(radius - stroke_width, 0.0),
            ),
            0.0,
            1.0,
        );
        // `floor(x + 0.5)` rounds like Rust's `f64::round` for these
        // non-negative values; WGSL's `round` rounds halves to even, and
        // lerped channels often land exactly on a half.
        color = floor(input.stroke + (color - input.stroke) * inner + 0.5);
    }
    return vec4<f32>(color.rgb, floor(color.a * outer + 0.5)) / 255.0;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sampled unconditionally: `textureSample` needs uniform control flow.
    // Rect draws bind a 1x1 placeholder texture.
    var color = textureSample(source_texture, source_sampler, input.uv);
    if input.size_opacity_kind.w == 1.0 {
        color = rect_color(input);
    }
    return vec4<f32>(color.rgb, color.a * input.size_opacity_kind.z);
}
