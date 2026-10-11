//! `LayerContent::Instances`: many particles of one shape, written straight
//! into the frame's instance buffer and drawn with one instanced draw.

use crate::bounds::{CanvasRegion, PixelBounds};
use crate::layer::{InstanceFields, LAYER_INSTANCE_FLOATS, layer_instance, level_of_detail};
use crate::transform::{Affine, LayerState};
use celesta_composition::{BlendMode, EvaluatedTransform, F32Column, Point, U8Column};

/// What every particle draws.
pub(crate) enum PreparedInstanceShape {
    /// A rect rounded by `corner_radius`, at most half its shorter side.
    Rect { corner_radius: f64 },
    /// A rect rounded by half its shorter side.
    Circle,
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
    pub(crate) width: f64,
    pub(crate) height: f64,
    /// Straight RGBA in 0-255, for every particle without its own colour.
    pub(crate) color: [f32; 4],
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
    /// What every particle's quad covers, in scene pixels.
    shape_box: PixelBounds,
}

const CENTRE: [f32; 2] = [0.5, 0.5];

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
        };
        let mut covered: Option<PixelBounds> = None;
        for i in 0..count as usize {
            if let Some(particle) = instances.particle(i) {
                covered = PixelBounds::union(covered, Some(particle.quad()));
            }
        }
        instances.shape_box = covered?;
        Some(instances)
    }

    pub(crate) const fn count(&self) -> u32 {
        self.count
    }

    /// Scene pixels the particles can touch, as `PreparedLayer::bounds`
    /// reckons a rect's: a rect's quad reaches one pixel past its edge,
    /// within this growth.
    pub(crate) fn bounds(&self) -> PixelBounds {
        self.shape_box.expand(2.0, 2.0)
    }

    /// The box of the particles' shapes in scene pixels.
    pub(crate) const fn shape(&self) -> PixelBounds {
        self.shape_box
    }

    /// Particle `i` as the `Rect` layer centred on it would be placed, or
    /// `None` when one of its values is not finite.
    fn particle(&self, i: usize) -> Option<Particle> {
        let columns = &self.columns;
        let x = f64::from(columns.x[i]);
        let y = f64::from(columns.y[i]);
        let width = columns
            .widths
            .as_ref()
            .map_or(columns.width, |widths| f64::from(widths[i]));
        let height = columns
            .heights
            .as_ref()
            .map_or(columns.height, |heights| f64::from(heights[i]));
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
        let own = Affine::from_transform(&EvaluatedTransform {
            position: Point { x, y },
            scale: Point { x: 1.0, y: 1.0 },
            rotation,
            anchor: Point { x: 0.5, y: 0.5 },
        });
        Some(Particle {
            transform: self.state.transform.multiply(own),
            width,
            height,
        })
    }

    /// Appends one `LayerInstance` per particle, drawn onto the canvas
    /// covering `target`. A particle with a value that is not finite is
    /// written transparent and without area, so instance indices stay
    /// those of the particles.
    pub(crate) fn write_instances(&self, target: CanvasRegion, output: &mut Vec<u8>) {
        output.reserve(self.count as usize * LAYER_INSTANCE_FLOATS * 4);
        for i in 0..self.count as usize {
            let fields = match self.particle(i) {
                Some(particle) => self.rect_fields(i, &particle, target),
                None => InstanceFields {
                    size: (0.0, 0.0),
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
            output.extend_from_slice(bytemuck::cast_slice(&layer_instance(&fields)));
        }
    }

    /// Particle `i` shaded as `RectShape` shades a rect layer.
    fn rect_fields(&self, i: usize, particle: &Particle, target: CanvasRegion) -> InstanceFields {
        let half_width = particle.width / 2.0;
        let half_height = particle.height / 2.0;
        let radius = match self.shape {
            PreparedInstanceShape::Rect { corner_radius } => corner_radius,
            PreparedInstanceShape::Circle => particle.width.min(particle.height) / 2.0,
        };
        let fill = self
            .columns
            .colors
            .as_ref()
            .map_or(self.columns.color, |colors| {
                [
                    f32::from(colors[4 * i]),
                    f32::from(colors[4 * i + 1]),
                    f32::from(colors[4 * i + 2]),
                    f32::from(colors[4 * i + 3]),
                ]
            });
        let exact = particle.transform.is_uniform_scale(1.0);
        InstanceFields {
            transform: particle.transform,
            size: (particle.width as f32, particle.height as f32),
            anchor: CENTRE,
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
            fill,
            stroke: [0.0; 4],
            clip: self.state.clip,
            exact,
            level_of_detail: level_of_detail(particle.transform, 1.0, exact),
            raster_scale: 1.0,
        }
    }
}

impl Particle {
    /// The particle's quad in scene pixels, anchored at its centre.
    fn quad(&self) -> PixelBounds {
        let (half_width, half_height) = ((self.width / 2.0) as f32, (self.height / 2.0) as f32);
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
