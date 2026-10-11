use crate::compositor::begin_pass;
use crate::texture::CanvasTexture;
use std::collections::HashMap;

/// The pass that quantizes a frame composited in `canvas_format` to 8-bit
/// code values, with a dither (`quantize.wgsl`), onto a target of any 8-bit
/// format.
pub(crate) struct Quantizer {
    layout: wgpu::PipelineLayout,
    shader: wgpu::ShaderModule,
    pipelines: HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>,
}

impl Quantizer {
    /// Reads the frame through `texture_layout` (`layer.wgsl`'s), so a
    /// canvas's own bind group serves it.
    pub(crate) fn new(device: &wgpu::Device, texture_layout: &wgpu::BindGroupLayout) -> Self {
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Celesta quantize pipeline layout"),
            bind_group_layouts: &[Some(texture_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Celesta quantize shader"),
            source: wgpu::ShaderSource::Wgsl(
                concat!(include_str!("dither.wgsl"), include_str!("quantize.wgsl")).into(),
            ),
        });
        let mut quantizer = Self {
            layout,
            shader,
            pipelines: HashMap::new(),
        };
        quantizer.ensure_pipeline(device, wgpu::TextureFormat::Rgba8Unorm);
        quantizer
    }

    pub(crate) fn ensure_pipeline(&mut self, device: &wgpu::Device, format: wgpu::TextureFormat) {
        self.pipelines.entry(format).or_insert_with(|| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Celesta quantize pipeline"),
                layout: Some(&self.layout),
                vertex: wgpu::VertexState {
                    module: &self.shader,
                    entry_point: Some("vertex"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &self.shader,
                    entry_point: Some("fragment"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            })
        });
    }

    /// Quantizes `frame` onto `target`, a texture of the same size whose
    /// `format` has a pipeline (`ensure_pipeline`).
    pub(crate) fn encode(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        frame: &CanvasTexture,
        target: &wgpu::TextureView,
        format: wgpu::TextureFormat,
    ) {
        let mut pass = begin_pass(encoder, target, wgpu::LoadOp::Clear(wgpu::Color::BLACK));
        pass.set_pipeline(&self.pipelines[&format]);
        pass.set_bind_group(0, &frame.bind_group, &[]);
        pass.draw(0..3, 0..1);
    }
}
