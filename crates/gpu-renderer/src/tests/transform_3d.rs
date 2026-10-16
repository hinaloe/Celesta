//! Skew and orthographic 3D rotation: the affine path of the GPU renderer.

use super::*;
use celesta_composition::BackfaceVisibility;

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
