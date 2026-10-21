use crate::Point;
use crate::tagged::TypeTagged;
use serde::de::value::{MapAccessDeserializer, SeqAccessDeserializer};
use serde::de::{MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;
use std::fmt;

// Deserialized through `PaintDef`, which keeps the same serde field attributes.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Paint {
    Solid {
        color: String,
    },
    /// Colors blend along the line from `start` to `end`, in the painted
    /// layer's local pixels (a rect's top-left, or a text layer's layout box
    /// top-left). Beyond either end the nearest stop's color continues.
    Linear {
        start: Point,
        end: Point,
        stops: Vec<GradientStop>,
    },
    /// Colors blend outward from `center` to `radius`, in the same space as
    /// `Linear`.
    Radial {
        center: Point,
        radius: f64,
        stops: Vec<GradientStop>,
    },
}

impl<'de> Deserialize<'de> for Paint {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        PaintDef::deserialize(TypeTagged(deserializer))
    }
}

/// `Paint` without the `type` tag, which [`TypeTagged`] reads instead.
#[derive(Deserialize)]
#[serde(
    remote = "Paint",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum PaintDef {
    Solid {
        color: String,
    },
    Linear {
        start: Point,
        end: Point,
        stops: Vec<GradientStop>,
    },
    Radial {
        center: Point,
        radius: f64,
        stops: Vec<GradientStop>,
    },
}

/// A gradient color at `offset` (0 at the start/center, 1 at the end/radius).
/// The color may carry alpha (`#RRGGBBAA`), so a gradient can fade out.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    pub offset: f64,
    pub color: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    /// Language tag for font fallback, such as `ja`, `ja-JP`, or `zh-Hant`.
    /// When omitted, uses the system locale. Does not select a BudouX model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    /// Where characters the `fontFamily` stack has no glyph for are drawn
    /// from. Omitted means `System`. Has no effect without `fontFamily`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_fallback: Option<FontFallbackMode>,
    /// A family name, or a font stack tried per grapheme cluster.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<FontFamily>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Paint>,
    /// An outline around the glyphs, or several: each `width` is measured
    /// from the glyph outline, so a list such as a 14px stroke and a 7px one
    /// draws the 7px one next to the glyphs and the 14px one around it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<TextStroke>,
    /// Where each line sits within the text's `max_width`, or within its
    /// widest line when it has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<TextAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    /// Extra space after each glyph, in px or as `{ em }`, a multiple of the
    /// font size. Negative values tighten.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<LetterSpacing>,
    /// OpenType features, as CSS `font-feature-settings`: `{ liga: false,
    /// calt: false }` draws `===` as three `=` in a font with coding
    /// ligatures. A font run's are merged over these tag by tag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_features: Option<FontFeatures>,
    /// Solid color overrides in Unicode code-point ranges of the complete text.
    /// Ranges must be ordered and non-overlapping. A shaped cluster uses the
    /// color at its first code point, so color changes never split shaping.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub color_runs: Vec<TextColorRun>,
    /// Font weight, family, and feature overrides in Unicode code-point
    /// ranges of the complete text. Ranges must be ordered and non-overlapping. Unlike
    /// `color_runs`, these change shaping and layout. Written by `<Span>`;
    /// not meant to be set directly.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub font_runs: Vec<TextFontRun>,
    /// Reveal clusters beginning before this code-point offset, retaining the
    /// complete text's layout. Omitted means all text is visible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_characters: Option<usize>,
    /// Where a line may wrap when the text has a `maxWidth`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_break: Option<LineBreak>,
}

/// Space after each glyph: a number of px, or `{ em }`, a multiple of the
/// font size that follows it as the size changes.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(untagged)]
pub enum LetterSpacing {
    Px(f64),
    Em { em: f64 },
}

impl LetterSpacing {
    /// The spacing in em for text of `font_size` px.
    pub fn em(self, font_size: f64) -> f64 {
        match self {
            Self::Px(px) => px / font_size,
            Self::Em { em } => em,
        }
    }

    pub fn is_finite(self) -> bool {
        match self {
            Self::Px(value) | Self::Em { em: value } => value.is_finite(),
        }
    }
}

