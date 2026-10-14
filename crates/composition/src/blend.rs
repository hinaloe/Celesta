use serde::{Deserialize, Serialize};

/// Blend modes from the W3C Compositing and Blending spec (plus `Add`,
/// Photoshop's Linear Dodge), applied to non-premultiplied channel values
/// as stored (sRGB-encoded). With source color `Cs`, backdrop color `Cb` and
/// backdrop alpha `ab`, the source color is replaced by
/// `(1 - ab) * Cs + ab * B(Cb, Cs)` and then composited source-over.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum BlendMode {
    /// `B = Cs`: plain source-over.
    #[default]
    Normal,
    /// `B = Cs * Cb`: darkens; white is neutral.
    Multiply,
    /// `B = Cs + Cb - Cs * Cb`: lightens; black is neutral.
    Screen,
    /// Multiply where the backdrop is dark, screen where it is light:
    /// `HardLight` with backdrop and source swapped.
    Overlay,
    /// `B = min(Cs + Cb, 1)` (Linear Dodge): black is neutral.
    Add,
    /// `B = |Cb - Cs|`: black is neutral, white inverts.
    Difference,
    /// `B = min(Cb, Cs)`.
    Darken,
    /// `B = max(Cb, Cs)`.
    Lighten,
    /// Brightens the backdrop toward the source: `min(1, Cb / (1 - Cs))`.
    ColorDodge,
    /// Darkens the backdrop toward the source: `1 - min(1, (1 - Cb) / Cs)`.
    ColorBurn,
    /// Multiply where the source is dark, screen where it is light.
    HardLight,
    /// A gentler `HardLight`: darkens or lightens the backdrop a little.
    SoftLight,
    /// `B = Cb + Cs - 2 * Cb * Cs`: `Difference` with less contrast.
    Exclusion,
    /// The source's hue with the backdrop's saturation and luminosity.
    Hue,
    /// The source's saturation with the backdrop's hue and luminosity.
    Saturation,
    /// The source's hue and saturation with the backdrop's luminosity.
    Color,
    /// The source's luminosity with the backdrop's hue and saturation.
    Luminosity,
}

impl BlendMode {
    pub fn is_normal(&self) -> bool {
        *self == Self::Normal
    }

    /// The blended color `B(Cb, Cs)`, every channel in `0.0..=1.0`.
    pub fn blend(self, backdrop: [f64; 3], source: [f64; 3]) -> [f64; 3] {
        if let Some(mix) = self.separable() {
            return [0, 1, 2].map(|index| mix(backdrop[index], source[index]));
        }
        match self {
            Self::Hue => set_lum(set_sat(source, sat(backdrop)), lum(backdrop)),
            Self::Saturation => set_lum(set_sat(backdrop, sat(source)), lum(backdrop)),
            Self::Color => set_lum(source, lum(backdrop)),
            Self::Luminosity => set_lum(backdrop, lum(source)),
            _ => unreachable!("{self:?} is separable"),
        }
    }

    /// `B(Cb, Cs)` of one channel for the modes that blend each channel on
    /// its own; `None` for hue, saturation, color and luminosity, which mix
    /// whole colors.
    pub fn separable(self) -> Option<fn(f64, f64) -> f64> {
        Some(match self {
            Self::Normal => |_, s| s,
            Self::Multiply => |b, s| b * s,
            Self::Screen => screen,
            Self::Overlay => |b, s| hard_light(s, b),
            Self::Add => |b, s| (b + s).min(1.0),
            Self::Difference => |b, s| (b - s).abs(),
            Self::Darken => f64::min,
            Self::Lighten => f64::max,
            Self::ColorDodge => color_dodge,
            Self::ColorBurn => color_burn,
            Self::HardLight => hard_light,
            Self::SoftLight => soft_light,
            Self::Exclusion => |b, s| b + s - 2.0 * b * s,
            Self::Hue | Self::Saturation | Self::Color | Self::Luminosity => return None,
        })
    }
}

fn screen(backdrop: f64, source: f64) -> f64 {
    backdrop + source - backdrop * source
}

fn color_dodge(backdrop: f64, source: f64) -> f64 {
    if backdrop <= 0.0 {
        0.0
    } else if source >= 1.0 {
        1.0
    } else {
        (backdrop / (1.0 - source)).min(1.0)
    }
}

fn color_burn(backdrop: f64, source: f64) -> f64 {
    if backdrop >= 1.0 {
        1.0
    } else if source <= 0.0 {
        0.0
    } else {
        1.0 - ((1.0 - backdrop) / source).min(1.0)
    }
}

