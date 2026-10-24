//! Editing the selected React layer's props in its JSX source: which source
//! spans hold each prop the editor writes, the state the Layer section and
//! the canvas read, and the commit that writes new values.

use crate::edit_history::Texts;
use crate::layer_select::{SourceLookup, owner_call_site};
use crate::view::EditorView;
use celesta_react_bridge::{
    ElementKind, LayerSource, LayerSourceReport, ReceivedProps, ReceivedValue, SourcePos,
};
use celesta_source_edit::{
    ApplyError, Edit, EditTarget, EditValue, ElementRef, LockReason, ResolveContext, apply,
    element_at, enclosing_component, format_number, has_attribute, parameter_of, resolve_through,
};
use gpui_kit::Context;
use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// A row the editor writes: a table prop by its table key (`fontSize`, even
/// when it writes `style.fontSize`).
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) enum PropKey {
    Prop(String),
}

impl PropKey {
    /// The row's name in messages: a transform prop's label, the key
    /// otherwise.
    pub(crate) fn label(&self) -> String {
        match TransformProp::from_key(self) {
            Some(prop) => prop.label().to_owned(),
            None => match self {
                Self::Prop(name) => name.clone(),
            },
        }
    }
}

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
    /// Every transform prop, in row order.
    pub(crate) const ALL: [Self; 6] = [
        Self::X,
        Self::Y,
        Self::Rotation,
        Self::Scale,
        Self::ScaleX,
        Self::ScaleY,
    ];

    /// The row key of this prop.
    pub(crate) fn key(self) -> PropKey {
        PropKey::Prop(self.name().to_owned())
    }

    /// The transform prop `key` names, if any.
    pub(crate) fn from_key(key: &PropKey) -> Option<Self> {
        let PropKey::Prop(name) = key;
        Self::ALL.into_iter().find(|prop| prop.name() == name)
    }

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
}

/// The number the runtime passed for `prop`, if it passed one.
pub(crate) fn received_number(props: &ReceivedProps, prop: &str) -> Option<f64> {
    match props.get(prop)? {
        ReceivedValue::Number(value) => Some(value),
        ReceivedValue::String(_) | ReceivedValue::Bool(_) => None,
    }
}

/// Where one row's value lives.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Target {
    /// The file `target` is in: the call site's for a `PassThrough`, the
    /// element's otherwise.
    pub(crate) file: PathBuf,
    /// The prop path resolved on the element (`fontSize`, `style.fontSize`,
    /// `children`).
    pub(crate) path: String,
    pub(crate) target: EditTarget,
    /// Where the component enclosing the element is called, for a
    /// `PassThrough`.
    pub(crate) call_site: Option<SourcePos>,
}

/// Where each row of one element lives.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ElementTargets {
    /// The element's file.
    pub(crate) file: PathBuf,
    /// The files resolving read: the element's, then the call site's when a
    /// prop is a parameter of the enclosing component. A commit reads them
    /// all again.
    pub(crate) files: Vec<PathBuf>,
    pub(crate) element: ElementRef,
    /// `x`, `y`, `rotation`, then `scale` or `scaleX`, `scaleY`.
    pub(crate) targets: Vec<(PropKey, Target)>,
}

impl ElementTargets {
    /// `key`'s target: a `PassThrough` wraps the target at the call site.
    pub(crate) fn target(&self, key: &PropKey) -> Option<&EditTarget> {
        self.entry(key).map(|target| &target.target)
    }

    /// The file `key` is written in; the element's when `key` is not a
    /// target.
    pub(crate) fn file_of(&self, key: &PropKey) -> &Path {
        self.entry(key).map_or(&self.file, |target| &target.file)
    }

    /// The target of the transform prop `prop`.
    pub(crate) fn transform(&self, prop: TransformProp) -> Option<&EditTarget> {
        self.target(&prop.key())
    }

