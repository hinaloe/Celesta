use crate::PathTransform;
use crate::clip::ParentState;
use crate::error::RenderError;
use crate::images::render_tinted_image_pixels;
use crate::layer::render_output_pixels;
use crate::paint::ResolvedPaint;
use crate::rect::{RectPaint, rasterize_rect_transformed};
use crate::renderer::CpuRenderer;
use crate::types::{Color, RgbaFrame};
use celesta_composition::{InstanceShape, Layer, LayerContent, Point};

const CENTRE: Point = Point { x: 0.5, y: 0.5 };

impl CpuRenderer {
    /// Draws an `Instances` layer particle by particle, each as the `Rect`
    /// (or image) centred on it would draw, in `state`'s frame.
    pub(crate) fn render_instances(
        &mut self,
        frame: &mut RgbaFrame,
        layer: &Layer,
        state: &ParentState,
    ) -> Result<(), RenderError> {
        let LayerContent::Instances {
            count,
            shape,
            width,
            height,
            color,
            x,
            y,
            widths,
            heights,
            rotation,
            colors,
        } = &layer.content
        else {
            unreachable!("render_instances draws Instances layers");
        };
        let shared_color = match color {
            Some(color) => Color::from_hex(color)?,
            None => Color::rgba(255, 255, 255, 255),
        };
        let image = match shape {
            InstanceShape::Image { asset } => {
                let path = self.local_asset_path(asset)?;
                let mut render = |density: f64| {
                    self.image_sources
                        .render(&asset.id, &path, None, None, None, density)
                        .map_err(|source| RenderError::ImageDecode {
                            asset: asset.id.clone(),
                            source,
                        })
                };
                let scale = state.scale.x.abs().max(state.scale.y.abs());
                let display = render(scale)?;
                // An SVG drawn larger than its natural size is rasterized
                // for the largest particle, as an `Image` layer is for its
                // own size.
                let largest = [widths, heights]
                    .into_iter()
                    .flatten()
                    .flat_map(|column| column.iter().map(|&value| f64::from(value)))
                    .chain([*width, *height].into_iter().flatten())
                    .filter(|value| value.is_finite())
                    .fold(0.0, f64::max);
                let natural = display.width.max(display.height);
                if display.is_svg && natural > 0.0 && largest > natural {
                    Some(render(scale * largest / natural)?)
                } else {
                    Some(display)
                }
            }
            InstanceShape::Rect { .. } | InstanceShape::Circle => None,
        };
        for i in 0..*count as usize {
            let (natural_width, natural_height) = image
                .as_ref()
                .map_or((0.0, 0.0), |image| (image.width, image.height));
            let particle_width = widths
                .as_ref()
                .map_or(width.unwrap_or(natural_width), |widths| {
                    f64::from(widths[i])
                });
            let particle_height = heights
                .as_ref()
                .map_or(height.unwrap_or(natural_height), |heights| {
                    f64::from(heights[i])
                });
            let degrees = rotation
                .as_ref()
                .map_or(0.0, |rotation| f64::from(rotation[i]));
            let (particle_x, particle_y) = (f64::from(x[i]), f64::from(y[i]));
            if ![
                particle_x,
                particle_y,
                particle_width,
                particle_height,
                degrees,
            ]
            .iter()
            .all(|value| value.is_finite())
            {
                continue;
            }
            if degrees != 0.0 {
                return Err(RenderError::UnsupportedRotation {
                    layer: layer.id.clone(),
                    degrees,
                });
            }
            let tint = colors.as_ref().map_or(
                [
                    shared_color.red,
                    shared_color.green,
                    shared_color.blue,
                    shared_color.alpha,
                ],
                |colors| {
                    [
                        colors[4 * i],
                        colors[4 * i + 1],
                        colors[4 * i + 2],
                        colors[4 * i + 3],
                    ]
                },
            );
            let particle = ParentState {
                position: Point {
                    x: state.position.x + particle_x * state.scale.x,
                    y: state.position.y + particle_y * state.scale.y,
                },
                ..state.clone()
            };
            if let Some(image) = &image {
                let pixels = &image.pixels;
                let mut particle = particle;
                particle.scale.x *= particle_width / f64::from(pixels.width());
                particle.scale.y *= particle_height / f64::from(pixels.height());
                if particle.scale.x == 0.0 || particle.scale.y == 0.0 {
                    continue;
                }
                render_tinted_image_pixels(
                    frame,
                    pixels.width(),
                    pixels.height(),
                    pixels.as_raw(),
                    CENTRE,
                    &particle,
                    tint,
                );
                continue;
            }
            let corner_radius = match shape {
                InstanceShape::Rect { corner_radius } => *corner_radius,
                _ => particle_width.min(particle_height) / 2.0,
            };
            let paint = RectPaint {
                fill: Some(ResolvedPaint::Solid(Color::rgba(
                    tint[0], tint[1], tint[2], tint[3],
                ))),
                stroke: None,
            };
            let transform = PathTransform::scale_translate(
                particle.scale.x,
                particle.scale.y,
                particle.position.x - CENTRE.x * particle_width * particle.scale.x,
                particle.position.y - CENTRE.y * particle_height * particle.scale.y,
            );
            if let Some(rect) = rasterize_rect_transformed(
                particle_width,
                particle_height,
                corner_radius,
                &paint,
                transform,
                frame.width,
                frame.height,
            ) {
                render_output_pixels(frame, &rect, &particle);
            }
        }
        Ok(())
    }
}