impl From<f64> for LetterSpacing {
    fn from(px: f64) -> Self {
        Self::Px(px)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct Stroke {
    pub paint: Paint,
    pub width: f64,
}

/// A text's outline: one stroke, or several drawn around one another.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(untagged)]
pub enum TextStroke {
    One(Stroke),
    /// In any order: each width is from the glyph outline, so the thinnest
    /// stroke is drawn next to the glyphs and each wider one around it.
    /// Read-only in TypeScript, so a list declared `as const` fits too.
    Many(#[cfg_attr(feature = "codegen", ts(type = "ReadonlyArray<Stroke>"))] Vec<Stroke>),
}

impl TextStroke {
    /// The strokes, in the order they were given.
    pub fn strokes(&self) -> &[Stroke] {
        match self {
            Self::One(stroke) => std::slice::from_ref(stroke),
            Self::Many(strokes) => strokes,
        }
    }

    /// How far the widest stroke reaches past the glyph outline; 0 for none.
    pub fn width(&self) -> f64 {
        self.strokes()
            .iter()
            .map(|stroke| stroke.width)
            .filter(|width| width.is_finite())
            .fold(0.0, f64::max)
    }
}

impl From<Stroke> for TextStroke {
    fn from(stroke: Stroke) -> Self {
        Self::One(stroke)
    }
}

impl From<Vec<Stroke>> for TextStroke {
    fn from(strokes: Vec<Stroke>) -> Self {
        Self::Many(strokes)
    }
}

// Picks the variant by the JSON shape instead of trying each in turn, so an
// error inside a stroke names that stroke's field, not "no variant matched".
impl<'de> Deserialize<'de> for TextStroke {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct TextStrokeVisitor;

        impl<'de> Visitor<'de> for TextStrokeVisitor {
            type Value = TextStroke;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a stroke or a list of strokes")
            }

            fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Self::Value, A::Error> {
                Stroke::deserialize(MapAccessDeserializer::new(map)).map(TextStroke::One)
            }

            fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<Self::Value, A::Error> {
                Vec::deserialize(SeqAccessDeserializer::new(seq)).map(TextStroke::Many)
            }
        }

        deserializer.deserialize_any(TextStrokeVisitor)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

/// Where characters a text's `fontFamily` stack has no glyph for are drawn
/// from.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum FontFallbackMode {
    /// Installed fonts chosen for `lang`.
    #[default]
    System,
    /// Fonts loaded with `<Font>` first, in the order the composition
    /// declares them, then installed fonts.
    Loaded,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub enum LineBreak {
    /// Between any two characters a line may break between (UAX #14), such
    /// as any two Japanese characters.
    #[default]
    Normal,
    /// Only between phrases ([BudouX](https://github.com/google/budoux)'s
    /// Japanese model) and at spaces, so a Japanese word or a particle is
    /// not split across lines. A phrase wider than `maxWidth` wraps inside
    /// itself as `Normal` text does.
    Phrase,
}

/// A solid color over a half-open Unicode code-point range in the full text.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TextColorRun {
    pub start: usize,
    pub end: usize,
    pub color: String,
}

/// A font weight, family, and features over a half-open Unicode code-point
/// range in the full text. Omitted fields use the text's own; features are
/// merged over the text's tag by tag.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TextFontRun {
    pub start: usize,
    pub end: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<FontFamily>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_features: Option<FontFeatures>,
}

/// OpenType feature settings, as CSS `font-feature-settings`: each tag
/// (four ASCII characters, such as `liga`, `calt`, `ss01`, or `zero`) is
/// turned on (`true`), off (`false`), or set to an alternate's number.
/// Tags a font does not have change nothing. Deserializing rejects a
/// malformed tag and a value that is not a boolean or a whole number from
/// 0 up.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "codegen",
    ts(export, type = "{ readonly [tag: string]: boolean | number }")
)]
#[serde(transparent)]
pub struct FontFeatures(BTreeMap<String, u32>);

impl FontFeatures {
    /// Features set to the given values, or an error naming the first
    /// malformed tag.
    pub fn new<'a>(settings: impl IntoIterator<Item = (&'a str, u32)>) -> Result<Self, String> {
        let mut features = BTreeMap::new();
        for (tag, value) in settings {
            check_feature_tag(tag)?;
            features.insert(tag.to_owned(), value);
        }
        Ok(Self(features))
    }

    /// The tags and their values, in tag order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, u32)> {
        self.0.iter().map(|(tag, value)| (tag.as_str(), *value))
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// These features with `over`'s set over them, tag by tag.
    pub fn merged(&self, over: &Self) -> Self {
        let mut features = self.0.clone();
        features.extend(over.0.iter().map(|(tag, value)| (tag.clone(), *value)));
        Self(features)
    }
}

