use crate::font_run_tests::{bebas, glyph_families, run, two_family_rasterizer};
use crate::fonts::TextRasterizer;
use celesta_composition::{AssetLocation, FontFeatures, ResolvedAsset, TextFontRun, TextStyle};
use std::path::Path;

fn features(settings: &[(&str, u32)]) -> Option<FontFeatures> {
    Some(FontFeatures::new(settings.iter().copied()).unwrap())
}

fn plex(size: f64) -> TextStyle {
    TextStyle {
        font_family: Some("IBM Plex Mono".into()),
        font_size: Some(size),
        ..TextStyle::default()
    }
}

/// Each glyph's id, in text order.
fn glyph_ids(rasterizer: &mut TextRasterizer, text: &str, style: &TextStyle) -> Vec<u16> {
    let buffer = rasterizer.shaped_buffer(text, style, None, 1.0);
    let mut glyphs: Vec<(usize, u16)> = buffer
        .layout_runs()
        .flat_map(|run| run.glyphs.iter().map(|glyph| (glyph.start, glyph.glyph_id)))
        .collect();
    glyphs.sort_by_key(|&(start, _)| start);
    glyphs.into_iter().map(|(_, id)| id).collect()
}

#[test]
fn a_feature_changes_the_glyphs_the_text_is_drawn_with() {
    let mut rasterizer = two_family_rasterizer();
    // IBM Plex Mono's `zero` draws a slashed zero.
    let plain = glyph_ids(&mut rasterizer, "0", &plex(48.0));
    let slashed = glyph_ids(
        &mut rasterizer,
        "0",
        &TextStyle {
            font_features: features(&[("zero", 1)]),
            ..plex(48.0)
        },
    );
    assert_ne!(plain, slashed);
    let off = TextStyle {
        font_features: features(&[("zero", 0)]),
        ..plex(48.0)
    };
    assert_eq!(glyph_ids(&mut rasterizer, "0", &off), plain);
}

#[test]
fn turning_kerning_off_widens_the_text_alike_when_measured_and_drawn() {
    let mut rasterizer = two_family_rasterizer();
    let kerned = bebas(96.0);
    let unkerned = TextStyle {
        font_features: features(&[("kern", 0)]),
        ..bebas(96.0)
    };
    let kerned_width = rasterizer.measure("AVATAR", &kerned, None).width;
    let measured = rasterizer.measure("AVATAR", &unkerned, None);
    assert!(
        measured.width > kerned_width + 1.0,
        "{} vs {kerned_width}",
        measured.width
    );
    let drawn = rasterizer
        .rasterize("AVATAR", &unkerned, None, 1.0)
        .unwrap();
    assert_eq!(measured.width.ceil() as u32, drawn.anchor_box.width);
}

#[test]
fn a_feature_run_inside_a_word_shapes_only_its_range() {
    let mut rasterizer = two_family_rasterizer();
    let plain = glyph_ids(&mut rasterizer, "0", &plex(48.0))[0];
    let slashed = glyph_ids(
        &mut rasterizer,
        "0",
        &TextStyle {
            font_features: features(&[("zero", 1)]),
            ..plex(48.0)
        },
    )[0];
    // cosmic-text shapes "0000" as one word; the run must still split it.
    let spanned = TextStyle {
        font_runs: vec![TextFontRun {
            font_features: features(&[("zero", 1)]),
            ..run(1, 3, None, None)
        }],
        ..plex(48.0)
    };
    assert_eq!(
        glyph_ids(&mut rasterizer, "0000", &spanned),
        [plain, slashed, slashed, plain]
    );
    // The run's glyphs still come from the text's family.
    for (_, start, _, family) in glyph_families(&mut rasterizer, "0000", &spanned, None) {
        assert_eq!(family, "IBM Plex Mono", "glyph at {start}");
    }
}

