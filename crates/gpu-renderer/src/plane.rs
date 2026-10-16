//! Projective layers: a layer with a perspective and a 3D rotation draws its
//! content onto a canvas in its own plane (a plane), which then draws onto
//! its parent through the layer's homography.

use crate::bounds::{CanvasRegion, PixelBounds};
use crate::error::GpuRenderError;
use crate::hit::HitClip;
use crate::layer::{PreparedItem, PreparedLayer};
use crate::plan::content_bounds;
use crate::renderer::GpuRenderer;
use crate::text::round_up_to_eighth_octave;
use crate::transform::{Affine, ClipEntry, LayerState};
use celesta_composition::{
    BlendMode, EvaluatedTransform, IDENTITY3, Layer, LayerEffects, Matrix3, Point, invert3,
    multiply3, project, stretch_at,
};

/// The nearest a point may come to the viewer and still be drawn: points
/// with `w` below it are behind the viewer, or so close they would fill the
/// screen.
pub(crate) const NEAR_W: f64 = 1.0 / 16.0;

/// The convex polygon `corners` clipped to the part `m` maps to
/// `w ≥ NEAR_W`.
pub(crate) fn clip_in_front(m: &Matrix3, corners: &[[f64; 2]]) -> Vec<[f64; 2]> {
    clip_polygon(corners, |[x, y]| {
        m[2][0] * x + m[2][1] * y + m[2][2] - NEAR_W
    })
}

/// Sutherland–Hodgman: the convex polygon `corners` clipped to where the
/// affine function `inside` is at least 0.
fn clip_polygon(corners: &[[f64; 2]], inside: impl Fn([f64; 2]) -> f64) -> Vec<[f64; 2]> {
    let mut clipped = Vec::with_capacity(corners.len() + 1);
    for (index, &current) in corners.iter().enumerate() {
        let next = corners[(index + 1) % corners.len()];
        let (here, there) = (inside(current), inside(next));
        if here >= 0.0 {
            clipped.push(current);
        }
        if (here >= 0.0) != (there >= 0.0) {
            let t = here / (here - there);
            clipped.push([
                current[0] + t * (next[0] - current[0]),
                current[1] + t * (next[1] - current[1]),
            ]);
        }
    }
    clipped
}

/// The corners of `bounds`, in order around it.
fn corners(PixelBounds(bounds): PixelBounds) -> [[f64; 2]; 4] {
    let [left, top, right, bottom] = bounds.map(f64::from);
    [[left, top], [right, top], [right, bottom], [left, bottom]]
}

/// The box of `points`; `None` without any.
fn box_of(points: impl IntoIterator<Item = [f64; 2]>) -> Option<[f64; 4]> {
    points.into_iter().fold(None, |bounds, [x, y]| {
        Some(
            bounds.map_or([x, y, x, y], |[left, top, right, bottom]: [f64; 4]| {
                [left.min(x), top.min(y), right.max(x), bottom.max(y)]
            }),
        )
    })
}

/// The box of where `m` maps the part of the canvas `(0, 0, width, height)`
/// in front of the viewer, grown by 2 pixels; `None` when none of it is.
pub(crate) fn projected_bounds(m: &Matrix3, width: u32, height: u32) -> Option<PixelBounds> {
    let canvas = PixelBounds([0.0, 0.0, width as f32, height as f32]);
    let polygon = clip_in_front(m, &corners(canvas));
    let [left, top, right, bottom] = box_of(polygon.into_iter().map(|[x, y]| {
        let [x, y, _] = project(m, x, y);
        [x, y]
    }))?;
    Some(PixelBounds([left, top, right, bottom].map(|value| value as f32)).expand(2.0, 2.0))
}

/// How a plane's content is rasterized: `scale` plane pixels per local
/// unit, the local box from `left`, `top` drawn onto a `width`x`height`
/// canvas with a 1-pixel transparent margin round it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PlaneRaster {
    pub(crate) scale: f64,
    pub(crate) left: f64,
    pub(crate) top: f64,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// The convex polygon `polygon`, all of it in front of the viewer (see
