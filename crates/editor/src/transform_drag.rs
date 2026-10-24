//! Dragging the selected React layer on the canvas: which props the drag may
//! change, the prop overrides the preview evaluates the scene with while it
//! runs, and the one write on release.

use crate::element_edit::{
    ElementTargets, PropKey, TransformProp, editable, inner_target, reason_text,
};
use crate::canvas_geometry::local_box;
use crate::layer_select::{letterbox, to_scene};
use crate::transform_handles::{
    Handle, PivotMode, drag_label, drag_values, handle_at, preview_values, prop_values,
    shown_handles, turn,
};
use crate::view::EditorView;
use celesta_composition::Point;
use celesta_gpu_renderer::LayerFrame;
use celesta_react_bridge::{LayerSourceReport, PropOverride, ReceivedProps, SourcePos};
use celesta_source_edit::{EditTarget, EditValue};
use gpui_kit::{Context, MouseMoveEvent};

/// Side of a square handle, in viewer pixels.
pub(crate) const HANDLE_SIZE: f32 = 7.0;
/// Length of the rotation handle's stem, in viewer pixels.
pub(crate) const ROTATE_STEM: f32 = 20.0;
/// How far from a handle's center a press still takes it, in viewer pixels.
const HANDLE_REACH: f32 = 6.0;

pub(crate) const NO_AFFINE_FRAME: &str = "Can't drag inside a 3D-transformed or collapsed group";

/// A running (or released and being written) drag of the selected layer.
#[derive(Clone, Debug)]
pub(crate) struct TransformDrag {
    /// The layer's frame when the drag started; every move is measured
    /// against it, not against the frames drawn with the overrides.
    frame: LayerFrame,
    handle: Handle,
    start: Point,
    editable: Vec<PropKey>,
    /// What a rotation or scale turns about, as used (see `pivot_used`).
    pivot: PivotMode,
    /// The props the runtime saw when the drag started.
    received: ReceivedProps,
    /// Where the runtime takes each editable prop's dragged value, kept from
    /// the start: the targets are gone while the write runs.
    sites: Vec<(PropKey, OverrideSite)>,
    /// How far a rotation drag has turned so far, unsnapped, in degrees.
    turned: f64,
    /// The values the pointer has made so far, by prop.
    values: Vec<(PropKey, f64)>,
    /// Released; the overrides stay while the write runs and, after a
    /// successful one, until its reload, so the old position does not flash
    /// before the reloaded code draws the new one.
    released: bool,
}

impl TransformDrag {
    /// A drag of `handle` pressed at `start` (scene pixels), before the
    /// pointer moves.
    pub(crate) fn new(
        frame: LayerFrame,
        handle: Handle,
        start: Point,
        editable: Vec<PropKey>,
        pivot: PivotMode,
        received: ReceivedProps,
        sites: Vec<(PropKey, OverrideSite)>,
    ) -> Self {
        Self {
            frame,
            handle,
            start,
            editable,
            pivot,
            received,
            sites,
            turned: 0.0,
            values: Vec::new(),
            released: false,
        }
    }

    /// Takes the values the pointer made; true when they changed.
    pub(crate) fn follow(&mut self, values: Vec<(PropKey, f64)>) -> bool {
        let changed = values != self.values;
        self.values = values;
        changed
    }

    /// The prop overrides the preview evaluates the scene with: the values
    /// the write puts into the source, so the frame shows what the write will
    /// produce. None before the pointer moves, nor while `playing`. From the
    /// first move on, every prop the handle can change is overridden, changed
    /// or not, so the positions stay the same for the whole drag: the runtime
    /// remounts the entry when they change, which is then only when the drag
    /// starts and when it is cancelled.
    pub(crate) fn overrides(&self, playing: bool) -> Vec<PropOverride> {
        if playing || self.values.is_empty() {
            return Vec::new();
        }
        prop_overrides(
            &self.sites,
            &preview_values(
                &self.frame,
                self.handle,
                &self.editable,
                &self.values,
                &self.received,
                self.pivot,
            ),
        )
    }
}

/// The prop `prop` of the elements written at `position`: where the runtime
/// takes a dragged or scrubbed value while the pointer moves.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct OverrideSite {
    position: SourcePos,
    prop: String,
}

