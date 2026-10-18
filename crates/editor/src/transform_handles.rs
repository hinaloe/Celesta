//! The geometry of dragging a selected layer on the canvas: where its handles
//! sit, which handle a point is on, and what a drag from one point to another
//! makes of the layer's transform props. Scene pixels throughout.
//!
//! The values are the layer's `EvaluatedTransform` fields after the drag. For
//! a React primitive those are its props as written: `buildLayer`'s
//! `extractTransform` copies `x`/`y` to `position`, `rotation`, and
//! `scaleX ?? scale`/`scaleY ?? scale` to `scale`, with no offset (a text's
//! baseline anchor changes where it draws, not its position). `prop_values`
//! still carries an offset or a ratio over from the props the runtime saw,
//! for the layers that deviate (an `<Instances>`, whose x, y and rotation are
//! its particles').

use crate::transform_edit::TransformProp;
use celesta_composition::{EvaluatedTransform, Point};
use celesta_gpu_renderer::{LayerFrame, invert_affine};
use celesta_react_bridge::ReceivedProps;
use celesta_source_edit::format_number;

/// A part of the selection that a drag starts from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Handle {
    /// The layer's body: moves it.
    Move,
    /// The outline's corner `i`, in the outline's order: scales both axes.
    Corner(u8),
    /// The middle of the outline's edge from corner `i` to corner `i + 1`
    /// (top, right, bottom, left): scales one axis.
    Edge(u8),
    /// The square on a stem above the top edge: rotates.
    Rotate,
}

/// Rotation steps with Shift held, in degrees.
const SNAP_DEGREES: f64 = 15.0;
/// The smallest scale a drag makes; a drag through the anchor does not flip
/// or collapse the layer.
const MIN_SCALE_RATIO: f64 = 0.01;

/// The handles of `frame` and where they sit: the corners, the edges' middles
/// (none for a `uniform` scale), and the rotation handle `stem` scene pixels
/// out from the top edge's middle.
pub(crate) fn handles(frame: &LayerFrame, uniform: bool, stem: f64) -> Vec<(Handle, Point)> {
    let outline = frame.outline;
    let mut handles: Vec<(Handle, Point)> = (0..4u8)
        .map(|i| (Handle::Corner(i), outline[usize::from(i)]))
        .collect();
    if !uniform {
        handles.extend((0..4u8).map(|i| (Handle::Edge(i), edge_middle(&outline, i))));
    }
    handles.push((Handle::Rotate, rotate_handle(&outline, stem)));
    handles
}

/// The middle of the top edge and the rotation handle at the stem's end.
pub(crate) fn rotate_stem(frame: &LayerFrame, stem: f64) -> (Point, Point) {
    (
        edge_middle(&frame.outline, 0),
        rotate_handle(&frame.outline, stem),
    )
}

fn edge_middle(outline: &[Point; 4], i: u8) -> Point {
    let (a, b) = (
        outline[usize::from(i) % 4],
        outline[(usize::from(i) + 1) % 4],
    );
    Point {
        x: (a.x + b.x) / 2.0,
        y: (a.y + b.y) / 2.0,
    }
}

/// `stem` out from the top edge's middle, away from the outline's center.
fn rotate_handle(outline: &[Point; 4], stem: f64) -> Point {
    let top = edge_middle(outline, 0);
    let center = Point {
        x: outline.iter().map(|p| p.x).sum::<f64>() / 4.0,
        y: outline.iter().map(|p| p.y).sum::<f64>() / 4.0,
    };
    let (dx, dy) = (top.x - center.x, top.y - center.y);
    let length = dx.hypot(dy);
    let (ux, uy) = if length > f64::EPSILON {
        (dx / length, dy / length)
    } else {
        (0.0, -1.0)
    };
    Point {
        x: top.x + ux * stem,
        y: top.y + uy * stem,
    }
}

