//! Editing the selected React layer's transform in its JSX source: which
//! source spans hold `x`, `y`, `rotation` and the scale props, the state the
//! Layer section and the canvas read, and the commit that writes new values.

use crate::layer_select::SourceLookup;
use crate::view::EditorView;
use celesta_react_bridge::{ElementKind, LayerSourceReport, ReceivedProps};
use celesta_source_edit::{
    ApplyError, EditTarget, ElementRef, LockReason, ResolveContext, apply, element_at,
    format_number, resolve,
};
use gpui_kit::Context;
use std::fmt;
use std::fs;
use std::path::PathBuf;

/// A transform prop the editor writes back.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum TransformProp {
    X,
    Y,
    Rotation,
    Scale,
    ScaleX,
    ScaleY,
}

impl TransformProp {
    /// The JSX attribute name.
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::X => "x",
            Self::Y => "y",
            Self::Rotation => "rotation",
            Self::Scale => "scale",
            Self::ScaleX => "scaleX",
            Self::ScaleY => "scaleY",
        }
    }

    /// The Layer section's row label.
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::X => "X",
            Self::Y => "Y",
            Self::Rotation => "Rotation",
            Self::Scale => "Scale",
            Self::ScaleX => "Scale X",
            Self::ScaleY => "Scale Y",
        }
    }

    /// The value the runtime passed for this prop.
    pub(crate) fn received(self, props: &ReceivedProps) -> Option<f64> {
        match self {
            Self::X => props.x,
            Self::Y => props.y,
            Self::Rotation => props.rotation,
            Self::Scale => props.scale,
            Self::ScaleX => props.scale_x,
            Self::ScaleY => props.scale_y,
        }
    }
}

/// Where each transform prop of one element lives in its file.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TransformTargets {
    pub(crate) file: PathBuf,
    pub(crate) element: ElementRef,
    /// `X`, `Y`, `Rotation`, then `Scale` or `ScaleX`, `ScaleY`.
    pub(crate) targets: Vec<(TransformProp, EditTarget)>,
}

impl TransformTargets {
    pub(crate) fn target(&self, prop: TransformProp) -> Option<&EditTarget> {
        self.targets
            .iter()
            .find(|(candidate, _)| *candidate == prop)
            .map(|(_, target)| target)
    }
}

/// Resolves the transform targets of `report`'s innermost element in `text`
/// (that element's file). Scale is per axis when `scaleX` or `scaleY` is
/// written on the element, and uniform otherwise.
pub(crate) fn resolve_targets(
    text: &str,
    report: &LayerSourceReport,
) -> Result<TransformTargets, String> {
    let source = report
        .chain
        .first()
        .ok_or_else(|| "No source position".to_owned())?;
    let element = element_at(text, source.line, source.column)
        .ok_or_else(|| reason_text(&LockReason::ElementNotFound))?;
    let target = |prop: TransformProp| {
        let ctx = ResolveContext {
            primitive: source.kind == ElementKind::Primitive,
            local_frame: report.local_frame,
            received: prop.received(&report.props),
            render_count: report.render_count,
        };
        (prop, resolve(text, &element, prop.name(), &ctx))
    };
    let mut targets = vec![
        target(TransformProp::X),
        target(TransformProp::Y),
        target(TransformProp::Rotation),
    ];
    let scale_x = target(TransformProp::ScaleX);
    let scale_y = target(TransformProp::ScaleY);
    if is_written(&scale_x.1) || is_written(&scale_y.1) {
        targets.extend([scale_x, scale_y]);
    } else {
        targets.push(target(TransformProp::Scale));
    }
    Ok(TransformTargets {
        file: source.file.clone(),
        element,
        targets,
    })
}

/// Whether a scale-axis target shows the prop is set on the element (or by a
/// parent), rather than absent or locked for the whole element.
fn is_written(target: &EditTarget) -> bool {
    !matches!(
        target,
        EditTarget::Missing { .. }
            | EditTarget::Locked(
                LockReason::Spread
                    | LockReason::SyntaxError
                    | LockReason::ElementNotFound
                    | LockReason::NotPrimitive
                    | LockReason::Repeated { .. }
            )
    )
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum CommitError {
    /// The file no longer has the targets the edit started from.
    SourceChanged,
    /// The prop is locked or not a target of this element.
    NotEditable(TransformProp),
    /// The value is NaN or infinite.
    NotANumber,
    Apply(ApplyError),
}

impl fmt::Display for CommitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceChanged => f.write_str("The source changed while dragging"),
            Self::NotEditable(prop) => write!(f, "{} can't be edited here", prop.label()),
            Self::NotANumber => f.write_str("Enter a number"),
            Self::Apply(error) => write!(f, "Couldn't edit the source: {error}"),
        }
    }
}

