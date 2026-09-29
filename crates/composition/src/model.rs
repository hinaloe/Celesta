use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Animatable, Paint, Rational, Stroke, TextStyle, Time, TimeRange};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub width: u32,
    pub height: u32,
    pub frame_rate: Rational,
    pub time: Time,
    /// Project-provided fonts available to text layout, in addition to system fonts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fonts: Vec<ResolvedAsset>,
    /// Bottom-to-top painter's order.
    pub layers: Vec<Layer>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: String,
    pub transform: EvaluatedTransform,
    pub opacity: f64,
    /// How the layer's pixels combine with what is already drawn beneath
    /// it. A `Group` with a mode other than `Normal` is isolated: its
    /// children composite onto a transparent layer first, and that result
    /// blends with the backdrop as one layer.
    #[serde(default, skip_serializing_if = "BlendMode::is_normal")]
    pub blend_mode: BlendMode,
    #[serde(default, skip_serializing_if = "LayerEffects::is_empty")]
    pub effects: LayerEffects,
    pub content: LayerContent,
}

/// Effects applied to the composited pixels of one visual layer or group.
/// Radii and offsets are measured in output pixels after transforms.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct LayerEffects {
    #[serde(default, skip_serializing_if = "is_zero")]
    pub blur: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<LayerShadow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glow: Option<LayerGlow>,
}

impl LayerEffects {
    pub fn is_empty(&self) -> bool {
        self.blur <= 0.0 && self.shadow.is_none() && self.glow.is_none()
    }
}

fn is_zero(value: &f64) -> bool {
    *value == 0.0
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct LayerShadow {
    pub color: String,
    pub blur: f64,
    pub offset_x: f64,
    pub offset_y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct LayerGlow {
    pub color: String,
    pub blur: f64,
}

/// Separable blend modes from the W3C Compositing and Blending spec (plus
/// `Add`, Photoshop's Linear Dodge), applied to non-premultiplied 8-bit
/// channel values. With source color `Cs`, backdrop color `Cb` and backdrop
/// alpha `ab`, the source color is replaced by
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
    /// Multiply where the backdrop is dark, screen where it is light.
    Overlay,
    /// `B = min(Cs + Cb, 1)` (Linear Dodge): black is neutral.
    Add,
    /// `B = |Cb - Cs|`: black is neutral, white inverts.
    Difference,
}

impl BlendMode {
    pub fn is_normal(&self) -> bool {
        *self == Self::Normal
    }

    /// The blended color `B(Cb, Cs)` of one channel, all in `0.0..=1.0`.
    pub fn blend_channel(self, backdrop: f64, source: f64) -> f64 {
        match self {
            Self::Normal => source,
            Self::Multiply => source * backdrop,
            Self::Screen => screen(backdrop, source),
            Self::Overlay => {
                if backdrop <= 0.5 {
                    source * 2.0 * backdrop
                } else {
                    screen(source, 2.0 * backdrop - 1.0)
                }
            }
            Self::Add => (source + backdrop).min(1.0),
            Self::Difference => (backdrop - source).abs(),
        }
    }
}

fn screen(backdrop: f64, source: f64) -> f64 {
    backdrop + source - backdrop * source
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LayerContent {
    Video {
        asset: ResolvedAsset,
        timing: MediaTiming,
    },
    Image {
        asset: ResolvedAsset,
    },
    Psd {
        asset: ResolvedAsset,
        /// Full paths of the layers and folders a portrait preset makes
        /// visible (PSDTool "all layer" semantics). When non-empty the PSD's
        /// own saved visibility is ignored and exactly these layers compose;
        /// when empty the PSD renders from its saved visibility state.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        visible_layers: Vec<String>,
        /// Layers forced visible on top of the resolved set — the selected
        /// lip-sync mouth for the current frame.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        enabled_layers: Vec<String>,
        /// Layers forced hidden — the other lip-sync mouth shapes.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        disabled_layers: Vec<String>,
    },
    Text {
        text: String,
        style: TextStyle,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_width: Option<f64>,
        /// Anchors the layer vertically on its first line's baseline instead
        /// of `transform.anchor.y`, so separate `Text` layers placed at the
        /// same `y` share a baseline whatever their glyphs or sizes.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        baseline_anchor: bool,
    },
    Group {
        layers: Vec<Layer>,
        /// Draws the children only inside this region, in the group's own
        /// coordinate space (the space the children's positions are given
        /// in), so it moves, scales, and rotates with the group.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        clip: Option<Clip>,
    },
    /// A flat-shaded rectangle, optionally rounded and/or stroked. Has no
    /// natural size the way `Image`/`Video` do, so `width`/`height` are
    /// explicit.
    Rect {
        width: f64,
        height: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fill: Option<Paint>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stroke: Option<Stroke>,
        #[serde(default)]
        corner_radius: f64,
    },
    MissingComponent {
        component: String,
        props: BTreeMap<String, Value>,
    },
}

/// A rectangle, optionally with rounded corners, that limits where a group's
/// children are drawn. Coordinates are in the group's own space, in pixels:
/// `x`/`y` is the top-left corner. Pixels straddling the edge are
/// anti-aliased, and nested clips intersect.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Corner radius, limited to half the shorter side. Defaults to 0.
    #[serde(default)]
    pub corner_radius: f64,
}

impl Clip {
    /// Whether the region has no area, so nothing inside it is visible.
    /// Also true when a value is not finite.
    pub fn is_empty(&self) -> bool {
        let finite = [self.x, self.y, self.width, self.height]
            .into_iter()
            .all(f64::is_finite);
        !finite || self.width <= 0.0 || self.height <= 0.0
    }

    /// The corner radius as drawn: at least 0, at most half the shorter side.
    pub fn effective_corner_radius(&self) -> f64 {
        let radius = if self.corner_radius.is_finite() {
            self.corner_radius
        } else {
            0.0
        };
        radius.max(0.0).min(self.width.min(self.height) / 2.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct EvaluatedTransform {
    pub position: Point,
    pub scale: Point,
    /// Clockwise rotation in degrees.
    pub rotation: f64,
    /// Normalized coordinates where `(0.5, 0.5)` is the center.
    pub anchor: Point,
}

impl Default for EvaluatedTransform {
    fn default() -> Self {
        Self {
            position: Point { x: 0.0, y: 0.0 },
            scale: Point { x: 1.0, y: 1.0 },
            rotation: 0.0,
            anchor: Point { x: 0.5, y: 0.5 },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAsset {
    pub id: String,
    pub location: AssetLocation,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssetLocation {
    File { path: String },
    Url { url: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct MediaTiming {
    pub local_time: Time,
    pub source_start: Time,
    pub source_time_seconds: f64,
    pub playback_rate: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AudioGraph {
    pub sample_rate: u32,
    #[serde(default = "default_audio_master_volume")]
    pub master_volume: f64,
    pub clips: Vec<AudioClip>,
}

const fn default_audio_master_volume() -> f64 {
    1.0
}

impl Default for AudioGraph {
    fn default() -> Self {
        Self {
            sample_rate: 0,
            master_volume: 1.0,
            clips: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AudioClip {
    pub id: String,
    pub asset: ResolvedAsset,
    pub range: TimeRange,
    pub source_start: Time,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_duration: Option<Time>,
    pub playback_rate: Animatable<f64>,
    pub volume: Animatable<f64>,
    pub muted: bool,
}