/// `clip_in_front`), clipped to the part `m` maps into `target`. Each side
/// of `target` is a half-plane in the plane too: `X/W ≥ left` is
/// `X − left·W ≥ 0` where `W > 0`, which is linear in the point, so the clip
/// is exact whether or not the plane's horizon shows.
fn clip_to_shown(m: &Matrix3, polygon: &[[f64; 2]], target: PixelBounds) -> Vec<[f64; 2]> {
    let [left, top, right, bottom] = target.0.map(f64::from);
    let row = |r: usize, [x, y]: [f64; 2]| m[r][0] * x + m[r][1] * y + m[r][2];
    let polygon = clip_polygon(polygon, |p| row(0, p) - left * row(2, p));
    let polygon = clip_polygon(&polygon, |p| row(1, p) - top * row(2, p));
    let polygon = clip_polygon(&polygon, |p| right * row(2, p) - row(0, p));
    clip_polygon(&polygon, |p| bottom * row(2, p) - row(1, p))
}

/// The raster of a plane whose content covers `local` (layer-local units),
/// drawn through `forward` (layer-local units to `target`'s space) onto a
/// space `target` covers; `None` when nothing of it can show. Only the part
/// in front of the viewer that lands in `target` is rasterized, at the scale
/// its most magnified corner needs, rounded up as text raster scales are,
/// and lowered to keep the canvas within `max_texture` on either side and
/// `max_area` pixels in all.
pub(crate) fn plane_raster(
    forward: &Matrix3,
    local: PixelBounds,
    target: PixelBounds,
    max_texture: u32,
    max_area: u64,
) -> Option<PlaneRaster> {
    let polygon = clip_in_front(forward, &corners(local));
    let polygon = clip_to_shown(forward, &polygon, target);
    let stretch = polygon
        .iter()
        .filter_map(|&[x, y]| stretch_at(forward, x, y))
        .reduce(f64::max)?;
    let [left, top, right, bottom] = box_of(polygon)?;
    let (width, height) = (right - left, bottom - top);
    if !(width.is_finite() && height.is_finite()) {
        return None;
    }
    let mut scale = round_up_to_eighth_octave(stretch).clamp(MIN_SCALE, MAX_SCALE);
    let side = |extent: f64, scale: f64| (extent * scale).ceil() + 2.0;
    let limit = f64::from(max_texture);
    if side(width, scale) > limit || side(height, scale) > limit {
        scale = (limit - 2.0) / width.max(height);
    }
    // A plane reaching to the horizon would otherwise fill the largest
    // texture: the largest scale whose canvas, with its margin and the
    // rounding up, fits `max_area`, a root of
    // `(width·s + 3)(height·s + 3) = max_area`.
    let max_area = max_area as f64;
    if side(width, scale) * side(height, scale) > max_area {
        let (a, b, c) = (width * height, 3.0 * (width + height), 9.0 - max_area);
        let lowered = if a > 0.0 {
            (-b + (b * b - 4.0 * a * c).sqrt()) / (2.0 * a)
        } else {
            -c / b
        };
        if lowered.is_finite() && lowered > 0.0 {
            scale = scale.min(lowered);
        }
    }
    // Rounding can leave the lowered scale a hair over the limit.
    let side = |extent: f64| side(extent, scale).min(limit) as u32;
    Some(PlaneRaster {
        scale,
        left,
        top,
        width: side(width),
        height: side(height),
    })
}

/// The inverse of the stretch of `forward` at the layer's origin (output
/// pixels per local unit), 1 where it has none.
fn stretch_ratio(forward: &Matrix3) -> f64 {
    stretch_at(forward, 0.0, 0.0).map_or(1.0, f64::recip)
}

/// How much larger than its output size an effect's pixels are drawn on the
/// plane `raster` rasterizes, measured at the layer's origin: a blur of `r`
/// plane pixels spreads `r · effect_scale` output pixels, so effects scaled
/// by it come out the size they would without the plane.
pub(crate) fn effect_scale(forward: &Matrix3, raster: &PlaneRaster) -> f32 {
    (raster.scale * stretch_ratio(forward)) as f32
}

/// The range of plane raster scales, as for text: `2^-6` to `2^6`.
const MIN_SCALE: f64 = 1.0 / 64.0;
const MAX_SCALE: f64 = 64.0;

/// A plane of the frame being prepared, for hit testing through it.
pub(crate) struct PlaneEntry {
    /// The map from the plane's canvas pixels to its parent's space.
    pub(crate) to_parent: Matrix3,
    /// Index into `GpuRenderer::plane_entries` of the plane it is drawn
    /// onto, if any.
    pub(crate) parent: Option<u32>,
    /// The innermost clip its canvas is drawn through.
    pub(crate) clip: Option<u32>,
}

