//! Skew and 3D rotation: the affine path of the GPU renderer, and the
//! projective planes perspective layers draw through.

use super::*;
use celesta_composition::{BackfaceVisibility, project};

fn transformed(mut layer: Layer, edit: impl FnOnce(&mut EvaluatedTransform)) -> Layer {
    edit(&mut layer.transform);
    layer
}

fn transparent_renderer() -> Option<TestRenderer> {
    renderer(GpuRenderOptions {
        background: Color::TRANSPARENT,
        ..GpuRenderOptions::default()
    })
}

fn scene_of(layers: Vec<Layer>) -> Scene {
    let mut scene = empty_scene(64, 64);
    scene.layers = layers;
    scene
}

#[test]
fn skews_rects_by_the_tangent() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let rect = transformed(
        corner_rect("rect", 10.0, 10.0, 20.0, 20.0, "#FF0000FF"),
        |transform| transform.skew.x = 45.0,
    );
    let frame = renderer.render(&scene_of(vec![rect])).unwrap();
    // A row at y = 25 is 15 below the anchor, so the rect shifts right 15.
    assert_eq!(pixel_at(&frame, 35, 25), [255, 0, 0, 255]);
    assert_eq!(pixel_at(&frame, 22, 25)[3], 0);
    assert_eq!(pixel_at(&frame, 47, 25)[3], 0);
}

#[test]
fn orthographic_rotation_y_matches_scale_x() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let rotated = transformed(
        corner_rect("rotated", 10.0, 10.0, 40.0, 30.0, "#FF0000FF"),
        |transform| transform.rotation_y = 60.0,
    );
    let scaled = transformed(
        corner_rect("scaled", 10.0, 10.0, 40.0, 30.0, "#FF0000FF"),
        |transform| transform.scale.x = 0.5,
    );
    let rotated = renderer.render(&scene_of(vec![rotated])).unwrap();
    let scaled = renderer.render(&scene_of(vec![scaled])).unwrap();
    assert_eq!(pixel_at(&scaled, 20, 20), [255, 0, 0, 255]);
    let difference = rotated
        .pixels()
        .iter()
        .zip(scaled.pixels())
        .map(|(a, b)| a.abs_diff(*b))
        .max()
        .unwrap();
    assert_eq!(difference, 0);
}

#[test]
fn hides_backfaces_through_parents() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let hidden = |mut layer: Layer| {
        layer.transform.backface_visibility = BackfaceVisibility::Hidden;
        layer
    };
    let scene = |group_rotation_y: f64| {
        let red = hidden(corner_rect("a", -10.0, -10.0, 20.0, 20.0, "#FF0000FF"));
        let blue = corner_rect("b", -10.0, -10.0, 20.0, 20.0, "#0000FFFF");
        let inner = hidden(group(
            EvaluatedTransform {
                anchor: Point { x: 0.0, y: 0.0 },
                rotation_y: 180.0,
                ..EvaluatedTransform::default()
            },
            vec![blue],
        ));
        scene_of(vec![group(
            EvaluatedTransform {
                position: Point { x: 32.0, y: 32.0 },
                anchor: Point { x: 0.0, y: 0.0 },
                rotation_y: group_rotation_y,
                ..EvaluatedTransform::default()
            },
            vec![red, inner],
        )])
    };
    // 120° turns the red rect's back to the viewer, and 180° more turns the
    // inner group (and so the blue rect) round to the front again.
    let frame = renderer.render(&scene(120.0)).unwrap();
    assert_eq!(pixel_at(&frame, 32, 32), [0, 0, 255, 255]);
    let frame = renderer.render(&scene(30.0)).unwrap();
    assert_eq!(pixel_at(&frame, 32, 32), [255, 0, 0, 255]);
}

