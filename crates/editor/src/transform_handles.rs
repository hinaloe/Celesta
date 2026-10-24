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

use crate::canvas_geometry::{apply, keep_fixed, layer_map, local_box, pivot};
use crate::element_edit::{PropKey, TransformProp, received_number};
use celesta_composition::{EvaluatedTransform, Point};
use celesta_gpu_renderer::{LayerFrame, invert_affine};
use celesta_react_bridge::ReceivedProps;
use celesta_source_edit::format_number;

/// What a rotation or scale drag turns about.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub(crate) enum PivotMode {
    /// The center of the layer's box, which stays put: `x`/`y` compensate.
    #[default]
    Center,
    /// The layer's pivot, its anchor point plus `origin`, where the renderer
    /// turns and scales it.
    Pivot,
}

/// The box center a drag of `frame` keeps still under `pivot`, in the
/// layer's own pixels; `None` in Pivot mode, or when the box is unknown (the
/// drag then turns about the pivot).
fn kept_center(frame: &LayerFrame, pivot: PivotMode) -> Option<Point> {
    match pivot {
        PivotMode::Center => local_box(frame).map(|local| local.center()),
        PivotMode::Pivot => None,
    }
}

/// The point a rotation or scale of `frame` turns about under `mode`, in its
/// parent's space: the box center in Center mode, else the pivot.
fn turning_point(frame: &LayerFrame, mode: PivotMode) -> Point {
    let transform = &frame.transform;
    kept_center(frame, mode).map_or_else(
        || pivot(transform),
        |center| apply(&layer_map(transform), center),
    )
}

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
    /// The cross on the pivot, pressed with Alt: moves the anchor, and
    /// `x`/`y` with it so the layer stays where it is.
    Anchor,
}

/// The anchor props an anchor drag writes.
pub(crate) fn anchor_keys() -> [PropKey; 2] {
    ["anchorX", "anchorY"].map(|name| PropKey::Prop(name.to_owned()))
}

/// Where the pivot cross of `frame` sits, in scene pixels.
pub(crate) fn pivot_cross(frame: &LayerFrame) -> Point {
    apply(&frame.parent, pivot(&frame.transform))
}

/// Where the cross an Alt-drag moves the anchor from sits (scene pixels),
/// when `editable` lets it: both anchors, `x` and `y` (which the caller puts
/// in only when they can compensate), and a known box.
pub(crate) fn anchor_handle(frame: &LayerFrame, editable: &[PropKey]) -> Option<Point> {
    let keys = [TransformProp::X.key(), TransformProp::Y.key()];
    let draggable = keys.iter().chain(&anchor_keys()).all(|key| editable.contains(key))
        && local_box(frame).is_some();
    draggable.then(|| pivot_cross(frame))
}

