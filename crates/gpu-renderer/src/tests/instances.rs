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
        shape: Box::new(shape),
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
                    corner_radius: match shape.as_ref() {
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
        ..Default::default()
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
        shape: Box::new(InstanceShape::Circle),
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
        shape: Box::new(InstanceShape::Rect { corner_radius: 0.0 }),
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

fn image_particles(
    path: &str,
    x: Vec<f32>,
    y: Vec<f32>,
    colors: Vec<u8>,
    size: Option<f32>,
    rotation: Option<f32>,
) -> LayerContent {
    let count = x.len();
    LayerContent::Instances {
        count: count as u32,
        shape: Box::new(InstanceShape::Image {
            asset: ResolvedAsset {
                id: path.to_owned(),
                location: AssetLocation::File {
                    path: path.to_owned(),
                },
            },
        }),
        width: size.map(f64::from),
        height: size.map(f64::from),
        color: None,
        x: F32Column::from(x),
        y: F32Column::from(y),
        widths: None,
        heights: None,
        rotation: rotation.map(|degrees| F32Column::from(vec![degrees; count])),
        colors: Some(U8Column::from(colors)),
    }
}

/// A 4x4 opaque white image under `id`, decoded without reading a file.
fn white_sprite(renderer: &mut GpuRenderer, id: &str) {
    renderer.image_sources.insert_raster(
        id,
        image::RgbaImage::from_raw(4, 4, [255; 4].repeat(16)).unwrap(),
    );
}

#[test]
fn image_instances_multiply_their_colour() {
    let Some(mut renderer) = black_renderer() else {
        return;
    };
    white_sprite(&mut renderer, "spark");
    let mut scene = empty_scene(16, 16);
    scene.layers = vec![instances_layer(
        "sparks",
        image_particles(
            "spark",
            vec![4.0, 12.0],
            vec![8.0, 8.0],
            vec![255, 0, 0, 255, 0, 0, 255, 128],
            None,
            None,
        ),
    )];
    let frame = renderer.render(&scene).unwrap();
    assert_eq!(pixel_at(&frame, 2, 6), [255, 0, 0, 255]);
    assert_eq!(pixel_at(&frame, 5, 9), [255, 0, 0, 255]);
    let blue = pixel_at(&frame, 12, 8);
    assert!(
        blue[..2] == [0, 0] && blue[2].abs_diff(128) <= 1,
        "{blue:?}"
    );
    assert_eq!(pixel_at(&frame, 8, 8), [0, 0, 0, 255]);
    assert_eq!(pixel_at(&frame, 6, 8), [0, 0, 0, 255]);
}

#[test]
fn image_instances_match_the_cpu_renderer() {
    let Some(renderer) = renderer(GpuRenderOptions {
        background: Color::rgba(10, 20, 30, 255),
        ..GpuRenderOptions::default()
    }) else {
        return;
    };
    let mut renderer = renderer.with_asset_root(env!("CARGO_MANIFEST_DIR"));
    let count = 20;
    let mut scene = empty_scene(48, 48);
    scene.layers = vec![instances_layer(
        "checkers",
        image_particles(
            "tests/assets/checker.ppm",
            (0..count).map(|i| (2 + 2 * i) as f32).collect(),
            (0..count).map(|i| (3 + (i * 7) % 40) as f32).collect(),
            (0..count)
                .flat_map(|i| [255, (i * 40) as u8, (i * 90) as u8, 128 + i as u8])
                .collect(),
            None,
            None,
        ),
    )];
    let frame = renderer.render(&scene).unwrap();
    let expected = celesta_renderer::CpuRenderer::new(celesta_renderer::RenderOptions {
        background: celesta_renderer::Color::rgba(10, 20, 30, 255),
    })
    .with_asset_root(env!("CARGO_MANIFEST_DIR"))
    .render(&scene)
    .unwrap();
    assert!(max_channel_difference(&frame, &expected) <= 1);
}

#[test]
fn image_instances_scale_and_rotate() {
    let Some(mut renderer) = black_renderer() else {
        return;
    };
    white_sprite(&mut renderer, "spark");
    let mut scene = empty_scene(16, 16);
    scene.layers = vec![instances_layer(
        "turned",
        image_particles(
            "spark",
            vec![8.0],
            vec![8.0],
            vec![255; 4],
            Some(8.0),
            Some(90.0),
        ),
    )];
    let frame = renderer.render(&scene).unwrap();
    // Magnified and turned, the sprite is filtered: its edge pixels are
    // anti-aliased, its inside is solid, and it reaches no further.
    for (x, y) in [(5, 5), (10, 10), (5, 10), (10, 5), (8, 8)] {
        assert_eq!(pixel_at(&frame, x, y), [255, 255, 255, 255], "({x}, {y})");
    }
    for (x, y) in [(2, 8), (13, 8), (8, 2), (8, 13)] {
        assert_eq!(pixel_at(&frame, x, y), [0, 0, 0, 255], "({x}, {y})");
    }
    // Exactly as an `Image` layer of the particle's size draws it.
    let mut image = empty_scene(16, 16);
    image.layers = vec![Layer {
        transform: EvaluatedTransform {
            position: Point { x: 8.0, y: 8.0 },
            rotation: 90.0,
            anchor: Point { x: 0.5, y: 0.5 },
            ..EvaluatedTransform::default()
        },
        content: LayerContent::Image {
            asset: ResolvedAsset {
                id: "spark".to_owned(),
                location: AssetLocation::File {
                    path: "spark".to_owned(),
                },
            },
            width: Some(8.0),
            height: Some(8.0),
            fit: None,
            animation: None,
        },
        ..instances_layer(
            "image",
            LayerContent::Group {
                layers: Vec::new(),
                clip: None,
                mask: None,
                motion_blur: false,
            },
        )
    }];
    let expected = renderer.render(&image).unwrap();
    assert_eq!(frame.pixels(), expected.pixels());
}

/// The sprite textures the renderer holds, as (width, height, mip levels).
fn image_textures(renderer: &GpuRenderer) -> Vec<(u32, u32, u32)> {
    renderer
        .textures
        .iter()
        .filter(|(key, _)| key.starts_with("image\0"))
        .map(|(_, cached)| {
            let texture = &cached.texture;
            (
                texture.width,
                texture.height,
                texture._texture.mip_level_count(),
            )
        })
        .collect()
}

fn svg_sprite(svg: &str, width: Option<f32>) -> (tempfile::TempDir, LayerContent) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sprite.svg");
    std::fs::write(&path, svg).unwrap();
    let mut content = image_particles(
        path.to_str().unwrap(),
        vec![10.0, 30.0],
        vec![40.0, 40.0],
        vec![255; 8],
        None,
        None,
    );
    if let LayerContent::Instances { width: shared, .. } = &mut content {
        *shared = width.map(f64::from);
    }
    (dir, content)
}

