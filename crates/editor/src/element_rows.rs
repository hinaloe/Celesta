//! The Properties tab's element rows: one row per prop of the selected
//! layer's property table (the transform props without one), each with a
//! control by type that writes the prop into the JSX source, and under an
//! expression row the inputs it reads. This module holds the pure helpers,
//! the row state, and the commit flow; `element_rows_view.rs` renders them.

use crate::element_edit::{
    ElementTargets, PropKey, Target, edit_value, editable, field_of, inner_target, table_default,
};
use crate::layer_select::display_path;
use crate::property_controls::{Control, ControlEvent, ControlKind, build_control};
use crate::property_panel::{color_hex, parse_color, parse_color_input, parse_number_input};
use crate::transform_drag::override_sites;
use crate::view::EditorView;
use celesta_react_bridge::{
    LayerSourceReport, PrimitivePropertyField, PropOverride, ReceivedProps, SourcePos, import_path,
};
use celesta_source_edit::{EditTarget, EditValue, default_for, format_number};
use gpui_kit::{Context, MouseMoveEvent, PathPromptOptions, Subscription, Window};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

/// The control kind of a table field.
pub(crate) fn control_kind(field: &PrimitivePropertyField) -> ControlKind {
    match field {
        PrimitivePropertyField::Number { .. } => ControlKind::Number,
        PrimitivePropertyField::String { .. } => ControlKind::String,
        PrimitivePropertyField::Text { .. } => ControlKind::Text,
        PrimitivePropertyField::Boolean { .. } => ControlKind::Boolean,
        PrimitivePropertyField::Color { .. } => ControlKind::Color,
        PrimitivePropertyField::Select { options, .. } => ControlKind::Select(options.clone()),
        PrimitivePropertyField::Path => ControlKind::Path,
    }
}

