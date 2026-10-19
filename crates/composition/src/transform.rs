use crate::keyframe::Animatable;
use crate::projection::BackfaceVisibility;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<AnimatablePoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<AnimatablePoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<Animatable<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<AnimatablePoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<AnimatablePoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skew: Option<AnimatablePoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation_x: Option<Animatable<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation_y: Option<Animatable<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perspective: Option<Animatable<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backface_visibility: Option<BackfaceVisibility>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AnimatablePoint {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<Animatable<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<Animatable<f64>>,
}
