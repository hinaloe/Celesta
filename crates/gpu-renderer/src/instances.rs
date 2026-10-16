//! `LayerContent::Instances`: many particles of one shape, written straight
//! into the frame's instance buffer and drawn with one instanced draw.

use crate::bounds::{CanvasRegion, PixelBounds};
use crate::layer::{
    AFFINE, InstanceBytes, InstanceFields, layer_instance, level_of_detail,
    pixel_aligned_translation,
};
use crate::texture::LayerTexture;
use crate::transform::{Affine, LayerState};
use celesta_composition::{BlendMode, F32Column, Point, U8Column, instance_size};

/// What every particle draws.
pub(crate) enum PreparedInstanceShape {
    /// A rect rounded by `corner_radius`, at most half its shorter side.
    Rect { corner_radius: f64 },
    /// A rect rounded by half its shorter side.
    Circle,
    /// The texture stretched over the particle and multiplied by its colour.
    Image(LayerTexture),
}

/// The columns of an `Instances` layer, shared with the scene, and the
/// values that stand in for absent ones.
pub(crate) struct InstanceColumns {
    pub(crate) x: F32Column,
    pub(crate) y: F32Column,
    pub(crate) widths: Option<F32Column>,
    pub(crate) heights: Option<F32Column>,
    pub(crate) rotation: Option<F32Column>,
    pub(crate) colors: Option<U8Column>,
    /// The size of every particle without its own.
    pub(crate) width: Option<f64>,
    pub(crate) height: Option<f64>,
    /// An image's own size, which fills in a size the layer does not give.
    pub(crate) natural: Option<(f64, f64)>,
    /// Straight RGBA in 0-255, for every particle without its own colour.
    pub(crate) color: [f32; 4],
}

impl InstanceColumns {
    /// Particle `i`'s size; see `celesta_composition::instance_size`.
    pub(crate) fn size(&self, i: usize) -> (f64, f64) {
        let width = self
            .widths
            .as_ref()
            .map_or(self.width, |widths| Some(f64::from(widths[i])));
        let height = self
            .heights
            .as_ref()
            .map_or(self.height, |heights| Some(f64::from(heights[i])));
        instance_size(width, height, self.natural)
    }
}

/// One particle, placed in the scene.
struct Particle {
    transform: Affine,
    width: f64,
    height: f64,
}

pub(crate) struct PreparedInstances {
    /// The layer's frame, opacity, and clip; every particle draws inside it.
    state: LayerState,
    shape: PreparedInstanceShape,
    count: u32,
    columns: InstanceColumns,
    /// The box of every particle's shape, in scene pixels.
    shape_box: PixelBounds,
    /// `shape_box` and the texel a filtered image's quad reaches past it.
    reach: PixelBounds,
}

const CENTRE: Point = Point { x: 0.5, y: 0.5 };

impl PreparedInstances {
    /// The particles of a layer drawn in `state`; `None` when none of them
    /// can draw anything.
    pub(crate) fn new(
        state: LayerState,
        shape: PreparedInstanceShape,
        count: u32,
        columns: InstanceColumns,
    ) -> Option<Self> {
        let mut instances = Self {
            state,
            shape,
            count,
            columns,
            shape_box: PixelBounds([0.0; 4]),
            reach: PixelBounds([0.0; 4]),
        };
        // A filtered image's quad reaches one texel past its edge.
        let margins = match &instances.shape {
            PreparedInstanceShape::Image(texture) => {
                [1.0 / texture.width as f32, 1.0 / texture.height as f32]
            }
            _ => [0.0; 2],
        };
        let (mut shape_box, mut reach) = (None, None);
        for i in 0..count as usize {
            if let Some(particle) = instances.particle(i) {
                shape_box = PixelBounds::union(shape_box, Some(particle.quad([0.0; 2])));
                reach = PixelBounds::union(reach, Some(particle.quad(margins)));
            }
        }
        instances.shape_box = shape_box?;
        instances.reach = reach?;
        Some(instances)
    }

    pub(crate) const fn count(&self) -> u32 {
        self.count
    }

    /// The texture every particle samples; `None` for shaded shapes.
    pub(crate) const fn texture(&self) -> Option<&LayerTexture> {
        match &self.shape {
            PreparedInstanceShape::Image(texture) => Some(texture),
            _ => None,
        }
    }

    /// Scene pixels the particles can touch, grown by two pixels as
    /// `PreparedLayer::bounds` grows a layer's (a rect's quad reaches one
    /// pixel past its edge, within that growth).
    pub(crate) fn bounds(&self) -> PixelBounds {
        self.reach.expand(2.0, 2.0)
    }

    /// The box of the particles' shapes in scene pixels.
    pub(crate) const fn shape(&self) -> PixelBounds {
        self.shape_box
    }

    /// Particle `i` placed as the `Rect` layer centred on it would be, or
    /// `None` when one of its values is not finite.
    fn particle(&self, i: usize) -> Option<Particle> {
        let columns = &self.columns;
        let x = f64::from(columns.x[i]);
        let y = f64::from(columns.y[i]);
        let (width, height) = columns.size(i);
        let rotation = columns
            .rotation
            .as_ref()
            .map_or(0.0, |rotation| f64::from(rotation[i]));
        if ![x, y, width, height, rotation]
            .iter()
            .all(|value| value.is_finite())
        {
            return None;
        }
        let own = Affine::turned(rotation, Point { x, y });
        Some(Particle {
            transform: self.state.transform.multiply(own),
            width,
            height,
        })
    }

