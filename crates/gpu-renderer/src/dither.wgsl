// Rounding to 8-bit code values with an ordered dither, prepended to the
// shaders that quantize a finished frame (`quantize.wgsl`, `yuv420p.wgsl`).
// A smooth gradient rounded alone turns into flat bands a code apart; the
// dither spreads each band's edge over a fine, fixed pattern instead.

// The dither offset at `pixel`, in code values: the 8x8 Bayer matrix's 64
// thresholds, evenly spaced around 0. It depends on the pixel's position
// only, so a frame always quantizes the same way. Scaled to 7/8 so it stays
// under half a code by more than a half-float canvas's rounding error: a
// value that lands on a whole code, as a solid fill does, keeps it.
fn dither(pixel: vec2<u32>) -> f32 {
    let y = pixel.y & 7u;
    let v = (pixel.x & 7u) ^ y;
    // The bits of `v` and `y` interleaved, lowest first.
    let index = ((v & 1u) << 5u) | ((y & 1u) << 4u) | ((v & 2u) << 2u) | ((y & 2u) << 1u)
        | ((v & 4u) >> 1u) | ((y & 4u) >> 2u);
    return ((f32(index) + 0.5) / 64.0 - 0.5) * 0.875;
}

// `value`, in code values, rounded to a whole code after adding `offset`,
// as a 0-1 value an 8-bit unorm target stores without rounding again.
fn code(value: f32, offset: f32) -> f32 {
    return clamp(floor(value + 0.5 + offset), 0.0, 255.0) / 255.0;
}