#[test]
fn edge_on_layers_draw_nothing() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let cases: [(&str, f64, Option<f64>, f64); 3] = [
        ("rotation y", 90.0, None, 0.0),
        ("rotation y with perspective", 90.0, Some(400.0), 0.0),
        ("skew", 0.0, None, 90.0),
    ];
    for (case, rotation_y, perspective, skew_x) in cases {
        let rect = transformed(
            corner_rect("rect", 10.0, 10.0, 40.0, 40.0, "#FF0000FF"),
            |transform| {
                transform.rotation_y = rotation_y;
                transform.perspective = perspective;
                transform.skew.x = skew_x;
            },
        );
        let frame = renderer.render(&scene_of(vec![rect])).unwrap();
        assert!(
            frame.pixels().iter().all(|channel| *channel == 0),
            "{case} drew something"
        );
    }
}

/// A `width`x`height` rect of `color` centred on `(x, y)`.
fn centred_rect(x: f64, y: f64, width: f64, height: f64, color: &str) -> Layer {
    let mut rect = corner_rect("rect", x, y, width, height, color);
    rect.transform.anchor = Point { x: 0.5, y: 0.5 };
    rect
}

/// `layer` turned by `rotation_x` and `rotation_y` under `perspective`.
fn in_perspective(layer: Layer, rotation_x: f64, rotation_y: f64, perspective: f64) -> Layer {
    transformed(layer, |transform| {
        transform.rotation_x = rotation_x;
        transform.rotation_y = rotation_y;
        transform.perspective = Some(perspective);
    })
}

/// A group at `(x, y)` turning about its origin.
fn group_at(x: f64, y: f64, layers: Vec<Layer>) -> Layer {
    group(
        EvaluatedTransform {
            position: Point { x, y },
            anchor: Point { x: 0.0, y: 0.0 },
            ..EvaluatedTransform::default()
        },
        layers,
    )
}

fn sized_scene(width: u32, height: u32, layers: Vec<Layer>) -> Scene {
    let mut scene = empty_scene(width, height);
    scene.layers = layers;
    scene
}

const RED: [u8; 4] = [255, 0, 0, 255];

#[test]
fn projects_a_rect_through_its_perspective() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let rect = in_perspective(
        centred_rect(100.0, 100.0, 100.0, 100.0, "#FF0000FF"),
        0.0,
        45.0,
        300.0,
    );
    let homography = rect.transform.homography();
    let corners = [(-50.0, -50.0), (50.0, -50.0), (50.0, 50.0), (-50.0, 50.0)].map(|(x, y)| {
        let [x, y, _] = project(&homography, x, y);
        (x, y)
    });
    let frame = renderer.render(&sized_scene(200, 200, vec![rect])).unwrap();
    let centre = (
        corners.iter().map(|(x, _)| x).sum::<f64>() / 4.0,
        corners.iter().map(|(_, y)| y).sum::<f64>() / 4.0,
    );
    for index in 0..4 {
        let (from, to) = (corners[index], corners[(index + 1) % 4]);
        let middle = ((from.0 + to.0) / 2.0, (from.1 + to.1) / 2.0);
        let length = (to.0 - from.0).hypot(to.1 - from.1);
        let mut normal = (-(to.1 - from.1) / length, (to.0 - from.0) / length);
        if normal.0 * (centre.0 - middle.0) + normal.1 * (centre.1 - middle.1) < 0.0 {
            normal = (-normal.0, -normal.1);
        }
        let at = |distance: f64| {
            let x = middle.0 + normal.0 * distance;
            let y = middle.1 + normal.1 * distance;
            pixel_at(&frame, x.floor() as u32, y.floor() as u32)
        };
        assert_eq!(at(3.0), RED, "inside edge {index} at {middle:?}");
        assert_eq!(at(-3.0)[3], 0, "outside edge {index} at {middle:?}");
    }
}