    /// Particle `i`'s straight RGBA in 0-255.
    fn color(&self, i: usize) -> [f32; 4] {
        self.columns
            .colors
            .as_ref()
            .map_or(self.columns.color, |colors| {
                [
                    f32::from(colors[4 * i]),
                    f32::from(colors[4 * i + 1]),
                    f32::from(colors[4 * i + 2]),
                    f32::from(colors[4 * i + 3]),
                ]
            })
    }

    /// Appends one `LayerInstance` per particle, drawn onto the canvas
    /// covering `target`. A particle with a value that is not finite is
    /// written transparent and without area, so instance indices stay
    /// those of the particles.
    pub(crate) fn write_instances(&self, target: CanvasRegion, output: &mut InstanceBytes) {
        for i in 0..self.count as usize {
            let fields = match (self.particle(i), &self.shape) {
                (Some(particle), PreparedInstanceShape::Image(texture)) => {
                    self.image_fields(i, &particle, texture, target)
                }
                (Some(particle), _) => self.rect_fields(i, &particle, target),
                (None, _) => InstanceFields {
                    opacity: 0.0,
                    ..self.rect_fields(
                        i,
                        &Particle {
                            transform: self.state.transform,
                            width: 0.0,
                            height: 0.0,
                        },
                        target,
                    )
                },
            };
            output.push(&layer_instance(&fields));
        }
    }

    /// Particle `i` shaded as `RectShape` shades a rect layer.
    fn rect_fields(&self, i: usize, particle: &Particle, target: CanvasRegion) -> InstanceFields {
        let half_width = particle.width / 2.0;
        let half_height = particle.height / 2.0;
        let radius = match self.shape {
            PreparedInstanceShape::Rect { corner_radius } => corner_radius,
            _ => particle.width.min(particle.height) / 2.0,
        };
        let exact = particle.transform.is_uniform_scale(1.0);
        InstanceFields {
            transform: particle.transform,
            size: (particle.width as f32, particle.height as f32),
            anchor: [CENTRE.x as f32, CENTRE.y as f32],
            opacity: self.state.opacity,
            kind: 1.0,
            target,
            blend_mode: BlendMode::Normal,
            premultiplied: false,
            rect: [
                half_width as f32,
                half_height as f32,
                radius.max(0.0).min(half_width.min(half_height)) as f32,
                0.0,
            ],
            fill: self.color(i),
            stroke: [0.0; 4],
            clip: self.state.clip,
            exact,
            level_of_detail: level_of_detail(particle.transform, 1.0, exact),
            raster_scale: 1.0,
            projection: AFFINE,
        }
    }

    /// Particle `i` sampling `texture` stretched over it, as an `Image`
    /// layer of its size samples its texture, times its colour.
    fn image_fields(
        &self,
        i: usize,
        particle: &Particle,
        texture: &LayerTexture,
        target: CanvasRegion,
    ) -> InstanceFields {
        let raster_scale = texture.raster_scale;
        let mut transform = particle.transform;
        let scale_x = (particle.width * f64::from(raster_scale) / f64::from(texture.width)) as f32;
        let scale_y =
            (particle.height * f64::from(raster_scale) / f64::from(texture.height)) as f32;
        transform.a *= scale_x;
        transform.b *= scale_x;
        transform.c *= scale_y;
        transform.d *= scale_y;
        let exact = transform.is_uniform_scale(raster_scale);
        let level_of_detail = level_of_detail(transform, raster_scale, exact);
        if exact {
            (transform.tx, transform.ty) =
                pixel_aligned_translation(transform, texture.width, texture.height, CENTRE);
        }
        InstanceFields {
            transform,
            size: (
                texture.width as f32 / raster_scale,
                texture.height as f32 / raster_scale,
            ),
            anchor: [CENTRE.x as f32, CENTRE.y as f32],
            opacity: self.state.opacity,
            kind: 3.0,
            target,
            blend_mode: BlendMode::Normal,
            premultiplied: false,
            rect: [0.0; 4],
            fill: self.color(i),
            stroke: [0.0; 4],
            clip: self.state.clip,
            exact,
            level_of_detail,
            raster_scale,
            projection: AFFINE,
        }
    }
}

impl Particle {
    /// The particle's quad in scene pixels, anchored at its centre and
    /// reaching `margins` of its size past each edge.
    fn quad(&self, [margin_x, margin_y]: [f32; 2]) -> PixelBounds {
        let half_width = (self.width / 2.0) as f32 + self.width as f32 * margin_x;
        let half_height = (self.height / 2.0) as f32 + self.height as f32 * margin_y;
        let t = self.transform;
        let corners = [
            (-half_width, -half_height),
            (half_width, -half_height),
            (-half_width, half_height),
            (half_width, half_height),
        ]
        .map(|(x, y)| (t.a * x + t.c * y + t.tx, t.b * x + t.d * y + t.ty));
        let xs = corners.map(|(x, _)| x);
        let ys = corners.map(|(_, y)| y);
        let min = |values: [f32; 4]| values.into_iter().fold(f32::INFINITY, f32::min);
        let max = |values: [f32; 4]| values.into_iter().fold(f32::NEG_INFINITY, f32::max);
        PixelBounds([min(xs), min(ys), max(xs), max(ys)])
    }
}