impl OverrideSite {
    /// The override drawing `value` here.
    pub(crate) fn with(&self, value: f64) -> PropOverride {
        PropOverride {
            file: self.position.file.clone(),
            line: self.position.line,
            column: self.position.column,
            prop: self.prop.clone(),
            value,
        }
    }
}

/// Where each editable row and component prop of `targets` takes a value
/// the pointer makes: the prop at the row's resolved path on the element
/// (`report`'s innermost entry; `style.fontSize` for a `Text` font row the
/// `style` object sets) for a value written there or absent, the
/// parameter's prop at the call site for a value passed through, which also
/// moves everything else computed from it, and a component prop at the
/// component's call. The same prop the write changes. Inputs have none: a
/// value an expression reads is not a prop.
pub(crate) fn override_sites(
    targets: &ElementTargets,
    report: &LayerSourceReport,
) -> Vec<(PropKey, OverrideSite)> {
    let element = report.chain.first().map(SourcePos::from);
    let component = targets
        .component
        .as_ref()
        .map(|component| &component.call_site);
    targets
        .entries()
        .into_iter()
        .filter(|(_, target)| editable(&target.target))
        .filter_map(|(key, target)| {
            // Where a value not passed through is written.
            let written = match &key {
                PropKey::Prop(_) => element.as_ref(),
                PropKey::CallSite(_) => component,
                PropKey::Input { .. } => return None,
            };
            let site = match (&target.target, &target.call_site) {
                (EditTarget::PassThrough { param, .. }, Some(call_site)) => OverrideSite {
                    position: call_site.clone(),
                    prop: param.clone(),
                },
                (EditTarget::PassThrough { .. }, None) => return None,
                _ => OverrideSite {
                    position: written?.clone(),
                    prop: target.path.clone(),
                },
            };
            Some((key, site))
        })
        .collect()
}

/// The overrides that draw the drag values `values` (see `prop_values`).
pub(crate) fn prop_overrides(
    sites: &[(PropKey, OverrideSite)],
    values: &[(PropKey, f64)],
) -> Vec<PropOverride> {
    values
        .iter()
        .filter_map(|(key, value)| {
            let (_, site) = sites.iter().find(|(candidate, _)| candidate == key)?;
            Some(site.with(*value))
        })
        .collect()
}

/// What the canvas can do with the selected layer.
pub(crate) enum DragState {
    /// No frame or no targets yet: the outline only.
    Unknown,
    /// The layer has no affine frame.
    NoFrame,
    /// Every prop is locked; the first reason.
    Locked(LayerFrame, String),
    /// Draggable with these props, rotating and scaling about what the
    /// `PivotMode` names (the mode used, see `pivot_used`).
    Editable(LayerFrame, Vec<PropKey>, PivotMode),
}

/// Whether `x` and `y` can absorb a compensation: `Literal` or `Missing`
/// (directly or through a pass-through), never `Keyframe` or locked. A
/// keyframe would move at that keyframe only, and the layer would orbit
/// between them.
pub(crate) fn compensable(targets: &ElementTargets) -> bool {
    [TransformProp::X, TransformProp::Y].into_iter().all(|prop| {
        matches!(
            targets.transform(prop).map(inner_target),
            Some(EditTarget::Literal { .. } | EditTarget::Missing { .. })
        )
    })
}

/// The mode a drag of the layer `frame` measures uses when `choice` is
/// chosen: Center only when `x`/`y` can compensate and the layer's box is
/// known; the pivot otherwise.
pub(crate) fn pivot_used(
    choice: PivotMode,
    targets: &ElementTargets,
    frame: &LayerFrame,
) -> PivotMode {
    match choice {
        PivotMode::Center if compensable(targets) && local_box(frame).is_some() => {
            PivotMode::Center
        }
        _ => PivotMode::Pivot,
    }
}

/// The props a canvas drag of the element may change: its editable
/// transform props, in row order.
pub(crate) fn drag_props(targets: &ElementTargets) -> Vec<PropKey> {
    TransformProp::ALL
        .into_iter()
        .filter(|prop| targets.transform(*prop).is_some_and(editable))
        .map(TransformProp::key)
        .collect()
}