/// The handle a press at `point` (scene pixels) takes: with `alt`, the
/// pivot cross when it is within `radius` and an anchor drag can start
/// there (even over another handle); otherwise the one [`handle_at`] finds.
pub(crate) fn pressed_handle(
    frame: &LayerFrame,
    shown: &[(Handle, Point)],
    editable: &[PropKey],
    point: Point,
    radius: f64,
    alt: bool,
) -> Option<Handle> {
    let on_cross = anchor_handle(frame, editable)
        .is_some_and(|at| (at.x - point.x).hypot(at.y - point.y) <= radius);
    if alt && on_cross {
        return Some(Handle::Anchor);
    }
    handle_at(frame, shown, point, radius)
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

/// How far a rotation drag from `start` to `now` (scene pixels) has turned
/// about the point `pivot` turns about (see [`PivotMode`]), in degrees: the
/// angle between them, plus the whole turns that keep it nearest `previous`
/// (the turn at the previous move), so a drag that goes on past a half turn
/// keeps counting instead of wrapping.
pub(crate) fn turn(
    frame: &LayerFrame,
    pivot: PivotMode,
    start: Point,
    now: Point,
    previous: f64,
) -> Option<f64> {
    let inverse = invert_affine(frame.parent)?;
    let (start, now) = (apply(&inverse, start), apply(&inverse, now));
    let about = turning_point(frame, pivot);
    let angle = |p: Point| (p.y - about.y).atan2(p.x - about.x).to_degrees();
    let raw = angle(now) - angle(start);
    Some(raw + ((previous - raw) / 360.0).round() * 360.0)
}

/// The transform values a drag of `handle` from `start` to `now` (scene
/// pixels) makes, for the props in `editable` only. The pointer moves are
/// taken into the layer's parent space; rotation turns by [`turn`] from
/// `previous_turn` (the result snapped to 15° with `shift`), and scaling
/// keeps the turning point in place, in one ratio for a uniform `Scale`.
/// Both turn about the point `pivot` names (the mode the drag uses, Center
/// only when `x`/`y` can compensate); in Center mode `x`/`y` follow so the
/// box's center stays where it was.
pub(crate) fn drag_values(
    frame: &LayerFrame,
    handle: Handle,
    (start, now): (Point, Point),
    shift: bool,
    previous_turn: f64,
    editable: &[PropKey],
    pivot: PivotMode,
) -> Vec<(PropKey, f64)> {
    let pointer = (start, now);
    let Some(inverse) = invert_affine(frame.parent) else {
        return Vec::new();
    };
    let (start, now) = (apply(&inverse, start), apply(&inverse, now));
    let transform = &frame.transform;
    let can = |prop: TransformProp| editable.contains(&prop.key());
    let mut values = Vec::new();
    let mut push = |prop: TransformProp, value: f64| values.push((prop.key(), value));
    // The props after the drag, with the old position.
    let mut after = *transform;
    match handle {
        Handle::Move => {
            let position = transform.position;
            if can(TransformProp::X) {
                push(TransformProp::X, position.x + now.x - start.x);
            }
            if can(TransformProp::Y) {
                push(TransformProp::Y, position.y + now.y - start.y);
            }
            return values;
        }
        Handle::Anchor => return anchor_values(frame, (start, now), editable),
        Handle::Rotate => {
            if can(TransformProp::Rotation)
                && let Some(delta) = turn(frame, pivot, pointer.0, pointer.1, previous_turn)
            {
                let mut rotation = transform.rotation + delta;
                if shift {
                    rotation = (rotation / SNAP_DEGREES).round() * SNAP_DEGREES;
                }
                push(TransformProp::Rotation, rotation);
                after.rotation = rotation;
            }
        }
        Handle::Corner(_) | Handle::Edge(_) => {
            let Some(unturn) = unturn(transform) else {
                return values;
            };
            let about = turning_point(frame, pivot);
            let local = |p: Point| {
                let v = (p.x - about.x, p.y - about.y);
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
                    let scale = transform.scale.x * ratio;
                    push(TransformProp::Scale, scale);
                    after.scale = Point { x: scale, y: scale };
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
                    after.scale.x = transform.scale.x * ratio;
                    push(TransformProp::ScaleX, after.scale.x);
                }
                if y_axis
                    && can(TransformProp::ScaleY)
                    && let Some(ratio) = ratio(from.y, to.y)
                {
                    after.scale.y = transform.scale.y * ratio;
                    push(TransformProp::ScaleY, after.scale.y);
                }
            }
        }
    }
    // Center mode: move the layer so the box center stays where it was.
    if !values.is_empty()
        && can(TransformProp::X)
        && can(TransformProp::Y)
        && let Some(center) = kept_center(frame, pivot)
    {
        let kept = apply(&layer_map(transform), center);
        let position = keep_fixed(&after, center, kept);
        values.push((TransformProp::X.key(), position.x));
        values.push((TransformProp::Y.key(), position.y));
    }
    values
}