    /// The call site an edit of this element's transform writes, when every
    /// editable transform target passes through to that one call site: the
    /// edit then changes only the instances it makes. `None` when nothing is
    /// editable, or when an editable target is written on the element (in
    /// every instance). Other rows do not count.
    pub(crate) fn written_at(&self) -> Option<&SourcePos> {
        let mut sites = self
            .targets
            .iter()
            .filter(|(key, target)| {
                TransformProp::from_key(key).is_some() && editable(&target.target)
            })
            .map(|(_, target)| target.call_site.as_ref());
        let first = sites.next()??;
        sites.all(|site| site == Some(first)).then_some(first)
    }

    /// The row `key`.
    pub(crate) fn entry(&self, key: &PropKey) -> Option<&Target> {
        self.targets
            .iter()
            .find(|(candidate, _)| candidate == key)
            .map(|(_, target)| target)
    }
}

/// The target a value is shown from and written to: for a `PassThrough`,
/// the one at the call site.
pub(crate) fn inner_target(target: &EditTarget) -> &EditTarget {
    match target {
        EditTarget::PassThrough { target, .. } => inner_target(target),
        other => other,
    }
}

/// Whether a value can be written to `target`.
pub(crate) fn editable(target: &EditTarget) -> bool {
    matches!(
        inner_target(target),
        EditTarget::Literal { .. } | EditTarget::Keyframe { .. } | EditTarget::Missing { .. }
    )
}

/// Resolves the transform targets of `report`'s innermost element, reading
/// files with `read`: the element's, and, only when a prop is a parameter of
/// the component enclosing the element, the file of that component's call
/// site, where such a prop resolves. Scale is per axis when `scaleX` or
/// `scaleY` is written as an attribute of the element, and uniform otherwise
/// (also when only a parent sets them).
pub(crate) fn resolve_targets(
    read: impl Fn(&Path) -> Result<String, String>,
    report: &LayerSourceReport,
) -> Result<ElementTargets, String> {
    resolve_rows(read, report, |text, element| {
        let per_axis = [TransformProp::ScaleX, TransformProp::ScaleY]
            .iter()
            .any(|prop| has_attribute(text, element, prop.name()));
        let props: &[TransformProp] = if per_axis {
            &[
                TransformProp::X,
                TransformProp::Y,
                TransformProp::Rotation,
                TransformProp::ScaleX,
                TransformProp::ScaleY,
            ]
        } else {
            &[
                TransformProp::X,
                TransformProp::Y,
                TransformProp::Rotation,
                TransformProp::Scale,
            ]
        };
        props.iter().map(|prop| prop.key()).collect()
    })
}

/// Resolves the rows `keys` picks from the text and element of `report`'s
/// innermost element; see [`resolve_targets`]. A commit replays the rows it
/// started from this way.
fn resolve_rows(
    read: impl Fn(&Path) -> Result<String, String>,
    report: &LayerSourceReport,
    keys: impl FnOnce(&str, &ElementRef) -> Vec<PropKey>,
) -> Result<ElementTargets, String> {
    let source = report
        .chain
        .first()
        .ok_or_else(|| "No source position".to_owned())?;
    let text = read(&source.file)?;
    let element = element_at(&text, source.line, source.column)
        .ok_or_else(|| reason_text(&LockReason::ElementNotFound))?;
    let rows: Vec<(PropKey, String)> = keys(&text, &element)
        .into_iter()
        .map(|key| {
            let PropKey::Prop(name) = &key;
            let path = name.clone();
            (key, path)
        })
        .collect();
    let mut files = vec![source.file.clone()];
    let passes = rows
        .iter()
        .any(|(_, path)| parameter_of(&text, &element, path).is_some());
    // A call site that can't be read or found locks only the props passed
    // through (`CallSiteNotFound`); the element's own stay editable.
    let call_site =
        passes
            .then(|| caller(&text, &element, report))
            .flatten()
            .and_then(|(component, entry)| {
                let call_site_text = read(&entry.file).ok()?;
                if !files.contains(&entry.file) {
                    files.push(entry.file.clone());
                }
                let call = element_at(&call_site_text, entry.line, entry.column)?;
                // An anonymous entry may be any `memo` component above the
                // element, one it is only passed to as children among them.
                (entry.name == component || tag_name(&call_site_text, &call) == component)
                    .then_some((entry, call_site_text, call))
            });
    let target = |(key, path): (PropKey, String)| {
        let ctx = ResolveContext {
            primitive: source.kind == ElementKind::Primitive,
            component_props: false,
            candidate_frames: candidate_frames(report),
            received: report.props.get(&path).map(edit_value),
            render_count: report.render_count,
        };
        let through = call_site
            .as_ref()
            .map(|(_, call_site_text, call)| (call_site_text.as_str(), call));
        let target = resolve_through(&text, &element, &path, &ctx, through);
        let target = match (&target, &call_site) {
            (EditTarget::PassThrough { .. }, Some((entry, ..))) => Target {
                file: entry.file.clone(),
                path,
                target,
                call_site: Some(SourcePos::from(*entry)),
            },
            _ => Target {
                file: source.file.clone(),
                path,
                target,
                call_site: None,
            },
        };
        (key, target)
    };
    Ok(ElementTargets {
        file: source.file.clone(),
        files,
        element,
        targets: rows.into_iter().map(target).collect(),
    })
}