impl EditorView {
    /// The selected layer's measured frame, when it is the selected one.
    pub(crate) fn selected_frame(&self) -> Option<Option<&LayerFrame>> {
        let selected = self.selected_layer.as_deref()?;
        self.layer_frame
            .as_ref()
            .filter(|(id, _)| id == selected)
            .map(|(_, frame)| frame.as_ref())
    }

    /// What dragging the selected layer can change, for the canvas.
    pub(crate) fn drag_state(&self) -> DragState {
        if !self.picks_layers() || self.playing {
            return DragState::Unknown;
        }
        let frame = match self.selected_frame() {
            None => return DragState::Unknown,
            Some(None) => return DragState::NoFrame,
            Some(Some(frame)) => frame.clone(),
        };
        // While dragging, the props stay those the drag began with; the
        // frame is the one drawn with the overrides, so the handles follow.
        if let Some(drag) = &self.transform_drag {
            return DragState::Editable(frame, drag.editable.clone(), drag.pivot);
        }
        let Some((targets, _)) = self.element_targets() else {
            return DragState::Unknown;
        };
        let props = drag_props(targets);
        if props.is_empty() {
            let reason = TransformProp::ALL
                .into_iter()
                .filter_map(|prop| targets.transform(prop))
                .find_map(|target| match inner_target(target) {
                    EditTarget::Locked(reason) => Some(reason_text(reason)),
                    _ => None,
                })
                .unwrap_or_default();
            return DragState::Locked(frame, reason);
        }
        let pivot = pivot_used(self.pivot_mode, targets, &frame);
        DragState::Editable(frame, props, pivot)
    }

    /// The pivot mode the viewer's toggle shows: the one a drag of the
    /// selected layer uses (the chosen one without a draggable selection),
    /// and whether Center is chosen but the layer's `x`/`y` can't
    /// compensate.
    pub(crate) fn shown_pivot_mode(&self) -> (PivotMode, bool) {
        let DragState::Editable(_, _, used) = self.drag_state() else {
            return (self.pivot_mode, false);
        };
        let fixed = self.pivot_mode == PivotMode::Center
            && used == PivotMode::Pivot
            && self
                .element_targets()
                .is_some_and(|(targets, _)| !compensable(targets));
        (used, fixed)
    }

    /// The prop overrides the preview evaluates the scene with while a drag
    /// or a row's scrub runs (see `TransformDrag::overrides`,
    /// `Scrub::overrides`); the two never run together.
    pub(crate) fn prop_overrides(&self) -> Vec<PropOverride> {
        let drag = self
            .transform_drag
            .iter()
            .flat_map(|drag| drag.overrides(self.playing));
        let scrub = self
            .element_rows
            .scrub
            .iter()
            .flat_map(|scrub| scrub.overrides(self.playing));
        drag.chain(scrub).collect()
    }

    /// The drag's `x 120 → 184` label, once the pointer changed something.
    pub(crate) fn transform_drag_label(&self) -> Option<String> {
        let drag = self.transform_drag.as_ref()?;
        let label = drag_label(&drag.frame, &drag.values, &drag.received);
        (!label.is_empty()).then_some(label)
    }

    /// Whether a drag is running with the button down (not one released and
    /// being written).
    pub(crate) fn transform_drag_active(&self) -> bool {
        self.transform_drag
            .as_ref()
            .is_some_and(|drag| !drag.released)
    }

    /// Whether a released drag is being written, or waits for the reload
    /// that draws its values.
    pub(crate) fn transform_drag_released(&self) -> bool {
        self.transform_drag
            .as_ref()
            .is_some_and(|drag| drag.released)
    }

