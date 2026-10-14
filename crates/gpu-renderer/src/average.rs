use crate::compositor::begin_pass;
use crate::texture::CanvasTexture;

/// The pass that adds one sample of a motion-blurred group onto the group's
/// canvas, weighted by the pipeline's blend constant, so that after every
/// sample the canvas holds their average.
pub(crate) struct AveragePipeline {
    pipeline: wgpu::RenderPipeline,
}

impl AveragePipeline {
    /// Reads the sample canvas through `texture_layout` (`layer.wgsl`'s), so
    /// a canvas's own bind group serves it.
    pub(crate) fn new(
        device: &wgpu::Device,
        texture_layout: &wgpu::BindGroupLayout,
        format: wgpu::TextureFormat,
    ) -> Self {
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Celesta average pipeline layout"),
            bind_group_layouts: &[Some(texture_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::include_wgsl!("average.wgsl"));
        // `sample * weight + canvas`, on every channel, alpha included.
        let add = wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::Constant,
            dst_factor: wgpu::BlendFactor::One,
            operation: wgpu::BlendOperation::Add,
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Celesta average pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vertex"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fragment"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState {
                        color: add,
                        alpha: add,
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        Self { pipeline }
    }

    /// Adds `sample` times `weight` onto `target`, clearing `target` first
    /// when `first`. Both cover the same region, so the pass covers the
    /// whole target.
    pub(crate) fn add(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        sample: &CanvasTexture,
        target: &CanvasTexture,
        weight: f64,
        first: bool,
    ) {
        let load = if first {
            wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT)
        } else {
            wgpu::LoadOp::Load
        };
        let mut pass = begin_pass(encoder, &target.view, load);
        pass.set_pipeline(&self.pipeline);
        pass.set_blend_constant(wgpu::Color {
            r: weight,
            g: weight,
            b: weight,
            a: weight,
        });
        pass.set_bind_group(0, &sample.bind_group, &[]);
        pass.draw(0..3, 0..1);
    }
}
