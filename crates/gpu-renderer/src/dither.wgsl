// Rounding to 8-bit code values with an ordered dither, prepended to the
// shaders that quantize a finished frame (`quantize.wgsl`, `yuv420p.wgsl`).
// A smooth gradient rounded alone turns into flat bands a code apart; the
// dither spreads each band's edge over a fine, fixed pattern instead.

// The dither offset at `pixel`, in codes: the 8x8 Bayer matrix's 64
// thresholds, evenly spaced around 0 within half a code. It depends on the
// pixel's position only, so a frame always quantizes the same way.
fn dither(pixel: vec2<u32>) -> f32 {
    let y = pixel.y & 7u;
    let v = (pixel.x & 7u) ^ y;
    // The bits of `v` and `y` interleaved, lowest first.
    let index = ((v & 1u) << 5u) | ((y & 1u) << 4u) | ((v & 2u) << 2u) | ((y & 2u) << 1u)
        | ((v & 4u) >> 1u) | ((y & 4u) >> 2u);
    return (f32(index) + 0.5) / 64.0 - 0.5;
}

// How far from a whole code a value can be and still be taken for it: a
// half-float canvas's error, one unit in the last place (1/8 of a code just
// below 1) where a driver truncates rather than rounds when it stores
// (lavapipe and WARP do).
const WHOLE_CODE_TOLERANCE: f32 = 0.125;

// `value`, in code values, rounded to a whole code after adding `offset`,
// as a 0-1 value an 8-bit unorm target stores without rounding again. A
// value within `WHOLE_CODE_TOLERANCE` of a whole code, as a solid fill's
// is, keeps that code without the dither.
fn code(value: f32, offset: f32) -> f32 {
    let nearest = floor(value + 0.5);
    let dithered = floor(value + 0.5 + offset);
    let rounded = select(dithered, nearest, abs(value - nearest) < WHOLE_CODE_TOLERANCE);
    return clamp(rounded, 0.0, 255.0) / 255.0;
}