/// The new text of `text` with `values` written, after checking `text` still
/// has the targets of `expected` (same kinds at the same spans).
pub(crate) fn commit_text(
    text: &str,
    expected: &TransformTargets,
    report: &LayerSourceReport,
    values: &[(TransformProp, f64)],
) -> Result<String, CommitError> {
    let fresh = resolve_targets(text, report).map_err(|_| CommitError::SourceChanged)?;
    let unchanged = fresh.element == expected.element
        && fresh.targets.len() == expected.targets.len()
        && fresh
            .targets
            .iter()
            .zip(&expected.targets)
            .all(|((prop, now), (was_prop, was))| prop == was_prop && same_place(now, was));
    if !unchanged {
        return Err(CommitError::SourceChanged);
    }
    let edits = values
        .iter()
        .map(|&(prop, value)| {
            if !value.is_finite() {
                return Err(CommitError::NotANumber);
            }
            fresh
                .target(prop)
                .and_then(|target| target.to_edit(prop.name(), value))
                .ok_or(CommitError::NotEditable(prop))
        })
        .collect::<Result<Vec<_>, _>>()?;
    apply(text, &edits).map_err(CommitError::Apply)
}

/// Same kind at the same span; locked targets compare by reason kind.
fn same_place(a: &EditTarget, b: &EditTarget) -> bool {
    match (a, b) {
        (EditTarget::Literal { span: a, .. }, EditTarget::Literal { span: b, .. })
        | (EditTarget::Keyframe { span: a, .. }, EditTarget::Keyframe { span: b, .. }) => a == b,
        (EditTarget::Missing { insert_at: a, .. }, EditTarget::Missing { insert_at: b, .. }) => {
            a == b
        }
        (EditTarget::Locked(a), EditTarget::Locked(b)) => {
            std::mem::discriminant(a) == std::mem::discriminant(b)
        }
        _ => false,
    }
}

/// The Layer section's line for a locked target.
pub(crate) fn reason_text(reason: &LockReason) -> String {
    match reason {
        LockReason::SyntaxError => "The source has syntax errors".to_owned(),
        LockReason::ElementNotFound => "Couldn't find this element in the source".to_owned(),
        LockReason::NotPrimitive => "Set by a component, not written on this element".to_owned(),
        LockReason::Expression { source } => format!("Written as an expression: `{source}`"),
        LockReason::UnresolvedIdentifier { name } => {
            format!("Comes from `{name}`, which can't be traced")
        }
        LockReason::SharedBinding { name, uses } => format!("`{name}` is used in {uses} places"),
        LockReason::BetweenKeyframes { previous, next } => format!(
            "Between keyframes at {} and {}",
            format_number(*previous),
            format_number(*next)
        ),
        LockReason::OutsideKeyframes => "Outside the keyframes".to_owned(),
        LockReason::UnsupportedCall { callee } => format!("Computed by `{callee}()`"),
        LockReason::OverriddenByParent => "A layout component sets this value".to_owned(),
        LockReason::Spread => "May be set by a spread (`{...props}`)".to_owned(),
        LockReason::Repeated { count } => format!("Rendered {count} times from this element"),
    }
}

/// A finished resolution, for the layer and report it was started for.
#[derive(Debug)]
pub(crate) struct Resolved {
    pub(crate) layer: String,
    pub(crate) report: LayerSourceReport,
    pub(crate) outcome: Result<TransformTargets, String>,
}

/// The selected layer's transform targets as the view keeps them. Resolution
/// runs off the UI thread; a result for an older request or another layer is
/// dropped.
#[derive(Debug, Default)]
pub(crate) struct TransformEdit {
    request: u64,
    /// The layer and report the newest resolution was started for.
    wanted: Option<(String, LayerSourceReport)>,
    resolved: Option<Resolved>,
    /// A write changed the file since `resolved` was read; cleared by the
    /// next finished resolution.
    stale: bool,
    /// The last commit's error and the layer it belongs to.
    error: Option<(String, String)>,
}

impl TransformEdit {
    /// Starts resolving `report` for `layer`, returning the request number,
    /// unless that is already resolved (or resolving) and still current.
    pub(crate) fn begin(&mut self, layer: &str, report: &LayerSourceReport) -> Option<u64> {
        if self
            .wanted
            .as_ref()
            .is_some_and(|(wanted, was)| wanted == layer && was == report)
        {
            return None;
        }
        if self
            .resolved
            .as_ref()
            .is_some_and(|resolved| resolved.layer != layer)
        {
            self.resolved = None;
        }
        self.request += 1;
        self.wanted = Some((layer.to_owned(), report.clone()));
        Some(self.request)
    }

