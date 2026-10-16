use crate::compositor::{Compositor, begin_pass};
use crate::effect::PASSES_PER_FILTER;
use crate::error::GpuRenderError;
use crate::pipeline::{PipelineKind, create_pipeline};
use crate::plan::{GpuStep, PreparedDraws, backdrop_size};
use crate::quantize::QuantizeOutput;
use crate::renderer::GpuRenderer;
use crate::texture::{CanvasTexture, canvas_texture};
use crate::types::{GpuRenderTarget, PreviewViewport};
use celesta_composition::Scene;

impl GpuRenderer {
    /// Draws `scene` onto `target` as `encode_draws` does, but onto a canvas
    /// of `canvas_format` first, which `quantizer` then rounds onto `target`
    /// with its dither, as `submit` does for an export. A target the size of
    /// the scene is rounded from the canvas `encode_scene` finishes on.
    pub(crate) fn encode_frame(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        scene: &Scene,
        target: GpuRenderTarget<'_>,
        draws: &PreparedDraws,
    ) -> Result<(), GpuRenderError> {
        let size = wgpu::Extent3d {
            width: target.width,
            height: target.height,
            depth_or_array_layers: 1,
        };
        if self
            .target_canvas
            .as_ref()
            .is_none_or(|canvas| canvas.texture.size() != size)
        {
            self.target_canvas = Some(canvas_texture(
                &self.device,
                &self.texture_bind_group_layout,
                self.canvas_format,
                target.width,
                target.height,
            ));
        }
        let canvas = self.target_canvas.clone().expect("created above");
        let frame = if (target.width, target.height) == (scene.width, scene.height) {
            self.encode_scene(encoder, scene, draws, &canvas)?
        } else {
            self.encode_draws(
                encoder,
                scene,
                GpuRenderTarget {
                    view: &canvas.view,
                    format: self.canvas_format,
                    width: target.width,
                    height: target.height,
                },
                draws,
            )?;
            canvas
        };
        self.quantizer
            .ensure_pipeline(&self.device, target.format, QuantizeOutput::Premultiplied);
        self.quantizer.encode(
            encoder,
            &frame,
            target.view,
            target.format,
            QuantizeOutput::Premultiplied,
        );
        Ok(())
    }

    /// Draws `scene` at its own size and returns the canvas the frame
    /// finishes on, for a pass that reads it texel for texel (quantizing or
    /// converting it to YUV): the root canvas for a composited frame, which
    /// spares copying it onto `canvas` first, else `canvas` itself, a
    /// scene-sized canvas of `canvas_format` the layers draw onto.
    pub(crate) fn encode_scene(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        scene: &Scene,
        draws: &PreparedDraws,
        canvas: &CanvasTexture,
    ) -> Result<CanvasTexture, GpuRenderError> {
        if draws.composite.is_some() {
            self.encode_composited(encoder, scene, draws);
            return Ok(self.canvas.clone().expect("encode_composited creates it"));
        }
        self.encode_draws(
            encoder,
            scene,
            GpuRenderTarget {
                view: &canvas.view,
                format: self.canvas_format,
                width: scene.width,
                height: scene.height,
            },
            draws,
        )?;
        Ok(canvas.clone())
    }

    pub(crate) fn encode_draws(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        scene: &Scene,
        target: GpuRenderTarget<'_>,
        draws: &PreparedDraws,
    ) -> Result<(), GpuRenderError> {
        let viewport =
            PreviewViewport::fit(scene.width, scene.height, target.width, target.height)?;
        let background = self.options.background.as_wgpu();
        if draws.composite.is_some() {
            self.encode_composited(encoder, scene, draws);
        }
        let kind = if draws.composite.is_some() {
            PipelineKind::Blit
        } else {
            PipelineKind::Layer
        };
        self.ensure_pipeline(target.format, kind);
        let pipeline = &self.pipelines[&(target.format, kind)];
        let mut pass = begin_pass(encoder, target.view, wgpu::LoadOp::Clear(background));
        pass.set_viewport(
            viewport.x,
            viewport.y,
            viewport.width,
            viewport.height,
            0.0,
            1.0,
        );
        pass.set_pipeline(pipeline);
        pass.set_vertex_buffer(0, draws.instances.slice(..));
        pass.set_bind_group(2, &draws.clips, &[]);
        if let Some(plan) = &draws.composite {
            let canvas = self.canvas.as_ref().expect("encode_composited creates it");
            pass.set_bind_group(0, &canvas.bind_group, &[]);
            pass.draw(0..6, plan.blit_instance..plan.blit_instance + 1);
            return Ok(());
        }
        for step in &draws.steps {
            let GpuStep::Draw(draw) = step else {
                unreachable!("a frame with blend steps is composited");
            };
            pass.set_bind_group(0, &draw.texture.bind_group, &[]);
            pass.draw(draw.vertices.clone(), draw.instances.clone());
        }
        Ok(())
    }

    /// Draws a frame that uses blend modes, isolated groups, effects or masks
    /// onto the scene-sized root canvas (each group through a canvas of its
    /// own), leaving the result in `self.canvas` for `encode_draws` to copy
    /// onto the target. Canvases hold premultiplied alpha, which is what
    /// source-over blending onto a cleared texture produces.
    pub(crate) fn encode_composited(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        scene: &Scene,
        draws: &PreparedDraws,
    ) {
        let format = self.canvas_format;
        let backdrop = backdrop_size(
            &draws.steps,
            (scene.width, scene.height),
            self.max_texture_dimension,
        );
        self.prepare_canvases(scene.width, scene.height, backdrop);
        self.ensure_pipeline(format, PipelineKind::Layer);
        self.ensure_pipeline(format, PipelineKind::Blend);
        // Each effect filters its shadow, glow and blur through at most
        // `PASSES_PER_FILTER` passes each.
        let effects = draws
            .steps
            .iter()
            .filter(|step| matches!(step, GpuStep::EndEffect { .. }))
            .count();
        self.effects
            .begin_frame(&self.device, effects * 3 * PASSES_PER_FILTER);
        self.shaders.begin_frame(&self.device);
        let root = self.canvas.clone().expect("prepare_canvases creates it");
        let mut compositor = Compositor {
            device: &self.device,
            texture_layout: &self.texture_bind_group_layout,
            layer_pipeline: &self.pipelines[&(format, PipelineKind::Layer)],
            blend_pipeline: &self.pipelines[&(format, PipelineKind::Blend)],
            backdrop: self.backdrop.as_ref().expect("prepare_canvases creates it"),
            draws,
            effects: &mut self.effects,
            shaders: &mut self.shaders,
            masks: &self.masks,
            averages: &self.averages,
        };
        compositor.draw_canvas(
            encoder,
            &root,
            self.options.background.as_wgpu(),
            &draws.steps,
        );
        self.effects.end_frame(&self.queue);
        self.shaders.end_frame(&self.queue);
    }
}

impl GpuRenderer {
    pub(crate) fn ensure_pipeline(&mut self, format: wgpu::TextureFormat, kind: PipelineKind) {
        self.pipelines.entry((format, kind)).or_insert_with(|| {
            let layout = match kind {
                PipelineKind::Blend => &self.blend_pipeline_layout,
                PipelineKind::Layer | PipelineKind::Blit => &self.pipeline_layout,
            };
            create_pipeline(&self.device, layout, &self.shader, format, kind)
        });
    }
}
