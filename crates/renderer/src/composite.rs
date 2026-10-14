use crate::types::Color;
use celesta_composition::{BlendMode, MaskMode};

/// Composites `source` onto `destination` (both non-premultiplied) through
/// `mode`: the source color becomes `(1 - ab) * Cs + ab * B(Cb, Cs)`, which
/// then composites source-over, as in the W3C Compositing and Blending spec.
pub(crate) fn blend_with_mode(
    destination: &mut [u8],
    source: Color,
    opacity: f64,
    mode: BlendMode,
) {
    if mode.is_normal() {
        return blend(destination, source, opacity);
    }
    blend_mixed(destination, source, opacity, |backdrop, source| {
        mode.blend(backdrop, source)
    });
}

/// Source-over compositing with a mixing function `mix(backdrop, source)`
/// of whole colors, all in 0–1 (W3C Compositing, "simple alpha
/// compositing" with blending).
pub(crate) fn blend_mixed(
    destination: &mut [u8],
    source: Color,
    opacity: f64,
    mix: impl Fn([f64; 3], [f64; 3]) -> [f64; 3],
) {
    let source_alpha = (f64::from(source.alpha) / 255.0) * opacity.clamp(0.0, 1.0);
    if source_alpha == 0.0 {
        return;
    }
    let backdrop_alpha = f64::from(destination[3]) / 255.0;
    let output_alpha = source_alpha + backdrop_alpha * (1.0 - source_alpha);
    let source_color = [source.red, source.green, source.blue].map(|c| f64::from(c) / 255.0);
    let backdrop_color = [0, 1, 2].map(|channel| f64::from(destination[channel]) / 255.0);
    let blended = mix(backdrop_color, source_color);
    for channel in 0..3 {
        let mixed =
            (1.0 - backdrop_alpha) * source_color[channel] + backdrop_alpha * blended[channel];
        let output = (source_alpha * mixed
            + backdrop_alpha * backdrop_color[channel] * (1.0 - source_alpha))
            / output_alpha;
        destination[channel] = (output * 255.0).round().clamp(0.0, 255.0) as u8;
    }
    destination[3] = (output_alpha * 255.0).round().clamp(0.0, 255.0) as u8;
}

pub(crate) fn blend(destination: &mut [u8], source: Color, opacity: f64) {
    let source_alpha = (f64::from(source.alpha) / 255.0) * opacity.clamp(0.0, 1.0);
    // A transparent source keeps the destination: the general formula below
    // divides `destination * alpha` by that same alpha. Over nothing, or
    // fully opaque, the source comes out as it is, for the same reason. Most
    // glyph and stroke pixels take one of these paths.
    if source_alpha == 0.0 {
        // Except that a transparent destination comes out all zeros.
        if destination[3] == 0 {
            destination.copy_from_slice(&[0, 0, 0, 0]);
        }
        return;
    }
    if source_alpha == 1.0 || destination[3] == 0 {
        destination.copy_from_slice(&[
            source.red,
            source.green,
            source.blue,
            (source_alpha * 255.0).round() as u8,
        ]);
        return;
    }
    let destination_alpha = f64::from(destination[3]) / 255.0;
    let output_alpha = source_alpha + destination_alpha * (1.0 - source_alpha);
    if output_alpha == 0.0 {
        destination.copy_from_slice(&[0, 0, 0, 0]);
        return;
    }
    for channel in 0..3 {
        let source_value = f64::from([source.red, source.green, source.blue][channel]);
        let destination_value = f64::from(destination[channel]);
        let output = (source_value * source_alpha
            + destination_value * destination_alpha * (1.0 - source_alpha))
            / output_alpha;
        destination[channel] = output.round().clamp(0.0, 255.0) as u8;
    }
    destination[3] = (output_alpha * 255.0).round().clamp(0.0, 255.0) as u8;
}