/// The component that encloses `element` in `text`, and the chain entry
/// calling it.
fn caller<'r>(
    text: &str,
    element: &ElementRef,
    report: &'r LayerSourceReport,
) -> Option<(String, &'r LayerSource)> {
    let component = enclosing_component(text, element)?;
    let entry = owner_call_site(report, &component)?;
    Some((component, entry))
}

/// The last `.` segment of the tag name of `element` in `text`: `PriceTag`
/// for `<PriceTag …>` and `<ui.PriceTag …>`.
fn tag_name<'t>(text: &'t str, element: &ElementRef) -> &'t str {
    let name = text
        .get(element.start as usize + 1..)
        .unwrap_or_default()
        .trim_start();
    let end = name
        .find(|c: char| !(c.is_alphanumeric() || matches!(c, '_' | '$' | '.' | '-' | ':')))
        .unwrap_or(name.len());
    name[..end].rsplit('.').next().unwrap_or_default()
}

fn edit_value(value: ReceivedValue) -> EditValue {
    match value {
        ReceivedValue::Number(value) => EditValue::Number(value),
        ReceivedValue::String(value) => EditValue::String(value),
        ReceivedValue::Bool(value) => EditValue::Bool(value),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum CommitError {
    /// The file no longer has the targets the edit started from.
    SourceChanged,
    /// The row (by its label) is locked or not a target of this element.
    NotEditable(String),
    /// The value is NaN or infinite.
    NotANumber,
    Apply(ApplyError),
}

impl fmt::Display for CommitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceChanged => f.write_str("The source changed while editing"),
            Self::NotEditable(label) => write!(f, "{label} can't be edited here"),
            Self::NotANumber => f.write_str("Enter a number"),
            Self::Apply(error) => write!(f, "Couldn't edit the source: {error}"),
        }
    }
}