#[test]
fn projective_text_stays_sharp() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let scene = |rotation_x: f64| {
        let mut text = text_layer("h", Point { x: 0.0, y: 0.0 }, 1.0, 120.0);
        text.transform.anchor = Point { x: 0.5, y: 0.5 };
        if let LayerContent::Text { text, .. } = &mut text.content {
            *text = "H".to_owned();
        }
        let mut group = group_at(100.0, 100.0, vec![text]);
        if rotation_x != 0.0 {
            group = in_perspective(group, rotation_x, 0.0, 800.0);
        }
        sized_scene(200, 200, vec![group])
    };
    // The largest alpha step between neighbours on the rows through the
    // stems, above the crossbar.
    let sharpness = |frame: &GpuFrame| {
        (62..78)
            .flat_map(|y| (1..frame.width()).map(move |x| (x, y)))
            .map(|(x, y)| pixel_at(frame, x, y)[3].abs_diff(pixel_at(frame, x - 1, y)[3]))
            .max()
            .unwrap()
    };
    let flat = sharpness(&renderer.render(&scene(0.0)).unwrap());
    let projected = sharpness(&renderer.render(&scene(30.0)).unwrap());
    assert!(flat > 128, "the flat H has sharp stems: {flat}");
    assert!(
        f64::from(projected) >= 0.75 * f64::from(flat),
        "projected {projected} vs flat {flat}"
    );
}

#[test]
fn flips_a_card() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let hidden = |mut layer: Layer| {
        layer.transform.backface_visibility = BackfaceVisibility::Hidden;
        layer
    };
    let card = |rotation_y: f64| {
        let front = hidden(corner_rect(
            "front",
            -60.0,
            -80.0,
            120.0,
            160.0,
            "#F4EFE6FF",
        ));
        let back = hidden(transformed(
            group_at(
                0.0,
                0.0,
                vec![corner_rect("back", -60.0, -80.0, 120.0, 160.0, "#1D3557FF")],
            ),
            |transform| transform.rotation_y = 180.0,
        ));
        let card = in_perspective(
            group_at(200.0, 200.0, vec![front, back]),
            0.0,
            rotation_y,
            600.0,
        );
        sized_scene(400, 400, vec![card])
    };
    let frame = renderer.render(&card(30.0)).unwrap();
    assert_eq!(pixel_at(&frame, 200, 200), [0xF4, 0xEF, 0xE6, 255]);
    let frame = renderer.render(&card(150.0)).unwrap();
    assert_eq!(pixel_at(&frame, 200, 200), [0x1D, 0x35, 0x57, 255]);
    let frame = renderer.render(&card(90.0)).unwrap();
    assert_eq!(pixel_at(&frame, 190, 200)[3], 0, "edge-on");
}

#[test]
fn nests_projective_groups() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let rect = in_perspective(
        centred_rect(0.0, 0.0, 100.0, 100.0, "#FF0000FF"),
        0.0,
        30.0,
        600.0,
    );
    let outer = in_perspective(group_at(100.0, 100.0, vec![rect]), 20.0, 0.0, 800.0);
    let frame = renderer
        .render(&sized_scene(200, 200, vec![outer]))
        .unwrap();
    assert_eq!(pixel_at(&frame, 100, 100), RED);
    // Both halves of the rect are drawn: the nested plane covers its whole
    // content, left of its origin too.
    assert_eq!(pixel_at(&frame, 70, 100), RED);
    assert_eq!(pixel_at(&frame, 130, 100), RED);
}