/// The planes from `plane` outwards: it, its parent, and so on.
fn plane_chain(planes: &[PlaneEntry], plane: Option<u32>) -> impl Iterator<Item = u32> + '_ {
    std::iter::successors(plane, |&index| planes[index as usize].parent)
}

/// `corners`, in the canvas pixels of `plane`, mapped up through each
/// plane's `to_parent` to scene pixels; `None` when any is behind the
/// viewer at any level.
pub(crate) fn corners_to_scene(
    planes: &[PlaneEntry],
    plane: Option<u32>,
    corners: [Point; 4],
) -> Option<[Point; 4]> {
    let mut scene = corners;
    for point in &mut scene {
        for index in plane_chain(planes, plane) {
            let [x, y, w] = project(&planes[index as usize].to_parent, point.x, point.y);
            if w.is_nan() || w <= 0.0 {
                return None;
            }
            *point = Point { x, y };
        }
    }
    Some(scene)
}

/// Every clip a leaf in `plane` is drawn through, innermost first: the
/// clips of `clip` and its parents in the plane's canvas, then those the
/// plane's canvas is drawn through in its parent's space, and so on out to
/// the scene. A plane that cannot be inverted (`None`) cannot be hit.
pub(crate) fn hit_clips(
    clips: &[ClipEntry],
    planes: &[PlaneEntry],
    plane: Option<u32>,
    clip: Option<u32>,
) -> Option<Vec<HitClip>> {
    let chain = plane_chain(planes, plane).collect::<Vec<_>>();
    // The map from each plane's canvas pixels to the scene's, built from
    // the outermost plane in.
    let mut to_scene = Vec::with_capacity(chain.len());
    let mut composed = IDENTITY3;
    for &index in chain.iter().rev() {
        composed = multiply3(&composed, &planes[index as usize].to_parent);
        to_scene.push(composed);
    }
    to_scene.reverse();
    let mut hit_clips = Vec::new();
    let mut clip = clip;
    // The leaf's own space, then each plane's parent's, down to the scene.
    for level in 0..=chain.len() {
        let to_local = match to_scene.get(level) {
            Some(to_scene) => {
                let [[a, b, c], [d, e, f], [g, h, i]] = invert3(to_scene)?;
                Some([a, b, c, d, e, f, g, h, i])
            }
            None => None,
        };
        hit_clips.extend(
            std::iter::successors(clip, |&index| clips[index as usize].parent).map(|index| {
                HitClip {
                    to_local,
                    ..clips[index as usize].hit_clip()
                }
            }),
        );
        if let Some(&index) = chain.get(level) {
            clip = planes[index as usize].clip;
        }
    }
    Some(hit_clips)
}

/// The most pixels a plane's canvas has, in scene areas.
const MAX_PLANE_AREA: u64 = 4;

/// How far the space a plane can show reaches while its parent's content is
/// only measured: unbounded, short of overflowing an f32.
const UNBOUNDED: f32 = 1e9;

