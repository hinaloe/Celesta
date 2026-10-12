//! Reading frames back: a composited frame is quantized or converted
//! straight from the root canvas it finishes on, and must read back as the
//! same pixels drawn without compositing.

use super::*;

/// Columns of `colors`, two pixels wide each, on a 16x4 scene; with
/// `screen`, each column screens onto the black background, which leaves
/// its color as it is but composites the frame through the root canvas.
fn columns(colors: &[&str], screen: bool) -> Scene {
    let mut scene = empty_scene(16, 4);
    for (index, color) in colors.iter().enumerate() {
        let mut layer = solid_rect(
            &format!("column-{index}"),
            index as f64 * 2.0 + 1.0,
            2.0,
            4.0,
            color,
        );
        if screen {
            layer.blend_mode = BlendMode::Screen;
        }
        scene.layers.push(layer);
    }
    scene
}

#[test]
fn reads_composited_frames_back_like_directly_drawn_ones() {
    let Some(mut renderer) = renderer(GpuRenderOptions {
        background: Color::rgba(0, 0, 0, 255),
        ..GpuRenderOptions::default()
    }) else {
        return;
    };
    let first = ["#ff0000", "#33aa66", "#0000ff", "#ffffff", "#808080"];
    let second = ["#123456", "#fedcba", "#00ff00", "#000000", "#c0ffee"];

    let plain = renderer.render(&columns(&first, false)).unwrap();
    let screened = renderer.render(&columns(&first, true)).unwrap();
    assert_eq!(screened.pixels(), plain.pixels(), "render");

    for format in [
        ReadbackFormat::Rgba8,
        ReadbackFormat::Rgba16,
        ReadbackFormat::Yuv420p,
        ReadbackFormat::Yuv420p10,
    ] {
        if format.is_yuv() && !renderer.supports_yuv420p_readback() {
            eprintln!("skipping {format:?}: the GPU cannot convert to yuv420p");
            continue;
        }
        renderer.set_readback_format(format).unwrap();
        // In flight together, so each composited frame must have been read
        // from the root canvas before the next one drew onto it.
        let mut frames = Vec::new();
        for scene in [
            columns(&first, false),
            columns(&first, true),
            columns(&second, true),
            columns(&second, false),
        ] {
            frames.extend(renderer.submit(&scene).unwrap());
        }
        frames.extend(renderer.drain().unwrap());
        assert_eq!(frames.len(), 4);
        assert!(frames.iter().all(|frame| frame.format() == format));
        assert_eq!(frames[1].pixels(), frames[0].pixels(), "{format:?} first");
        assert_eq!(frames[2].pixels(), frames[3].pixels(), "{format:?} second");
        assert_ne!(frames[0].pixels(), frames[3].pixels(), "{format:?}");
    }
}
