// The declarations every custom shader is assembled with (`shader.rs`): the
// author's `effect` sees `EffectInput`, `celesta`, and the helpers below.
// Names starting with `celesta` are the prelude's own.

struct EffectInput {
    // The pixel's centre, in scene pixels.
    position: vec2f,
    // `position` relative to the content box: 0,0 at its top-left corner,
    // 1,1 at its bottom-right.
    uv: vec2f,
};

struct Celesta {
    // The scene's width and height, in pixels.
    scene_size: vec2f,
    // The scene pixel the canvas's top-left texel covers.
    celesta_canvas_origin: vec2f,
    // The content box: left, top, right, bottom, in scene pixels.
    content: vec4f,
};

// The canvas the filtered layer was drawn onto, bound like `layer.wgsl`'s
// layer texture.
@group(0) @binding(0)
var celesta_source: texture_2d<f32>;

@group(1) @binding(0)
var<uniform> celesta: Celesta;

// The filtered layer's pixel at `pixel`, in scene pixel coordinates.
// Pixels outside the canvas are transparent.
fn source_load(pixel: vec2i) -> vec4f {
    let texel = pixel - vec2i(celesta.celesta_canvas_origin);
    let size = vec2i(textureDimensions(celesta_source));
    if any(texel < vec2i(0)) || any(texel >= size) {
        return vec4f(0.0);
    }
    return textureLoad(celesta_source, texel, 0);
}

// The filtered layer at `position`, in scene pixels, interpolated bilinearly
// between pixel centres. Pixels outside the canvas are transparent.
fn source_at(position: vec2f) -> vec4f {
    let at = position - vec2f(0.5);
    let low = vec2i(floor(at));
    let fraction = at - floor(at);
    let top = mix(source_load(low), source_load(low + vec2i(1, 0)), fraction.x);
    let bottom = mix(source_load(low + vec2i(0, 1)), source_load(low + vec2i(1, 1)), fraction.x);
    return mix(top, bottom, fraction.y);
}

// The centres of the content box's first and last pixels, the range the
// edge-aware reads below keep to. A box narrower than a pixel keeps to its
// middle.
fn celesta_edge_low() -> vec2f {
    return min(celesta.content.xy + vec2f(0.5), mix(celesta.content.xy, celesta.content.zw, vec2f(0.5)));
}

fn celesta_edge_high() -> vec2f {
    return max(celesta.content.zw - vec2f(0.5), celesta_edge_low());
}

// `source_at`, with a position past the content box moved onto its edge:
// the edge pixels stretch outward.
fn source_at_clamped(position: vec2f) -> vec4f {
    return source_at(clamp(position, celesta_edge_low(), celesta_edge_high()));
}

// `source_at`, with a position past the content box folded back in, as if
// the box were mirrored about its edge pixels' centres, again and again.
fn source_at_mirrored(position: vec2f) -> vec4f {
    let low = celesta_edge_low();
    let period = max(2.0 * (celesta_edge_high() - low), vec2f(1e-4));
    let t = abs(position - low) % period;
    return source_at(low + min(t, period - t));
}

fn premultiply(color: vec4f) -> vec4f {
    return vec4f(color.rgb * color.a, color.a);
}

fn unpremultiply(color: vec4f) -> vec4f {
    if color.a <= 0.0 {
        return vec4f(0.0);
    }
    return vec4f(color.rgb / color.a, color.a);
}
