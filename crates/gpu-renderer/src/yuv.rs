use crate::error::GpuRenderError;
use crate::readback::{ReadbackLayout, YuvPlane, YuvReadback};

/// The render pipelines behind [`ReadbackFormat::Yuv420p`] and
/// [`ReadbackFormat::Yuv420p10`] (`yuv420p.wgsl`), one converter each.
pub(crate) struct YuvConverter {
    pub(crate) luma: wgpu::RenderPipeline,
    pub(crate) chroma: wgpu::RenderPipeline,
    pub(crate) bind_group_layout: wgpu::BindGroupLayout,
    /// `R8Unorm` planes for 8-bit codes, `R16Uint` for 10-bit ones.
    plane_format: wgpu::TextureFormat,
}

impl YuvConverter {
    /// A converter to 10-bit codes when `ten_bit` is set, else to 8-bit.
    pub(crate) fn new(device: &wgpu::Device, ten_bit: bool) -> Self {
        let (plane_format, luma, chroma) = if ten_bit {
            (wgpu::TextureFormat::R16Uint, "luma10", "chroma10")
        } else {
            (wgpu::TextureFormat::R8Unorm, "luma", "chroma")
        };
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Celesta yuv420p bind group layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Celesta yuv420p pipeline layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Celesta yuv420p shader"),
            source: wgpu::ShaderSource::Wgsl(
                concat!(include_str!("dither.wgsl"), include_str!("yuv420p.wgsl")).into(),
            ),
        });
        let target = Some(wgpu::ColorTargetState {
            format: plane_format,
            blend: None,
            write_mask: wgpu::ColorWrites::ALL,
        });
        let pipeline = |label, entry_point, targets: &[Option<wgpu::ColorTargetState>]| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
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
                    entry_point: Some(entry_point),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets,
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        Self {
            luma: pipeline("Celesta yuv420p luma", luma, std::slice::from_ref(&target)),
            chroma: pipeline("Celesta yuv420p chroma", chroma, &[target.clone(), target]),
            bind_group_layout,
            plane_format,
        }
    }

    /// The plane textures and bind group converting one `width`x`height`
    /// slot whose frame, composited in `canvas_format`, is `frame`.
    pub(crate) fn readback(
        &self,
        device: &wgpu::Device,
        frame: &wgpu::TextureView,
        width: u32,
        height: u32,
    ) -> Result<YuvReadback, GpuRenderError> {
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Celesta yuv420p bind group"),
            layout: &self.bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(frame),
            }],
        });
        let mut offset = 0;
        let mut plane = |label, width: u32, height: u32| -> Result<YuvPlane, GpuRenderError> {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: self.plane_format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            let bytes_per_sample = self.plane_format.block_copy_size(None).unwrap_or(1);
            let layout = ReadbackLayout::with_bytes_per_pixel(width, height, bytes_per_sample)?;
            // Each plane's size is a whole number of aligned rows, so every
            // plane starts at an offset the copy accepts.
            let plane_offset = offset;
            offset += layout.buffer_size;
            Ok(YuvPlane {
                texture,
                view,
                height,
                layout,
                offset: plane_offset,
            })
        };
        let planes = [
            plane("Celesta yuv420p Y plane", width, height)?,
            plane("Celesta yuv420p U plane", width / 2, height / 2)?,
            plane("Celesta yuv420p V plane", width / 2, height / 2)?,
        ];
        Ok(YuvReadback { bind_group, planes })
    }

    /// Renders the slot's frame into its Y, U, and V planes.
    pub(crate) fn encode(&self, encoder: &mut wgpu::CommandEncoder, yuv: &YuvReadback) {
        fn attachment(plane: &YuvPlane) -> Option<wgpu::RenderPassColorAttachment<'_>> {
            Some(wgpu::RenderPassColorAttachment {
                view: &plane.view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })
        }
        let [luma, u, v] = &yuv.planes;
        for (label, pipeline, targets) in [
            (
                "Celesta yuv420p luma pass",
                &self.luma,
                vec![attachment(luma)],
            ),
            (
                "Celesta yuv420p chroma pass",
                &self.chroma,
                vec![attachment(u), attachment(v)],
            ),
        ] {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(label),
                color_attachments: &targets,
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, &yuv.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
    }
}