    /// Starts a drag when `position` (window pixels) is on a handle of the
    /// selected layer, or on its body with the layer topmost there. True when
    /// a drag started.
    pub(crate) fn begin_transform_drag(
        &mut self,
        position: gpui_kit::Point<gpui_kit::Pixels>,
        topmost: Option<&str>,
    ) -> bool {
        // Only a pressed drag takes the click; while a released one is being
        // written, clicks select as usual (and no second drag starts).
        if let Some(drag) = &self.transform_drag {
            return !drag.released;
        }
        // Nor while a released scrub is: its override stays until the reload
        // draws the written value.
        if self.row_scrub_released() {
            return false;
        }
        let DragState::Editable(frame, editable, pivot) = self.drag_state() else {
            return false;
        };
        let Some((received, sites)) = self
            .element_targets()
            .map(|(targets, report)| (report.props.clone(), override_sites(targets, report)))
        else {
            return false;
        };
        let Some(bounds) = self.viewer_bounds.get() else {
            return false;
        };
        let size = self.frame_size();
        let (Some((_, _, scale)), Some(start)) =
            (letterbox(bounds, size), to_scene(bounds, size, position))
        else {
            return false;
        };
        let scale = f64::from(scale);
        let shown = shown_handles(&frame, &editable, f64::from(ROTATE_STEM) / scale, pivot);
        let handle = match handle_at(&frame, &shown, start, f64::from(HANDLE_REACH) / scale) {
            Some(Handle::Move)
                if presses_body(&frame, topmost)
                    && (editable.contains(&TransformProp::X.key())
                        || editable.contains(&TransformProp::Y.key())) =>
            {
                Handle::Move
            }
            Some(Handle::Move) | None => return false,
            Some(handle) => handle,
        };
        // A pressed scrub ends unwritten: the two never run together.
        if self.row_scrub_active() {
            self.cancel_row_scrub();
        }
        self.transform_drag = Some(TransformDrag::new(
            frame, handle, start, editable, pivot, received, sites,
        ));
        true
    }

    /// Follows the pointer: recomputes the values and redraws the frame with
    /// them. Writes nothing.
    pub(crate) fn continue_transform_drag(
        &mut self,
        event: &MouseMoveEvent,
        cx: &mut Context<Self>,
    ) {
        // The button came up where the view did not see it: end there.
        if !event.dragging() {
            if self.end_transform_drag(cx) {
                cx.notify();
            }
            return;
        }
        let Some(bounds) = self.viewer_bounds.get() else {
            return;
        };
        let size = self.frame_size();
        let Some(drag) = self.transform_drag.as_mut().filter(|drag| !drag.released) else {
            return;
        };
        let Some(now) = to_scene(bounds, size, event.position) else {
            return;
        };
        let values = drag_values(
            &drag.frame,
            drag.handle,
            (drag.start, now),
            event.modifiers.shift,
            drag.turned,
            &drag.editable,
            drag.pivot,
        );
        if drag.handle == Handle::Rotate
            && let Some(turned) = turn(&drag.frame, drag.pivot, drag.start, now, drag.turned)
        {
            drag.turned = turned;
        }
        if drag.follow(values) {
            self.refresh_preview();
            cx.notify();
        }
    }

    /// Ends the drag: writes its values as one undo entry. True when a drag
    /// was running.
    pub(crate) fn end_transform_drag(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(drag) = self.transform_drag.as_mut().filter(|drag| !drag.released) else {
            return false;
        };
        // Back where it started (or never moved): nothing to write, and no
        // history entry.
        let values = prop_values(&drag.frame, &drag.values, &drag.received);
        if values.is_empty() {
            self.cancel_transform_drag();
            return true;
        }
        drag.released = true;
        if self.element_targets().is_none() {
            // The targets went stale mid-drag (a reload); nothing to write to.
            let message = self
                .element_edit
                .unavailable(self.selected_layer.as_deref());
            self.element_edit
                .set_error(self.selected_layer.as_deref(), Some(message));
            self.cancel_transform_drag();
            return true;
        }
        // A success reloads the code, which draws the written values; the
        // released drag stays until that reload so a redraw before it still
        // shows the dragged position. A failure (the source changed while
        // dragging, the history is busy) puts the layer back where it was.
        // The error shows in the Layer section and over the canvas.
        let values = values
            .into_iter()
            .map(|(key, value)| (key, Some(EditValue::Number(value))))
            .collect();
        self.commit_element(
            values,
            |this, result, cx| {
                // Targets still current after a success mean nothing was
                // written (the text came out the same), so no reload comes
                // to drop the drag.
                if result.is_err() || this.element_targets().is_some() {
                    this.cancel_transform_drag();
                }
                cx.notify();
            },
            cx,
        );
        true
    }