const TALL_SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="40"><rect width="10" height="40" fill="white"/></svg>"#;

#[test]
fn an_svg_sprite_rasterizes_once_for_its_largest_particle() {
    let Some(mut renderer) = black_renderer() else {
        return;
    };
    // Twice (eight times) as wide as the SVG, so as much taller too:
    // rasterized at that scale on both axes, once, and reused by the next
    // frame.
    for (width, size) in [(20.0, (20, 80)), (80.0, (80, 320))] {
        let (_dir, content) = svg_sprite(TALL_SVG, Some(width));
        let mut scene = empty_scene(64, 128);
        scene.layers = vec![instances_layer("tall", content)];
        for _ in 0..2 {
            renderer.render(&scene).unwrap();
            let textures = image_textures(&renderer);
            assert_eq!(textures.len(), 1, "{textures:?}");
            assert_eq!((textures[0].0, textures[0].1), size, "{textures:?}");
        }
    }
}

#[test]
fn an_svg_sprite_has_mipmaps_for_smaller_particles() {
    let Some(mut renderer) = black_renderer() else {
        return;
    };
    let (_dir, content) = svg_sprite(TALL_SVG, None);
    let mut scene = empty_scene(64, 128);
    scene.layers = vec![instances_layer("tall", content)];
    renderer.render(&scene).unwrap();
    let textures = image_textures(&renderer);
    assert!(
        textures.iter().all(|&(_, _, levels)| levels > 1),
        "{textures:?}"
    );
}

