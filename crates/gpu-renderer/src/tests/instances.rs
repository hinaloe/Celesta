//! `LayerContent::Instances`: each particle must shade exactly as the `Rect`
//! layer centred on it would.

use super::*;
use celesta_composition::{F32Column, InstanceShape, U8Column};

fn instances_layer(id: &str, content: LayerContent) -> Layer {
    Layer {
        id: id.to_owned(),
        transform: EvaluatedTransform::default(),
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        effects: Default::default(),
        content,
    }
}

/// `count` particles spread over a `size`-pixel square: per-particle widths,
/// a shared height, rotations from 0° to 350°, and translucent colours.
fn particles(shape: InstanceShape, count: usize, size: f32) -> LayerContent {
    let step = |i: usize| i as f32 / count as f32;
    LayerContent::Instances {
        count: count as u32,
        shape,
        width: None,
        height: Some(7.0),
        color: None,
        x: F32Column::from((0..count).map(|i| size * step(i) + 3.3).collect::<Vec<_>>()),
        y: F32Column::from(
            (0..count)
                .map(|i| size * ((i * 7 % count) as f32 / count as f32) + 2.1)
                .collect::<Vec<_>>(),
        ),
        widths: Some(F32Column::from(
            (0..count).map(|i| 3.0 + (i % 9) as f32).collect::<Vec<_>>(),
        )),
        heights: None,
        rotation: Some(F32Column::from(
            (0..count)
                .map(|i| (i % 36) as f32 * 10.0)
                .collect::<Vec<_>>(),
        )),
        colors: Some(U8Column::from(
            (0..count)
                .flat_map(|i| [(i * 40) as u8, (i * 90) as u8, (i * 13) as u8 ^ 0xff, 180])
                .collect::<Vec<_>>(),
        )),
    }
}

/// The `Rect` layers an `Instances` content stands for.
fn centred_rects(content: &LayerContent) -> Vec<Layer> {
    let LayerContent::Instances {
        count,
        shape,
        width,
        height,
        color,
        x,
        y,
        widths,
        heights,
        rotation,
        colors,
    } = content
    else {
        panic!("not an Instances content");
    };
    (0..*count as usize)
        .map(|i| {
            let width = widths
                .as_ref()
                .map_or_else(|| width.unwrap(), |w| f64::from(w[i]));
            let height = heights
                .as_ref()
                .map_or_else(|| height.unwrap(), |h| f64::from(h[i]));
            let color = colors.as_ref().map_or_else(
                || color.clone().unwrap_or_else(|| "#FFFFFFFF".to_owned()),
                |c| {
                    format!(
                        "#{:02x}{:02x}{:02x}{:02x}",
                        c[4 * i],
                        c[4 * i + 1],
                        c[4 * i + 2],
                        c[4 * i + 3]
                    )
                },
            );
            Layer {
                id: format!("particle-{i}"),
                transform: EvaluatedTransform {
                    position: Point {
                        x: f64::from(x[i]),
                        y: f64::from(y[i]),
                    },
                    rotation: rotation.as_ref().map_or(0.0, |r| f64::from(r[i])),
                    anchor: Point { x: 0.5, y: 0.5 },
                    ..EvaluatedTransform::default()
                },
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                effects: Default::default(),
                content: LayerContent::Rect {
                    width,
                    height,
                    fill: Some(Paint::Solid { color }),
                    stroke: None,
                    corner_radius: match shape {
                        InstanceShape::Rect { corner_radius } => *corner_radius,
                        _ => width.min(height) / 2.0,
                    },
                },
            }
        })
        .collect()
}

fn black_renderer() -> Option<TestRenderer> {
    renderer(GpuRenderOptions {
        background: Color::rgba(0, 0, 0, 255),
        ..GpuRenderOptions::default()
    })
}

/// Renders `layers` and `expected` into `size` scenes and requires the
/// same pixels.
fn assert_same_pixels(size: u32, layers: Vec<Layer>, expected: Vec<Layer>) {
    let Some(mut renderer) = black_renderer() else {
        return;
    };
    let render = |renderer: &mut GpuRenderer, layers| {
        let mut scene = empty_scene(size, size);
        scene.layers = layers;
        renderer.render(&scene).unwrap().pixels().to_vec()
    };
    let actual = render(&mut renderer, layers);
    let expected = render(&mut renderer, expected);
    let differing = actual
        .as_chunks::<4>()
        .0
        .iter()
        .zip(expected.as_chunks::<4>().0)
        .filter(|(a, e)| a != e)
        .count();
    assert_eq!(differing, 0, "{differing} pixels differ");
}

#[test]
fn instances_shade_like_centred_rects() {
    let content = particles(InstanceShape::Rect { corner_radius: 3.0 }, 50, 58.0);
    let rects = centred_rects(&content);
    assert_same_pixels(64, vec![instances_layer("rects", content)], rects);
}