/// The row label: the table key in words (`cornerRadius` → "Corner radius",
/// `children` → "Text", `scaleX` → "Scale X", `x` → "X", `anchorX` →
/// "Anchor X").
pub(crate) fn row_label(key: &str) -> String {
    match key {
        "children" => return "Text".to_owned(),
        "src" => return "Source".to_owned(),
        _ => {}
    }
    let mut words: Vec<String> = Vec::new();
    for c in key.chars() {
        match words.last_mut() {
            Some(word) if !c.is_uppercase() => word.push(c),
            _ => words.push(c.to_string()),
        }
    }
    words
        .iter()
        .enumerate()
        .map(|(index, word)| {
            let mut chars = word.chars();
            match chars.next() {
                // A one-letter word is an axis: "Scale X".
                Some(first) if index == 0 || word.len() == 1 => {
                    first.to_uppercase().chain(chars).collect()
                }
                _ => word.to_lowercase(),
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

/// How a value shows in a row's text: numbers as written to the source,
/// strings as they are, booleans as `true`/`false`.
pub(crate) fn value_text(value: &EditValue) -> String {
    match value {
        EditValue::Number(value) => format_number(*value),
        EditValue::String(value) => value.clone(),
        EditValue::Bool(value) => value.to_string(),
    }
}

/// What a row shows for `target`: the value, and the dimmed placeholder of
/// an absent prop (Rulings: source default, received, table default).
pub(crate) fn row_text(
    key: &str,
    target: &Target,
    field: Option<&PrimitivePropertyField>,
    report: &LayerSourceReport,
) -> (String, String) {
    shown_text(
        key,
        &target.path,
        &target.target,
        field,
        Some(&report.props),
    )
}

/// [`row_text`] for `target` at `path`; `props` are the element's received
/// props, `None` for a value the element does not receive itself (an
/// input, a component's prop).
pub(crate) fn shown_text(
    key: &str,
    path: &str,
    target: &EditTarget,
    field: Option<&PrimitivePropertyField>,
    props: Option<&ReceivedProps>,
) -> (String, String) {
    let (value, placeholder) = shown_value(key, path, target, field, props);
    let text = value.as_ref().map(value_text).unwrap_or_default();
    if placeholder {
        (String::new(), text)
    } else {
        (text, String::new())
    }
}

/// The value [`shown_text`] shows, unrounded, and whether it shows as the
/// dimmed placeholder of an absent prop.
fn shown_value(
    key: &str,
    path: &str,
    target: &EditTarget,
    field: Option<&PrimitivePropertyField>,
    props: Option<&ReceivedProps>,
) -> (Option<EditValue>, bool) {
    let received = |path: &str| props.and_then(|props| props.get(path)).map(edit_value);
    // A scale axis absent from the element is drawn at the `scale` it
    // received (`<Rect scale={2} scaleX={3} />` draws Y at 2).
    let axis = || {
        matches!(key, "scaleX" | "scaleY")
            .then(|| received("scale"))
            .flatten()
    };
    // What an absent prop is drawn with when the source sets no default; a
    // primitive's own defaults only for the element's props.
    let absent = || {
        axis()
            .or_else(|| field.and_then(table_default))
            .or_else(|| props.and_then(|_| default_for(key)))
    };
    let placeholder = |value: Option<EditValue>| (value, true);
    match target {
        EditTarget::Literal { value, .. } => (Some(value.clone()), false),
        EditTarget::Keyframe { value, .. } => (Some(EditValue::Number(*value)), false),
        EditTarget::Missing {
            default: Some(default),
            ..
        } => placeholder(axis().or_else(|| Some(default.clone()))),
        // A parameter without a literal default: the element draws what it
        // received (`{ scale = base * 2 }`), or its own default.
        EditTarget::Missing { default: None, .. } => placeholder(received(path).or_else(absent)),
        EditTarget::PassThrough { target, .. } => match inner_target(target) {
            // The parameter's default is what the element is drawn with.
            EditTarget::Missing {
                default: Some(default),
                ..
            } => placeholder(Some(default.clone())),
            inner => shown_value(key, path, inner, field, props),
        },
        EditTarget::Locked(_) => match received(path) {
            Some(value) => (Some(value), false),
            None => placeholder(absent()),
        },
    }
}

const COLOR_MESSAGE: &str = "Enter a color: #RRGGBB, #RRGGBBAA, or a theme color name";

/// A `<Theme>` color name: a letter, then letters, digits, `_` or `-`.
fn theme_color_name(text: &str) -> bool {
    let mut chars = text.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

/// Parses typed text for `kind`; the error is the row's message.
pub(crate) fn parse_row_value(
    kind: &ControlKind,
    field: Option<&PrimitivePropertyField>,
    text: &str,
) -> Result<EditValue, String> {
    match kind {
        ControlKind::Number => {
            let value = parse_number_input(text)?;
            let (min, max) = match field {
                Some(PrimitivePropertyField::Number { min, max, .. }) => (*min, *max),
                _ => (None, None),
            };
            let inside = min.is_none_or(|min| value >= min) && max.is_none_or(|max| value <= max);
            match (min, max) {
                _ if inside => Ok(EditValue::Number(value)),
                (Some(min), Some(max)) => Err(format!(
                    "Enter a number from {} to {}",
                    format_number(min),
                    format_number(max)
                )),
                (Some(min), None) => {
                    Err(format!("Enter a number of at least {}", format_number(min)))
                }
                (None, _) => Err(format!(
                    "Enter a number of at most {}",
                    max.map(format_number).unwrap_or_default()
                )),
            }
        }
        ControlKind::String | ControlKind::Text | ControlKind::Path => {
            Ok(EditValue::String(text.to_owned()))
        }
        ControlKind::Color => {
            let text = text.trim();
            if parse_color_input(text).is_ok() || theme_color_name(text) {
                Ok(EditValue::String(text.to_owned()))
            } else {
                Err(COLOR_MESSAGE.to_owned())
            }
        }
        ControlKind::Select(options) => {
            let text = text.trim();
            if options.iter().any(|option| option == text) {
                Ok(EditValue::String(text.to_owned()))
            } else {
                Err(format!("Choose one of {}", options.join(", ")))
            }
        }
        ControlKind::Boolean => match text.trim() {
            "true" => Ok(EditValue::Bool(true)),
            "false" => Ok(EditValue::Bool(false)),
            _ => Err("Enter true or false".to_owned()),
        },
    }
}

/// A pass-through row's line naming the call site its value is written at,
/// the file relative to the entry's directory as [`display_path`] shows it.
pub(crate) fn set_at_text(call_site: &SourcePos, entry_dir: &Path) -> String {
    format!(
        "Set at {}:{}",
        display_path(&call_site.file, entry_dir),
        call_site.line
    )
}

/// The field of a scale row without a table (the transform rows alone): a
/// ratio around 1, scrubbed as the tables declare `scale`.
static SCALE_WITHOUT_TABLE: PrimitivePropertyField = PrimitivePropertyField::Number {
    default_value: None,
    min: None,
    max: None,
    step: Some(0.01),
};

/// The table field of the row `key`, or a component prop's registered
/// field; inputs have none. Without a table, only a scale row has one.
pub(crate) fn row_field<'t>(
    targets: &'t ElementTargets,
    key: &PropKey,
) -> Option<&'t PrimitivePropertyField> {
    match key {
        PropKey::Prop(name) => match &targets.table {
            Some(table) => field_of(table, name),
            None => matches!(name.as_str(), "scale" | "scaleX" | "scaleY")
                .then_some(&SCALE_WITHOUT_TABLE),
        },
        PropKey::Input { .. } => None,
        PropKey::CallSite(name) => targets
            .component
            .as_ref()?
            .props
            .iter()
            .find(|prop| prop.name == *name)?
            .field
            .as_ref(),
    }
}

/// What "None" on a path row writes: an empty path over a written one, and
/// nothing for an absent prop (no `src=""` is inserted).
pub(crate) fn cleared_path(target: &EditTarget) -> Option<EditValue> {
    match inner_target(target) {
        EditTarget::Missing { .. } => None,
        _ => Some(EditValue::String(String::new())),
    }
}

/// The control a row edits its value with: its table field's, a number for
/// a transform prop without a table, a number or (for a string literal) a
/// string for an input, and the Component section's kind for a component
/// prop.
pub(crate) fn row_kind(targets: &ElementTargets, key: &PropKey, target: &Target) -> ControlKind {
    match key {
        PropKey::Prop(_) => row_field(targets, key).map_or(ControlKind::Number, control_kind),
        PropKey::Input { .. } => match inner_target(&target.target) {
            EditTarget::Literal {
                value: EditValue::String(_),
                ..
            } => ControlKind::String,
            _ => ControlKind::Number,
        },
        PropKey::CallSite(name) => targets
            .component
            .iter()
            .flat_map(|component| &component.props)
            .find(|prop| prop.name == *name)
            .map_or(ControlKind::String, |prop| prop.kind.clone()),
    }
}

/// The value a scrub `dx` pixels from its start gives: `start + dx * step`,
/// `step` the field's declared step per pixel, else 0.01 for a field with
/// `max <= 1` (opacity, ratios), else 1, clamped to `min`/`max`; Shift
/// multiplies the step by 10.
pub(crate) fn scrub_value(
    start: f64,
    dx: f32,
    field: Option<&PrimitivePropertyField>,
    shift: bool,
) -> f64 {
    let (min, max, step) = match field {
        Some(PrimitivePropertyField::Number { min, max, step, .. }) => (*min, *max, *step),
        _ => (None, None, None),
    };
    let step = step.unwrap_or(if max.is_some_and(|max| max <= 1.0) {
        0.01
    } else {
        1.0
    });
    let step = if shift { step * 10.0 } else { step };
    let value = start + f64::from(dx) * step;
    let value = min.map_or(value, |min| value.max(min));
    max.map_or(value, |max| value.min(max))
}

/// Whether dragging the label of the row `key` scrubs its value: a number
/// the editor can write as one value. Not an input (the runtime overrides
/// props, and an input is a value an expression reads), nor a keyframe (no
/// single prop value to override); a locked row, between keyframes too,
/// can't be written at all.
pub(crate) fn scrubs(targets: &ElementTargets, key: &PropKey, target: &Target) -> bool {
    !matches!(key, PropKey::Input { .. })
        && row_kind(targets, key, target) == ControlKind::Number
        && editable(&target.target)
        && !matches!(inner_target(&target.target), EditTarget::Keyframe { .. })
}

/// A scrub in progress on one number row.
#[derive(Clone, Debug)]
pub(crate) struct Scrub {
    key: PropKey,
    /// Where the label was pressed, in window pixels.
    start_x: f32,
    start_value: f64,
    value: f64,
    /// The row's override, its position fixed for the scrub: the runtime
    /// remounts the entry when the positions change.
    sites: Vec<PropOverride>,
    /// The row's field (its range), kept from the start: the targets are
    /// gone while the write runs.
    field: Option<PrimitivePropertyField>,
    /// The pointer changed the value at least once.
    moved: bool,
    /// Released; the override stays while the write runs and, after a
    /// successful one, until its reload, as a released canvas drag's does.
    released: bool,
}

impl Scrub {
    /// A scrub of the row `key` pressed at `start_x`, starting from the
    /// value the row shows (0 when it shows none); `None` when the row does
    /// not scrub.
    pub(crate) fn start(
        targets: &ElementTargets,
        report: &LayerSourceReport,
        key: &PropKey,
        start_x: f32,
    ) -> Option<Self> {
        let target = targets.entry(key)?;
        if !scrubs(targets, key, target) {
            return None;
        }
        let (_, site) = override_sites(targets, report)
            .into_iter()
            .find(|(candidate, _)| candidate == key)?;
        // The value or the placeholder the row shows, unrounded, moved
        // inside the field's range: a pointer back at the start pixel then
        // gives the start value, which writes nothing.
        let field = row_field(targets, key).cloned();
        let shown = match entry_value(targets, key, target, report) {
            Some(EditValue::Number(value)) => value,
            _ => 0.0,
        };
        let start_value = scrub_value(shown, 0.0, field.as_ref(), false);
        Some(Self {
            key: key.clone(),
            start_x,
            start_value,
            value: start_value,
            sites: vec![site.with(start_value)],
            field,
            moved: false,
            released: false,
        })
    }

    /// Takes the pointer at `x` (window pixels); true when the value
    /// changed.
    pub(crate) fn follow(&mut self, x: f32, shift: bool) -> bool {
        let dx = (x - self.start_x).round();
        let value = scrub_value(self.start_value, dx, self.field.as_ref(), shift);
        if value == self.value {
            return false;
        }
        self.value = value;
        self.moved = true;
        true
    }

    /// Whether there is a value to write: the pointer left the start value.
    pub(crate) fn changed(&self) -> bool {
        self.value != self.start_value
    }

    /// The prop overrides the preview evaluates the scene with: none before
    /// the value first changes, nor while `playing`; from then on the row's
    /// prop at the same position, also back at the start value.
    pub(crate) fn overrides(&self, playing: bool) -> Vec<PropOverride> {
        if playing || !self.moved {
            return Vec::new();
        }
        self.sites
            .iter()
            .map(|site| PropOverride {
                value: self.value,
                ..site.clone()
            })
            .collect()
    }

    /// The value the row `key` shows while this scrub changes it.
    fn shown(&self, key: &PropKey) -> Option<f64> {
        (self.moved && self.key == *key).then_some(self.value)
    }
}

/// What a row shows for `key`, as [`row_text`] does for a row, and without
/// received props for an input or a component prop (the element did not
/// receive those).
fn entry_text(
    targets: &ElementTargets,
    key: &PropKey,
    target: &Target,
    report: &LayerSourceReport,
) -> (String, String) {
    match key {
        PropKey::Prop(name) => row_text(name, target, row_field(targets, key), report),
        PropKey::Input { name, .. } | PropKey::CallSite(name) => {
            shown_text(name, &target.path, &target.target, None, None)
        }
    }
}

/// The value [`entry_text`] shows, unrounded: the row's value, else its
/// placeholder (source default, else received, else table default).
fn entry_value(
    targets: &ElementTargets,
    key: &PropKey,
    target: &Target,
    report: &LayerSourceReport,
) -> Option<EditValue> {
    let (name, field, props) = match key {
        PropKey::Prop(name) => (name, row_field(targets, key), Some(&report.props)),
        PropKey::Input { name, .. } | PropKey::CallSite(name) => (name, None, None),
    };
    shown_value(name, &target.path, &target.target, field, props).0
}

/// One row's control and what it shows.
pub(crate) struct ElementRow {
    pub(crate) kind: ControlKind,
    pub(crate) control: Control,
    /// Typed since the control last showed the source's value.
    edited: bool,
    /// The text and placeholder last put into the control, and the layer
    /// they belong to.
    pub(crate) shown: Option<(String, String)>,
    layer: Option<String>,
    /// Why the typed text was not written.
    pub(crate) invalid: Option<String>,
    /// A color was picked since the picker last closed.
    picked: bool,
    /// A value this row committed whose write has not finished.
    pending: Option<EditValue>,
    _subscriptions: Vec<Subscription>,
}

impl ElementRow {
    /// The switch state: the shown value, else the placeholder.
    pub(crate) fn shown_bool(&self) -> bool {
        self.shown.as_ref().is_some_and(|(text, placeholder)| {
            let text = if text.is_empty() { placeholder } else { text };
            text == "true"
        })
    }
}

/// The selected layer's row controls, built on first need (controls need a
/// window) and kept while the rows' keys and kinds stay.
#[derive(Default)]
pub(crate) struct ElementRows {
    rows: HashMap<PropKey, ElementRow>,
    /// The scrub of a row's value by its label, if one is running or being
    /// written. Never together with a canvas drag.
    pub(crate) scrub: Option<Scrub>,
}

impl ElementRows {
    pub(crate) fn get(&self, key: &PropKey) -> Option<&ElementRow> {
        self.rows.get(key)
    }
}

/// Sends what the person does in a row's control to the row for `key`.
pub(crate) fn element_control_handler(
    key: PropKey,
) -> impl Fn(&mut EditorView, ControlEvent, &mut Window, &mut Context<EditorView>) + Clone + 'static
{
    move |this, event, _, cx| this.element_control_event(&key, event, cx)
}

/// Puts `shown` into `row`'s control.
fn show(
    row: &mut ElementRow,
    shown: &(String, String),
    window: &mut Window,
    cx: &mut Context<EditorView>,
) {
    row.control.set_text(shown.0.clone(), window, cx);
    row.control.set_placeholder(shown.1.clone(), window, cx);
    let value = if shown.0.is_empty() {
        &shown.1
    } else {
        &shown.0
    };
    match &row.control {
        // A value none of the options is shows as the select's placeholder.
        Control::Select(select) => {
            let chosen = match &row.kind {
                ControlKind::Select(options) if options.contains(&shown.0) => Some(shown.0.clone()),
                _ => None,
            };
            select.update(cx, |select, cx| match &chosen {
                Some(chosen) => select.set_selected_value(chosen, window, cx),
                None => select.set_selected_index(None, window, cx),
            });
        }
        // A theme color name has no swatch.
        Control::Color { picker, .. } => {
            let color = parse_color(&Value::String(value.clone()));
            picker.update(cx, |picker, cx| match color {
                Some(color) => picker.set_value(color, window, cx),
                None => picker.clear_value(window, cx),
            });
        }
        Control::Text(_) | Control::Textarea(_) | Control::Switch => {}
    }
}

impl EditorView {
    /// Builds a control per row of the selected layer's targets and puts
    /// newly resolved values (or, until the reload after an own write
    /// resolves, the written ones) into those not being typed in. Runs from
    /// `render`, which has the window controls need.
    pub(crate) fn sync_element_rows(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.is_react_preview() {
            return;
        }
        let Some((resolved, _)) = self.element_edit.resolved(self.selected_layer.as_deref()) else {
            return;
        };
        let Ok(targets) = &resolved.outcome else {
            return;
        };
        let layer = resolved.layer.clone();
        let specs: Vec<(PropKey, ControlKind, (String, String))> = targets
            .entries()
            .into_iter()
            .map(|(key, target)| {
                let kind = row_kind(targets, &key, target);
                let shown = match self.element_edit.written_value(Some(&layer), &key) {
                    Some(value) => (value_text(value), String::new()),
                    None => entry_text(targets, &key, target, &resolved.report),
                };
                (key, kind, shown)
            })
            .collect();
        let scrub = self.element_rows.scrub.as_ref();
        let rows = &mut self.element_rows.rows;
        rows.retain(|key, _| specs.iter().any(|(wanted, _, _)| wanted == key));
        for (key, kind, shown) in specs {
            if rows.get(&key).is_none_or(|row| row.kind != kind) {
                let built = build_control(&kind, window, cx, element_control_handler(key.clone()));
                let row = ElementRow {
                    kind,
                    control: built.control,
                    edited: false,
                    shown: None,
                    layer: None,
                    invalid: None,
                    picked: false,
                    pending: None,
                    _subscriptions: built.subscriptions,
                };
                rows.insert(key.clone(), row);
            }
            let Some(row) = rows.get_mut(&key) else {
                continue;
            };
            // A value being scrubbed, then the one being written.
            let scrubbed = scrub
                .and_then(|scrub| scrub.shown(&key))
                .map(EditValue::Number);
            let shown = match scrubbed.as_ref().or(row.pending.as_ref()) {
                Some(value) => (value_text(value), String::new()),
                None => shown,
            };
            // Typed text stays until committed, but never under another layer.
            let same_layer = row.layer.as_deref() == Some(layer.as_str());
            if same_layer && (row.edited || row.shown.as_ref() == Some(&shown)) {
                continue;
            }
            if !same_layer {
                row.invalid = None;
            }
            show(row, &shown, window, cx);
            row.shown = Some(shown);
            row.layer = Some(layer.clone());
            row.edited = false;
        }
    }

    /// What the person did in the control of the row `key`.
    fn element_control_event(
        &mut self,
        key: &PropKey,
        event: ControlEvent,
        cx: &mut Context<Self>,
    ) {
        match event {
            ControlEvent::Edited => {
                if let Some(row) = self.element_rows.rows.get_mut(key) {
                    row.edited = true;
                    row.invalid = None;
                }
            }
            ControlEvent::Submit { blur } => self.submit_element_row(key, blur, cx),
            ControlEvent::Escape => self.restore_element_row(key, true, cx),
            ControlEvent::Toggled(checked) => {
                self.commit_element_row(key, EditValue::Bool(checked), cx);
            }
            ControlEvent::Chosen(choice) => {
                self.commit_element_row(key, EditValue::String(choice), cx);
            }
            ControlEvent::ColorPicked => {
                if let Some(row) = self.element_rows.rows.get_mut(key) {
                    row.picked = true;
                }
            }
            ControlEvent::ColorPickerClosed => {
                let Some(row) = self.element_rows.rows.get_mut(key) else {
                    return;
                };
                let Control::Color { picker, .. } = &row.control else {
                    return;
                };
                let color = picker.read(cx).value();
                if std::mem::take(&mut row.picked)
                    && let Some(color) = color
                {
                    self.commit_element_row(key, EditValue::String(color_hex(color)), cx);
                }
            }
            ControlEvent::ChoosePath => self.choose_element_path(key, cx),
            ControlEvent::ClearPath => {
                let cleared = self
                    .element_edit
                    .resolved(self.selected_layer.as_deref())
                    .and_then(|(resolved, _)| resolved.outcome.as_ref().ok())
                    .and_then(|targets| targets.entry(key))
                    .and_then(|target| cleared_path(&target.target));
                if let Some(value) = cleared {
                    self.commit_element_row(key, value, cx);
                }
            }
        }
    }

    /// Shows the source's value in the row `key` again on the next render;
    /// `forget` drops its message too.
    fn restore_element_row(&mut self, key: &PropKey, forget: bool, cx: &mut Context<Self>) {
        if let Some(row) = self.element_rows.rows.get_mut(key) {
            row.edited = false;
            row.shown = None;
            if forget {
                row.invalid = None;
            }
        }
        cx.notify();
    }

    /// Enter (`blur` false) or blur: writes typed text that parses for the
    /// row's kind. Unedited text is never written; text that does not parse
    /// shows the row's message, and on blur the source's value again.
    fn submit_element_row(&mut self, key: &PropKey, blur: bool, cx: &mut Context<Self>) {
        let field = self
            .element_edit
            .resolved(self.selected_layer.as_deref())
            .and_then(|(resolved, _)| resolved.outcome.as_ref().ok())
            .and_then(|targets| row_field(targets, key))
            .cloned();
        let Some(row) = self.element_rows.rows.get_mut(key) else {
            return;
        };
        if !row.edited {
            return;
        }
        // Clicking another layer blurs the field after the selection moved;
        // the text was typed for the old one.
        if row.layer != self.selected_layer {
            return self.restore_element_row(key, true, cx);
        }
        let Some(text) = row.control.text(cx) else {
            return;
        };
        // An emptied field of a value that can't be empty writes nothing.
        let may_be_empty = matches!(
            row.kind,
            ControlKind::String | ControlKind::Text | ControlKind::Path
        );
        if text.trim().is_empty() && !may_be_empty {
            if blur {
                self.restore_element_row(key, true, cx);
            }
            return;
        }
        match parse_row_value(&row.kind, field.as_ref(), &text) {
            Ok(value) => self.commit_element_row(key, value, cx),
            Err(message) => {
                row.invalid = Some(message);
                if blur {
                    self.restore_element_row(key, false, cx);
                }
                cx.notify();
            }
        }
    }

    /// Writes `value` into the row `key` as one history entry; the row shows
    /// it until the write finishes, and the written value until the reload
    /// resolves (the source's value again when the write failed).
    fn commit_element_row(&mut self, key: &PropKey, value: EditValue, cx: &mut Context<Self>) {
        if let Some(row) = self.element_rows.rows.get_mut(key) {
            row.edited = false;
            row.invalid = None;
            row.pending = Some(value.clone());
        }
        let written = key.clone();
        self.commit_element(
            vec![(key.clone(), value)],
            move |this, result, cx| {
                if let Some(row) = this.element_rows.rows.get_mut(&written) {
                    row.pending = None;
                    if result.is_err() {
                        row.edited = false;
                        row.shown = None;
                    }
                }
                // A released scrub's override stays until the reload draws
                // the written value; none comes after a failure, nor after
                // a write that left the text as it was (the targets are
                // still current).
                let scrubbed = this
                    .element_rows
                    .scrub
                    .as_ref()
                    .is_some_and(|scrub| scrub.released && scrub.key == written);
                if scrubbed && (result.is_err() || this.element_targets().is_some()) {
                    this.cancel_row_scrub();
                }
                cx.notify();
            },
            cx,
        );
        cx.notify();
    }

    /// Whether a scrub is running with the button down (not one released
    /// and being written).
    pub(crate) fn row_scrub_active(&self) -> bool {
        self.element_rows
            .scrub
            .as_ref()
            .is_some_and(|scrub| !scrub.released)
    }

    /// Mouse down on the label of the row `key` at `x` (window pixels):
    /// starts a scrub of its value when the row scrubs, ending a canvas drag
    /// without writing it. Nothing while playing.
    pub(crate) fn begin_row_scrub(&mut self, key: &PropKey, x: f32, cx: &mut Context<Self>) {
        // While a released scrub or drag is being written, none starts: its
        // override stays until the reload draws the written value.
        if self.playing || self.element_rows.scrub.is_some() || self.transform_drag_released() {
            return;
        }
        let Some(scrub) = self
            .element_targets()
            .and_then(|(targets, report)| Scrub::start(targets, report, key, x))
        else {
            return;
        };
        if self.transform_drag_active() {
            self.cancel_transform_drag();
        }
        // Text typed in this row gives way to the scrubbed value; text typed
        // in another row stays in its field, which keeps the focus (the
        // label's press does not take it).
        match self.element_rows.rows.get_mut(key) {
            Some(row) if row.edited => self.restore_element_row(key, true, cx),
            Some(row) => row.invalid = None,
            None => {}
        }
        self.element_rows.scrub = Some(scrub);
        cx.notify();
    }

    /// Whether a released scrub is being written, or waits for the reload
    /// that draws its value.
    pub(crate) fn row_scrub_released(&self) -> bool {
        self.element_rows
            .scrub
            .as_ref()
            .is_some_and(|scrub| scrub.released)
    }

    /// Follows the pointer: recomputes the value and redraws the frame with
    /// it. Writes nothing.
    pub(crate) fn continue_row_scrub(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        if !self.row_scrub_active() {
            return;
        }
        // The button came up where the view did not see it: end there.
        if !event.dragging() {
            if self.end_row_scrub(cx) {
                cx.notify();
            }
            return;
        }
        let Some(scrub) = self.element_rows.scrub.as_mut() else {
            return;
        };
        if scrub.follow(f32::from(event.position.x), event.modifiers.shift) {
            self.refresh_preview();
            cx.notify();
        }
    }

    /// Release: writes the scrubbed value as one history entry, or nothing
    /// when the value is back where it started (or never moved). True when
    /// a scrub was running.
    pub(crate) fn end_row_scrub(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(scrub) = self
            .element_rows
            .scrub
            .as_mut()
            .filter(|scrub| !scrub.released)
        else {
            return false;
        };
        if !scrub.changed() {
            self.cancel_row_scrub();
            return true;
        }
        scrub.released = true;
        let (key, value) = (scrub.key.clone(), scrub.value);
        // The row shows the value until the write finishes; a failure (the
        // targets went stale, the source changed) drops the override.
        self.commit_element_row(&key, EditValue::Number(value), cx);
        true
    }

    /// Escape during a scrub: drops it and its override, writing nothing.
    /// True when a pressed scrub was cancelled.
    pub(crate) fn escape_row_scrub(&mut self) -> bool {
        if !self.row_scrub_active() {
            return false;
        }
        self.cancel_row_scrub();
        true
    }

    /// Drops the scrub and redraws the frame without its override.
    pub(crate) fn cancel_row_scrub(&mut self) {
        if self.element_rows.scrub.take().is_some() {
            self.refresh_preview();
        }
    }

    /// `Choose…` on a path row: imports the chosen file into the project and
    /// writes the path relative to the entry's directory.
    fn choose_element_path(&mut self, key: &PropKey, cx: &mut Context<Self>) {
        let entry_dir = self.entry_dir();
        let selection = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose".into()),
        });
        let key = key.clone();
        let session = self.session;
        let layer = self.selected_layer.clone();
        cx.spawn(async move |view, cx| {
            let chosen = match selection.await {
                Ok(Ok(Some(paths))) => paths.into_iter().next(),
                Ok(Ok(None)) | Err(_) => None,
                Ok(Err(error)) => {
                    let message = format!("Couldn't show the file dialog: {error}");
                    view.update(cx, |this, cx| this.set_row_message(&key, message, cx))
                        .ok();
                    None
                }
            };
            let Some(chosen) = chosen else {
                return;
            };
            let imported = cx
                .background_executor()
                .spawn(async move { import_path(&entry_dir, &entry_dir, &chosen) })
                .await;
            view.update(cx, |this, cx| {
                // Another file opened or another layer was picked meanwhile.
                if this.session != session || this.selected_layer != layer {
                    return;
                }
                match imported {
                    Ok(path) => this.commit_element_row(&key, EditValue::String(path), cx),
                    Err(error) => {
                        let message = format!("Couldn't use the chosen file: {error}");
                        this.set_row_message(&key, message, cx);
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    fn set_row_message(&mut self, key: &PropKey, message: String, cx: &mut Context<Self>) {
        if let Some(row) = self.element_rows.rows.get_mut(key) {
            row.invalid = Some(message);
            cx.notify();
        }
    }
}