#[test]
fn one_sprite_dimension_keeps_the_images_aspect_ratio() {
    let Some(mut renderer) = black_renderer() else {
        return;
    };
    renderer.image_sources.insert_raster(
        "wide",
        image::RgbaImage::from_raw(4, 2, [255; 4].repeat(8)).unwrap(),
    );
    let mut content = image_particles("wide", vec![8.0], vec![8.0], vec![255; 4], None, None);
    if let LayerContent::Instances { width, .. } = &mut content {
        *width = Some(8.0);
    }
    let mut scene = empty_scene(16, 16);
    scene.layers = vec![instances_layer("wide", content)];
    let frame = renderer.render(&scene).unwrap();
    // 8 wide, so 4 tall (rows 6 to 9), magnified and so filtered: solid
    // inside, anti-aliased at its edges, nothing beyond.
    assert_eq!(pixel_at(&frame, 8, 7), [255, 255, 255, 255]);
    assert_eq!(pixel_at(&frame, 8, 8), [255, 255, 255, 255]);
    assert_eq!(pixel_at(&frame, 8, 3), [0, 0, 0, 255]);
    assert_eq!(pixel_at(&frame, 8, 12), [0, 0, 0, 255]);
    // Exactly as `<Image width={8}>` draws it.
    let mut image = empty_scene(16, 16);
    image.layers = vec![Layer {
        transform: EvaluatedTransform {
            position: Point { x: 8.0, y: 8.0 },
            anchor: Point { x: 0.5, y: 0.5 },
            ..EvaluatedTransform::default()
        },
        content: LayerContent::Image {
            asset: ResolvedAsset {
                id: "wide".to_owned(),
                location: AssetLocation::File {
                    path: "wide".to_owned(),
                },
            },
            width: Some(8.0),
            height: None,
            fit: None,
            animation: None,
        },
        ..instances_layer(
            "image",
            LayerContent::Group {
                layers: Vec::new(),
                clip: None,
                mask: None,
                motion_blur: false,
            },
        )
    }];
    assert_eq!(frame.pixels(), renderer.render(&image).unwrap().pixels());
}

/// A frame pushes one `PreparedItem` per layer and copies it at least once
/// more; 100,000 layers make its size show in a frame's time.
#[test]
fn prepared_items_stay_small() {
    let size = std::mem::size_of::<PreparedItem>();
    assert!(size <= 160, "PreparedItem is {size} bytes");
}

#[test]
fn gpu_refuses_a_static_ref() {
    let Some(mut renderer) = black_renderer() else {
        return;
    };
    let mut scene = empty_scene(4, 4);
    scene.layers = vec![instances_layer("s", LayerContent::StaticRef { key: 3 })];
    let error = renderer.prepare_draws(&scene).err().unwrap();
    assert!(
        matches!(&error, GpuRenderError::UnsupportedContent { layer, content: "static reference" } if layer == "s"),
        "{error}"
    );
}

#[test]
fn records_one_hit_region_around_every_particle() {
    let Some(mut renderer) = renderer(GpuRenderOptions::default()) else {
        return;
    };
    renderer.set_record_hit_regions(true);
    let mut scene = empty_scene(100, 60);
    scene.layers = vec![instances_layer(
        "particles",
        LayerContent::Instances {
            count: 2,
            shape: Box::new(InstanceShape::Rect { corner_radius: 0.0 }),
            width: Some(10.0),
            height: Some(4.0),
            color: None,
            x: F32Column::from(vec![20.0, 70.0]),
            y: F32Column::from(vec![10.0, 40.0]),
            widths: None,
            heights: None,
            rotation: None,
            colors: None,
        },
    )];
    renderer.render(&scene).unwrap();
    let regions = renderer.hit_regions();
    assert_eq!(regions.len(), 1);
    assert_eq!(regions[0].layer_id, "particles");
    // Particles are centred on their positions.
    assert_corners(
        &regions[0],
        [(15.0, 8.0), (75.0, 8.0), (75.0, 42.0), (15.0, 42.0)],
    );
}