fn hard_light(backdrop: f64, source: f64) -> f64 {
    if source <= 0.5 {
        backdrop * 2.0 * source
    } else {
        screen(backdrop, 2.0 * source - 1.0)
    }
}

fn soft_light(backdrop: f64, source: f64) -> f64 {
    if source <= 0.5 {
        backdrop - (1.0 - 2.0 * source) * backdrop * (1.0 - backdrop)
    } else {
        let d = if backdrop <= 0.25 {
            ((16.0 * backdrop - 12.0) * backdrop + 4.0) * backdrop
        } else {
            backdrop.sqrt()
        };
        backdrop + (2.0 * source - 1.0) * (d - backdrop)
    }
}

/// The spec's luminosity, with its own weights (not Rec. 709).
fn lum([red, green, blue]: [f64; 3]) -> f64 {
    0.3 * red + 0.59 * green + 0.11 * blue
}

fn sat(color: [f64; 3]) -> f64 {
    max(color) - min(color)
}

fn min([red, green, blue]: [f64; 3]) -> f64 {
    red.min(green).min(blue)
}

fn max([red, green, blue]: [f64; 3]) -> f64 {
    red.max(green).max(blue)
}

/// Brings a color with channels outside 0–1 back in, keeping its
/// luminosity and hue.
fn clip_color(color: [f64; 3]) -> [f64; 3] {
    let l = lum(color);
    let (n, x) = (min(color), max(color));
    let mut color = color;
    if n < 0.0 && l > n {
        color = color.map(|c| l + (c - l) * l / (l - n));
    }
    if x > 1.0 && x > l {
        color = color.map(|c| l + (c - l) * (1.0 - l) / (x - l));
    }
    color.map(|c| c.clamp(0.0, 1.0))
}

fn set_lum(color: [f64; 3], l: f64) -> [f64; 3] {
    let d = l - lum(color);
    clip_color(color.map(|c| c + d))
}