/// The new text of every file `values` touch, in path order, after checking
/// `texts` (each of `expected.files`) still have the targets of `expected`:
/// its rows, resolved again, are the same kinds at the same spans, in the
/// same files. Nothing is returned for a file no value is written to.
pub(crate) fn commit_files(
    texts: &Texts,
    expected: &ElementTargets,
    report: &LayerSourceReport,
    values: &[(PropKey, EditValue)],
) -> Result<Vec<(PathBuf, String)>, CommitError> {
    // A prop locked when the edit started (outside the project, say) stays
    // locked whatever the file holds now.
    if let Some((key, _)) = values
        .iter()
        .find(|(key, _)| !expected.target(key).is_some_and(editable))
    {
        return Err(CommitError::NotEditable(key.label()));
    }
    let read = |path: &Path| {
        texts
            .get(path)
            .cloned()
            .ok_or_else(|| format!("{} was not read", path.display()))
    };
    let rows = |_: &str, _: &ElementRef| {
        expected
            .targets
            .iter()
            .map(|(key, _)| key.clone())
            .collect()
    };
    let mut fresh = resolve_rows(read, report, rows).map_err(|_| CommitError::SourceChanged)?;
    let outside: Vec<&Path> = expected
        .targets
        .iter()
        .filter(|(_, was)| was.target == EditTarget::Locked(LockReason::OutsideProject))
        .map(|(_, was)| was.file.as_path())
        .collect();
    lock_outside_project(&mut fresh, |file| outside.contains(&file));
    let unchanged = fresh.element == expected.element
        && fresh.targets.len() == expected.targets.len()
        && fresh
            .targets
            .iter()
            .zip(&expected.targets)
            .all(|((key, now), (was_key, was))| {
                key == was_key
                    && now.file == was.file
                    && now.path == was.path
                    && same_place(&now.target, &was.target)
            });
    if !unchanged {
        return Err(CommitError::SourceChanged);
    }
    let mut edits: BTreeMap<&Path, Vec<Edit>> = BTreeMap::new();
    for (key, value) in values {
        if value.as_number().is_some_and(|value| !value.is_finite()) {
            return Err(CommitError::NotANumber);
        }
        // `None` for a keyframe given anything but a number, too.
        let edit = fresh
            .entry(key)
            .and_then(|target| target.target.to_edit(&target.path, value))
            .ok_or_else(|| CommitError::NotEditable(key.label()))?;
        edits.entry(fresh.file_of(key)).or_default().push(edit);
    }
    edits
        .into_iter()
        .map(|(file, edits)| {
            // Resolving read every file a target is in.
            let text = texts.get(file).ok_or(CommitError::SourceChanged)?;
            let written = apply(text, &edits).map_err(CommitError::Apply)?;
            Ok((file.to_path_buf(), written))
        })
        .collect()
}

/// Same kind at the same span; locked targets compare by reason kind, and
/// pass-through targets by call site, parameter and target there.
fn same_place(a: &EditTarget, b: &EditTarget) -> bool {
    match (a, b) {
        (
            EditTarget::PassThrough {
                call_site: a_call,
                param: a_param,
                target: a,
            },
            EditTarget::PassThrough {
                call_site: b_call,
                param: b_param,
                target: b,
            },
        ) => a_call == b_call && a_param == b_param && same_place(a, b),
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
        LockReason::Expression { source } => format!("Written as an expression: {source}"),
        LockReason::UnresolvedIdentifier { name } => {
            format!("Comes from {name}, which can't be traced")
        }
        LockReason::SharedBinding { name, uses } => format!("{name} is used in {uses} places"),
        LockReason::BetweenKeyframes { previous, next, .. } => format!(
            "Between keyframes at {} and {}",
            format_number(*previous),
            format_number(*next)
        ),
        LockReason::OutsideKeyframes => "Outside the keyframes".to_owned(),
        LockReason::UnsupportedCall { callee } => format!("Computed by {callee}()"),
        LockReason::OverriddenByParent => "A layout component sets this value".to_owned(),
        LockReason::Spread => "May be set by a spread ({...props})".to_owned(),
        LockReason::Repeated { count } => format!("Rendered {count} times from this element"),
        LockReason::FrameUncertain => "Can't tell which frame this animation reads".to_owned(),
        LockReason::OutsideProject => "This file is outside the project".to_owned(),
        LockReason::NoStyleObject => "No style object to set this in".to_owned(),
        LockReason::StyleMaySet => "May be set by `style`".to_owned(),
        LockReason::ParameterOfCaller { component } => {
            format!("Comes from `<{component}>`'s caller")
        }
        LockReason::CallSiteNotFound { component } => {
            format!("Can't find where `<{component}>` is called")
        }
    }
}

/// A finished resolution, for the layer and report it was started for.
#[derive(Debug)]
pub(crate) struct Resolved {
    pub(crate) layer: String,
    pub(crate) report: LayerSourceReport,
    /// The timeline frame the report was looked up at.
    pub(crate) timeline_frame: i64,
    pub(crate) outcome: Result<ElementTargets, String>,
}