    /// Keeps the outcome of resolution `request` when it is the newest one and
    /// `selected` is still the layer it was for. True when kept.
    pub(crate) fn finish(
        &mut self,
        request: u64,
        selected: Option<&str>,
        outcome: Result<TransformTargets, String>,
    ) -> bool {
        let Some((layer, report)) = self.wanted.as_ref() else {
            return false;
        };
        if request != self.request || selected != Some(layer.as_str()) {
            return false;
        }
        self.stale = false;
        self.resolved = Some(Resolved {
            layer: layer.clone(),
            report: report.clone(),
            outcome,
        });
        true
    }

    /// The editor wrote the file: the targets are unknown until the layer is
    /// looked up again in the reloaded code and resolved.
    pub(crate) fn invalidate(&mut self) {
        self.stale = true;
        self.request += 1;
    }

    /// The code reloaded: the next lookup answer is resolved again even when
    /// it equals the last one.
    pub(crate) fn reloaded(&mut self) {
        self.wanted = None;
        self.request += 1;
    }

    /// The newest resolution for `selected`, and whether it may be committed
    /// against (no write changed the file since).
    pub(crate) fn resolved(&self, selected: Option<&str>) -> Option<(&Resolved, bool)> {
        self.resolved
            .as_ref()
            .filter(|resolved| Some(resolved.layer.as_str()) == selected)
            .map(|resolved| (resolved, !self.stale))
    }

    /// The targets a commit for `selected` writes to, with the report they
    /// were resolved for.
    pub(crate) fn targets(
        &self,
        selected: Option<&str>,
    ) -> Option<(&TransformTargets, &LayerSourceReport)> {
        let (resolved, current) = self.resolved(selected)?;
        let targets = resolved.outcome.as_ref().ok().filter(|_| current)?;
        Some((targets, &resolved.report))
    }

    pub(crate) fn error(&self, selected: Option<&str>) -> Option<&str> {
        self.error
            .as_ref()
            .filter(|(layer, _)| Some(layer.as_str()) == selected)
            .map(|(_, message)| message.as_str())
    }

    pub(crate) fn set_error(&mut self, layer: Option<&str>, message: Option<String>) {
        self.error = layer
            .zip(message)
            .map(|(layer, message)| (layer.to_owned(), message));
    }
}

impl EditorView {
    /// Starts resolving the selected layer's transform targets when its
    /// source lookup has an answer the targets were not resolved for. Reads
    /// the file and parses it on the background executor.
    pub(crate) fn sync_transform_targets(&mut self, cx: &mut Context<Self>) {
        if !self.is_react_preview() {
            return;
        }
        let (Some(layer), Some(SourceLookup::Found(report))) =
            (self.selected_layer.as_deref(), self.source_lookup.as_ref())
        else {
            return;
        };
        let Some(request) = self.transform.begin(layer, report) else {
            return;
        };
        let report = report.clone();
        cx.spawn(async move |view, cx| {
            let outcome = cx
                .background_executor()
                .spawn(async move {
                    let file = report
                        .chain
                        .first()
                        .map(|source| source.file.clone())
                        .ok_or_else(|| "No source position".to_owned())?;
                    let text = fs::read_to_string(&file)
                        .map_err(|error| format!("Couldn't read {}: {error}", file.display()))?;
                    resolve_targets(&text, &report)
                })
                .await;
            view.update(cx, |this, cx| {
                let selected = this.selected_layer.clone();
                if this.transform.finish(request, selected.as_deref(), outcome) {
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    /// The selected layer's transform targets and the report they were
    /// resolved for, when they can be committed to.
    // The canvas drag reads these too.
    pub(crate) fn transform_targets(&self) -> Option<(&TransformTargets, &LayerSourceReport)> {
        self.transform.targets(self.selected_layer.as_deref())
    }

    /// Writes `values` for the selected layer into its source as one undo
    /// entry, then reloads keeping the selection. `done` gets the outcome
    /// (also shown in the Layer section when it failed).
    pub(crate) fn commit_transform(
        &mut self,
        values: Vec<(TransformProp, f64)>,
        done: impl FnOnce(&mut Self, Result<(), String>, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let layer = self.selected_layer.clone();
        let Some((targets, report)) = self.transform_targets() else {
            let message = "The source is still being read".to_owned();
            self.transform
                .set_error(layer.as_deref(), Some(message.clone()));
            return done(self, Err(message), cx);
        };
        let (targets, report) = (targets.clone(), report.clone());
        self.transform.set_error(layer.as_deref(), None);
        self.record_own_write(
            targets.file.clone(),
            move |text| {
                commit_text(text, &targets, &report, &values).map_err(|error| error.to_string())
            },
            move |this, result, cx| {
                // A success invalidated the targets (`apply_own_write_sample`).
                if let Err(message) = &result {
                    this.transform
                        .set_error(layer.as_deref(), Some(message.clone()));
                }
                done(this, result, cx);
            },
            cx,
        );
    }
}
