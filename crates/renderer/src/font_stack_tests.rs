use crate::font_run_tests::{bebas, glyph_families, run, two_family_rasterizer};
use crate::text::{FontFallback, MissingGlyphs};
use celesta_composition::{FontFamily, TextStyle};

// Of the two repository fonts, only IBM Plex Mono has Cyrillic (Б), arrows
// (→), and U+0315 COMBINING COMMA ABOVE RIGHT; only Bebas Neue has Δ.

fn stack(names: &[&str]) -> Option<FontFamily> {
    Some(FontFamily::Stack(
        names.iter().map(|name| (*name).to_owned()).collect(),
    ))
}

fn bebas_then_mono(size: f64) -> TextStyle {
    TextStyle {
        font_family: stack(&["Bebas Neue", "IBM Plex Mono"]),
        ..bebas(size)
    }
}

/// Each glyph's source code point and family, shaped on one line.
fn families_by_point(
    rasterizer: &mut crate::TextRasterizer,
    text: &str,
    style: &TextStyle,
) -> Vec<(usize, String)> {
    glyph_families(rasterizer, text, style, None)
        .into_iter()
        .map(|(_, _, point, family)| (point, family))
        .collect()
}

#[test]
fn a_stack_draws_each_cluster_with_its_first_family_that_has_it() {
    let mut rasterizer = two_family_rasterizer();
    let families = families_by_point(&mut rasterizer, "AБ→B", &bebas_then_mono(48.0));
    assert_eq!(
        families,
        [
            (0, "Bebas Neue".to_owned()),
            (1, "IBM Plex Mono".to_owned()),
            (2, "IBM Plex Mono".to_owned()),
            (3, "Bebas Neue".to_owned()),
        ]
    );
    // The order decides: Plex Mono first draws everything it has.
    let mono_then_bebas = TextStyle {
        font_family: stack(&["IBM Plex Mono", "Bebas Neue"]),
        ..bebas(48.0)
    };
    let families = families_by_point(&mut rasterizer, "AΔ", &mono_then_bebas);
    assert_eq!(
        families,
        [
            (0, "IBM Plex Mono".to_owned()),
            (1, "Bebas Neue".to_owned())
        ]
    );
}

#[test]
fn a_cluster_takes_one_family_for_its_marks_and_selectors() {
    let mut rasterizer = two_family_rasterizer();
    // Bebas has A but not U+0315, so the whole cluster comes from Plex
    // Mono; a variation selector needs no glyph, so A︀ stays in Bebas.
    let families = families_by_point(
        &mut rasterizer,
        "A\u{315}BA\u{FE00}",
        &bebas_then_mono(48.0),
    );
    for (point, family) in families {
        let expected = if point < 2 {
            "IBM Plex Mono"
        } else {
            "Bebas Neue"
        };
        assert_eq!(family, expected, "code point {point}");
    }
    // A mark no family has stays with the first family that has its base.
    let families = families_by_point(&mut rasterizer, "Б\u{0335}\u{1AB0}", &bebas_then_mono(48.0));
    assert!(
        families
            .iter()
            .filter(|(point, _)| *point < 2)
            .all(|(_, family)| family == "IBM Plex Mono"),
        "{families:?}"
    );
}

#[test]
fn a_stack_lays_out_its_families_as_each_does_alone() {
    let mut rasterizer = two_family_rasterizer();
    let style = bebas_then_mono(48.0);
    let mono = TextStyle {
        font_family: Some("IBM Plex Mono".into()),
        ..bebas(48.0)
    };
    // Text in the first family alone measures and draws as that family does.
    assert_eq!(
        rasterizer.measure("ABC", &style, None),
        rasterizer.measure("ABC", &bebas(48.0), None)
    );
    assert_eq!(
        rasterizer.rasterize("ABC", &style, None, 1.0).unwrap(),
        rasterizer
            .rasterize("ABC", &bebas(48.0), None, 1.0)
            .unwrap()
    );
    // In mixed text each cluster advances as it does in its own family.
    let mixed = rasterizer.measure("AБ", &style, None);
    let a = rasterizer.measure("A", &bebas(48.0), None);
    let b = rasterizer.measure("Б", &mono, None);
    assert_eq!(mixed.glyphs[0].width, a.glyphs[0].width);
    assert_eq!(mixed.glyphs[1].width, b.glyphs[0].width);
    assert!((mixed.width - (a.width + b.width)).abs() < 1e-3);
}

#[test]
fn a_stack_skips_families_with_no_face() {
    let mut rasterizer = two_family_rasterizer();
    let style = TextStyle {
        font_family: stack(&["Celesta Missing Family", "IBM Plex Mono"]),
        ..bebas(48.0)
    };
    let mono = TextStyle {
        font_family: Some("IBM Plex Mono".into()),
        ..bebas(48.0)
    };
    assert_eq!(
        rasterizer.rasterize("AB", &style, None, 1.0).unwrap(),
        rasterizer.rasterize("AB", &mono, None, 1.0).unwrap()
    );
    assert!(rasterizer.font_fallback("title", &style).is_empty());
    assert!(rasterizer.missing_glyphs("title", "AB", &style).is_empty());
}

