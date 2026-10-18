use crate::Point;
use crate::tagged::TypeTagged;
use serde::de::value::{MapAccessDeserializer, SeqAccessDeserializer};
use serde::de::{MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<TextAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    /// Extra space after each glyph, in px or as `{ em }`, a multiple of the
    /// font size. Negative values tighten.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<LetterSpacing>,
    /// Solid color overrides in Unicode code-point ranges of the complete text.
    /// Ranges must be ordered and non-overlapping. A shaped cluster uses the
    /// color at its first code point, so color changes never split shaping.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub color_runs: Vec<TextColorRun>,
    /// Font weight and family overrides in Unicode code-point ranges of the
    /// complete text. Ranges must be ordered and non-overlapping. Unlike
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

/// A font weight and family over a half-open Unicode code-point range in the
/// full text. Omitted fields use the text's own.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
