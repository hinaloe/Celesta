//! Density-banded planes: a plane too large for one canvas at the scale its
//! nearest part needs is drawn in bands of equal depth, each pixel from
//! exactly one.

use super::transform_3d::{group_at, in_perspective, sized_scene, transparent_renderer};
use super::*;
use crate::bounds::PixelBounds;
use crate::plane::plane_bands;
use celesta_composition::{Matrix3, invert3, project};

/// The crawl's group: at `(960, 900)`, turned back 70 degrees under a
/// perspective of 800, so local `y` 276 is its near edge near the bottom of
/// a 1920x1080 scene.
fn crawl(layers: Vec<Layer>) -> Layer {
    in_perspective(group_at(960.0, 900.0, layers), 70.0, 0.0, 800.0)
}

/// Where the crawl's group maps scene pixels back to, in its local units.
fn crawl_inverse() -> Matrix3 {
    invert3(&crawl(Vec::new()).transform.homography()).unwrap()
}

/// The pixels whose 5x5 neighbourhood lies wholly inside the local box
/// `[left, top, right, bottom]` drawn through the inverse map `inverse`.
fn inside(
    frame: &GpuFrame,
    inverse: &Matrix3,
    [left, top, right, bottom]: [f64; 4],
) -> Vec<(u32, u32)> {
    let covered = |x: i64, y: i64| {
        let [lx, ly, w] = project(inverse, x as f64 + 0.5, y as f64 + 0.5);
        w > 0.0 && (left..=right).contains(&lx) && (top..=bottom).contains(&ly)
    };
    (2..frame.height() - 2)
        .flat_map(|y| (2..frame.width() - 2).map(move |x| (x, y)))
        .filter(|&(x, y)| {
            (-2..=2).all(|dy| (-2..=2).all(|dx| covered(i64::from(x) + dx, i64::from(y) + dy)))
        })
        .collect()
}

/// Asserts every channel of `pixels` in `frame` is within 1 of its median.
fn assert_flat(frame: &GpuFrame, pixels: &[(u32, u32)]) {
    assert!(pixels.len() > 10_000, "{} pixels", pixels.len());
    for channel in 0..4 {
        let mut values = pixels
            .iter()
            .map(|&(x, y)| pixel_at(frame, x, y)[channel])
            .collect::<Vec<_>>();
        values.sort_unstable();
        let median = values[values.len() / 2];
        for &(x, y) in pixels {
            let value = pixel_at(frame, x, y)[channel];
            assert!(
                value.abs_diff(median) <= 1,
                "channel {channel} at ({x}, {y}) is {value}, the median {median}"
            );
        }
    }
}

const LONG: [f64; 4] = [-600.0, -19724.0, 600.0, 276.0];

fn long_rect(color: &str) -> Layer {
    let [left, top, right, bottom] = LONG;
    corner_rect("long", left, top, right - left, bottom - top, color)
}

#[test]
fn a_long_plane_has_no_seams() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let mut plane = crawl(vec![long_rect("#FFFFFF80")]);
    plane.opacity = 0.5;
    let frame = renderer
        .render(&sized_scene(1920, 1080, vec![plane]))
        .unwrap();
    assert_flat(&frame, &inside(&frame, &crawl_inverse(), LONG));
}

#[test]
fn a_long_multiplied_plane_has_no_seams() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let background = corner_rect("background", 0.0, 0.0, 1920.0, 1080.0, "#808080FF");
    let mut plane = crawl(vec![long_rect("#C04020C0")]);
    plane.blend_mode = BlendMode::Multiply;
    let frame = renderer
        .render(&sized_scene(1920, 1080, vec![background, plane]))
        .unwrap();
    assert_flat(&frame, &inside(&frame, &crawl_inverse(), LONG));
}

#[test]
fn bands_partition_a_diagonal_plane_exactly() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    renderer.plane_area_limit = 1;
    let local = [-3000.0, -3000.0, 3000.0, 3000.0];
    let rect = corner_rect("square", -3000.0, -3000.0, 6000.0, 6000.0, "#2080FF80");
    let plane = in_perspective(group_at(960.0, 700.0, vec![rect]), 60.0, 35.0, 800.0);
    let inverse = invert3(&plane.transform.homography()).unwrap();
    let frame = renderer
        .render(&sized_scene(1920, 1080, vec![plane]))
        .unwrap();
    assert_flat(&frame, &inside(&frame, &inverse, local));
}

#[test]
fn bands_partition_inside_an_offset_group_canvas() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    // Lands right of x 300 and below y 200, so the screened group's canvas
    // does not start at the scene's origin.
    let plane = in_perspective(
        group_at(1300.0, 900.0, vec![long_rect("#FFFFFF80")]),
        70.0,
        0.0,
        800.0,
    );
    let inverse = invert3(&plane.transform.homography()).unwrap();
    let mut screened = group_at(0.0, 0.0, vec![plane]);
    screened.blend_mode = BlendMode::Screen;
    let frame = renderer
        .render(&sized_scene(1920, 1080, vec![screened]))
        .unwrap();
    assert_flat(&frame, &inside(&frame, &inverse, LONG));
}