impl GpuRenderer {
    /// Prepares the projective `layer`, drawn onto `parent`'s space, as a
    /// canvas in its own plane: its content is prepared once in its local
    /// units to measure it (and rolled back), then for real onto a canvas
    /// at the scale `plane_raster` picks, which an `EndPlane` then draws
    /// through the layer's homography.
    pub(crate) fn prepare_plane(
        &mut self,
        layer: &Layer,
        parent: LayerState,
        output: &mut Vec<PreparedItem>,
    ) -> Result<(), GpuRenderError> {
        let forward = multiply3(&matrix(parent.transform), &layer.transform.homography());
        // The layer's content in its own plane, where the anchor still
        // places it. `self.walk` already holds the layer's orientation.
        let inner = Layer {
            id: layer.id.clone(),
            transform: EvaluatedTransform {
                anchor: layer.transform.anchor,
                ..EvaluatedTransform::default()
            },
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            effects: LayerEffects::default(),
            content: layer.content.clone(),
        };
        // Effects are measured in the plane's pixels, which are local units
        // while measuring and `raster.scale` per unit once rasterized.
        let parent_scale = self.walk.effect_scale;
        self.walk.effect_scale = parent_scale * stretch_ratio(&forward) as f32;
        let local = self.measure_plane(&inner, output);
        self.walk.effect_scale = parent_scale;
        let Some(local) = local? else {
            return Ok(());
        };
        let target = if self.measuring_plane {
            PixelBounds([-UNBOUNDED, -UNBOUNDED, UNBOUNDED, UNBOUNDED])
        } else {
            let (width, height) = self.scene_size;
            PixelBounds([0.0, 0.0, width as f32, height as f32])
        };
        let Some(raster) = plane_raster(
            &forward,
            local,
            target,
            self.max_texture_dimension,
            MAX_PLANE_AREA.saturating_mul(self.scene_area),
        ) else {
            return Ok(());
        };
        // In steps, so a plane that changes size a little from frame to
        // frame reuses its canvas; the rest is transparent margin.
        let step = |extent: u32| {
            (extent.div_ceil(CanvasRegion::STEP) * CanvasRegion::STEP)
                .min(self.max_texture_dimension)
                .max(extent)
        };
        let (width, height) = (step(raster.width), step(raster.height));
        let to_plane = raster.to_plane();
        let effect_scale = parent_scale * effect_scale(&forward, &raster);
        let to_parent = multiply3(
            &forward,
            &invert3(&matrix(to_plane)).expect("a plane's raster scale is positive"),
        );
        let index = u32::try_from(self.plane_entries.len())
            .map_err(|_| GpuRenderError::TooManyLayers(self.plane_entries.len()))?;
        self.plane_entries.push(PlaneEntry {
            to_parent,
            parent: self.walk.plane,
            clip: parent.clip,
        });
        output.push(PreparedItem::BeginPlane { width, height });
        let (walk, space) = (self.walk, self.scene_size);
        self.walk.plane = Some(index);
        self.walk.effect_scale = effect_scale;
        self.scene_size = (width, height);
        let prepared = self.prepare_layer(
            &inner,
            LayerState {
                transform: to_plane,
                opacity: 1.0,
                clip: None,
            },
            output,
        );
        (self.walk, self.scene_size) = (walk, space);
        prepared?;
        let [top, middle, bottom] = to_parent.map(|row| row.map(|value| value as f32));
        output.push(PreparedItem::EndPlane(PreparedLayer::plane(
            LayerState {
                transform: Affine {
                    a: top[0],
                    b: middle[0],
                    c: top[1],
                    d: middle[1],
                    tx: top[2],
                    ty: middle[2],
                },
                opacity: (parent.opacity * layer.opacity.clamp(0.0, 1.0) as f32).clamp(0.0, 1.0),
                clip: parent.clip,
            },
            layer.blend_mode,
            bottom,
        )));
        Ok(())
    }

    /// The box `inner`, a plane's content, covers in its local units,
    /// prepared onto the end of `output` and rolled back; `None` when it
    /// draws nothing.
    fn measure_plane(
        &mut self,
        inner: &Layer,
        output: &mut Vec<PreparedItem>,
    ) -> Result<Option<PixelBounds>, GpuRenderError> {
        let start = output.len();
        let texts = self.pending_texts.len();
        let paths = self.pending_paths.len();
        let clips = self.clip_entries.len();
        let paints = self.paint_entries.len();
        let leaves = self.hit_leaves.len();
        let planes = self.plane_entries.len();
        let uses = self.shaders.use_count();
        let measuring = std::mem::replace(&mut self.measuring_plane, true);
        let prepared = self.prepare_layer(inner, LayerState::default(), output);
        self.measuring_plane = measuring;
        let local = prepared.map(|()| {
            // What the text and paths still pending cover, by item.
            let mut pending: Vec<(usize, Option<PixelBounds>)> = Vec::new();
            for text in &self.pending_texts[texts..] {
                pending.push((
                    text.item,
                    Some(text.measured_bounds(&mut self.text_rasterizer)),
                ));
            }
            for path in &self.pending_paths[paths..] {
                pending.push((path.item, path.shape_box()));
            }
            pending.sort_unstable_by_key(|(item, _)| *item);
            content_bounds(&output[start..], |index| {
                let item = start + index;
                pending
                    .binary_search_by_key(&item, |(item, _)| *item)
                    .map_or(None, |found| pending[found].1)
            })
        });
        output.truncate(start);
        self.pending_texts.truncate(texts);
        self.pending_paths.truncate(paths);
        self.clip_entries.truncate(clips);
        self.paint_entries.truncate(paints);
        self.hit_leaves.truncate(leaves);
        self.plane_entries.truncate(planes);
        self.shaders.truncate_uses(uses);
        local
    }
}

impl PlaneRaster {
    /// The map from the plane's local units to its canvas pixels:
    /// `Translate(1 − left·scale, 1 − top·scale) · Scale(scale)`.
    fn to_plane(self) -> Affine {
        let scale = self.scale as f32;
        Affine {
            a: scale,
            d: scale,
            tx: (1.0 - self.left * self.scale) as f32,
            ty: (1.0 - self.top * self.scale) as f32,
            ..Affine::IDENTITY
        }
    }
}