#[test]
fn a_runs_features_merge_over_the_texts() {
    let mut rasterizer = two_family_rasterizer();
    let slashed = TextStyle {
        font_features: features(&[("zero", 1), ("kern", 0)]),
        ..plex(48.0)
    };
    let ids = glyph_ids(&mut rasterizer, "0", &slashed);
    // The run turns `zero` back off and leaves `kern` as the text sets it.
    let spanned = TextStyle {
        font_runs: vec![TextFontRun {
            font_features: features(&[("zero", 0)]),
            ..run(1, 2, None, None)
        }],
        ..slashed.clone()
    };
    let plain = glyph_ids(&mut rasterizer, "0", &plex(48.0));
    assert_eq!(
        glyph_ids(&mut rasterizer, "000", &spanned),
        [ids[0], plain[0], ids[0]]
    );
}

#[test]
fn a_run_with_the_texts_own_features_does_not_split_the_shaping() {
    let mut rasterizer = two_family_rasterizer();
    let style = TextStyle {
        font_features: features(&[("kern", 0)]),
        ..bebas(96.0)
    };
    let spanned = TextStyle {
        font_runs: vec![TextFontRun {
            font_features: features(&[("kern", 0)]),
            ..run(1, 3, None, None)
        }],
        ..style.clone()
    };
    assert_eq!(
        rasterizer.measure("AVATAR", &spanned, None).width,
        rasterizer.measure("AVATAR", &style, None).width
    );
}

#[test]
fn text_without_a_family_takes_features_too() {
    let mut rasterizer = TextRasterizer::new();
    let style = TextStyle {
        font_size: Some(48.0),
        font_features: features(&[("liga", 0), ("kern", 0)]),
        font_runs: vec![TextFontRun {
            font_features: features(&[("liga", 1)]),
            ..run(2, 4, None, None)
        }],
        ..TextStyle::default()
    };
    let drawn = rasterizer.rasterize("office", &style, None, 1.0).unwrap();
    let measured = rasterizer.measure("office", &style, None);
    assert_eq!(measured.width.ceil() as u32, drawn.anchor_box.width);
}

#[test]
fn a_font_loaded_later_joins_a_familys_feature_faces() {
    let examples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/prism");
    let font = |path: &str| ResolvedAsset {
        id: path.to_owned(),
        location: AssetLocation::File {
            path: path.to_owned(),
        },
    };
    let mut rasterizer = TextRasterizer::new();
    rasterizer
        .load_fonts(&[font("assets/fonts/IBMPlexMono-Regular.ttf")], &examples)
        .unwrap();
    let style = TextStyle {
        font_features: features(&[("kern", 0)]),
        ..bebas(96.0)
    };
    // Bebas Neue is not loaded yet: the text falls back to another font.
    rasterizer.measure("AVATAR", &style, None);
    rasterizer
        .load_fonts(
            &[
                font("assets/fonts/IBMPlexMono-Regular.ttf"),
                font("assets/fonts/BebasNeue-Regular.ttf"),
            ],
            &examples,
        )
        .unwrap();
    for (_, start, _, family) in glyph_families(&mut rasterizer, "AVATAR", &style, None) {
        assert_eq!(family, "Bebas Neue", "glyph at {start}");
    }
    let mut fresh = two_family_rasterizer();
    assert_eq!(
        rasterizer.measure("AVATAR", &style, None).width,
        fresh.measure("AVATAR", &style, None).width
    );
}

#[test]
fn a_fork_draws_feature_text_as_the_original_does() {
    let mut rasterizer = two_family_rasterizer();
    let style = TextStyle {
        font_runs: vec![TextFontRun {
            font_features: features(&[("zero", 1)]),
            ..run(1, 3, None, None)
        }],
        ..plex(48.0)
    };
    let ids = glyph_ids(&mut rasterizer, "0000", &style);
    let mut fork = rasterizer.fork();
    assert_eq!(glyph_ids(&mut fork, "0000", &style), ids);
    let mut other_language = TextStyle {
        lang: Some("ja".into()),
        ..style.clone()
    };
    assert_eq!(glyph_ids(&mut rasterizer, "0000", &other_language), ids);
    other_language.lang = None;
    assert_eq!(glyph_ids(&mut rasterizer, "0000", &other_language), ids);
}