#[test]
fn a_blur_across_a_seam_matches_one_canvas() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let (width, height) = (640, 360);
    let group = |layers| in_perspective(group_at(320.0, 300.0, layers), 70.0, 0.0, 800.0);
    let forward = group(Vec::new()).transform.homography();
    let local = PixelBounds([-2000.0, -6000.0, 2000.0, 200.0]);
    let screen = PixelBounds([0.0, 0.0, width as f32, height as f32]);
    let bands = plane_bands(&forward, local, screen, 16384, 640 * 360, 0.0, true);
    assert!(bands.len() > 2, "{bands:?}");
    // The local y of the nearest band's far boundary: w = 1 - y sin / d.
    let boundary = bands[0].far.unwrap();
    let y = (1.0 - boundary) * 800.0 / 70f64.to_radians().sin();
    let scene = || {
        let [left, top, right, bottom] = local.0.map(f64::from);
        let floor = corner_rect("floor", left, top, right - left, bottom - top, "#3060C0FF");
        let mut glow = corner_rect("glow", -100.0, y - 100.0, 200.0, 200.0, "#FFFFFFFF");
        glow.effects.blur = 12.0;
        sized_scene(width, height, vec![group(vec![floor, glow])])
    };
    renderer.plane_area_limit = 1;
    let banded = renderer.render(&scene()).unwrap();
    renderer.plane_area_limit = 1000;
    let single = renderer.render(&scene()).unwrap();
    let difference = (height / 2..height)
        .flat_map(|y| (0..width).map(move |x| (x, y)))
        .flat_map(|(x, y)| {
            let (a, b) = (pixel_at(&banded, x, y), pixel_at(&single, x, y));
            (0..4).map(move |channel| a[channel].abs_diff(b[channel]))
        })
        .max()
        .unwrap();
    assert!(difference <= 6, "{difference}");
}

#[test]
fn hits_through_the_near_and_far_bands() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    renderer.set_record_hit_regions(true);
    renderer
        .render(&sized_scene(
            1920,
            1080,
            vec![crawl(vec![long_rect("#FFFFFFFF")])],
        ))
        .unwrap();
    let regions = renderer.hit_regions();
    assert_eq!(
        regions
            .iter()
            .filter(|region| region.layer_id == "long")
            .count(),
        1,
        "{regions:?}"
    );
    let forward = crawl(Vec::new()).transform.homography();
    for local_y in [250.0, -15000.0] {
        let [x, y, _] = project(&forward, 0.0, local_y);
        assert_eq!(hit_test(regions, Point { x, y }), Some("long"), "{local_y}");
    }
}

/// Ten lines of capital letters, 1200 wide, white.
fn paragraph(id: &str, y: f64) -> Layer {
    let mut layer = text_layer(id, Point { x: -600.0, y }, 1.0, 40.0);
    if let LayerContent::Text {
        text, max_width, ..
    } = &mut layer.content
    {
        *text = vec!["HELIOS CRAWL HHHH IIII MMMM"; 10].join("\n");
        *max_width = Some(1200.0);
    }
    layer
}

/// The mean step in alpha between horizontal neighbours over the rows just
/// above the crawl's near edge and the middle 800 columns.
fn near_sharpness(frame: &GpuFrame) -> f64 {
    let steps = (965..1020)
        .flat_map(|y| (560..1360).map(move |x| (x, y)))
        .map(|(x, y)| f64::from(pixel_at(frame, x, y)[3].abs_diff(pixel_at(frame, x - 1, y)[3])))
        .collect::<Vec<_>>();
    steps.iter().sum::<f64>() / steps.len() as f64
}

#[test]
fn a_crawl_of_many_text_layers_is_sharp_near_its_edge() {
    let Some(mut renderer) = transparent_renderer() else {
        return;
    };
    let paragraphs = |count: usize| {
        (0..count)
            .map(|index| paragraph(&format!("p{index}"), -224.0 - 500.0 * index as f64))
            .collect::<Vec<_>>()
    };
    let long = renderer
        .render(&sized_scene(1920, 1080, vec![crawl(paragraphs(40))]))
        .unwrap();
    let short = renderer
        .render(&sized_scene(1920, 1080, vec![crawl(paragraphs(2))]))
        .unwrap();
    let (long, short) = (near_sharpness(&long), near_sharpness(&short));
    assert!(short > 5.0, "the short plane's text is sharp: {short}");
    assert!(long >= 0.9 * short, "long {long} vs short {short}");
}
