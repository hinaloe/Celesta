//! Renderer-independent primitives shared by projects and evaluated compositions.

mod keyframe;
mod style;
mod tagged;
#[cfg(test)]
mod tests;
mod time;
mod transform;

pub use keyframe::{Animatable, Easing, Keyframe, KeyframeAnimation, KeyframeAnimationType};
pub use style::{
    FontFamily, GradientStop, LetterSpacing, LineBreak, Paint, Stroke, TextAlign, TextColorRun,
    TextFontRun, TextStyle,
};
pub use time::{Rational, Time, TimeError, TimeRange};
pub use transform::{AnimatablePoint, Transform};

mod animation;
mod instances;
mod model;

pub use animation::{AnimationError, evaluate_f64, integrate_f64};
pub use instances::{F32Column, InstanceShape, U8Column, instance_size};
pub use model::{
    AssetLocation, AudioClip, AudioGraph, BlendMode, Clip, DEFAULT_MITER_LIMIT, EvaluatedTransform,
    GroupMask, ImageFit, Layer, LayerContent, LayerEffects, LayerFilter, LayerGlow, LayerShader,
    LayerShadow, LineCap, LineJoin, MaskMode, MediaTiming, PathCommand, Point, ResolvedAsset,
    Scene, ShaderParam, ShaderParamType, ShaderSource,
};