/// The spec's `SetSat`: the largest channel becomes `s`, the smallest 0,
/// and the middle one keeps its place between them. Scaling each channel's
/// distance from the smallest does that without sorting.
fn set_sat(color: [f64; 3], s: f64) -> [f64; 3] {
    let (n, x) = (min(color), max(color));
    if x > n {
        color.map(|c| (c - n) * s / (x - n))
    } else {
        [0.0; 3]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEPARABLE: [BlendMode; 13] = [
        BlendMode::Normal,
        BlendMode::Multiply,
        BlendMode::Screen,
        BlendMode::Overlay,
        BlendMode::Add,
        BlendMode::Difference,
        BlendMode::Darken,
        BlendMode::Lighten,
        BlendMode::ColorDodge,
        BlendMode::ColorBurn,
        BlendMode::HardLight,
        BlendMode::SoftLight,
        BlendMode::Exclusion,
    ];
    const NON_SEPARABLE: [BlendMode; 4] = [
        BlendMode::Hue,
        BlendMode::Saturation,
        BlendMode::Color,
        BlendMode::Luminosity,
    ];

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    fn close3(a: [f64; 3], b: [f64; 3]) -> bool {
        a.iter().zip(b).all(|(a, b)| close(*a, b))
    }

    /// `B(Cb, Cs)` of a separable mode, on one channel.
    fn mix(mode: BlendMode, backdrop: f64, source: f64) -> f64 {
        let blended = mode.blend([backdrop; 3], [source; 3]);
        assert!(close(blended[0], blended[1]) && close(blended[1], blended[2]));
        blended[0]
    }

    const STEPS: [f64; 9] = [0.0, 0.1, 0.25, 0.3, 0.5, 0.64, 0.75, 0.9, 1.0];

    #[test]
    fn separable_modes_follow_the_spec_formulas() {
        // Values worked out by hand from the formulas in the spec.
        let cases = [
            (BlendMode::Multiply, 0.5, 0.5, 0.25),
            (BlendMode::Screen, 0.5, 0.5, 0.75),
            (BlendMode::Overlay, 0.25, 0.5, 0.25),
            (BlendMode::Overlay, 0.75, 0.5, 0.75),
            (BlendMode::Add, 0.7, 0.6, 1.0),
            (BlendMode::Difference, 0.3, 0.8, 0.5),
            (BlendMode::Darken, 0.3, 0.6, 0.3),
            (BlendMode::Lighten, 0.3, 0.6, 0.6),
            (BlendMode::ColorDodge, 0.25, 0.5, 0.5),
            (BlendMode::ColorDodge, 0.75, 0.5, 1.0),
            (BlendMode::ColorBurn, 0.75, 0.5, 0.5),
            (BlendMode::ColorBurn, 0.25, 0.5, 0.0),
            (BlendMode::HardLight, 0.5, 0.25, 0.25),
            (BlendMode::HardLight, 0.5, 0.75, 0.75),
            // Cs <= 0.5: Cb - (1 - 2Cs) Cb (1 - Cb).
            (BlendMode::SoftLight, 0.5, 0.0, 0.25),
            // Cs > 0.5, Cb <= 0.25: D(Cb) = ((16Cb - 12)Cb + 4)Cb = 0.5.
            (BlendMode::SoftLight, 0.25, 0.75, 0.375),
            // Cs > 0.5, Cb > 0.25: D(Cb) = sqrt(Cb) = 0.8.
            (BlendMode::SoftLight, 0.64, 1.0, 0.8),
            (BlendMode::Exclusion, 0.5, 0.5, 0.5),
            (BlendMode::Exclusion, 0.25, 1.0, 0.75),
        ];
        for (mode, backdrop, source, expected) in cases {
            let actual = mix(mode, backdrop, source);
            assert!(
                close(actual, expected),
                "{mode:?}({backdrop}, {source}) = {actual}, expected {expected}"
            );
        }
    }

    #[test]
    fn only_the_non_separable_modes_lack_a_channel_function() {
        for mode in SEPARABLE {
            assert!(mode.separable().is_some(), "{mode:?}");
        }
        for mode in NON_SEPARABLE {
            assert!(mode.separable().is_none(), "{mode:?}");
        }
    }

    #[test]
    fn dodge_and_burn_take_the_spec_edge_cases() {
        // A black backdrop stays black under color-dodge, even under white.
        assert_eq!(mix(BlendMode::ColorDodge, 0.0, 1.0), 0.0);
        assert_eq!(mix(BlendMode::ColorDodge, 0.4, 1.0), 1.0);
        // A white backdrop stays white under color-burn, even under black.
        assert_eq!(mix(BlendMode::ColorBurn, 1.0, 0.0), 1.0);
        assert_eq!(mix(BlendMode::ColorBurn, 0.4, 0.0), 0.0);
    }

    #[test]
    fn separable_modes_keep_the_backdrop_under_their_neutral_source() {
        let neutral = [
            (BlendMode::Multiply, 1.0),
            (BlendMode::Screen, 0.0),
            (BlendMode::Add, 0.0),
            (BlendMode::Difference, 0.0),
            (BlendMode::Darken, 1.0),
            (BlendMode::Lighten, 0.0),
            (BlendMode::ColorDodge, 0.0),
            (BlendMode::ColorBurn, 1.0),
            (BlendMode::HardLight, 0.5),
            (BlendMode::SoftLight, 0.5),
            (BlendMode::Exclusion, 0.0),
        ];
        for (mode, source) in neutral {
            for backdrop in STEPS {
                let actual = mix(mode, backdrop, source);
                assert!(
                    close(actual, backdrop),
                    "{mode:?}({backdrop}, {source}) = {actual}"
                );
            }
        }
        // White inverts under difference and exclusion.
        for backdrop in STEPS {
            assert!(close(
                mix(BlendMode::Exclusion, backdrop, 1.0),
                1.0 - backdrop
            ));
            assert!(close(
                mix(BlendMode::Difference, backdrop, 1.0),
                1.0 - backdrop
            ));
        }
    }

    #[test]
    fn overlay_is_hard_light_with_its_inputs_swapped() {
        for backdrop in STEPS {
            for source in STEPS {
                assert!(close(
                    mix(BlendMode::Overlay, backdrop, source),
                    mix(BlendMode::HardLight, source, backdrop),
                ));
            }
        }
    }

    /// The spec's `SetSat` as written: sort the channels, then set max,
    /// mid and min.
    fn set_sat_sorted(color: [f64; 3], s: f64) -> [f64; 3] {
        let mut order = [0, 1, 2];
        order.sort_by(|&a, &b| color[a].total_cmp(&color[b]));
        let [lo, mid, hi] = order;
        let mut result = [0.0; 3];
        if color[hi] > color[lo] {
            result[mid] = (color[mid] - color[lo]) * s / (color[hi] - color[lo]);
            result[hi] = s;
        }
        result
    }

    fn colors() -> Vec<[f64; 3]> {
        let mut colors = Vec::new();
        for red in [0.0, 0.2, 0.5, 0.8, 1.0] {
            for green in [0.0, 0.35, 0.7, 1.0] {
                for blue in [0.0, 0.1, 0.6, 1.0] {
                    colors.push([red, green, blue]);
                }
            }
        }
        colors
    }

    #[test]
    fn set_sat_matches_the_spec_pseudocode() {
        for color in colors() {
            for s in [0.0, 0.3, 1.0] {
                assert!(
                    close3(set_sat(color, s), set_sat_sorted(color, s)),
                    "{color:?} {s}"
                );
            }
        }
    }

    #[test]
    fn non_separable_modes_follow_the_spec_formulas() {
        let red = [1.0, 0.0, 0.0];
        let gray = [0.5, 0.5, 0.5];
        // SetLum(red, 0.5): red + 0.2 = (1.2, 0.2, 0.2), then ClipColor
        // scales toward the luminosity 0.5 by (1 - 0.5) / (1.2 - 0.5).
        let clipped_red = [1.0, 0.5 - 0.3 * 0.5 / 0.7, 0.5 - 0.3 * 0.5 / 0.7];
        assert!(close3(BlendMode::Color.blend(gray, red), clipped_red));
        assert!(
            close3(BlendMode::Hue.blend(gray, red), gray),
            "a gray backdrop has no saturation to give"
        );
        assert!(
            close3(BlendMode::Saturation.blend(gray, red), gray),
            "a gray backdrop has no hue to keep"
        );
        // Luminosity: the gray backdrop moved to red's luminosity, 0.3.
        assert!(close3(BlendMode::Luminosity.blend(gray, red), [0.3; 3]));
        // Hue: blue at the backdrop's saturation 0.6 is (0, 0, 0.6), lifted
        // to the backdrop's luminosity 0.498 and clipped below 1.
        let orange = [0.8, 0.4, 0.2];
        let blue = [0.0, 0.0, 1.0];
        let l = lum(orange);
        let lifted = [0.0, 0.0, 0.6].map(|c| c + l - 0.066);
        let expected = lifted.map(|c| l + (c - l) * (1.0 - l) / (lifted[2] - l));
        assert!(close3(BlendMode::Hue.blend(orange, blue), expected));
    }

    #[test]
    fn non_separable_modes_keep_what_the_spec_says_they_keep() {
        for backdrop in colors() {
            for source in colors() {
                let color = BlendMode::Color.blend(backdrop, source);
                assert!(
                    close(lum(color), lum(backdrop)),
                    "color keeps the backdrop's luminosity"
                );
                let luminosity = BlendMode::Luminosity.blend(backdrop, source);
                assert!(
                    close(lum(luminosity), lum(source)),
                    "luminosity takes the source's"
                );
                let hue = BlendMode::Hue.blend(backdrop, source);
                assert!(
                    close(lum(hue), lum(backdrop)),
                    "hue keeps the backdrop's luminosity"
                );
                let saturation = BlendMode::Saturation.blend(backdrop, source);
                assert!(
                    close(lum(saturation), lum(backdrop)),
                    "saturation keeps it too"
                );
                // Without clipping, color and saturation also keep the
                // saturation they take.
                let unclipped = |c: [f64; 3]| min(c) > 1e-9 && max(c) < 1.0 - 1e-9;
                if unclipped(color) {
                    assert!(close(sat(color), sat(source)));
                }
                if unclipped(saturation) {
                    assert!(close(sat(saturation), sat(source)));
                }
            }
        }
    }

    #[test]
    fn every_mode_stays_in_range() {
        for mode in SEPARABLE.into_iter().chain(NON_SEPARABLE) {
            for backdrop in colors() {
                for source in colors() {
                    let blended = mode.blend(backdrop, source);
                    assert!(
                        blended.iter().all(|c| (0.0..=1.0).contains(c)),
                        "{mode:?}({backdrop:?}, {source:?}) = {blended:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn modes_use_css_names_in_camel_case() {
        let names = serde_json::to_string(&[
            BlendMode::ColorDodge,
            BlendMode::ColorBurn,
            BlendMode::HardLight,
            BlendMode::SoftLight,
            BlendMode::Luminosity,
        ])
        .unwrap();
        assert_eq!(
            names,
            r#"["colorDodge","colorBurn","hardLight","softLight","luminosity"]"#
        );
    }
}
