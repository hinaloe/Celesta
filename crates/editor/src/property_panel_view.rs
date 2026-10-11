//! Renders the Properties section of the React Preview panel; the state and
//! the commit flow live in `property_panel.rs`.

use crate::property_panel::{
    PropertyRow, RowControl, TextUpdate, differs_from_default, field_label, issues_by_key,
    number_hint, ordered_keys, parse_color, value_text,
};
use crate::view::EditorView;
use celesta_react_bridge::{ComponentPropertyField, EffectiveValue, ValueSource, effective_values};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::color_picker::ColorPicker;
use gpui_kit::component::input::{Escape, Input, InputState};
use gpui_kit::component::select::Select;
use gpui_kit::component::spinner::Spinner;
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{ActiveTheme as _, Disableable as _, Sizable as _};
use gpui_kit::prelude::*;
use gpui_kit::{AnyElement, Context, ElementId, Entity, Hsla, SharedString, div};
use serde_json::Value;

/// A row control's id, namespaced by the property key.
fn row_id(control: &str, key: &str) -> ElementId {
    SharedString::from(format!("property-{control}-{key}")).into()
}

impl EditorView {
    /// The Properties section, or `None` when the entry declares none.
    pub(crate) fn property_section(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let react = self.react_preview.as_ref()?;
        let schema = react
            .property_schema
            .as_ref()
            .filter(|schema| !schema.fields.is_empty())?;
        let values = effective_values(&schema.fields, &react.disk_properties);
        let (issues, mut general) = issues_by_key(&react.property_issues);
        // Issues for keys the schema does not declare have no row to sit on.
        general.extend(
            react
                .property_issues
                .iter()
                .filter(|issue| !issue.key.is_empty() && !schema.fields.contains_key(&issue.key))
                .map(ToString::to_string),
        );
        let busy = self.property_panel.is_writing() || self.react_reloads.is_running();
        let danger = cx.theme().danger;
        let heading = div()
            .flex()
            .items_center()
            .gap_2()
            .text_sm()
            .text_color(cx.theme().foreground)
            .child("Properties")
            .when(busy, |heading| heading.child(Spinner::new().xsmall()));
        let rows: Vec<AnyElement> = ordered_keys(schema)
            .into_iter()
            .filter_map(|key| {
                let row = self.property_panel.rows.get(key)?;
                let effective = values.get(key)?;
                let issues = issues.get(key).map_or(&[][..], Vec::as_slice);
                Some(self.property_row(key, row, effective, issues, cx))
            })
            .collect();
        Some(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .mx_3()
                .pt_3()
                .pb_3()
                .border_t_1()
                .border_color(cx.theme().border)
                .child(heading)
                .children(
                    general
                        .into_iter()
                        .map(|message| div().text_xs().text_color(danger).child(message)),
                )
                .children(rows)
                .into_any_element(),
        )
    }

    /// One property: its label (with `Reset to default` when the props file
    /// holds a non-default value), its control, and its messages.
    fn property_row(
        &self,
        key: &str,
        row: &PropertyRow,
        effective: &EffectiveValue,
        issues: &[String],
        cx: &mut Context<Self>,
    ) -> AnyElement {
        // A file edit has no effect on a key --props sets.
        let locked = effective.source == ValueSource::Props;
        let resettable = effective.source == ValueSource::File
            && differs_from_default(&row.field, &effective.value);
        let muted = cx.theme().muted_foreground;
        let danger = cx.theme().danger;
        let reset_key = key.to_owned();
        let header = div()
            .flex()
            .items_center()
            .justify_between()
            .gap_2()
            .h_5()
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_xs()
                    .text_color(muted)
                    .child(field_label(key, &row.field).to_owned()),
            )
            .when(resettable, |header| {
                header.child(
                    Button::new(row_id("reset", key))
                        .ghost()
                        .xsmall()
                        .label("Reset to default")
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.commit_property(&reset_key, None, TextUpdate::Always, cx);
                        })),
                )
            });
        let messages = row
            .invalid
            .iter()
            .chain(&row.write_error)
            .chain(issues)
            .cloned()
            .map(move |message| div().text_xs().text_color(danger).child(message));
        div()
            .flex()
            .flex_col()
            .gap_1()
            .child(header)
            .child(self.property_control(key, row, locked, cx))
            .when(locked, |row| {
                row.child(div().text_xs().text_color(muted).child("Set by --props"))
            })
            .children(messages)
            .into_any_element()
    }

    fn property_control(
        &self,
        key: &str,
        row: &PropertyRow,
        locked: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match (&row.control, &row.field) {
            (RowControl::Text(input), ComponentPropertyField::Path { .. }) => {
                let choose_key = key.to_owned();
                let none_key = key.to_owned();
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(Self::property_input(key, input, locked, None, cx)),
                    )
                    .child(
                        Button::new(row_id("choose", key))
                            .outline()
                            .small()
                            .label("Choose…")
                            .disabled(locked)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.choose_property_path(&choose_key, cx);
                            })),
                    )
                    .child(
                        Button::new(row_id("none", key))
                            .ghost()
                            .small()
                            .label("None")
                            .disabled(locked)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                let none = Some(Value::String(String::new()));
                                this.commit_property(&none_key, none, TextUpdate::Always, cx);
                            })),
                    )
                    .into_any_element()
            }
            (RowControl::Text(input), field) => {
                let hint = match field {
                    ComponentPropertyField::Number { min, max, .. } => number_hint(*min, *max),
                    _ => None,
                };
                Self::property_input(key, input, locked, hint, cx).into_any_element()
            }
            (RowControl::Switch, _) => {
                let key = key.to_owned();
                Switch::new(row_id("switch", &key))
                    .small()
                    .checked(row.state.shown.as_bool().unwrap_or(false))
                    .disabled(locked)
                    .on_click(cx.listener(move |this, checked: &bool, _, cx| {
                        let value = Some(Value::Bool(*checked));
                        this.commit_property(&key, value, TextUpdate::Keep, cx);
                    }))
                    .into_any_element()
            }
            (RowControl::Select(select), _) => Select::new(select)
                .small()
                .disabled(locked)
                .placeholder(value_text(&row.state.shown))
                .into_any_element(),
            (RowControl::Color { text, picker }, _) => div()
                .flex()
                .items_center()
                .gap_2()
                .child(if locked {
                    Self::color_swatch(parse_color(&row.state.shown), cx).into_any_element()
                } else {
                    ColorPicker::new(picker).small().into_any_element()
                })
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .child(Self::property_input(key, text, locked, None, cx)),
                )
                .into_any_element(),
        }
    }

    /// A row's text input. Escape shows the row's value again.
    fn property_input(
        key: &str,
        input: &Entity<InputState>,
        locked: bool,
        hint: Option<String>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let key = key.to_owned();
        let muted = cx.theme().muted_foreground;
        div()
            .w_full()
            .on_action(cx.listener(move |this, _: &Escape, _, cx| {
                this.restore_property_text(&key, cx);
            }))
            .child(
                Input::new(input)
                    .small()
                    .disabled(locked)
                    .when_some(hint, |input, hint| {
                        input.suffix(div().text_xs().text_color(muted).child(hint))
                    }),
            )
    }

    /// The color a disabled color row shows in place of the picker.
    fn color_swatch(color: Option<Hsla>, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex_none()
            .size_5()
            .rounded(cx.theme().radius)
            .border_1()
            .border_color(cx.theme().input)
            .when_some(color, |swatch, color| swatch.bg(color))
    }
}