#[test]
fn the_primary_family_places_the_baselines() {
    let mut rasterizer = two_family_rasterizer();
    let style = bebas_then_mono(48.0);
    let bebas_ascent = rasterizer.measure("A", &bebas(48.0), None).ascent;
    let mono_ascent = rasterizer
        .measure(
            "Б",
            &TextStyle {
                font_family: Some("IBM Plex Mono".into()),
                ..bebas(48.0)
            },
            None,
        )
        .ascent;
    assert_ne!(bebas_ascent, mono_ascent, "the faces' metrics must differ");
    // A line with clusters from the second family, a line with only those,
    // and text with only those all sit as the first family's text does.
    for text in ["AБ", "Б"] {
        let ascent = rasterizer.measure(text, &style, None).ascent;
        assert!(
            (ascent - bebas_ascent).abs() < 1e-3,
            "{text}: {ascent} vs {bebas_ascent}"
        );
    }
    let text = "A\nБ";
    let buffer = rasterizer.shaped_buffer(text, &style, None, 1.0);
    let baselines = rasterizer.run_baselines(&buffer, text, &style).unwrap();
    let line_height = buffer.metrics().line_height;
    assert!(
        (baselines[1] - baselines[0] - line_height).abs() < 1e-3,
        "{baselines:?}"
    );
    // Text in the first family alone keeps cosmic-text's baselines.
    let buffer = rasterizer.shaped_buffer("AB", &style, None, 1.0);
    assert_eq!(rasterizer.run_baselines(&buffer, "AB", &style), None);
}

#[test]
fn a_span_takes_a_stack_of_its_own() {
    let mut rasterizer = two_family_rasterizer();
    let style = TextStyle {
        font_family: Some("IBM Plex Mono".into()),
        font_runs: vec![celesta_composition::TextFontRun {
            font_family: stack(&["Bebas Neue", "IBM Plex Mono"]),
            ..run(1, 4, None, None)
        }],
        ..bebas(48.0)
    };
    let families = families_by_point(&mut rasterizer, "AAБΔ", &style);
    assert_eq!(
        families,
        [
            (0, "IBM Plex Mono".to_owned()),
            (1, "Bebas Neue".to_owned()),
            (2, "IBM Plex Mono".to_owned()),
            (3, "Bebas Neue".to_owned()),
        ]
    );
    // A span with only a weight keeps choosing from the text's stack.
    let style = TextStyle {
        font_runs: vec![run(0, 2, Some(700), None)],
        ..bebas_then_mono(48.0)
    };
    let families = families_by_point(&mut rasterizer, "AБ", &style);
    assert_eq!(
        families,
        [
            (0, "Bebas Neue".to_owned()),
            (1, "IBM Plex Mono".to_owned())
        ]
    );
}

#[test]
fn warnings_judge_the_whole_stack() {
    let mut rasterizer = two_family_rasterizer();
    let style = bebas_then_mono(48.0);
    assert!(rasterizer.font_fallback("title", &style).is_empty());
    // Б is in the stack; ず is in neither family.
    let missing = rasterizer.missing_glyphs("title", "AБず", &style);
    assert_eq!(
        missing,
        vec![MissingGlyphs {
            layer: "title".to_owned(),
            families: vec!["Bebas Neue".to_owned(), "IBM Plex Mono".to_owned()],
            weight: 400,
            characters: vec!['ず'],
        }]
    );
    assert_eq!(
        missing[0].to_string(),
        "none of the font families \"Bebas Neue\", \"IBM Plex Mono\" (weight 400) has a glyph for \"ず\"; text layer \"title\" draws them with a fallback font"
    );
    // A missing family is no warning while another family has a face, but
    // a stack none of whose families has one is a fallback.
    let missing_stack = TextStyle {
        font_family: stack(&["Celesta Missing Family", "Celesta Missing Too"]),
        font_weight: Some(700),
        ..bebas(48.0)
    };
    let fallbacks = rasterizer.font_fallback("title", &missing_stack);
    assert_eq!(
        fallbacks,
        vec![FontFallback {
            layer: "title".to_owned(),
            families: vec![
                "Celesta Missing Family".to_owned(),
                "Celesta Missing Too".to_owned()
            ],
            weight: 700,
        }]
    );
    assert_eq!(
        fallbacks[0].to_string(),
        "none of the font families \"Celesta Missing Family\", \"Celesta Missing Too\" (weight 700) is installed or loaded; text layer \"title\" uses a fallback font"
    );
    assert!(
        rasterizer
            .missing_glyphs("title", "AB", &missing_stack)
            .is_empty()
    );
}
