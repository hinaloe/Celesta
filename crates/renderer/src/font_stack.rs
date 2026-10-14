//! Font stacks: `fontFamily` lists tried in order for each grapheme cluster.

use crate::fonts::{COLOR_EMOJI_FAMILIES, TextRasterizer};
use crate::linebreak::{emoji_presentation_spans, is_visible_character};
use crate::shaping::usable_font_runs;
use celesta_composition::{FontFamily, TextFontRun, TextStyle};
use cosmic_text::{Family, Font, Weight, fontdb};
use std::sync::Arc;
use unicode_segmentation::UnicodeSegmentation;

/// A half-open code-point range of the complete text shaped in a family and
/// weight other than the text's own: a `<Span>` font run, or clusters a font
/// stack draws with a family other than its primary one. Omitted fields use
/// the text's own.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct FaceRun {
    pub start: usize,
    pub end: usize,
    pub font_weight: Option<u16>,
    pub font_family: Option<Arc<str>>,
}

/// The families of one stack at one weight that have a face, with the face
/// that weight matches, in stack order.
struct StackFaces<'a> {
    family: &'a FontFamily,
    weight: u16,
    faces: Vec<(Arc<str>, Arc<Font>)>,
}

impl TextRasterizer {
    /// The family `family` draws with where no other family of it is
    /// chosen: its first family with a face, or its first family when none
    /// has one (drawn with a fallback font, as a missing family always was).
    pub(crate) fn primary_family<'a>(&mut self, family: &'a FontFamily, weight: u16) -> &'a str {
        if !family.is_stack() {
            return family.first();
        }
        family
            .names()
            .iter()
            .find(|name| self.matched_weight(name, weight).is_some())
            .unwrap_or(&family.names()[0])
    }

    /// The face of `family` that a request for `weight` draws with, as
    /// cosmic-text picks it for the weight [`Self::matched_weight`] returns.
    pub(crate) fn matched_face(&mut self, family: &str, weight: u16) -> Option<Arc<Font>> {
        let matched = self.matched_weight(family, weight)?;
        let database = self.font_system.db();
        // A query walks every installed face, so it is looked up once.
        let id = (*self
            .matched_faces
            .entry((family.to_owned(), matched))
            .or_insert_with(|| {
                database.query(&fontdb::Query {
                    families: &[Family::Name(family)],
                    weight: Weight(matched),
                    ..fontdb::Query::default()
                })
            }))?;
        self.font_system.get_font(id, Weight(matched))
    }

    /// `style`'s font runs, and the ranges its font stacks (its own and its
    /// runs') draw with a family other than the text's primary one, in
    /// order. Without a stack or split stylesheet these are `style`'s
    /// usable font runs as they are.
    pub(crate) fn face_runs(&mut self, text: &str, style: &TextStyle) -> Arc<[FaceRun]> {
        let spans = if style.font_runs.is_empty() {
            Vec::new()
        } else {
            usable_font_runs(style, text.chars().count())
        };
        let needs_selection = |family: &FontFamily| {
            family.is_stack()
                || family.names().iter().any(|name| {
                    self.stylesheet_faces
                        .get(name)
                        .is_some_and(|faces| faces.len() > 1)
                })
        };
        let stacked = style.font_family.as_ref().is_some_and(needs_selection)
            || spans
                .iter()
                .any(|run| run.font_family.as_ref().is_some_and(needs_selection));
        if !stacked {
            return spans
                .iter()
                .map(|run| FaceRun {
                    start: run.start,
                    end: run.end,
                    font_weight: run.font_weight,
                    font_family: run.font_family.as_ref().map(|family| family.first().into()),
                })
                .collect();
        }
        // Measuring and drawing ask for the same text's runs again and
        // again (each frame of a typing animation, say), and choosing a
        // family looks at every cluster.
        let key = (text.len() <= 100_000).then(|| {
            format!(
                "{text:?}\0{:?}",
                (&style.font_family, style.font_weight, &style.font_runs)
            )
        });
        if let Some(runs) = key.as_ref().and_then(|key| self.stacked_runs.get(key)) {
            return Arc::clone(runs);
        }
        let runs: Arc<[FaceRun]> = self.resolve_stacks(text, style, &spans).into();
        if let Some(key) = key {
            if self.stacked_runs.len() >= 64 {
                self.stacked_runs.clear();
            }
            self.stacked_runs.insert(key, Arc::clone(&runs));
        }
        runs
    }

    /// [`Self::face_runs`] for text with a font stack: each grapheme
    /// cluster's family, from its span's stack or the text's.
    fn resolve_stacks(
        &mut self,
        text: &str,
        style: &TextStyle,
        spans: &[&TextFontRun],
    ) -> Vec<FaceRun> {
        let requested = style.font_weight.unwrap_or(400);
        let primary = style
            .font_family
            .as_ref()
            .map(|family| self.primary_family(family, requested));
        let emoji = emoji_presentation_spans(text);
        let mut next_emoji = 0;
        let mut stacks: Vec<StackFaces> = Vec::new();
        let mut runs: Vec<FaceRun> = Vec::new();
        let mut point = 0;
        let mut next_span = 0;
        for (byte, cluster) in text.grapheme_indices(true) {
            let start = point;
            point += cluster.chars().count();
            // A cluster takes the run at its first code point.
            while next_span < spans.len() && spans[next_span].end <= start {
                next_span += 1;
            }
            let span = spans.get(next_span).filter(|run| run.start <= start);
            let font_weight = span.and_then(|run| run.font_weight);
            let family = span
                .and_then(|run| run.font_family.as_ref())
                .or(style.font_family.as_ref());
            let font_family = match family {
                Some(family) => {
                    let weight = font_weight.or(style.font_weight).unwrap_or(400);
                    let index = match stacks
                        .iter()
                        .position(|stack| stack.family == family && stack.weight == weight)
                    {
                        Some(index) => index,
                        None => {
                            let faces = self.stack_faces(family, weight);
                            stacks.push(StackFaces {
                                family,
                                weight,
                                faces,
                            });
                            stacks.len() - 1
                        }
                    };
                    while next_emoji < emoji.len() && emoji[next_emoji].end <= byte {
                        next_emoji += 1;
                    }
                    let is_emoji = emoji
                        .get(next_emoji)
                        .is_some_and(|range| range.start <= byte);
                    Some(cluster_family(&stacks[index], cluster, is_emoji))
                }
                None => None,
            };
            // Outside spans, a cluster in the primary family needs no run.
            if span.is_none() && font_family == primary {
                continue;
            }
            match runs.last_mut() {
                Some(last)
                    if last.end == start
                        && last.font_family.as_deref() == font_family
                        && last.font_weight == font_weight =>
                {
                    last.end = point;
                }
                _ => runs.push(FaceRun {
                    start,
                    end: point,
                    font_weight,
                    font_family: font_family.map(Into::into),
                }),
            }
        }
        runs
    }

    fn stack_faces(&mut self, family: &FontFamily, weight: u16) -> Vec<(Arc<str>, Arc<Font>)> {
        let mut faces = Vec::new();
        for name in family.names() {
            let Some(matched) = self.matched_weight(name, weight) else {
                continue;
            };
            let names = self
                .stylesheet_faces
                .get(name)
                .cloned()
                .unwrap_or_else(|| vec![name.as_str().into()]);
            for name in names {
                if self.matched_weight(&name, weight) == Some(matched)
                    && let Some(font) = self.matched_face(&name, weight)
                {
                    faces.push((name, font));
                }
            }
        }
        faces
    }
}

