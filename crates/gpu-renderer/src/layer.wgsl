// One instance per layer, drawn in painter's order. Consecutive layers that
// sample the same texture (every rect shares a placeholder) are one draw.
struct LayerInstance {
    @location(0) matrix: vec4<f32>,
    @location(1) translation_size: vec4<f32>,
    // anchor.xy, opacity, and the content kind: 0 samples `source_texture`,
    // 1 shades the rect described by `rect`/`fill`/`stroke`.
    @location(2) anchor_opacity_kind: vec4<f32>,
    // canvas width, height; the blend mode index (see `blend`), and 1 when
    // `source_texture` holds premultiplied alpha (an isolated group's canvas)
    @location(3) canvas: vec4<f32>,
    // half width, half height, corner radius, stroke width (0 without one)
    @location(4) rect: vec4<f32>,
    // Straight-alpha RGBA in 0-255 code values.
    @location(5) fill: vec4<f32>,
    @location(6) stroke: vec4<f32>,
    // The index of the innermost clip the layer is drawn through (-1 without
    // one), unused
    @location(7) clip: vec4<f32>,
};

@group(0) @binding(0)
var source_texture: texture_2d<f32>;

@group(0) @binding(1)
var source_sampler: sampler;

// A copy of the canvas `fs_blend` draws onto, in premultiplied alpha.
@group(1) @binding(0)
var backdrop_texture: texture_2d<f32>;

// Every clipped group of the frame, three vec4s each:
//   inverse matrix (a, b, c, d)
//   translation to the clip rectangle's frame, half width, half height
//   corner radius, local-to-canvas distance scale, parent clip (-1 for none), unused
// Mirrors `ClipEntry` in lib.rs.
@group(2) @binding(0)
var<storage, read> clips: array<vec4<f32>>;

// Mirrors `MAX_CLIP_DEPTH` in lib.rs.
const MAX_CLIP_DEPTH: i32 = 8;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    // size.xy, opacity, kind
    @location(1) @interpolate(flat) size_opacity_kind: vec4<f32>,
    @location(2) @interpolate(flat) rect: vec4<f32>,
    @location(3) @interpolate(flat) fill: vec4<f32>,
    @location(4) @interpolate(flat) stroke: vec4<f32>,
    // blend mode index, premultiplied source
    @location(5) @interpolate(flat) blend: vec2<f32>,
    // The canvas position of the fragment and the innermost clip it is drawn through.
    @location(6) world: vec2<f32>,
    @location(7) @interpolate(flat) clip: f32,
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
        layer.canvas.zw,
        world,
        layer.clip.x,
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

// How much of the pixel at canvas position `world` is inside every clip in
// the chain starting at `index`, anti-aliased over the edge like `rect_color`.
fn clip_coverage(world: vec2<f32>, index: f32) -> f32 {
    var coverage = 1.0;
    var current = index;
    for (var depth = 0; depth < MAX_CLIP_DEPTH; depth++) {
        if current < 0.0 {
            break;
        }
        let base = u32(current) * 3u;
        let matrix = clips[base];
        let placement = clips[base + 1u];
        let shape = clips[base + 2u];
        let local = vec2<f32>(
            matrix.x * world.x + matrix.z * world.y + placement.x,
            matrix.y * world.x + matrix.w * world.y + placement.y,
        );
        let distance = rounded_box(local, placement.zw, shape.x);
        coverage = coverage * clamp(0.5 - distance * shape.y, 0.0, 1.0);
        current = shape.z;
    }
    return coverage;
}

// The layer's non-premultiplied color, with its opacity applied to alpha.
fn source_color(input: VertexOutput) -> vec4<f32> {
    // Sampled unconditionally: `textureSample` needs uniform control flow.
    // Rect draws bind a 1x1 placeholder texture.
    var color = textureSample(source_texture, source_sampler, input.uv);
    if input.blend.y == 1.0 && color.a > 0.0 {
        color = vec4<f32>(color.rgb / color.a, color.a);
    }
    if input.size_opacity_kind.w == 1.0 {
        color = rect_color(input);
    }
    let coverage = clip_coverage(input.world, input.clip);
    return vec4<f32>(color.rgb, color.a * input.size_opacity_kind.z * coverage);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return source_color(input);
}

// `celesta_composition::BlendMode::blend_channel` for all three channels.
fn blend(mode: u32, backdrop: vec3<f32>, source: vec3<f32>) -> vec3<f32> {
    switch mode {
        case 1u: {
            return source * backdrop;
        }
        case 2u: {
            return backdrop + source - backdrop * source;
        }
        case 3u: {
            let doubled = 2.0 * backdrop;
            let screened = source + (doubled - 1.0) - source * (doubled - 1.0);
            return select(screened, source * doubled, backdrop <= vec3<f32>(0.5));
        }
        case 4u: {
            return min(source + backdrop, vec3<f32>(1.0));
        }
        case 5u: {
            return abs(backdrop - source);
        }
        default: {
            return source;
        }
    }
}

// Blends the layer with the backdrop under this fragment and replaces the
// canvas pixel with the result, as `celesta_renderer`'s `blend_with_mode`
// does, keeping the canvas premultiplied.
@fragment
fn fs_blend(input: VertexOutput) -> @location(0) vec4<f32> {
    let source = source_color(input);
    let backdrop = textureLoad(backdrop_texture, vec2<i32>(floor(input.position.xy)), 0);
    var backdrop_color = vec3<f32>(0.0);
    if backdrop.a > 0.0 {
        backdrop_color = backdrop.rgb / backdrop.a;
    }
    let mode = u32(input.blend.x + 0.5);
    let mixed = (1.0 - backdrop.a) * source.rgb
        + backdrop.a * blend(mode, backdrop_color, source.rgb);
    return vec4<f32>(
        source.a * mixed + backdrop.rgb * (1.0 - source.a),
        source.a + backdrop.a * (1.0 - source.a),
    );
}