/// The values an anchor drag from `start` to `now` (parent space) makes:
/// the anchor moves by the pointer's move in fractions of the box (not
/// clamped: an anchor outside the box is valid), so the cross follows the
/// pointer, and `x`/`y` move so the box stays where it was. Empty unless
/// [`anchor_handle`] allows the drag.
fn anchor_values(
    frame: &LayerFrame,
    (start, now): (Point, Point),
    editable: &[PropKey],
) -> Vec<(PropKey, f64)> {
    let transform = &frame.transform;
    let map = layer_map(transform);
    let (Some(_), Some(local), Some(inverse)) = (
        anchor_handle(frame, editable),
        local_box(frame),
        invert_affine(map),
    ) else {
        return Vec::new();
    };
    let size = local.size();
    if size.x.abs() < 1e-9 || size.y.abs() < 1e-9 {
        return Vec::new();
    }
    let (from, to) = (apply(&inverse, start), apply(&inverse, now));
    let moved = Point {
        x: (to.x - from.x) / size.x,
        y: (to.y - from.y) / size.y,
    };
    // Own pixels are relative to the anchor point, so every point of the box
    // moves by the opposite offset; keep its top-left corner where it is.
    // The anchor is not part of the map, so the props after are the same.
    let corner = local.min;
    let corner_after = Point {
        x: corner.x - moved.x * size.x,
        y: corner.y - moved.y * size.y,
    };
    let position = keep_fixed(transform, corner_after, apply(&map, corner));
    let [anchor_x, anchor_y] = anchor_keys();
    vec![
        (anchor_x, transform.anchor.x + moved.x),
        (anchor_y, transform.anchor.y + moved.y),
        (TransformProp::X.key(), position.x),
        (TransformProp::Y.key(), position.y),
    ]
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

fn ratio(was: f64, now: f64) -> f64 {
    if was.abs() > 1e-12 { now / was } else { 1.0 }
}

/// The prop name a drag key writes (`x`, `anchorX`); `None` for an input or
/// a component prop, which no drag changes.
fn prop_name(key: &PropKey) -> Option<&str> {
    match key {
        PropKey::Prop(name) => Some(name),
        PropKey::Input { .. } | PropKey::CallSite(_) => None,
    }
}

/// The value the drag started from for `key`: the evaluated transform's
/// field for a transform prop or an anchor. `None` for any other prop: a
/// size's start is the layer's box, which the Rect tool reads; no drag
/// changes a size yet.
fn start_value(frame: &LayerFrame, key: &PropKey) -> Option<f64> {
    let transform = &frame.transform;
    if let Some(prop) = TransformProp::from_key(key) {
        return Some(match prop {
            TransformProp::X => transform.position.x,
            TransformProp::Y => transform.position.y,
            TransformProp::Rotation => transform.rotation,
            TransformProp::Scale | TransformProp::ScaleX => transform.scale.x,
            TransformProp::ScaleY => transform.scale.y,
        });
    }
    match prop_name(key)? {
        "anchorX" => Some(transform.anchor.x),
        "anchorY" => Some(transform.anchor.y),
        _ => None,
    }
}

/// Whether `key` is a scale, which a drag changes by a ratio.
fn is_scale(key: &PropKey) -> bool {
    matches!(
        TransformProp::from_key(key),
        Some(TransformProp::Scale | TransformProp::ScaleX | TransformProp::ScaleY)
    )
}

/// Each prop of the drag's `values` as the source has it (`was`) and as the
/// drag writes it (`now`): the prop the runtime saw (`received`) moved by the
/// same amount (position, anchors, rotation) or ratio (scales) as the
/// evaluated value; the evaluated value when it saw none. A prop without a
/// start value (see `start_value`) is left out.
fn prop_changes(
    frame: &LayerFrame,
    values: &[(PropKey, f64)],
    received: &ReceivedProps,
) -> Vec<(PropKey, f64, f64)> {
    values
        .iter()
        .filter_map(|(key, value)| {
            let start = start_value(frame, key)?;
            let was = received_number(received, prop_name(key)?).unwrap_or(start);
            let now = if is_scale(key) {
                was * ratio(start, *value)
            } else {
                was + value - start
            };
            Some((key.clone(), was, now))
        })
        .collect()
}

/// The props to write for the drag's `values` (see `prop_changes`), leaving
/// out those the source would keep as written (same formatted number). Empty
/// when the drag changed nothing.
pub(crate) fn prop_values(
    frame: &LayerFrame,
    values: &[(PropKey, f64)],
    received: &ReceivedProps,
) -> Vec<(PropKey, f64)> {
    prop_changes(frame, values, received)
        .into_iter()
        .filter(|&(_, was, now)| format_number(was) != format_number(now))
        .map(|(key, _, now)| (key, now))
        .collect()
}

/// The value of every prop `handle` changes in a drag (of those in
/// `editable`, turning about what `pivot` names), for the preview: the
/// drag's for the props it changed (see `prop_values`), and the one the
/// runtime saw when the drag started for the others. The props are the same
/// on every frame of the drag, so the preview's overrides keep their
/// positions and the runtime never remounts for a new one.
pub(crate) fn preview_values(
    frame: &LayerFrame,
    handle: Handle,
    editable: &[PropKey],
    values: &[(PropKey, f64)],
    received: &ReceivedProps,
    pivot: PivotMode,
) -> Vec<(PropKey, f64)> {
    let changed = prop_values(frame, values, received);
    handle_props(handle, editable, pivot)
        .into_iter()
        .filter_map(|key| {
            let value = match changed.iter().find(|(candidate, _)| *candidate == key) {
                Some(&(_, value)) => value,
                None => prop_name(&key)
                    .and_then(|name| received_number(received, name))
                    .or_else(|| start_value(frame, &key))?,
            };
            Some((key, value))
        })
        .collect()
}

/// The props of `editable` a drag of `handle` may change (see `drag_values`):
/// in Center mode a rotation or scale also moves `x`/`y`.
fn handle_props(handle: Handle, editable: &[PropKey], pivot: PivotMode) -> Vec<PropKey> {
    if handle == Handle::Anchor {
        let mut props = anchor_keys().to_vec();
        props.extend([TransformProp::X.key(), TransformProp::Y.key()]);
        props.retain(|key| editable.contains(key));
        return props;
    }
    let uniform = editable.contains(&TransformProp::Scale.key());
    let props: &[TransformProp] = match handle {
        Handle::Move | Handle::Anchor => &[TransformProp::X, TransformProp::Y],
        Handle::Rotate => &[TransformProp::Rotation],
        _ if uniform => &[TransformProp::Scale],
        Handle::Edge(i) if i % 2 == 1 => &[TransformProp::ScaleX],
        Handle::Edge(_) => &[TransformProp::ScaleY],
        Handle::Corner(_) => &[TransformProp::ScaleX, TransformProp::ScaleY],
    };
    let compensation: &[TransformProp] = match (handle, pivot) {
        (Handle::Move | Handle::Anchor, _) | (_, PivotMode::Pivot) => &[],
        (_, PivotMode::Center) => &[TransformProp::X, TransformProp::Y],
    };
    props
        .iter()
        .chain(compensation)
        .map(|prop| prop.key())
        .filter(|key| editable.contains(key))
        .collect()
}

/// `x 120 → 184` for each prop the drag writes, with the values as written
/// to the source.
pub(crate) fn drag_label(
    frame: &LayerFrame,
    values: &[(PropKey, f64)],
    received: &ReceivedProps,
) -> String {
    prop_changes(frame, values, received)
        .into_iter()
        .filter(|&(_, was, now)| format_number(was) != format_number(now))
        .map(|(key, was, now)| {
            format!(
                "{} {} → {}",
                prop_name(&key).unwrap_or_default(),
                format_number(was),
                format_number(now)
            )
        })
        .collect::<Vec<_>>()
        .join("  ")
}

/// The offset of `point` (scene pixels) from `about` (parent space) in the
/// layer's own axes, still scaled; `None` when the parent or the layer
/// collapses.
fn local_offset(frame: &LayerFrame, point: Point, about: Point) -> Option<Point> {
    let inverse = invert_affine(frame.parent)?;
    let unturn = unturn(&frame.transform)?;
    let p = apply(&inverse, point);
    let v = (p.x - about.x, p.y - about.y);
    Some(Point {
        x: unturn[0] * v.0 + unturn[2] * v.1,
        y: unturn[1] * v.0 + unturn[3] * v.1,
    })
}

/// Below this many scene pixels from the turning point's lines, a scale
/// handle has nothing to scale.
const ON_ANCHOR: f64 = 1e-6;

/// The handles that can change something for `editable`: corners and edges
/// whose drag scales an editable axis (not on the point `pivot` turns about,
/// or on its line for that axis), edges only for a per-axis scale, and the
/// rotation handle with `Rotation`.
pub(crate) fn shown_handles(
    frame: &LayerFrame,
    editable: &[PropKey],
    stem: f64,
    pivot: PivotMode,
) -> Vec<(Handle, Point)> {
    let about = turning_point(frame, pivot);
    let can = |prop: TransformProp| editable.contains(&prop.key());
    let uniform = can(TransformProp::Scale);
    let scales_x = uniform || can(TransformProp::ScaleX);
    let scales_y = uniform || can(TransformProp::ScaleY);
    let rotates = can(TransformProp::Rotation);
    handles(frame, uniform, stem)
        .into_iter()
        .filter(|&(handle, at)| {
            let reaches = |x_axis: bool, y_axis: bool| {
                local_offset(frame, at, about).is_some_and(|offset| {
                    (x_axis && scales_x && offset.x.abs() > ON_ANCHOR)
                        || (y_axis && scales_y && offset.y.abs() > ON_ANCHOR)
                })
            };
            match handle {
                Handle::Corner(_) => reaches(true, true),
                Handle::Edge(i) => reaches(i % 2 == 1, i % 2 == 0),
                Handle::Rotate => rotates,
                Handle::Move | Handle::Anchor => true,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas_geometry::box_frame;
    use celesta_react_bridge::ReceivedValue;

    fn anchor_key(axis: &str) -> PropKey {
        PropKey::Prop(format!("anchor{axis}"))
    }

    #[test]
    fn received_offset_applies_to_anchors_and_sizes() {
        // Evaluated anchor (0.5, 0.5); the runtime saw `anchorX` 0.25 and no
        // `anchorY`.
        let frame = LayerFrame {
            transform: EvaluatedTransform {
                anchor: Point { x: 0.5, y: 0.5 },
                ..EvaluatedTransform::default()
            },
            parent: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            outline: [Point { x: 0.0, y: 0.0 }; 4],
            leaves: Vec::new(),
        };
        let received = ReceivedProps {
            others: [("anchorX".to_owned(), ReceivedValue::Number(0.25))].into(),
            ..ReceivedProps::default()
        };
        // The drag moves each anchor by +0.1.
        let values = [(anchor_key("X"), 0.6), (anchor_key("Y"), 0.6)];
        let written = prop_values(&frame, &values, &received);
        assert_eq!(
            written
                .iter()
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>(),
            vec![anchor_key("X"), anchor_key("Y")]
        );
        assert!((written[0].1 - 0.35).abs() < 1e-9, "{written:?}");
        assert!((written[1].1 - 0.6).abs() < 1e-9, "{written:?}");
        assert_eq!(
            drag_label(&frame, &values, &received),
            "anchorX 0.25 → 0.35  anchorY 0.5 → 0.6"
        );
    }

    fn at(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

    fn assert_close(actual: Point, expected: Point) {
        assert!(
            (actual.x - expected.x).abs() < 1e-6 && (actual.y - expected.y).abs() < 1e-6,
            "{actual:?} != {expected:?}"
        );
    }

    fn keys(props: &[TransformProp]) -> Vec<PropKey> {
        props.iter().map(|prop| prop.key()).collect()
    }

    fn uniform() -> Vec<PropKey> {
        keys(&[
            TransformProp::X,
            TransformProp::Y,
            TransformProp::Rotation,
            TransformProp::Scale,
        ])
    }

    fn per_axis() -> Vec<PropKey> {
        keys(&[
            TransformProp::X,
            TransformProp::Y,
            TransformProp::Rotation,
            TransformProp::ScaleX,
            TransformProp::ScaleY,
        ])
    }

    /// A parent turned 45° and scaled 2, moved off the origin.
    fn turned_parent() -> [f64; 6] {
        let (sin, cos) = 45.0_f64.to_radians().sin_cos();
        [2.0 * cos, 2.0 * sin, -2.0 * sin, 2.0 * cos, 30.0, -20.0]
    }

    /// `transform` with the drag's `values` put in.
    fn moved(transform: &EvaluatedTransform, values: &[(PropKey, f64)]) -> EvaluatedTransform {
        let mut after = *transform;
        for (key, value) in values {
            match TransformProp::from_key(key) {
                Some(TransformProp::X) => after.position.x = *value,
                Some(TransformProp::Y) => after.position.y = *value,
                Some(TransformProp::Rotation) => after.rotation = *value,
                Some(TransformProp::Scale) => after.scale = at(*value, *value),
                Some(TransformProp::ScaleX) => after.scale.x = *value,
                Some(TransformProp::ScaleY) => after.scale.y = *value,
                None => match prop_name(key) {
                    Some("anchorX") => after.anchor.x = *value,
                    Some("anchorY") => after.anchor.y = *value,
                    _ => panic!("not a drag prop: {key:?}"),
                },
            }
        }
        after
    }

    /// Where `local` (own pixels of `transform`) lands in the scene.
    fn scene(frame: &LayerFrame, transform: &EvaluatedTransform, local: Point) -> Point {
        apply(&frame.parent, apply(&layer_map(transform), local))
    }

    /// `point` turned by `degrees` (clockwise on screen) about `about`.
    fn turned(about: Point, point: Point, degrees: f64) -> Point {
        let (sin, cos) = degrees.to_radians().sin_cos();
        let (dx, dy) = (point.x - about.x, point.y - about.y);
        at(
            about.x + dx * cos - dy * sin,
            about.y + dx * sin + dy * cos,
        )
    }

    fn names(values: &[(PropKey, f64)]) -> Vec<&str> {
        values
            .iter()
            .filter_map(|(key, _)| prop_name(key))
            .collect()
    }

    fn value(values: &[(PropKey, f64)], prop: TransformProp) -> f64 {
        values
            .iter()
            .find(|(key, _)| *key == prop.key())
            .map(|(_, value)| *value)
            .unwrap_or_else(|| panic!("no {}: {values:?}", prop.name()))
    }

    /// A 100 × 50 `Rect` anchored at its top-left corner at (10, 10).
    fn top_left_rect() -> EvaluatedTransform {
        EvaluatedTransform {
            position: at(10.0, 10.0),
            anchor: at(0.0, 0.0),
            ..EvaluatedTransform::default()
        }
    }

    #[test]
    fn center_rotation_keeps_the_box_center() {
        let before = top_left_rect();
        let frame = box_frame(before, turned_parent(), 100.0, 50.0);
        let center = at(50.0, 25.0);
        let middle = scene(&frame, &before, center);
        let start = at(middle.x + 100.0, middle.y);
        let values = drag_values(
            &frame,
            Handle::Rotate,
            (start, turned(middle, start, 30.0)),
            false,
            0.0,
            &uniform(),
            PivotMode::Center,
        );
        assert_eq!(names(&values), ["rotation", "x", "y"]);
        assert!((value(&values, TransformProp::Rotation) - 30.0).abs() < 1e-9);
        let after = moved(&before, &values);
        assert_close(scene(&frame, &after, center), middle);
    }

    #[test]
    fn center_scale_keeps_the_box_center() {
        let before = EvaluatedTransform {
            rotation: 20.0,
            ..top_left_rect()
        };
        let frame = box_frame(before, turned_parent(), 100.0, 50.0);
        let (center, corner) = (at(50.0, 25.0), at(100.0, 50.0));
        let middle = scene(&frame, &before, center);
        let start = scene(&frame, &before, corner);

        // Uniform: the corner dragged half again as far from the center.
        let now = at(
            middle.x + 1.5 * (start.x - middle.x),
            middle.y + 1.5 * (start.y - middle.y),
        );
        let values = drag_values(
            &frame,
            Handle::Corner(2),
            (start, now),
            false,
            0.0,
            &uniform(),
            PivotMode::Center,
        );
        assert_eq!(names(&values), ["scale", "x", "y"]);
        assert!((value(&values, TransformProp::Scale) - 1.5).abs() < 1e-9);
        let after = moved(&before, &values);
        assert_close(scene(&frame, &after, center), middle);
        assert_close(scene(&frame, &after, corner), now);

        // Per axis: twice as wide and 1.2 times as tall about the center.
        let now = scene(&frame, &before, at(150.0, 55.0));
        let values = drag_values(
            &frame,
            Handle::Corner(2),
            (start, now),
            false,
            0.0,
            &per_axis(),
            PivotMode::Center,
        );
        assert_eq!(names(&values), ["scaleX", "scaleY", "x", "y"]);
        assert!((value(&values, TransformProp::ScaleX) - 2.0).abs() < 1e-9);
        assert!((value(&values, TransformProp::ScaleY) - 1.2).abs() < 1e-9);
        let after = moved(&before, &values);
        assert_close(scene(&frame, &after, center), middle);
        assert_close(scene(&frame, &after, corner), now);
    }

    #[test]
    fn pivot_mode_turns_about_anchor_and_origin() {
        let before = EvaluatedTransform {
            origin: at(40.0, 0.0),
            ..top_left_rect()
        };
        let frame = box_frame(before, turned_parent(), 100.0, 50.0);
        let turning = apply(&frame.parent, pivot(&before));
        let start = at(turning.x + 100.0, turning.y);
        let values = drag_values(
            &frame,
            Handle::Rotate,
            (start, turned(turning, start, 30.0)),
            false,
            0.0,
            &uniform(),
            PivotMode::Pivot,
        );
        // Measured about anchor + origin, and nothing compensates.
        assert_eq!(names(&values), ["rotation"]);
        assert!((value(&values, TransformProp::Rotation) - 30.0).abs() < 1e-9);
        let after = moved(&before, &values);
        assert_close(scene(&frame, &after, before.origin), turning);

        // A scale keeps it too, and measures from it.
        let start = scene(&frame, &before, at(100.0, 50.0));
        let now = at(
            turning.x + 2.0 * (start.x - turning.x),
            turning.y + 2.0 * (start.y - turning.y),
        );
        let values = drag_values(
            &frame,
            Handle::Corner(2),
            (start, now),
            false,
            0.0,
            &uniform(),
            PivotMode::Pivot,
        );
        assert_eq!(names(&values), ["scale"]);
        assert!((value(&values, TransformProp::Scale) - 2.0).abs() < 1e-9);
        let after = moved(&before, &values);
        assert_close(scene(&frame, &after, before.origin), turning);
    }

    #[test]
    fn center_mode_preview_overrides_x_and_y_from_the_first_move() {
        let before = top_left_rect();
        let frame = box_frame(before, turned_parent(), 100.0, 50.0);
        let middle = scene(&frame, &before, at(50.0, 25.0));
        let start = at(middle.x + 100.0, middle.y);
        // The first move: a hair, which writes nothing yet.
        let values = drag_values(
            &frame,
            Handle::Rotate,
            (start, turned(middle, start, 1e-9)),
            false,
            0.0,
            &uniform(),
            PivotMode::Center,
        );
        let received = ReceivedProps::default();
        assert!(prop_values(&frame, &values, &received).is_empty());
        let preview = |handle, editable: &[PropKey], pivot| {
            preview_values(&frame, handle, editable, &values, &received, pivot)
        };
        assert_eq!(
            names(&preview(Handle::Rotate, &uniform(), PivotMode::Center)),
            ["rotation", "x", "y"]
        );
        assert_eq!(
            names(&preview(Handle::Corner(1), &per_axis(), PivotMode::Center)),
            ["scaleX", "scaleY", "x", "y"]
        );
        assert_eq!(
            names(&preview(Handle::Edge(0), &uniform(), PivotMode::Center)),
            ["scale", "x", "y"]
        );
        // About the pivot nothing compensates.
        assert_eq!(
            names(&preview(Handle::Rotate, &uniform(), PivotMode::Pivot)),
            ["rotation"]
        );
    }

    /// `x`, `y` and both anchors.
    fn anchor_props() -> Vec<PropKey> {
        let mut props = keys(&[TransformProp::X, TransformProp::Y]);
        props.extend([anchor_key("X"), anchor_key("Y")]);
        props
    }

    fn assert_same_outline(after: &LayerFrame, before: &LayerFrame) {
        for (now, was) in after.outline.iter().zip(&before.outline) {
            assert_close(*now, *was);
        }
    }

    #[test]
    fn an_anchor_drag_keeps_the_layer_on_screen() {
        let parent = [2.0, 0.0, 0.0, 2.0, 5.0, -5.0];
        for origin in [at(0.0, 0.0), at(10.0, -5.0)] {
            let before = EvaluatedTransform {
                position: at(30.0, 40.0),
                rotation: 30.0,
                scale: at(1.5, 1.5),
                anchor: at(0.0, 0.0),
                origin,
                ..EvaluatedTransform::default()
            };
            let frame = box_frame(before, parent, 100.0, 50.0);
            // From the cross to the box's middle.
            let cross = apply(&parent, pivot(&before));
            // The cross is at the origin in own pixels: move it by half the
            // box.
            let middle = scene(&frame, &before, at(50.0 + origin.x, 25.0 + origin.y));
            let values = drag_values(
                &frame,
                Handle::Anchor,
                (cross, middle),
                false,
                0.0,
                &anchor_props(),
                PivotMode::Center,
            );
            assert_eq!(names(&values), ["anchorX", "anchorY", "x", "y"]);
            let after = moved(&before, &values);
            assert!((after.anchor.x - 0.5).abs() < 1e-9, "{values:?}");
            assert!((after.anchor.y - 0.5).abs() < 1e-9, "{values:?}");
            // Every corner stays where it was; the cross is now where the
            // pointer let go.
            let moved_frame = box_frame(after, parent, 100.0, 50.0);
            assert_same_outline(&moved_frame, &frame);
            assert_close(apply(&parent, pivot(&after)), middle);
        }
    }

    #[test]
    fn anchor_values_are_fractions_of_the_box() {
        let before = EvaluatedTransform {
            anchor: at(0.0, 0.0),
            ..EvaluatedTransform::default()
        };
        let frame = box_frame(before, IDENTITY, 200.0, 100.0);
        let values = drag_values(
            &frame,
            Handle::Anchor,
            (at(0.0, 0.0), at(50.0, 25.0)),
            false,
            0.0,
            &anchor_props(),
            PivotMode::Pivot,
        );
        let expected = [0.25, 0.25, 50.0, 25.0];
        assert_eq!(names(&values), ["anchorX", "anchorY", "x", "y"]);
        for ((_, value), expected) in values.iter().zip(expected) {
            assert!((value - expected).abs() < 1e-9, "{values:?}");
        }
        // Past the box: an anchor outside it is kept as it is.
        let values = drag_values(
            &frame,
            Handle::Anchor,
            (at(0.0, 0.0), at(-100.0, 150.0)),
            false,
            0.0,
            &anchor_props(),
            PivotMode::Pivot,
        );
        assert!((values[0].1 + 0.5).abs() < 1e-9, "{values:?}");
        assert!((values[1].1 - 1.5).abs() < 1e-9, "{values:?}");
        // The preview overrides all four from the first move.
        assert_eq!(
            names(&preview_values(
                &frame,
                Handle::Anchor,
                &anchor_props(),
                &[],
                &ReceivedProps::default(),
                PivotMode::Pivot,
            )),
            ["anchorX", "anchorY", "x", "y"]
        );
    }

    #[test]
    fn alt_on_the_cross_takes_the_anchor() {
        let before = EvaluatedTransform {
            position: at(50.0, 30.0),
            anchor: at(0.5, 0.5),
            ..EvaluatedTransform::default()
        };
        let frame = box_frame(before, IDENTITY, 100.0, 60.0);
        let mut editable = uniform();
        editable.extend([anchor_key("X"), anchor_key("Y")]);
        let shown = shown_handles(&frame, &editable, 20.0, PivotMode::Center);
        let press = |point, alt| pressed_handle(&frame, &shown, &editable, point, 4.0, alt);
        assert_eq!(anchor_handle(&frame, &editable), Some(at(50.0, 30.0)));
        // Without Alt the cross is the body.
        assert_eq!(press(at(51.0, 31.0), false), Some(Handle::Move));
        assert_eq!(press(at(51.0, 31.0), true), Some(Handle::Anchor));
        // Off the cross Alt changes nothing.
        assert_eq!(press(at(0.0, 0.0), true), Some(Handle::Corner(0)));
        // Without the anchors there is no cross to drag.
        let shown = shown_handles(&frame, &uniform(), 20.0, PivotMode::Center);
        assert_eq!(anchor_handle(&frame, &uniform()), None);
        assert_eq!(
            pressed_handle(&frame, &shown, &uniform(), at(50.0, 30.0), 4.0, true),
            Some(Handle::Move)
        );
    }
}