/// The family of `stack` a grapheme `cluster` is drawn with: the first one
/// with a glyph for every visible character of it, so combining marks and
/// variation selectors stay with their base; failing that, the first with
/// its first character; failing that, the primary family, where the
/// system's fallback fonts draw it. An emoji takes a color emoji font of
/// the stack first, if one has it.
fn cluster_family<'a>(stack: &'a StackFaces<'_>, cluster: &str, is_emoji: bool) -> &'a str {
    let Some((primary, _)) = stack.faces.first() else {
        return stack.family.first();
    };
    if stack.faces.len() == 1 {
        return primary;
    }
    let has = |font: &Font, character: char| font.as_swash().charmap().map(character) != 0;
    let covers = |font: &Font| {
        cluster
            .chars()
            .filter(|&character| is_visible_character(character))
            .all(|character| has(font, character))
    };
    if is_emoji
        && let Some((name, _)) = stack
            .faces
            .iter()
            .find(|(name, font)| COLOR_EMOJI_FAMILIES.contains(&name.as_ref()) && covers(font))
    {
        return name;
    }
    if let Some((name, _)) = stack.faces.iter().find(|(_, font)| covers(font)) {
        return name;
    }
    cluster
        .chars()
        .next()
        .and_then(|first| stack.faces.iter().find(|(_, font)| has(font, first)))
        .map_or(primary, |(name, _)| name)
}
