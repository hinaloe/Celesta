//! Motion-blurred groups (`LayerContent::Group { motion_blur: true }`): the
//! samples' average must match the CPU renderer's.

use super::*;

fn blurred(samples: Vec<Layer>) -> Layer {
    Layer {
        id: "blurred".to_owned(),
        transform: EvaluatedTransform {
            anchor: Point { x: 0.0, y: 0.0 },
            ..EvaluatedTransform::default()
        },
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        effects: Default::default(),
        content: LayerContent::Group {
            layers: samples,
            clip: None,
            mask: None,
            motion_blur: true,
        },
    }
}

/// A disc sliding right by `step` pixels a sample, `count` samples.
fn sliding_disc(count: usize, step: f64, color: &str) -> Vec<Layer> {
    (0..count)
        .map(|index| disc("disc", 16.0 + step * index as f64, 24.0, 10.0, color))
        .collect()
}

fn assert_matches_cpu(renderer: &mut TestRenderer, case: &str, scene: &Scene, tolerance: u8) {
    let gpu = renderer.render(scene).unwrap();
    let cpu = celesta_renderer::CpuRenderer::default()
        .render(scene)
        .unwrap();
    let difference = max_channel_difference(&gpu, &cpu);
    assert!(
        difference <= tolerance,
        "{case}: channels differ by up to {difference}"
    );
}

#[test]
fn averages_samples_like_the_cpu_renderer() {
    let Some(mut renderer) = renderer(GpuRenderOptions::default()) else {
        return;
    };
    let with = |layer: Layer, edit: &dyn Fn(&mut Layer)| {
        let mut layer = layer;
        edit(&mut layer);
        layer
    };
    let cases: Vec<(&str, Vec<Layer>)> = vec![
        (
            "halves",
            vec![blurred(vec![
                corner_rect("left", 0.0, 0.0, 32.0, 48.0, "#FF0000FF"),
                corner_rect("right", 32.0, 0.0, 32.0, 48.0, "#FF0000FF"),
            ])],
        ),
        (
            "a sliding disc",
            vec![blurred(sliding_disc(8, 4.0, "#20C0FFFF"))],
        ),
        (
            "colors",
            vec![blurred(vec![
                corner_rect("red", 0.0, 0.0, 64.0, 48.0, "#FF0000FF"),
                corner_rect("blue", 0.0, 0.0, 64.0, 48.0, "#0000FFFF"),
            ])],
        ),
        (
            "premultiplied",
            vec![blurred(vec![
                corner_rect("white", 0.0, 0.0, 64.0, 48.0, "#FFFFFF80"),
                corner_rect("black", 0.0, 0.0, 64.0, 48.0, "#000000FF"),
            ])],
        ),
        (
            "opacity and blend mode",
            vec![
                corner_rect("backdrop", 0.0, 0.0, 64.0, 48.0, "#336699FF"),
                with(blurred(sliding_disc(4, 6.0, "#FFAA00FF")), &|layer| {
                    layer.opacity = 0.6;
                    layer.blend_mode = BlendMode::Screen;
                }),
            ],
        ),
        (
            "clip",
            vec![with(blurred(sliding_disc(4, 6.0, "#FFAA00FF")), &|layer| {
                if let LayerContent::Group { clip, .. } = &mut layer.content {
                    *clip = Some(Clip {
                        x: 0.0,
                        y: 0.0,
                        width: 30.0,
                        height: 48.0,
                        corner_radius: 0.0,
                    });
                }
            })],
        ),
        (
            "mask",
            vec![with(blurred(sliding_disc(4, 6.0, "#FFAA00FF")), &|layer| {
                if let LayerContent::Group { mask, .. } = &mut layer.content {
                    *mask = Some(alpha_mask(vec![corner_rect(
                        "matte",
                        0.0,
                        0.0,
                        64.0,
                        24.0,
                        "#FFFFFFFF",
                    )]));
                }
            })],
        ),
        (
            "a blended layer inside a sample",
            vec![
                corner_rect("backdrop", 0.0, 0.0, 64.0, 48.0, "#808080FF"),
                blurred(vec![
                    corner_rect("base", 0.0, 0.0, 40.0, 48.0, "#204080FF"),
                    Layer {
                        blend_mode: BlendMode::Screen,
                        ..disc("screened", 30.0, 24.0, 12.0, "#C04000FF")
                    },
                ]),
            ],
        ),
        (
            "nested",
            vec![blurred(vec![
                blurred(sliding_disc(2, 4.0, "#FF0000FF")),
                blurred(sliding_disc(3, -4.0, "#00FF00FF")),
            ])],
        ),
        ("no samples", vec![blurred(Vec::new())]),
    ];
    for (case, layers) in cases {
        let mut scene = empty_scene(64, 48);
        scene.layers = layers;
        assert_matches_cpu(&mut renderer, case, &scene, 3);
    }
}

#[test]
fn a_shadow_follows_the_averaged_samples_like_the_cpu_renderer() {
    let Some(mut renderer) = renderer(GpuRenderOptions::default()) else {
        return;
    };
    let mut group = blurred(sliding_disc(4, 6.0, "#FFAA00FF"));
    group.effects.shadow = Some(Box::new(LayerShadow {
        color: "#000000C0".to_owned(),
        blur: 2.0,
        offset_x: 6.0,
        offset_y: 4.0,
    }));
    let mut scene = empty_scene(64, 48);
    scene.layers = vec![group];
    assert_matches_cpu(&mut renderer, "shadow", &scene, 5);
}

#[test]
fn averages_on_cropped_canvases_like_the_cpu_renderer() {
    let Some(mut renderer) = renderer(GpuRenderOptions::default()) else {
        return;
    };
    // Far bigger than `CanvasRegion::STEP`, so a small group's canvas is
    // cropped and sits away from the scene's origin, partly off its edge.
    let samples = (0..6)
        .map(|index| disc("disc", 360.0 + 8.0 * index as f64, 150.0, 20.0, "#FFFFFFFF"))
        .collect();
    let mut scene = empty_scene(400, 300);
    scene.layers = vec![blurred(samples)];
    assert_matches_cpu(&mut renderer, "cropped", &scene, 3);
}

#[test]
fn a_motion_blurred_group_is_planned_as_one_canvas_with_a_step_per_sample() {
    let Some(mut renderer) = renderer(GpuRenderOptions::default()) else {
        return;
    };
    let mut scene = empty_scene(64, 48);
    scene.layers = vec![blurred(sliding_disc(3, 4.0, "#FF0000FF"))];
    let draws = renderer.prepare_draws(&scene).unwrap();
    let kinds: Vec<&str> = draws
        .steps
        .iter()
        .map(|step| match step {
            GpuStep::BeginAverage { .. } => "begin",
            GpuStep::NextSample => "next",
            GpuStep::EndAverage { .. } => "end",
            GpuStep::Draw(_) => "draw",
            _ => "other",
        })
        .collect();
    assert_eq!(
        kinds,
        ["begin", "draw", "next", "draw", "next", "draw", "end"]
    );
}
