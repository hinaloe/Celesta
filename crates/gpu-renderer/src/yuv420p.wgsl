// Converts a rendered frame, composited in `canvas_format`, into the three
// planes of yuv420p: a full-size Y plane (`luma`) and quarter-size U and V
// planes (`chroma`, one render target each), ready to hand to an H.264
// encoder without a CPU-side color conversion.
//
// The matrix is BT.601 with limited ("TV") range, the conversion libswscale
// applies to untagged RGB input, so the encoded colors match an RGBA export.
// Chroma is the average of each 2x2 block, sited at the block's center.
//
// Each plane is rounded with `dither` (`dither.wgsl`, prepended) from the
// frame's own precision. Rounded alone, a dark gradient's luma would step
// only where its channels' steps add up to a whole code, in bands several
// times wider than an RGBA export's.

@group(0) @binding(0)
var frame: texture_2d<f32>;

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
    let positions = array(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    return vec4<f32>(positions[index], 0.0, 1.0);
}

fn rgb(pixel: vec2<u32>) -> vec3<f32> {
    return textureLoad(frame, pixel, 0).rgb;
}

@fragment
fn luma(@builtin(position) position: vec4<f32>) -> @location(0) f32 {
    let pixel = vec2<u32>(position.xy);
    let color = rgb(pixel);
    return code(16.0 + dot(color, vec3<f32>(65.481, 128.553, 24.966)), dither(pixel));
}

struct Chroma {
    @location(0) u: f32,
    @location(1) v: f32,
};

@fragment
fn chroma(@builtin(position) position: vec4<f32>) -> Chroma {
    let block = vec2<u32>(position.xy);
    let pixel = block * 2u;
    let color = (rgb(pixel) + rgb(pixel + vec2<u32>(1u, 0u)) + rgb(pixel + vec2<u32>(0u, 1u))
        + rgb(pixel + vec2<u32>(1u, 1u))) * 0.25;
    let offset = dither(block);
    return Chroma(
        code(128.0 + dot(color, vec3<f32>(-37.797, -74.203, 112.0)), offset),
        code(128.0 + dot(color, vec3<f32>(112.0, -93.786, -18.214)), offset),
    );
}
