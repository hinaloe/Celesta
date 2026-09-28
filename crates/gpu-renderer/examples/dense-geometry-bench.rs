//! Times the GPU renderer on dense animated geometry: the projected ribbons
//! of `examples/afterimage/film.tsx`, thousands of thin rotated rects whose
//! length, thickness, position, rotation, and opacity change every frame,
//! plus a full-frame wipe that changes size every frame. Frames go through
//! the same pipelined `submit`/`drain` readback an export uses. Run as:
//!
//! ```text
//! cargo run --release -p celesta-gpu-renderer --example dense-geometry-bench -- [frames] [ribbons] [strands]
//! ```
//!
//! The defaults (120 frames, 3 ribbons of 9 strands: 3,024 rects) match the
//! film's densest section.

use std::env;
use std::f64::consts::PI;
use std::time::{Duration, Instant};

use celesta_composition::{
    EvaluatedTransform, Layer, LayerContent, Paint, Point, Rational, Scene, Time,
};
use celesta_gpu_renderer::{GpuRenderOptions, GpuRenderer};

const WIDTH: u32 = 1920;
const HEIGHT: u32 = 1080;
const SEGMENTS: usize = 112;

fn main() {
    let mut args = env::args().skip(1);
    let mut next = |default: usize| {
        args.next().map_or(default, |value| {
            value.parse().expect("arguments are numbers")
        })
    };
    let frames = next(120);
    let ribbons = next(3);
    let strands = next(9);

    let mut renderer = GpuRenderer::new(GpuRenderOptions::default()).expect("gpu renderer");
    println!(
        "gpu: {} ({:?})",
        renderer.adapter_info().name,
        renderer.adapter_info().backend
    );

    let started = Instant::now();
    let mut building = Duration::ZERO;
    let mut rendered = 0;
    let mut layers = 0;
    for frame in 0..frames {
        let build_started = Instant::now();
        let scene = scene(frame, ribbons, strands);
        building += build_started.elapsed();
        layers = layers.max(count_layers(&scene.layers));
        rendered += usize::from(renderer.submit(&scene).expect("frame renders").is_some());
    }
    rendered += renderer.drain().expect("frames drain").len();
    let elapsed = started.elapsed();
    assert_eq!(rendered, frames);

    let per_frame = elapsed.as_secs_f64() * 1000.0 / frames as f64;
    println!(
        "{frames} frames of {WIDTH}x{HEIGHT}, up to {layers} layers: {elapsed:.2?} \
         ({per_frame:.2} ms/frame, {:.1} fps; building scenes {:.2} ms/frame)",
        frames as f64 / elapsed.as_secs_f64(),
        building.as_secs_f64() * 1000.0 / frames as f64,
    );
}

fn count_layers(layers: &[Layer]) -> usize {
    layers
        .iter()
        .map(|layer| match &layer.content {
            LayerContent::Group { layers } => 1 + count_layers(layers),
            _ => 1,
        })
        .sum()
}

fn scene(frame: usize, ribbons: usize, strands: usize) -> Scene {
    let time = frame as f64 / 30.0;
    let mut layers = vec![rect(
        "background",
        Point { x: 0.0, y: 0.0 },
        0.0,
        f64::from(WIDTH),
        f64::from(HEIGHT),
        "#EAE5D9",
        1.0,
    )];
    for index in 0..ribbons {
        let offset = index as f64 - (ribbons as f64 - 1.0) / 2.0;
        layers.push(Layer {
            id: format!("ribbon-{index}"),
            transform: EvaluatedTransform::default(),
            opacity: 1.0,
            content: LayerContent::Group {
                layers: ribbon(
                    time - index as f64 * 0.35,
                    960.0 + offset * 400.0,
                    510.0,
                    310.0,
                    strands,
                ),
            },
        });
    }
    // A wipe whose width changes every frame, as in the film's intro.
    let wipe = (frame % 45) as f64 / 45.0;
    layers.push(rect(
        "wipe",
        Point { x: 0.0, y: 0.0 },
        0.0,
        f64::from(WIDTH / 2) * (1.0 - wipe),
        f64::from(HEIGHT),
        "#171716",
        1.0,
    ));
    Scene {
        width: WIDTH,
        height: HEIGHT,
        frame_rate: Rational::new(30, 1),
        time: Time::ZERO,
        fonts: Vec::new(),
        layers,
    }
}

/// The half-twist ribbon of `examples/afterimage/film.tsx`.
fn ribbon(time: f64, x: f64, y: f64, size: f64, strands: usize) -> Vec<Layer> {
    let yaw = time * 0.23;
    let pitch = 0.85 + (time * 0.19).sin() * 0.35;
    let project = |u: f64, v: f64| {
        let radius = 1.0 + v * (u / 2.0).cos();
        let (px, py, pz) = (radius * u.cos(), radius * u.sin(), v * (u / 2.0).sin());
        let xx = px * yaw.cos() + pz * yaw.sin();
        let zz = -px * yaw.sin() + pz * yaw.cos();
        let yy = py * pitch.cos() - zz * pitch.sin();
        let depth = py * pitch.sin() + zz * pitch.cos();
        let perspective = 3.6 / (3.6 - depth);
        (
            x + size * xx * perspective,
            y + size * yy * perspective,
            depth,
        )
    };
    let mut segments = Vec::with_capacity(strands * SEGMENTS);
    for strand in 0..strands {
        let v = 0.035 + strand as f64 / (strands as f64 - 1.0).max(1.0) * 0.47;
        for index in 0..SEGMENTS {
            let a = project(index as f64 / SEGMENTS as f64 * PI * 4.0, v);
            let b = project((index + 1) as f64 / SEGMENTS as f64 * PI * 4.0, v);
            segments.push((a, b, (a.2 + b.2) / 2.0));
        }
    }
    segments.sort_by(|left, right| left.2.total_cmp(&right.2));
    segments
        .into_iter()
        .enumerate()
        .map(|(index, (a, b, depth))| {
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let mut line = rect(
                &format!("segment-{index}"),
                Point { x: a.0, y: a.1 },
                dy.atan2(dx).to_degrees(),
                dx.hypot(dy) + 0.7,
                1.5 + ((depth + 1.0) / 2.0).clamp(0.0, 1.0) * 0.8,
                "#EF402B",
                0.25 + ((depth + 1.4) / 2.8).clamp(0.0, 1.0) * 0.75,
            );
            line.transform.anchor.y = 0.5;
            line
        })
        .collect()
}

fn rect(
    id: &str,
    position: Point,
    rotation: f64,
    width: f64,
    height: f64,
    color: &str,
    opacity: f64,
) -> Layer {
    Layer {
        id: id.to_owned(),
        transform: EvaluatedTransform {
            position,
            rotation,
            anchor: Point { x: 0.0, y: 0.0 },
            ..EvaluatedTransform::default()
        },
        opacity,
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