/// The handle within `radius` of `point` (the nearest), else `Move` when
/// `point` is inside the outline, else `None`.
pub(crate) fn handle_at(
    frame: &LayerFrame,
    handles: &[(Handle, Point)],
    point: Point,
    radius: f64,
) -> Option<Handle> {
    handles
        .iter()
        .map(|(handle, at)| (*handle, (at.x - point.x).hypot(at.y - point.y)))
        .filter(|(_, distance)| *distance <= radius)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(handle, _)| handle)
        .or_else(|| inside(&frame.outline, point).then_some(Handle::Move))
}

/// Whether `point` is inside the convex quad `outline`, either winding.
fn inside(outline: &[Point; 4], point: Point) -> bool {
    let sides = (0..4).map(|i| {
        let (a, b) = (outline[i], outline[(i + 1) % 4]);
        (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    });
    let (mut positive, mut negative) = (false, false);
    for side in sides {
        positive |= side > 0.0;
        negative |= side < 0.0;
    }
    !(positive && negative)
}

fn apply(m: &[f64; 6], p: Point) -> Point {
    Point {
        x: m[0] * p.x + m[2] * p.y + m[4],
        y: m[1] * p.x + m[3] * p.y + m[5],
    }
}

/// The transform values a drag of `handle` from `start` to `now` (scene
/// pixels) makes, for the props in `editable` only. The pointer moves are
/// taken into the layer's parent space; rotation turns about the anchor
/// (snapped to 15° with `shift`), and scaling keeps the anchor in place, in
/// one ratio for a uniform `Scale`.
pub(crate) fn drag_values(
    frame: &LayerFrame,
    handle: Handle,
    start: Point,
    now: Point,
    shift: bool,
    editable: &[TransformProp],
) -> Vec<(TransformProp, f64)> {
    let Some(inverse) = invert_affine(frame.parent) else {
        return Vec::new();
    };
    let (start, now) = (apply(&inverse, start), apply(&inverse, now));
    let transform = &frame.transform;
    let anchor = transform.position;
    let can = |prop| editable.contains(&prop);
    let mut values = Vec::new();
    match handle {
        Handle::Move => {
            if can(TransformProp::X) {
                values.push((TransformProp::X, anchor.x + now.x - start.x));
            }
            if can(TransformProp::Y) {
                values.push((TransformProp::Y, anchor.y + now.y - start.y));
            }
        }
        Handle::Rotate => {
            if can(TransformProp::Rotation) {
                let angle = |p: Point| (p.y - anchor.y).atan2(p.x - anchor.x).to_degrees();
                let mut delta = angle(now) - angle(start);
                if delta > 180.0 {
                    delta -= 360.0;
                } else if delta <= -180.0 {
                    delta += 360.0;
                }
                let mut rotation = transform.rotation + delta;
                if shift {
                    rotation = (rotation / SNAP_DEGREES).round() * SNAP_DEGREES;
                }
                values.push((TransformProp::Rotation, rotation));
            }
        }
        Handle::Corner(_) | Handle::Edge(_) => {
            let Some(unturn) = unturn(transform) else {
                return values;
            };
            let local = |p: Point| {
                let v = (p.x - anchor.x, p.y - anchor.y);
                Point {
                    x: unturn[0] * v.0 + unturn[2] * v.1,
                    y: unturn[1] * v.0 + unturn[3] * v.1,
                }
            };
            let (from, to) = (local(start), local(now));
            if can(TransformProp::Scale) {
                let length = from.x * from.x + from.y * from.y;
                if length > 1e-9 {
                    let ratio = ((to.x * from.x + to.y * from.y) / length).max(MIN_SCALE_RATIO);
                    values.push((TransformProp::Scale, transform.scale.x * ratio));
                }
            } else {
                let ratio = |from: f64, to: f64| {
                    (from.abs() > 1e-9).then(|| (to / from).max(MIN_SCALE_RATIO))
                };
                let (x_axis, y_axis) = match handle {
                    Handle::Edge(i) => (i % 2 == 1, i % 2 == 0),
                    _ => (true, true),
                };
                if x_axis
                    && can(TransformProp::ScaleX)
                    && let Some(ratio) = ratio(from.x, to.x)
                {
                    values.push((TransformProp::ScaleX, transform.scale.x * ratio));
                }
                if y_axis
                    && can(TransformProp::ScaleY)
                    && let Some(ratio) = ratio(from.y, to.y)
                {
                    values.push((TransformProp::ScaleY, transform.scale.y * ratio));
                }
            }
        }
    }
    values
}

/// The inverse of the layer's linear part without its scale (its rotation
/// and skew), as `[a, b, c, d]`: takes a parent-space offset from the anchor
/// into the layer's axes, still scaled.
fn unturn(transform: &EvaluatedTransform) -> Option<[f64; 4]> {
    let unscaled = EvaluatedTransform {
        scale: Point { x: 1.0, y: 1.0 },
        ..*transform
    };
    let l = unscaled.linear();
    invert_affine([l[0][0], l[1][0], l[0][1], l[1][1], 0.0, 0.0]).map(|m| [m[0], m[1], m[2], m[3]])
}

/// `frame`'s transform with the drag's `values` in place, to draw while
/// dragging.
pub(crate) fn override_transform(
    frame: &LayerFrame,
    values: &[(TransformProp, f64)],
) -> EvaluatedTransform {
    let mut transform = frame.transform;
    for &(prop, value) in values {
        match prop {
            TransformProp::X => transform.position.x = value,
            TransformProp::Y => transform.position.y = value,
            TransformProp::Rotation => transform.rotation = value,
            TransformProp::Scale => {
                let ratio = ratio(frame.transform.scale.x, value);
                transform.scale.x *= ratio;
                transform.scale.y *= ratio;
            }
            TransformProp::ScaleX => transform.scale.x = value,
            TransformProp::ScaleY => transform.scale.y = value,
        }
    }
    transform
}

fn ratio(was: f64, now: f64) -> f64 {
    if was.abs() > 1e-12 { now / was } else { 1.0 }
}

/// The value the drag started from for `prop`.
fn start_value(frame: &LayerFrame, prop: TransformProp) -> f64 {
    let transform = &frame.transform;
    match prop {
        TransformProp::X => transform.position.x,
        TransformProp::Y => transform.position.y,
        TransformProp::Rotation => transform.rotation,
        TransformProp::Scale | TransformProp::ScaleX => transform.scale.x,
        TransformProp::ScaleY => transform.scale.y,
    }
}

/// The props to write for the drag's `values`: each prop the runtime saw
/// (`received`) moved by the same amount (position, rotation) or ratio
/// (scale) as the transform; the transform's value when it saw none.
pub(crate) fn prop_values(
    frame: &LayerFrame,
    values: &[(TransformProp, f64)],
    received: &ReceivedProps,
) -> Vec<(TransformProp, f64)> {
    values
        .iter()
        .map(|&(prop, value)| {
            let was = start_value(frame, prop);
            let value = match (prop.received(received), prop) {
                (None, _) => value,
                (
                    Some(base),
                    TransformProp::Scale | TransformProp::ScaleX | TransformProp::ScaleY,
                ) => base * ratio(was, value),
                (Some(base), _) => base + value - was,
            };
            (prop, value)
        })
        .collect()
}

/// `x 120 → 184` for each changed value, as written to the source.
pub(crate) fn drag_label(frame: &LayerFrame, values: &[(TransformProp, f64)]) -> String {
    values
        .iter()
        .map(|&(prop, value)| {
            format!(
                "{} {} → {}",
                prop.name(),
                format_number(start_value(frame, prop)),
                format_number(value)
            )
        })
        .collect::<Vec<_>>()
        .join("  ")
}