/// The selected layer's targets as the view keeps them. Resolution runs off
/// the UI thread; a result for an older request or another layer is
/// dropped.
#[derive(Debug, Default)]
pub(crate) struct ElementEdit {
    request: u64,
    /// The layer, report and lookup frame the newest resolution was started for.
    wanted: Option<(String, LayerSourceReport, i64)>,
    /// A resolution is running.
    pending: bool,
    resolved: Option<Resolved>,
    /// A write changed the file since `resolved` was read. Only `reset`, or a
    /// resolution started after `expire` (the reload that reads the write),
    /// clears it: a lookup the old code answered after the write may still
    /// resolve meanwhile.
    stale: bool,
    /// The code reloaded after the write: the next resolution reads the
    /// written file, so it is current again.
    expired: bool,
    /// The values the editor's own writes put into the file, and the layer
    /// they belong to: shown in the rows while `resolved` is stale, so a
    /// field does not show the old value until the reload resolves.
    written: Option<(String, Vec<(PropKey, EditValue)>)>,
    /// The last commit's error and the layer it belongs to.
    error: Option<(String, String)>,
}

impl ElementEdit {
    /// Starts resolving `report` for `layer`, returning the request number,
    /// unless that is already resolved (or resolving) and still current.
    pub(crate) fn begin(
        &mut self,
        layer: &str,
        report: &LayerSourceReport,
        timeline_frame: i64,
    ) -> Option<u64> {
        if self.wanted.as_ref().is_some_and(|(wanted, was, frame)| {
            wanted == layer && was == report && *frame == timeline_frame
        }) {
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
        self.wanted = Some((layer.to_owned(), report.clone(), timeline_frame));
        self.pending = true;
        Some(self.request)
    }

    /// Keeps the outcome of resolution `request` when it is the newest one and
    /// `selected` is still the layer it was for. True when kept.
    pub(crate) fn finish(
        &mut self,
        request: u64,
        selected: Option<&str>,
        outcome: Result<ElementTargets, String>,
    ) -> bool {
        let Some((layer, report, timeline_frame)) = self.wanted.as_ref() else {
            return false;
        };
        if request != self.request || selected != Some(layer.as_str()) {
            return false;
        }
        self.pending = false;
        if std::mem::take(&mut self.expired) {
            self.stale = false;
            self.written = None;
        }
        self.resolved = Some(Resolved {
            layer: layer.clone(),
            report: report.clone(),
            timeline_frame: *timeline_frame,
            outcome,
        });
        true
    }

    /// The editor wrote the file: the targets are unknown until the layer is
    /// looked up again in the reloaded code and resolved.
    pub(crate) fn invalidate(&mut self) {
        self.stale = true;
        self.expired = false;
        self.pending = false;
        self.request += 1;
    }

    /// The code reloaded after an own write: keeps showing `resolved` (not
    /// current), and resolves the next lookup answer even when it equals the
    /// last. The view starts no resolution until the reloaded code answers,
    /// so the next one reads the written file against the new answer. An old
    /// commit error is gone, as after `reset`.
    pub(crate) fn expire(&mut self) {
        self.stale = true;
        self.expired = true;
        self.wanted = None;
        self.pending = false;
        self.request += 1;
        self.error = None;
    }

    /// Forgets everything (selection cleared, or the code reloaded): the next
    /// lookup answer is resolved again even when it equals the last one, and
    /// an old commit error is gone.
    pub(crate) fn reset(&mut self) {
        *self = Self {
            request: self.request + 1,
            ..Self::default()
        };
    }

    /// An own write for `layer` put `values` into the file (after
    /// `invalidate`). Kept until the reloaded code resolves; values for a
    /// row written again replace the earlier ones.
    pub(crate) fn record_written(&mut self, layer: Option<&str>, values: &[(PropKey, EditValue)]) {
        let Some(layer) = layer.filter(|_| self.stale) else {
            return;
        };
        if self.written.as_ref().is_none_or(|(was, _)| was != layer) {
            self.written = Some((layer.to_owned(), Vec::new()));
        }
        let Some((_, written)) = &mut self.written else {
            return;
        };
        for (key, value) in values {
            written.retain(|(other, _)| other != key);
            written.push((key.clone(), value.clone()));
        }
    }

    /// The value an own write put into `key` of `selected`, while the rows
    /// still show the targets resolved before that write.
    pub(crate) fn written_value(
        &self,
        selected: Option<&str>,
        key: &PropKey,
    ) -> Option<&EditValue> {
        let (layer, written) = self.written.as_ref().filter(|_| self.stale)?;
        if Some(layer.as_str()) != selected {
            return None;
        }
        written
            .iter()
            .find(|(other, _)| other == key)
            .map(|(_, value)| value)
    }

    /// Why a commit for `selected` has no targets to write to.
    pub(crate) fn unavailable(&self, selected: Option<&str>) -> String {
        match self.resolved(selected) {
            _ if self.pending => STILL_READING.to_owned(),
            None => STILL_READING.to_owned(),
            Some((resolved, _)) if resolved.outcome.is_err() => {
                resolved.outcome.as_ref().err().cloned().unwrap_or_default()
            }
            Some(_) => "Select the layer again".to_owned(),
        }
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
    /// were resolved for. `lookup` is the view's current lookup answer and
    /// the timeline frame it was looked up at: targets resolved for another
    /// answer (before a seek, say, while the new one resolves) are not
    /// committed to.
    pub(crate) fn targets(
        &self,
        selected: Option<&str>,
        lookup: Option<(&LayerSourceReport, i64)>,
    ) -> Option<(&ElementTargets, &LayerSourceReport)> {
        let (resolved, current) = self.resolved(selected)?;
        let (report, frame) = lookup?;
        if !current || *report != resolved.report || frame != resolved.timeline_frame {
            return None;
        }
        let targets = resolved.outcome.as_ref().ok()?;
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

const STILL_READING: &str = "The source is still being read";

/// The frames an `interpolate(frame, …)` written for `report`'s element could
/// read; an older runtime that reports none reads its `local_frame`.
fn candidate_frames(report: &LayerSourceReport) -> Vec<f64> {
    if report.candidate_frames.is_empty() {
        vec![report.local_frame]
    } else {
        report.candidate_frames.clone()
    }
}

/// The timeline frame of the layer's local `keyframe`, given the timeline
/// frame the layer was looked up at and its local frame there.
pub(crate) fn keyframe_timeline_frame(keyframe: f64, lookup_frame: i64, local_frame: f64) -> i64 {
    (keyframe + lookup_frame as f64 - local_frame).round() as i64
}

/// The timeline frames of the keyframes before and after a target between
/// keyframes, converted with the candidate frame the resolver found them
/// from (not the report's `local_frame`, which may be another frame).
pub(crate) fn keyframe_jump_frames(target: &EditTarget, lookup_frame: i64) -> Option<(i64, i64)> {
    let EditTarget::Locked(LockReason::BetweenKeyframes {
        previous,
        next,
        frame,
    }) = target
    else {
        return None;
    };
    Some((
        keyframe_timeline_frame(*previous, lookup_frame, *frame),
        keyframe_timeline_frame(*next, lookup_frame, *frame),
    ))
}

impl EditorView {
    /// Starts resolving the selected layer's targets when its source lookup
    /// has an answer the targets were not resolved for. Reads the files and
    /// parses them on the background executor.
    pub(crate) fn sync_element_targets(&mut self, cx: &mut Context<Self>) {
        // A stale answer describes the code before the reload; resolving it
        // against the written file would pair the wrong report with it.
        if !self.is_react_preview() || self.source_lookup_stale {
            return;
        }
        let (Some(layer), Some(SourceLookup::Found(report))) =
            (self.selected_layer.as_deref(), self.source_lookup.as_ref())
        else {
            return;
        };
        let frame = self.source_lookup_frame;
        let Some(request) = self.element_edit.begin(layer, report, frame) else {
            return;
        };
        let report = report.clone();
        let entry_dir = self
            .react_entry()
            .and_then(Path::parent)
            .map(Path::to_path_buf);
        cx.spawn(async move |view, cx| {
            let outcome = cx
                .background_executor()
                .spawn(async move {
                    let read = |path: &Path| {
                        fs::read_to_string(path)
                            .map_err(|error| format!("Couldn't read {}: {error}", path.display()))
                    };
                    let mut targets = resolve_targets(read, &report)?;
                    let real = |path: &Path| fs::canonicalize(path).unwrap_or(path.to_path_buf());
                    let entry_dir = entry_dir.map(|dir| real(&dir));
                    lock_outside_project(&mut targets, |file| {
                        entry_dir
                            .as_ref()
                            .is_none_or(|dir| !inside_project(&real(file), dir))
                    });
                    Ok(targets)
                })
                .await;
            view.update(cx, |this, cx| {
                let selected = this.selected_layer.clone();
                if this
                    .element_edit
                    .finish(request, selected.as_deref(), outcome)
                {
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    /// The selected layer's targets and the report they were resolved for,
    /// when they can be committed to.
    // The canvas drag reads these too.
    pub(crate) fn element_targets(&self) -> Option<(&ElementTargets, &LayerSourceReport)> {
        let lookup = match &self.source_lookup {
            Some(SourceLookup::Found(report)) => Some((report, self.source_lookup_frame)),
            _ => None,
        };
        self.element_edit
            .targets(self.selected_layer.as_deref(), lookup)
    }

    /// Writes `values` for the selected layer into its source as one undo
    /// entry, the call site's file too when a value passes through, then
    /// reloads keeping the selection. `done` gets the outcome (also shown in
    /// the Layer section when it failed).
    pub(crate) fn commit_element(
        &mut self,
        values: Vec<(PropKey, EditValue)>,
        done: impl FnOnce(&mut Self, Result<(), String>, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let layer = self.selected_layer.clone();
        let Some((targets, report)) = self.element_targets() else {
            let message = self.element_edit.unavailable(layer.as_deref());
            self.element_edit
                .set_error(layer.as_deref(), Some(message.clone()));
            return done(self, Err(message), cx);
        };
        let (targets, report) = (targets.clone(), report.clone());
        let written = values.clone();
        self.element_edit.set_error(layer.as_deref(), None);
        self.record_own_writes(
            targets.files.clone(),
            move |texts| {
                commit_files(texts, &targets, &report, &values).map_err(|error| error.to_string())
            },
            move |this, result, cx| {
                // A success invalidated the targets (`apply_own_write_sample`);
                // the rows show the written values until the reload resolves.
                match &result {
                    Ok(()) => this.element_edit.record_written(layer.as_deref(), &written),
                    Err(message) => this
                        .element_edit
                        .set_error(layer.as_deref(), Some(message.clone())),
                }
                done(this, result, cx);
            },
            cx,
        );
    }
}

/// Whether the editor may write `file`: it is under the React entry's
/// directory `entry_dir` and not inside any `node_modules`. Compares paths
/// lexically after resolving `.` and `..`; callers pass real paths.
pub(crate) fn inside_project(file: &Path, entry_dir: &Path) -> bool {
    let file = normalize(file);
    file.starts_with(normalize(entry_dir))
        && !file
            .components()
            .any(|component| component.as_os_str() == "node_modules")
}

fn normalize(path: &Path) -> PathBuf {
    let mut normal = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normal.pop();
            }
            other => normal.push(other),
        }
    }
    normal
}

/// Locks every target in a file `outside` says is outside the project (the
/// element's, or a call site's).
pub(crate) fn lock_outside_project(targets: &mut ElementTargets, outside: impl Fn(&Path) -> bool) {
    for (_, target) in &mut targets.targets {
        if outside(&target.file) {
            target.target = EditTarget::Locked(LockReason::OutsideProject);
        }
    }
}