/// CSS `font-feature-settings` tags are four characters from U+20 to U+7E.
fn check_feature_tag(tag: &str) -> Result<(), String> {
    if tag.len() == 4 && tag.bytes().all(|byte| (0x20..=0x7e).contains(&byte)) {
        Ok(())
    } else {
        Err(format!(
            "font feature tag {tag:?} must be four ASCII characters, such as \"liga\""
        ))
    }
}

impl<'de> Deserialize<'de> for FontFeatures {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct FeatureValue(u32);

        impl<'de> Deserialize<'de> for FeatureValue {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                struct FeatureValueVisitor;

                impl Visitor<'_> for FeatureValueVisitor {
                    type Value = FeatureValue;

                    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                        formatter.write_str("true, false, or a whole number from 0 up")
                    }

                    fn visit_bool<E: serde::de::Error>(self, on: bool) -> Result<Self::Value, E> {
                        Ok(FeatureValue(u32::from(on)))
                    }

                    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> {
                        u32::try_from(value).map(FeatureValue).map_err(|_| {
                            E::invalid_value(serde::de::Unexpected::Unsigned(value), &self)
                        })
                    }

                    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> {
                        u64::try_from(value)
                            .map_err(|_| {
                                E::invalid_value(serde::de::Unexpected::Signed(value), &self)
                            })
                            .and_then(|value| self.visit_u64(value))
                    }

                    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
                        if value.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&value) {
                            Ok(FeatureValue(value as u32))
                        } else {
                            Err(E::invalid_value(serde::de::Unexpected::Float(value), &self))
                        }
                    }
                }

                deserializer.deserialize_any(FeatureValueVisitor)
            }
        }

        let settings = BTreeMap::<String, FeatureValue>::deserialize(deserializer)?;
        for tag in settings.keys() {
            check_feature_tag(tag).map_err(serde::de::Error::custom)?;
        }
        Ok(Self(
            settings
                .into_iter()
                .map(|(tag, FeatureValue(value))| (tag, value))
                .collect(),
        ))
    }
}

/// A font family name, or a font stack: names tried in order for each
/// grapheme cluster, which takes the first family with a glyph for it.
/// Clusters no family in the stack has fall back to the system's fonts.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(untagged)]
pub enum FontFamily {
    Name(String),
    /// Deserializing rejects an empty list. Read-only in TypeScript, so a
    /// stack declared `as const` fits too.
    Stack(#[cfg_attr(feature = "codegen", ts(type = "ReadonlyArray<string>"))] Vec<String>),
}

impl FontFamily {
    /// The family names, in the order they are tried; never empty. An empty
    /// stack, which deserializing rejects but Rust code can build, reads as
    /// one empty name: a family with no face, as `Name("")` is.
    pub fn names(&self) -> &[String] {
        static NO_NAME: String = String::new();
        match self {
            Self::Name(name) => std::slice::from_ref(name),
            Self::Stack(names) if names.is_empty() => std::slice::from_ref(&NO_NAME),
            Self::Stack(names) => names,
        }
    }

    /// The first family name.
    pub fn first(&self) -> &str {
        &self.names()[0]
    }