    /// Escape during a drag: drops it and its overrides, writing nothing.
    /// True when a pressed drag was cancelled.
    pub(crate) fn escape_transform_drag(&mut self) -> bool {
        if !self.transform_drag_active() {
            return false;
        }
        self.cancel_transform_drag();
        true
    }

    /// Drops the drag and redraws the frame without the overrides.
    pub(crate) fn cancel_transform_drag(&mut self) {
        if self.transform_drag.take().is_some() {
            self.refresh_preview();
        }
    }

    pub(crate) fn frame_size(&self) -> (f32, f32) {
        let settings = &self.document.project().settings;
        (settings.width as f32, settings.height as f32)
    }
}

/// Whether a press whose topmost hit is `topmost` lands on the body of the
/// layer `frame` measures. Hit tests name leaves only, so a group's body is
/// any of its leaves.
pub(crate) fn presses_body(frame: &LayerFrame, topmost: Option<&str>) -> bool {
    topmost.is_some_and(|hit| frame.leaves.iter().any(|leaf| leaf == hit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas_geometry::box_frame;
    use crate::edit_history::{EditHistory, HistoryEntry, write_all_recorded};
    use crate::element_edit::{Target, commit_files, resolve_targets};
    use celesta_composition::EvaluatedTransform;
    use celesta_react_bridge::{ElementKind, LayerSource};
    use celesta_source_edit::{EditValue, ElementRef, LiteralForm, LockReason, Span};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn at(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

    /// A 100 × 50 `Rect` anchored at its top-left corner at (40, 20).
    fn rect_frame() -> LayerFrame {
        let transform = EvaluatedTransform {
            position: at(40.0, 20.0),
            anchor: at(0.0, 0.0),
            ..EvaluatedTransform::default()
        };
        box_frame(transform, IDENTITY, 100.0, 50.0)
    }

    fn literal(value: f64) -> EditTarget {
        EditTarget::Literal {
            span: Span { start: 0, end: 1 },
            value: EditValue::Number(value),
            form: LiteralForm::Number,
        }
    }

    /// Targets with `rows` (name, target), written on one element.
    fn targets(rows: Vec<(&str, EditTarget)>) -> ElementTargets {
        let file = PathBuf::from("/project/scene.tsx");
        ElementTargets {
            file: file.clone(),
            files: vec![file.clone()],
            element: ElementRef {
                start: 0,
                end_of_attributes: 0,
                children: None,
            },
            targets: rows
                .into_iter()
                .map(|(name, target)| {
                    (
                        PropKey::Prop(name.to_owned()),
                        Target {
                            file: file.clone(),
                            path: name.to_owned(),
                            target,
                            call_site: None,
                            inputs: Vec::new(),
                        },
                    )
                })
                .collect(),
            table: None,
            component: None,
        }
    }

    fn with_x(x: EditTarget) -> ElementTargets {
        targets(vec![
            ("x", x),
            ("y", literal(20.0)),
            ("rotation", literal(0.0)),
            ("scale", literal(1.0)),
        ])
    }

    #[test]
    fn a_keyframed_x_falls_back_to_the_pivot() {
        let frame = rect_frame();
        let keyframed = with_x(EditTarget::Keyframe {
            span: Span { start: 0, end: 1 },
            value: 40.0,
            frame: 0.0,
        });
        assert!(!compensable(&keyframed));
        let pivot = pivot_used(PivotMode::Center, &keyframed, &frame);
        assert_eq!(pivot, PivotMode::Pivot);
        let values = drag_values(
            &frame,
            Handle::Rotate,
            (at(200.0, 20.0), at(40.0, 180.0)),
            false,
            0.0,
            &[
                TransformProp::X.key(),
                TransformProp::Y.key(),
                TransformProp::Rotation.key(),
            ],
            pivot,
        );
        assert_eq!(values.len(), 1, "{values:?}");
        assert_eq!(values[0].0, TransformProp::Rotation.key());

        // A literal, an absent prop, and one passed through to a literal
        // take the compensation; a locked one does not.
        assert_eq!(
            pivot_used(PivotMode::Center, &with_x(literal(40.0)), &frame),
            PivotMode::Center
        );
        let missing = EditTarget::Missing {
            insert_at: 0,
            default: None,
        };
        assert!(compensable(&with_x(missing)));
        let passed = EditTarget::PassThrough {
            call_site: ElementRef {
                start: 0,
                end_of_attributes: 0,
                children: None,
            },
            param: "x".to_owned(),
            target: Box::new(literal(40.0)),
        };
        assert!(compensable(&with_x(passed)));
        assert!(!compensable(&with_x(EditTarget::Locked(
            LockReason::Spread
        ))));
        assert!(!compensable(&targets(vec![("y", literal(20.0))])));
        // Pivot chosen is Pivot used.
        assert_eq!(
            pivot_used(PivotMode::Pivot, &with_x(literal(40.0)), &frame),
            PivotMode::Pivot
        );
    }

    const COMPONENT: &str =
        "export const PriceTag = ({ x, y }) => (\n  <Rect x={x} y={y} rotation={0} />\n);\n";
    const SCENE: &str = "export const Scene = () => (\n  <PriceTag x={40} y={20} />\n);\n";

    fn entry(name: &str, kind: ElementKind, file: &Path) -> LayerSource {
        LayerSource {
            name: name.to_owned(),
            file: file.to_path_buf(),
            line: 2,
            column: 3,
            kind,
            layer_id: None,
        }
    }

    #[test]
    fn a_two_file_center_rotation_is_one_undo() {
        let dir = std::env::temp_dir().join(format!(
            "celesta-center-rotation-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let (component, scene) = (dir.join("component.tsx"), dir.join("scene.tsx"));
        fs::write(&component, COMPONENT).unwrap();
        fs::write(&scene, SCENE).unwrap();
        // `<Rect>` in `PriceTag`, called from the scene with `x`, `y`.
        let report = LayerSourceReport {
            chain: vec![
                entry("Rect", ElementKind::Primitive, &component),
                entry("PriceTag", ElementKind::Component, &scene),
            ],
            local_frame: 0.0,
            candidate_frames: vec![],
            props: ReceivedProps {
                x: Some(40.0),
                y: Some(20.0),
                rotation: Some(0.0),
                ..ReceivedProps::default()
            },
            render_count: 1,
            windows: vec![],
            span: None,
        };
        let read = |path: &Path| fs::read_to_string(path).map_err(|error| error.to_string());
        let targets = resolve_targets(read, &report, None).expect("the element resolves");
        assert!(compensable(&targets));

        // A quarter turn about the box center (90, 45): the top-left corner
        // goes from (40, 20) to (115, −5).
        let frame = rect_frame();
        let pivot = pivot_used(PivotMode::Center, &targets, &frame);
        assert_eq!(pivot, PivotMode::Center);
        let editable = drag_props(&targets);
        let values = drag_values(
            &frame,
            Handle::Rotate,
            (at(190.0, 45.0), at(90.0, 145.0)),
            false,
            0.0,
            &editable,
            pivot,
        );
        let values: Vec<_> = prop_values(&frame, &values, &report.props)
            .into_iter()
            .map(|(key, value)| (key, Some(EditValue::Number(value))))
            .collect();
        let files = write_all_recorded(targets.files.clone(), |texts| {
            commit_files(texts, &targets, &report, &values).map_err(|error| error.to_string())
        })
        .expect("both files are written");
        assert_eq!(files.len(), 2);
        assert_eq!(
            fs::read_to_string(&component).unwrap(),
            COMPONENT.replace("rotation={0}", "rotation={90}")
        );
        assert_eq!(
            fs::read_to_string(&scene).unwrap(),
            SCENE.replace("x={40} y={20}", "x={115} y={-5}")
        );

        // One entry: one undo puts both files back.
        let mut history = EditHistory::default();
        history.push(HistoryEntry { files });
        history.undo().unwrap();
        assert_eq!(fs::read_to_string(&component).unwrap(), COMPONENT);
        assert_eq!(fs::read_to_string(&scene).unwrap(), SCENE);
        fs::remove_dir_all(&dir).ok();
    }
}