/// How much of a masked group shows through the straight-alpha mask pixel
/// `matte`, 0 to 1: its alpha, or the Rec. 709 luma of its sRGB-encoded
/// color times its alpha; `1 - m` when inverted.
pub(crate) fn mask_value(mode: MaskMode, invert: bool, matte: &[u8]) -> f64 {
    let alpha = f64::from(matte[3]) / 255.0;
    let value = match mode {
        MaskMode::Alpha => alpha,
        MaskMode::Luminance => {
            let [red, green, blue] = [matte[0], matte[1], matte[2]].map(|c| f64::from(c) / 255.0);
            (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha
        }
    };
    if invert { 1.0 - value } else { value }
}

/// How a PSD layer's blend mode mixes `B(backdrop, source)`, all in 0–1.
#[derive(Clone, Copy, Debug)]
pub(crate) enum PsdBlend {
    /// A mode Celesta's layers also have, as `BlendMode` computes it.
    Mode(BlendMode),
    /// One of Photoshop's other modes, which blend each channel on its own.
    Channel(fn(f64, f64) -> f64),
}

impl PsdBlend {
    pub(crate) fn mix(self, backdrop: [f64; 3], source: [f64; 3]) -> [f64; 3] {
        match self {
            Self::Mode(mode) => mode.blend(backdrop, source),
            Self::Channel(mix) => [0, 1, 2].map(|channel| mix(backdrop[channel], source[channel])),
        }
    }
}

/// The mixing of a PSD layer's blend mode, named as the `psd` crate's
/// `Debug` prints it. `None` for normal, and for the modes drawn as normal
/// because they pick whole colors (darker and lighter color) or noise
/// (dissolve).
pub(crate) fn psd_blend(mode: &str) -> Option<PsdBlend> {
    fn vivid_light(b: f64, s: f64) -> f64 {
        let (mode, s) = if s <= 0.5 {
            (BlendMode::ColorBurn, 2.0 * s)
        } else {
            (BlendMode::ColorDodge, 2.0 * s - 1.0)
        };
        mode.separable().expect("dodge and burn are separable")(b, s)
    }
    fn pin_light(b: f64, s: f64) -> f64 {
        if s <= 0.5 {
            b.min(2.0 * s)
        } else {
            b.max(2.0 * s - 1.0)
        }
    }

    let shared = match mode {
        "Darken" => BlendMode::Darken,
        "Multiply" => BlendMode::Multiply,
        "ColorBurn" => BlendMode::ColorBurn,
        "Lighten" => BlendMode::Lighten,
        "Screen" => BlendMode::Screen,
        "ColorDodge" => BlendMode::ColorDodge,
        "LinearDodge" => BlendMode::Add,
        "Overlay" => BlendMode::Overlay,
        "SoftLight" => BlendMode::SoftLight,
        "HardLight" => BlendMode::HardLight,
        "Difference" => BlendMode::Difference,
        "Exclusion" => BlendMode::Exclusion,
        "Hue" => BlendMode::Hue,
        "Saturation" => BlendMode::Saturation,
        "Color" => BlendMode::Color,
        "Luminosity" => BlendMode::Luminosity,
        _ => {
            return Some(PsdBlend::Channel(match mode {
                "LinearBurn" => |b, s| (b + s - 1.0).max(0.0),
                "VividLight" => vivid_light,
                "LinearLight" => |b, s| (b + 2.0 * s - 1.0).clamp(0.0, 1.0),
                "PinLight" => pin_light,
                "HardMix" => |b, s| if b + s >= 1.0 { 1.0 } else { 0.0 },
                "Subtract" => |b, s| (b - s).max(0.0),
                "Divide" => |b, s| {
                    if s <= 0.0 {
                        if b <= 0.0 { 0.0 } else { 1.0 }
                    } else {
                        (b / s).min(1.0)
                    }
                },
                // PassThrough, Normal, Dissolve, DarkerColor, LighterColor.
                _ => return None,
            }));
        }
    };
    Some(PsdBlend::Mode(shared))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `blend` without its shortcuts.
    fn blend_exactly(destination: &mut [u8], source: Color, opacity: f64) {
        let source_alpha = (f64::from(source.alpha) / 255.0) * opacity.clamp(0.0, 1.0);
        let destination_alpha = f64::from(destination[3]) / 255.0;
        let output_alpha = source_alpha + destination_alpha * (1.0 - source_alpha);
        if output_alpha == 0.0 {
            destination.copy_from_slice(&[0, 0, 0, 0]);
            return;
        }
        for channel in 0..3 {
            let source_value = f64::from([source.red, source.green, source.blue][channel]);
            let destination_value = f64::from(destination[channel]);
            let output = (source_value * source_alpha
                + destination_value * destination_alpha * (1.0 - source_alpha))
                / output_alpha;
            destination[channel] = output.round().clamp(0.0, 255.0) as u8;
        }
        destination[3] = (output_alpha * 255.0).round().clamp(0.0, 255.0) as u8;
    }

    #[test]
    fn shortcuts_match_the_general_formula() {
        let channels = [0, 1, 37, 128, 200, 254, 255];
        for &red in &channels {
            for &alpha in &channels {
                for opacity in [0.0, 0.3, 1.0 / 255.0, 0.999, 1.0] {
                    for destination in [[0, 0, 0, 0], [9, 99, 199, 0], [40, 80, 120, 255]] {
                        let source = Color::rgba(red, 255 - red, red / 2, alpha);
                        let (mut fast, mut exact) = (destination, destination);
                        blend(&mut fast, source, opacity);
                        blend_exactly(&mut exact, source, opacity);
                        assert_eq!(fast, exact, "{source:?} at {opacity} over {destination:?}");
                    }
                }
            }
        }
    }
}