    /// Whether the stack names more than one family.
    pub fn is_stack(&self) -> bool {
        self.names().len() > 1
    }
}

impl From<&str> for FontFamily {
    fn from(name: &str) -> Self {
        Self::Name(name.to_owned())
    }
}

impl From<String> for FontFamily {
    fn from(name: String) -> Self {
        Self::Name(name)
    }
}

impl<'de> Deserialize<'de> for FontFamily {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged, expecting = "a font family name or a list of names")]
        enum Def {
            Name(String),
            Stack(Vec<String>),
        }
        match Def::deserialize(deserializer)? {
            Def::Name(name) => Ok(Self::Name(name)),
            Def::Stack(names) if names.is_empty() => Err(serde::de::Error::custom(
                "a font family list must name at least one family",
            )),
            Def::Stack(names) => Ok(Self::Stack(names)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_fallback_reads_and_omits_like_other_optional_fields() {
        let style: TextStyle = serde_json::from_str(r#"{"fontFallback":"loaded"}"#).unwrap();
        assert_eq!(style.font_fallback, Some(FontFallbackMode::Loaded));
        assert_eq!(serde_json::to_string(&TextStyle::default()).unwrap(), "{}");
        assert!(serde_json::from_str::<TextStyle>(r#"{"fontFallback":"fonts"}"#).is_err());
    }

    #[test]
    fn stroke_reads_one_stroke_or_a_list_and_writes_it_back_alike() {
        let one = r##"{"stroke":{"paint":{"type":"solid","color":"#FFFFFF"},"width":7.0}}"##;
        let style: TextStyle = serde_json::from_str(one).unwrap();
        let stroke = style.stroke.as_ref().unwrap();
        assert!(matches!(stroke, TextStroke::One(_)));
        assert_eq!(stroke.width(), 7.0);
        assert_eq!(serde_json::to_string(&style).unwrap(), one);

        let many = r##"{"stroke":[{"paint":{"type":"solid","color":"#2E6B1F"},"width":14.0},{"paint":{"type":"solid","color":"#FFFFFF"},"width":7.0}]}"##;
        let style: TextStyle = serde_json::from_str(many).unwrap();
        let stroke = style.stroke.as_ref().unwrap();
        assert_eq!(stroke.strokes().len(), 2);
        assert_eq!(stroke.width(), 14.0);
        assert_eq!(serde_json::to_string(&style).unwrap(), many);

        let empty: TextStyle = serde_json::from_str(r#"{"stroke":[]}"#).unwrap();
        assert_eq!(empty.stroke.unwrap().width(), 0.0);
    }

    #[test]
    fn font_features_read_booleans_and_alternate_numbers() {
        let style: TextStyle = serde_json::from_str(
            r#"{"fontFeatures":{"liga":false,"calt":false,"salt":2,"ss01":true}}"#,
        )
        .unwrap();
        let features: Vec<_> = style.font_features.as_ref().unwrap().iter().collect();
        assert_eq!(
            features,
            [("calt", 0), ("liga", 0), ("salt", 2), ("ss01", 1)]
        );
        assert_eq!(
            serde_json::to_string(&style).unwrap(),
            r#"{"fontFeatures":{"calt":0,"liga":0,"salt":2,"ss01":1}}"#
        );
    }

    #[test]
    fn malformed_font_features_are_rejected() {
        for json in [
            r#"{"fontFeatures":{"lig":false}}"#,
            r#"{"fontFeatures":{"ligatures":false}}"#,
            r#"{"fontFeatures":{"lïga":false}}"#,
            r#"{"fontFeatures":{"li\nga":false}}"#,
        ] {
            let error = serde_json::from_str::<TextStyle>(json)
                .unwrap_err()
                .to_string();
            assert!(
                error.contains("must be four ASCII characters"),
                "{json}: {error}"
            );
        }
        for json in [
            r#"{"fontFeatures":{"liga":-1}}"#,
            r#"{"fontFeatures":{"liga":1.5}}"#,
            r#"{"fontFeatures":{"liga":"off"}}"#,
            r#"{"fontFeatures":{"liga":null}}"#,
            r#"{"fontFeatures":{"liga":4294967296}}"#,
            r#"{"fontFeatures":["liga"]}"#,
        ] {
            assert!(serde_json::from_str::<TextStyle>(json).is_err(), "{json}");
        }
        assert!(FontFeatures::new([("liga", 0)]).is_ok());
        assert!(FontFeatures::new([("ligature", 0)]).is_err());
    }

    #[test]
    fn a_font_runs_features_merge_over_the_texts_tag_by_tag() {
        let text = FontFeatures::new([("liga", 0), ("calt", 0)]).unwrap();
        let run = FontFeatures::new([("liga", 1), ("ss01", 1)]).unwrap();
        let merged = text.merged(&run);
        assert_eq!(
            merged.iter().collect::<Vec<_>>(),
            [("calt", 0), ("liga", 1), ("ss01", 1)]
        );
    }

    #[test]
    fn a_bad_stroke_in_a_list_names_its_field() {
        let error = serde_json::from_str::<TextStyle>(
            r##"{"stroke":[{"paint":{"type":"solid","color":"#FFFFFF"}}]}"##,
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("missing field `width`"), "{error}");
        assert!(serde_json::from_str::<TextStyle>(r#"{"stroke":7}"#).is_err());
    }
}
