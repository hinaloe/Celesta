use crate::renderer::CpuRenderer;
use crate::types::RgbaFrame;
use celesta_composition::{
    BlendMode, Clip, EvaluatedTransform, GroupMask, Layer, LayerContent, MaskMode, Paint, Point,
    Rational, Scene, Time,
};

fn scene(layers: Vec<Layer>) -> Scene {
    Scene {
        width: 40,
        height: 40,
        frame_rate: Rational::new(30, 1),
        time: Time::ZERO,
        fonts: Vec::new(),
        layers,
        shaders: Vec::new(),
    }
}

/// A rect with its top-left corner at `(x, y)` in its parent.
fn rect(x: f64, y: f64, width: f64, height: f64, color: &str) -> Layer {
    Layer {
        id: format!("rect-{x}-{y}"),
        transform: EvaluatedTransform {
            position: Point { x, y },
            anchor: Point { x: 0.0, y: 0.0 },
            ..EvaluatedTransform::default()
        },
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        effects: Default::default(),
        content: LayerContent::Rect {
            width,
            height,
            fill: Some(Paint::Solid {
                color: color.to_owned(),
            }),
            stroke: None,
            corner_radius: 0.0,
        },
    }
}

fn group(layers: Vec<Layer>, motion_blur: bool) -> Layer {
    Layer {
        id: "group".to_owned(),
        transform: EvaluatedTransform {
            anchor: Point { x: 0.0, y: 0.0 },
            ..EvaluatedTransform::default()
        },
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        effects: Default::default(),
        content: LayerContent::Group {
            layers,
            clip: None,
            mask: None,
            motion_blur,
        },
    }
}

/// A motion-blurred group whose samples are `samples`.
fn blurred(samples: Vec<Layer>) -> Layer {
    group(samples, true)
}

fn render(layers: Vec<Layer>) -> RgbaFrame {
    CpuRenderer::default().render(&scene(layers)).unwrap()
}

fn pixel(frame: &RgbaFrame, x: u32, y: u32) -> [u8; 4] {
    let offset = ((y * frame.width() + x) * 4) as usize;
    frame.pixels()[offset..offset + 4].try_into().unwrap()
}

fn assert_close(actual: [u8; 4], expected: [u8; 4]) {
    let close = actual.iter().zip(expected).all(|(a, e)| a.abs_diff(e) <= 1);
    assert!(close, "{actual:?} is not within 1 of {expected:?}");
}

#[test]
fn a_sample_drawn_in_half_the_samples_shows_at_half_its_alpha() {
    let frame = render(vec![blurred(vec![
        rect(0.0, 0.0, 20.0, 40.0, "#FF0000FF"),
        rect(20.0, 0.0, 20.0, 40.0, "#FF0000FF"),
    ])]);
    let half = render(vec![Layer {
        opacity: 0.5,
        ..rect(0.0, 0.0, 40.0, 40.0, "#FF0000FF")
    }]);
    for x in [5, 30] {
        assert_eq!(pixel(&frame, x, 20), pixel(&half, x, 20), "x = {x}");
    }
}

#[test]
fn what_every_sample_draws_is_drawn_as_it_is() {
    let frame = render(vec![blurred(vec![
        rect(0.0, 0.0, 30.0, 40.0, "#FF0000FF"),
        rect(10.0, 0.0, 30.0, 40.0, "#FF0000FF"),
    ])]);
    assert_eq!(pixel(&frame, 20, 20), [255, 0, 0, 255]);
}

#[test]
fn samples_average_their_colors() {
    let frame = render(vec![blurred(vec![
        rect(0.0, 0.0, 40.0, 40.0, "#FF0000FF"),
        rect(0.0, 0.0, 40.0, 40.0, "#0000FFFF"),
    ])]);
    assert_close(pixel(&frame, 20, 20), [128, 0, 128, 255]);
}

#[test]
fn samples_average_premultiplied_colors() {
    // Half-transparent white and opaque black: premultiplied, the mean is
    // a quarter white at three quarters alpha, a third gray once straight.
    // Averaging the straight colors would give mid-gray instead.
    let frame = render(vec![blurred(vec![
        rect(0.0, 0.0, 40.0, 40.0, "#FFFFFF80"),
        rect(0.0, 0.0, 40.0, 40.0, "#000000FF"),
    ])]);
    let expected = render(vec![rect(0.0, 0.0, 40.0, 40.0, "#555555C0")]);
    assert_close(pixel(&frame, 20, 20), pixel(&expected, 20, 20));
}

#[test]
fn the_average_goes_through_the_groups_opacity_as_one_layer() {
    let mut layer = blurred(vec![
        rect(0.0, 0.0, 40.0, 40.0, "#FF0000FF"),
        rect(0.0, 0.0, 40.0, 40.0, "#FF0000FF"),
    ]);
    layer.opacity = 0.5;
    let frame = render(vec![layer]);
    let expected = render(vec![Layer {
        opacity: 0.5,
        ..rect(0.0, 0.0, 40.0, 40.0, "#FF0000FF")
    }]);
    assert_eq!(pixel(&frame, 20, 20), pixel(&expected, 20, 20));
}

#[test]
fn a_clip_limits_every_sample() {
    let mut layer = blurred(vec![
        rect(0.0, 0.0, 40.0, 40.0, "#FF0000FF"),
        rect(0.0, 0.0, 40.0, 40.0, "#FF0000FF"),
    ]);
    let LayerContent::Group { clip, .. } = &mut layer.content else {
        unreachable!();
    };
    *clip = Some(Clip {
        x: 0.0,
        y: 0.0,
        width: 20.0,
        height: 40.0,
        corner_radius: 0.0,
    });
    let frame = render(vec![layer]);
    let background = render(vec![]);
    assert_eq!(pixel(&frame, 10, 20), [255, 0, 0, 255]);
    assert_eq!(pixel(&frame, 30, 20), pixel(&background, 30, 20));
}

#[test]
fn a_mask_shows_the_average() {
    let mut layer = blurred(vec![
        rect(0.0, 0.0, 20.0, 40.0, "#FF0000FF"),
        rect(20.0, 0.0, 20.0, 40.0, "#FF0000FF"),
    ]);
    let LayerContent::Group { mask, .. } = &mut layer.content else {
        unreachable!();
    };
    *mask = Some(GroupMask {
        layers: vec![rect(0.0, 0.0, 40.0, 20.0, "#FFFFFFFF")],
        mode: MaskMode::Alpha,
        invert: false,
    });
    let frame = render(vec![layer]);
    let half = render(vec![Layer {
        opacity: 0.5,
        ..rect(0.0, 0.0, 40.0, 40.0, "#FF0000FF")
    }]);
    let background = render(vec![]);
    assert_eq!(pixel(&frame, 5, 10), pixel(&half, 5, 10));
    assert_eq!(pixel(&frame, 30, 10), pixel(&half, 30, 10));
    assert_eq!(pixel(&frame, 5, 30), pixel(&background, 5, 30));
}

#[test]
fn a_group_without_motion_blur_draws_its_children_over_each_other() {
    let frame = render(vec![group(
        vec![
            rect(0.0, 0.0, 40.0, 40.0, "#FF0000FF"),
            rect(0.0, 0.0, 40.0, 40.0, "#0000FFFF"),
        ],
        false,
    )]);
    assert_eq!(pixel(&frame, 20, 20), [0, 0, 255, 255]);
}