/// `transform` as a 3x3 matrix.
fn matrix(transform: Affine) -> Matrix3 {
    [
        [transform.a, transform.c, transform.tx],
        [transform.b, transform.d, transform.ty],
        [0.0, 0.0, 1.0],
    ]
    .map(|row| row.map(f64::from))
}

#[cfg(test)]
mod tests {
    use super::*;
    use celesta_composition::{EvaluatedTransform, IDENTITY3, Point, stretch_at};

    const SCREEN: PixelBounds = PixelBounds([0.0, 0.0, 1920.0, 1080.0]);

    fn entry(to_parent: Matrix3, parent: Option<u32>) -> PlaneEntry {
        PlaneEntry {
            to_parent,
            parent,
            clip: None,
        }
    }

    #[test]
    fn corners_behind_the_viewer_at_any_level_are_dropped() {
        // Each of these maps every point behind the viewer (w = -1); the
        // two together map it back in front (w = 1).
        let behind = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, -1.0]];
        let front = IDENTITY3;
        let corners = [Point { x: 1.0, y: 2.0 }; 4];
        let planes = [
            entry(behind, None),
            entry(behind, Some(0)),
            entry(front, None),
            entry(front, Some(2)),
        ];
        assert!(corners_to_scene(&planes, Some(1), corners).is_none());
        assert!(corners_to_scene(&planes, Some(0), corners).is_none());
        assert!(corners_to_scene(&planes, Some(2), corners).is_some());
        assert!(corners_to_scene(&planes, Some(3), corners).is_some());
        assert!(corners_to_scene(&planes, None, corners).is_some());
    }

    #[test]
    fn projected_bounds_of_an_affine_canvas_is_its_box() {
        assert_eq!(
            projected_bounds(&IDENTITY3, 10, 20),
            Some(PixelBounds([-2.0, -2.0, 12.0, 22.0]))
        );
    }

    #[test]
    fn projected_bounds_drop_what_is_behind_the_viewer() {
        let m = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [-0.01, 0.0, 1.0]];
        let bounds = projected_bounds(&m, 200, 10).expect("the left part is in front");
        assert!(bounds.0.iter().all(|value| value.is_finite()), "{bounds:?}");
        assert_eq!(bounds.0[0], -2.0);
    }

    #[test]
    fn plane_raster_of_an_unscaled_layer() {
        let raster = plane_raster(
            &IDENTITY3,
            PixelBounds([0.0, 0.0, 100.0, 50.0]),
            SCREEN,
            8192,
            u64::MAX,
        )
        .unwrap();
        assert_eq!(
            raster,
            PlaneRaster {
                scale: 1.0,
                left: 0.0,
                top: 0.0,
                width: 102,
                height: 52,
            }
        );
    }

    #[test]
    fn plane_raster_follows_a_scale() {
        let scale = [[2.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 1.0]];
        let raster = plane_raster(
            &scale,
            PixelBounds([0.0, 0.0, 100.0, 50.0]),
            SCREEN,
            8192,
            u64::MAX,
        )
        .unwrap();
        assert_eq!(raster.scale, 2.0);
        assert_eq!(raster.width, 202);
    }

    #[test]
    fn plane_raster_covers_the_nearest_corner() {
        let forward = EvaluatedTransform {
            position: Point { x: 500.0, y: 500.0 },
            rotation_y: 60.0,
            perspective: Some(1000.0),
            ..EvaluatedTransform::default()
        }
        .homography();
        let raster = plane_raster(
            &forward,
            PixelBounds([-100.0, -100.0, 100.0, 100.0]),
            SCREEN,
            8192,
            u64::MAX,
        )
        .unwrap();
        for (x, y) in [
            (-100.0, -100.0),
            (100.0, -100.0),
            (100.0, 100.0),
            (-100.0, 100.0),
        ] {
            let stretch = stretch_at(&forward, x, y).unwrap();
            assert!(raster.scale >= stretch, "{} < {stretch}", raster.scale);
        }
        let steps = raster.scale.log2() * 8.0;
        assert!((steps - steps.round()).abs() < 1e-9, "{steps}");
    }

    #[test]
    fn plane_raster_is_limited_to_the_visible_part() {
        let raster = plane_raster(
            &IDENTITY3,
            PixelBounds([-1e6, -1e6, 1e6, 1e6]),
            SCREEN,
            8192,
            u64::MAX,
        )
        .unwrap();
        assert_eq!((raster.width, raster.height), (1922, 1082));
    }

    /// The example's floor, whose horizon shows: the screen's top corners
    /// map behind it.
    fn floor() -> Matrix3 {
        EvaluatedTransform {
            position: Point { x: 960.0, y: 800.0 },
            rotation_x: 60.0,
            perspective: Some(900.0),
            ..EvaluatedTransform::default()
        }
        .homography()
    }

    #[test]
    fn plane_raster_of_a_floor_is_scaled_by_what_shows_of_its_near_edge() {
        // The near corners are far off either side of the screen.
        let forward = floor();
        let raster = plane_raster(
            &forward,
            PixelBounds([-900.0, -750.0, 900.0, 294.0]),
            SCREEN,
            8192,
            u64::MAX,
        )
        .unwrap();
        let shown_near_edge = (-64..=64)
            .map(|i| f64::from(i) * 900.0 / 64.0)
            .filter(|&x| (0.0..=1920.0).contains(&project(&forward, x, 294.0)[0]));
        for x in shown_near_edge {
            let stretch = stretch_at(&forward, x, 294.0).unwrap();
            assert!(raster.scale >= stretch, "{} < {stretch}", raster.scale);
        }
        let off_screen = stretch_at(&forward, 900.0, 294.0).unwrap();
        assert!(
            raster.scale < off_screen,
            "{} >= {off_screen}",
            raster.scale
        );
    }

    #[test]
    fn plane_raster_of_a_floor_past_the_screen_bottom_is_scaled_by_the_bottom() {
        // The near part runs off the bottom of the screen and then behind
        // the viewer; what shows ends at the screen's bottom edge.
        let forward = floor();
        let raster = plane_raster(
            &forward,
            PixelBounds([-900.0, -750.0, 900.0, 1500.0]),
            SCREEN,
            8192,
            u64::MAX,
        )
        .unwrap();
        let inverse = invert3(&forward).unwrap();
        let bottom = [0.0, 1920.0]
            .map(|x| {
                let [x, y, _] = project(&inverse, x, 1080.0);
                stretch_at(&forward, x, y).unwrap()
            })
            .into_iter()
            .reduce(f64::max)
            .unwrap();
        assert_eq!(raster.scale, round_up_to_eighth_octave(bottom));
        assert!(raster.width < 8192 && raster.height < 8192, "{raster:?}");
    }

    #[test]
    fn plane_raster_stays_within_the_texture_limit() {
        let raster = plane_raster(
            &IDENTITY3,
            PixelBounds([0.0, 0.0, 10000.0, 10.0]),
            PixelBounds([0.0, 0.0, 20000.0, 20000.0]),
            8192,
            u64::MAX,
        )
        .unwrap();
        assert!(raster.width <= 8192, "{}", raster.width);
        assert!(raster.scale < 1.0, "{}", raster.scale);
    }

    #[test]
    fn plane_raster_stays_within_the_area_limit() {
        let raster = plane_raster(
            &IDENTITY3,
            PixelBounds([0.0, 0.0, 1000.0, 1000.0]),
            PixelBounds([0.0, 0.0, 2000.0, 2000.0]),
            8192,
            4 * 100 * 100,
        )
        .unwrap();
        let area = u64::from(raster.width) * u64::from(raster.height);
        assert!(area <= 4 * 100 * 100, "{area}");
        assert!(raster.scale < 1.0, "{}", raster.scale);
        assert!(
            area > 3 * 100 * 100,
            "the scale is lowered no more than needed: {area}"
        );
    }

    #[test]
    fn effect_scale_is_one_for_a_flat_plane() {
        let raster = PlaneRaster {
            scale: 1.0,
            left: 0.0,
            top: 0.0,
            width: 10,
            height: 10,
        };
        assert_eq!(effect_scale(&IDENTITY3, &raster), 1.0);
    }

    #[test]
    fn effect_scale_follows_the_raster_against_the_projection() {
        // Rasterized 25% finer than the layer is drawn, so a plane pixel
        // is 80% of an output pixel.
        let forward = [[2.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 1.0]];
        let raster = PlaneRaster {
            scale: 2.5,
            left: 0.0,
            top: 0.0,
            width: 10,
            height: 10,
        };
        assert_eq!(effect_scale(&forward, &raster), 1.25);
    }
}
