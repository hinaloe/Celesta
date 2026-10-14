// Adds one sample of a motion-blurred group onto the group's canvas, texel
// for texel; the pipeline's blend constant weights it. Both canvases hold
// premultiplied alpha and cover the same part of the scene.

@group(0) @binding(0)
var sample: texture_2d<f32>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
};

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> VertexOutput {
    let vertices = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    return VertexOutput(vec4<f32>(vertices[index], 0.0, 1.0));
}

@fragment
fn fragment(input: VertexOutput) -> @location(0) vec4<f32> {
    return textureLoad(sample, vec2<i32>(floor(input.position.xy)), 0);
}