#[test]
fn circle_instances_shade_like_round_rects() {
    let content = particles(InstanceShape::Circle, 50, 58.0);
    let rects = centred_rects(&content);
    assert_same_pixels(64, vec![instances_layer("circles", content)], rects);
}

#[test]
fn instances_follow_a_scaled_rotated_parent() {
    let content = particles(InstanceShape::Circle, 40, 30.0);
    let parent = || EvaluatedTransform {
        position: Point { x: 32.0, y: 30.0 },
        scale: Point { x: 1.5, y: 1.5 },
        rotation: 30.0,
        anchor: Point { x: 0.0, y: 0.0 },
    };
    let rects = centred_rects(&content);
    assert_same_pixels(
        64,
        vec![group(parent(), vec![instances_layer("circles", content)])],
        vec![group(parent(), rects)],
    );
}

#[test]
fn instances_draw_through_a_group_clip() {
    let content = particles(InstanceShape::Rect { corner_radius: 0.0 }, 50, 58.0);
    let clip = Clip {
        x: 10.0,
        y: 12.0,
        width: 30.0,
        height: 25.0,
        corner_radius: 6.0,
    };
    let origin = || EvaluatedTransform {
        anchor: Point { x: 0.0, y: 0.0 },
        ..EvaluatedTransform::default()
    };
    let rects = centred_rects(&content);
    assert_same_pixels(
        64,
        vec![clipped_group(
            origin(),
            clip,
            vec![instances_layer("clipped", content)],
        )],
        vec![clipped_group(origin(), clip, rects)],
    );
}

#[test]
fn blended_instances_match_a_blended_group_off_the_edge() {
    // Pushed right so the last particles straddle the scene's edge.
    let mut content = particles(InstanceShape::Circle, 50, 58.0);
    if let LayerContent::Instances { x, .. } = &mut content {
        *x = F32Column::from(x.iter().map(|x| x + 20.0).collect::<Vec<_>>());
    }
    let backdrop = || solid_rect("backdrop", 32.0, 64.0, 64.0, "#336699");
    let rects = centred_rects(&content);
    let instances = Layer {
        blend_mode: BlendMode::Screen,
        ..instances_layer("screen", content)
    };
    assert_same_pixels(
        64,
        vec![backdrop(), instances],
        vec![backdrop(), blend_group(1.0, BlendMode::Screen, rects)],
    );
}

#[test]
fn instances_are_one_draw() {
    let Some(mut renderer) = black_renderer() else {
        return;
    };
    let mut scene = empty_scene(64, 64);
    scene.layers = vec![
        solid_rect("before", 2.0, 4.0, 4.0, "#ff0000"),
        instances_layer("many", particles(InstanceShape::Circle, 1_000, 58.0)),
        solid_rect("after", 2.0, 4.0, 4.0, "#00ff00"),
    ];
    let draws = renderer.prepare_draws(&scene).unwrap();
    let runs: Vec<_> = draws
        .steps
        .iter()
        .map(|step| match step {
            GpuStep::Draw(draw) => draw.instances.clone(),
            _ => unreachable!("a frame without blend modes only draws"),
        })
        .collect();
    assert_eq!(runs.len(), 1, "{runs:?}");
    assert_eq!(runs[0], 0..1002);
}

#[test]
fn empty_and_non_finite_instances_draw_nothing() {
    let Some(mut renderer) = black_renderer() else {
        return;
    };
    let empty = LayerContent::Instances {
        count: 0,
        shape: InstanceShape::Circle,
        width: Some(4.0),
        height: Some(4.0),
        color: None,
        x: F32Column::from(Vec::new()),
        y: F32Column::from(Vec::new()),
        widths: None,
        heights: None,
        rotation: None,
        colors: None,
    };
    let mut scene = empty_scene(16, 16);
    scene.layers = vec![instances_layer("empty", empty)];
    assert!(renderer.prepare_draws(&scene).unwrap().steps.is_empty());

    let three = |middle_x: f32| LayerContent::Instances {
        count: 3,
        shape: InstanceShape::Rect { corner_radius: 0.0 },
        width: Some(4.0),
        height: Some(4.0),
        color: Some("#ffffff".to_owned()),
        x: F32Column::from(vec![3.0, middle_x, 13.0]),
        y: F32Column::from(vec![8.0, 8.0, 8.0]),
        widths: None,
        heights: None,
        rotation: None,
        colors: None,
    };
    let mut both = empty_scene(16, 16);
    both.layers = vec![instances_layer("nan", three(f32::NAN))];
    let frame = renderer.render(&both).unwrap();
    assert_eq!(pixel_at(&frame, 3, 8), [255, 255, 255, 255]);
    assert_eq!(pixel_at(&frame, 8, 8), [0, 0, 0, 255]);
    assert_eq!(pixel_at(&frame, 13, 8), [255, 255, 255, 255]);
}
