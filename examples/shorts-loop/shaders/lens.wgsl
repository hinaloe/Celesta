// A shock ring over the whole frame. Pixels near the ring, `params.radius`
// from `params.center`, are pulled in on its inside and pushed out on its
// outside, their red and blue drift apart, and the ring catches some light.
// Reads past the frame's edge fold back in, so the sides show no seam.

fn effect(input: EffectInput) -> vec4f {
    let d = input.position - params.center;
    let r = length(d);
    let direction = d / max(r, 1e-4);
    let x = (r - params.radius) / params.width;
    let ring = exp(-x * x);
    let p = input.position + direction * (2.0 * x * ring * params.strength);
    let split = direction * ring * params.strength * 0.4;
    let red = source_at_mirrored(p + split);
    let green = source_at_mirrored(p);
    let blue = source_at_mirrored(p - split);
    let color = vec4f(red.r, green.g, blue.b, max(green.a, max(red.a, blue.a)));
    return color + premultiply(params.tint) * ring * params.strength * 0.006;
}
