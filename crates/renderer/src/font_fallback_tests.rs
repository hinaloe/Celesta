use crate::fonts::TextRasterizer;
use celesta_composition::{AssetLocation, ResolvedAsset};
use std::fs;
use std::path::Path;
use tempfile::TempDir;

// Of the two repository fonts, only IBM Plex Mono has Cyrillic (Б).

/// A directory with Bebas Neue, IBM Plex Mono, two more copies of Plex
/// Mono, and stylesheets: `split.css` puts Bebas and Plex under one family,
/// `a.css` and `b.css` load a copy of Plex each as 'Fallback A' and
/// 'Fallback B'.
fn fixture() -> TempDir {
    let directory = tempfile::tempdir().unwrap();
    let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/prism/assets/fonts");
    for (from, to) in [
        ("BebasNeue-Regular.ttf", "bebas.ttf"),
        ("IBMPlexMono-Regular.ttf", "plex.ttf"),
        ("IBMPlexMono-Regular.ttf", "plex-a.ttf"),
        ("IBMPlexMono-Regular.ttf", "plex-b.ttf"),
    ] {
        fs::copy(fonts.join(from), directory.path().join(to)).unwrap();
    }
    for (name, css) in [
        (
            "split.css",
            "@font-face {font-family: 'Celesta Split'; src: url(bebas.ttf)}
             @font-face {font-family: 'Celesta Split'; src: url(plex.ttf)}",
        ),
        (
            "a.css",
            "@font-face {font-family: 'Fallback A'; src: url(plex-a.ttf)}",
        ),
        (
            "b.css",
            "@font-face {font-family: 'Fallback B'; src: url(plex-b.ttf)}",
        ),
    ] {
        fs::write(directory.path().join(name), css).unwrap();
    }
    directory
}

fn load(rasterizer: &mut TextRasterizer, directory: &TempDir, files: &[&str]) {
    let fonts: Vec<ResolvedAsset> = files
        .iter()
        .map(|path| ResolvedAsset {
            id: (*path).to_owned(),
            location: AssetLocation::File {
                path: (*path).to_owned(),
            },
        })
        .collect();
    rasterizer.load_fonts(&fonts, directory.path()).unwrap();
}

fn names(rasterizer: &TextRasterizer) -> Vec<String> {
    rasterizer
        .fallback_families
        .iter()
        .map(|name| name.to_string())
        .collect()
}

#[test]
fn fallback_families_follow_the_font_list() {
    let directory = fixture();
    let mut rasterizer = TextRasterizer::new();
    load(&mut rasterizer, &directory, &["bebas.ttf", "plex.ttf"]);
    assert_eq!(names(&rasterizer), ["Bebas Neue", "IBM Plex Mono"]);
    // Nothing new loads, and the order still follows the list.
    load(&mut rasterizer, &directory, &["plex.ttf", "bebas.ttf"]);
    assert_eq!(names(&rasterizer), ["IBM Plex Mono", "Bebas Neue"]);
    // Bebas Neue stays loaded but is no candidate.
    load(&mut rasterizer, &directory, &["plex.ttf"]);
    assert_eq!(names(&rasterizer), ["IBM Plex Mono"]);
}

#[test]
fn a_stylesheet_lists_one_private_family_per_face() {
    let directory = fixture();
    let mut rasterizer = TextRasterizer::new();
    load(&mut rasterizer, &directory, &["split.css"]);
    let names = names(&rasterizer);
    assert_eq!(names.len(), 2, "{names:?}");
    assert!(
        names
            .iter()
            .all(|name| name.starts_with("celesta-stylesheet-face-")),
        "{names:?}"
    );
}

#[test]
fn a_stylesheet_loaded_twice_keeps_its_families() {
    let directory = fixture();
    let mut rasterizer = TextRasterizer::new();
    load(&mut rasterizer, &directory, &["split.css"]);
    let first = names(&rasterizer);
    load(&mut rasterizer, &directory, &["bebas.ttf"]);
    load(&mut rasterizer, &directory, &["split.css"]);
    assert_eq!(names(&rasterizer), first);
}

#[test]
fn fonts_revision_changes_with_the_list_order_only_when_it_changes() {
    let directory = fixture();
    let mut rasterizer = TextRasterizer::new();
    load(&mut rasterizer, &directory, &["bebas.ttf", "plex.ttf"]);
    let loaded = rasterizer.fonts_revision();
    load(&mut rasterizer, &directory, &["bebas.ttf", "plex.ttf"]);
    assert_eq!(rasterizer.fonts_revision(), loaded);
    load(&mut rasterizer, &directory, &["plex.ttf", "bebas.ttf"]);
    assert!(rasterizer.fonts_revision() > loaded);
}

#[test]
fn a_fork_keeps_the_fallback_families() {
    let directory = fixture();
    let mut rasterizer = TextRasterizer::new();
    load(&mut rasterizer, &directory, &["split.css", "a.css"]);
    let fork = rasterizer.fork();
    assert_eq!(names(&fork), names(&rasterizer));
    assert_eq!(fork.fonts_revision(), rasterizer.fonts_revision());
}
