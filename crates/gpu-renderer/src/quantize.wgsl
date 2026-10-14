// Quantizes a finished frame, composited in `canvas_format`, to the 8-bit
// code values of an RGBA readback or a preview target, texel for texel,
// through `dither` (`dither.wgsl`, prepended); `rgba16` to 16-bit codes,
// finer than a half float, so it needs no dither; `rgba16_straight` to the
// same codes with the color divided by alpha, for an encoder that expects
// straight alpha.

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

@fragment
fn fragment(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let pixel = vec2<u32>(position.xy);
    let color = textureLoad(frame, pixel, 0) * 255.0;
    let offset = dither(pixel);
    let alpha = code(color.a, offset);
    // Premultiplied, over a transparent background: no channel above alpha.
    let rgb = vec3<f32>(code(color.r, offset), code(color.g, offset), code(color.b, offset));
    return vec4<f32>(min(rgb, vec3<f32>(alpha)), alpha);
}

@fragment
fn rgba16(@builtin(position) position: vec4<f32>) -> @location(0) vec4<u32> {
    let color = clamp(textureLoad(frame, vec2<u32>(position.xy), 0), vec4<f32>(0.0), vec4<f32>(1.0));
    let codes = vec4<u32>(floor(color * 65535.0 + 0.5));
    return vec4<u32>(min(codes.rgb, vec3<u32>(codes.a)), codes.a);
}

@fragment
fn rgba16_straight(@builtin(position) position: vec4<f32>) -> @location(0) vec4<u32> {
    let color = clamp(textureLoad(frame, vec2<u32>(position.xy), 0), vec4<f32>(0.0), vec4<f32>(1.0));
    var straight = vec4<f32>(0.0);
    if color.a > 0.0 {
        straight = vec4<f32>(clamp(color.rgb / color.a, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
    }
    return vec4<u32>(floor(straight * 65535.0 + 0.5));
}