#[test]
fn clips_inside_and_outside_a_projective_group() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let rect = || {
        in_perspective(
            centred_rect(100.0, 100.0, 100.0, 100.0, "#FF0000FF"),
            0.0,
            30.0,
            600.0,
        )
    };
    let left_half = Clip {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 200.0,
        corner_radius: 0.0,
    };
    let outside = clipped_group(EvaluatedTransform::default(), left_half, vec![rect()]);
    let frame = renderer
        .render(&sized_scene(200, 200, vec![outside]))
        .unwrap();
    assert_eq!(pixel_at(&frame, 80, 100), RED);
    assert_eq!(
        pixel_at(&frame, 120, 100)[3],
        0,
        "outside the parent's clip"
    );

    let inside = in_perspective(
        clipped_group(
            EvaluatedTransform {
                position: Point { x: 100.0, y: 100.0 },
                anchor: Point { x: 0.0, y: 0.0 },
                ..EvaluatedTransform::default()
            },
            Clip {
                x: -50.0,
                y: -50.0,
                width: 50.0,
                height: 100.0,
                corner_radius: 0.0,
            },
            vec![centred_rect(0.0, 0.0, 100.0, 100.0, "#FF0000FF")],
        ),
        0.0,
        30.0,
        600.0,
    );
    let frame = renderer
        .render(&sized_scene(200, 200, vec![inside]))
        .unwrap();
    assert_eq!(pixel_at(&frame, 80, 100), RED);
    assert_eq!(
        pixel_at(&frame, 120, 100)[3],
        0,
        "outside the group's own clip"
    );
}

#[test]
fn draws_only_what_is_in_front_of_the_viewer() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let rect = in_perspective(
        centred_rect(100.0, 100.0, 1000.0, 100.0, "#FF0000FF"),
        0.0,
        80.0,
        200.0,
    );
    let frame = renderer.render(&sized_scene(200, 200, vec![rect])).unwrap();
    assert!(
        frame.pixels().as_chunks::<4>().0.contains(&RED),
        "something of the rect is drawn"
    );
}

#[test]
fn caps_huge_planes_at_the_texture_limit() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let rect = in_perspective(
        centred_rect(100.0, 100.0, 50_000.0, 50_000.0, "#FF0000FF"),
        60.0,
        0.0,
        1000.0,
    );
    renderer.render(&sized_scene(200, 200, vec![rect])).unwrap();
}

#[test]
fn blends_a_projective_layer_with_its_mode() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let background = corner_rect("background", 0.0, 0.0, 200.0, 200.0, "#FF0000FF");
    let mut white = in_perspective(
        centred_rect(100.0, 100.0, 100.0, 100.0, "#FFFFFFFF"),
        0.0,
        30.0,
        600.0,
    );
    white.blend_mode = BlendMode::Difference;
    let frame = renderer
        .render(&sized_scene(200, 200, vec![background, white]))
        .unwrap();
    assert_eq!(pixel_at(&frame, 100, 100), [0, 255, 255, 255]);
}

#[test]
fn decodes_a_projective_video_once_per_frame() {
    struct Decoder(std::sync::Arc<std::sync::atomic::AtomicUsize>);

    impl VideoFrameDecoder for Decoder {
        fn decode_frame(&mut self, _: &Path, _: f64) -> Result<VideoFrame, MediaError> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(VideoFrame {
                width: 4,
                height: 4,
                pixels: [255, 0, 0, 255].repeat(16).into(),
            })
        }
    }

    let Some(renderer) = transparent_renderer() else {
        return;
    };
    let decodes = std::sync::Arc::default();
    let mut renderer = renderer.with_video_decoder(Decoder(std::sync::Arc::clone(&decodes)));
    let video = Layer {
        id: "video".to_owned(),
        transform: EvaluatedTransform {
            position: Point { x: 100.0, y: 100.0 },
            scale: Point { x: 25.0, y: 25.0 },
            rotation_y: 30.0,
            perspective: Some(600.0),
            ..EvaluatedTransform::default()
        },
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        effects: Default::default(),
        content: LayerContent::Video {
            asset: ResolvedAsset {
                id: "clip".to_owned(),
                location: AssetLocation::File {
                    path: "clip.mp4".to_owned(),
                },
            },
            timing: MediaTiming {
                local_time: Time::ZERO,
                source_start: Time::ZERO,
                source_time_seconds: 0.0,
                playback_rate: 1.0,
                r#loop: false,
            },
        },
    };
    let frame = renderer
        .render(&sized_scene(200, 200, vec![video]))
        .unwrap();
    assert_eq!(pixel_at(&frame, 100, 100), RED);
    assert_eq!(decodes.load(std::sync::atomic::Ordering::SeqCst), 1);
}
