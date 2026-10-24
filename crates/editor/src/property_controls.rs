//! The controls a property row edits its value with, shared by the panels
//! that show property rows. Each panel keeps its own row state and maps a
//! control's `ControlEvent`s to it.

use crate::view::EditorView;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::color_picker::{ColorPicker, ColorPickerEvent, ColorPickerState};
use gpui_kit::component::input::{Escape, Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{ActiveTheme as _, Disableable as _, Sizable as _};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, Context, ElementId, Entity, EventEmitter, Focusable as _, Hsla, SharedString,
    Subscription, Window, div,
};
use std::sync::Arc;

/// What a control is for.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ControlKind {
    Number,
    String,
    /// Multi-line text.
    Text,
    Boolean,
    Color,
    Select(Vec<String>),
    Path,
}

/// What the person did in a control; each panel maps it to its own rows.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ControlEvent {
    /// The person typed in the text.
    Edited,
    /// Enter (`blur` false) or blur in the text.
    Submit {
        blur: bool,
    },
    /// Escape in the text.
    Escape,
    Toggled(bool),
    Chosen(String),
    /// A color was picked; the pick is committed when the picker closes.
    ColorPicked,
    /// The picker went from open to closed; sent only on that change.
    ColorPickerClosed,
    /// `Choose…` on a path control.
    ChoosePath,
    /// `None` on a path control.
    ClearPath,
}

/// The control a row edits its value with.
pub(crate) enum Control {
    /// `Number`, `String`, and `Path`.
    Text(Entity<InputState>),
    /// `Text`: gpui-kit keeps multi-line text a separate state type.
    Textarea(Entity<TextareaState>),
    /// `Boolean`; the panel passes the shown state when rendering.
    Switch,
    Select(Entity<SelectState<Vec<String>>>),
    Color {
        text: Entity<InputState>,
        picker: Entity<ColorPickerState>,
    },
}

impl Control {
    /// The typed text, for controls with a text input.
    pub(crate) fn text(&self, cx: &App) -> Option<SharedString> {
        match self {
            Control::Text(input) | Control::Color { text: input, .. } => {
                Some(input.read(cx).value())
            }
            Control::Textarea(input) => Some(input.read(cx).value()),
            Control::Switch | Control::Select(_) => None,
        }
    }

    /// The control has a text input and it has focus.
    pub(crate) fn text_focused(&self, window: &Window, cx: &App) -> bool {
        match self {
            Control::Text(input) | Control::Color { text: input, .. } => {
                input.focus_handle(cx).is_focused(window)
            }
            Control::Textarea(input) => input.focus_handle(cx).is_focused(window),
            Control::Switch | Control::Select(_) => false,
        }
    }

    /// Replaces the text of a control with a text input; false for one
    /// without.
    pub(crate) fn set_text(&self, text: String, window: &mut Window, cx: &mut App) -> bool {
        match self {
            Control::Text(input) | Control::Color { text: input, .. } => {
                input.update(cx, |input, cx| input.set_value(text, window, cx));
            }
            Control::Textarea(input) => {
                input.update(cx, |input, cx| input.set_value(text, window, cx));
            }
            Control::Switch | Control::Select(_) => return false,
        }
        true
    }

    /// Replaces the dimmed placeholder of a control with a text input.
    pub(crate) fn set_placeholder(&self, placeholder: String, window: &mut Window, cx: &mut App) {
        match self {
            Control::Text(input) | Control::Color { text: input, .. } => {
                input.update(cx, |input, cx| {
                    input.set_placeholder(placeholder, window, cx)
                });
            }
            Control::Textarea(input) => {
                input.update(cx, |input, cx| {
                    input.set_placeholder(placeholder, window, cx)
                });
            }
            Control::Switch | Control::Select(_) => {}
        }
    }
}

/// A built control and the subscriptions that send its events.
pub(crate) struct BuiltControl {
    pub(crate) control: Control,
    pub(crate) subscriptions: Vec<Subscription>,
}

/// The text input a kind uses, as `(multi_line, submit_on_enter)`; `None`
/// for kinds without one. Multi-line text submits on Enter and takes a
/// newline on Shift+Enter.
pub(crate) fn input_options(kind: &ControlKind) -> Option<(bool, bool)> {
    match kind {
        ControlKind::Text => Some((true, true)),
        ControlKind::Number | ControlKind::String | ControlKind::Path | ControlKind::Color => {
            Some((false, false))
        }
        ControlKind::Boolean | ControlKind::Select(_) => None,
    }
}

/// Builds the control for `kind`; `on` receives what the person does in it.
pub(crate) fn build_control(
    kind: &ControlKind,
    window: &mut Window,
    cx: &mut Context<EditorView>,
    on: impl Fn(&mut EditorView, ControlEvent, &mut Window, &mut Context<EditorView>) + Clone + 'static,
) -> BuiltControl {
    let (control, subscriptions) = match kind {
        ControlKind::Boolean => (Control::Switch, Vec::new()),
        ControlKind::Select(options) => {
            let select = cx.new(|cx| SelectState::new(options.clone(), None, window, cx));
            let subscription = cx.subscribe_in(
                &select,
                window,
                move |this, _, event: &SelectEvent<Vec<String>>, window, cx| {
                    if let SelectEvent::Confirm(Some(choice)) = event {
                        on(this, ControlEvent::Chosen(choice.clone()), window, cx);
                    }
                },
            );
            (Control::Select(select), vec![subscription])
        }
        ControlKind::Color => {
            let text = cx.new(|cx| InputState::new(window, cx));
            let typed = subscribe_text(&text, window, cx, on.clone());
            let picker = cx.new(|cx| ColorPickerState::new(window, cx));
            let picked_on = on.clone();
            let picked = cx.subscribe_in(
                &picker,
                window,
                move |this, _, _: &ColorPickerEvent, window, cx| {
                    picked_on(this, ControlEvent::ColorPicked, window, cx);
                },
            );
            let mut was_open = false;
            let closed = cx.observe_in(&picker, window, move |this, picker, window, cx| {
                let open = picker.read(cx).is_open();
                if std::mem::replace(&mut was_open, open) && !open {
                    on(this, ControlEvent::ColorPickerClosed, window, cx);
                }
            });
            (Control::Color { text, picker }, vec![typed, picked, closed])
        }
        ControlKind::Number | ControlKind::String | ControlKind::Text | ControlKind::Path => {
            match input_options(kind) {
                Some((true, submit_on_enter)) => {
                    let input = cx.new(|cx| {
                        TextareaState::new(window, cx)
                            .submit_on_enter(submit_on_enter)
                            .auto_grow(1, 6)
                    });
                    let subscription = subscribe_text(&input, window, cx, on);
                    (Control::Textarea(input), vec![subscription])
                }
                _ => {
                    let input = cx.new(|cx| InputState::new(window, cx));
                    let subscription = subscribe_text(&input, window, cx, on);
                    (Control::Text(input), vec![subscription])
                }
            }
        }
    };
    BuiltControl {
        control,
        subscriptions,
    }
}

/// Sends a text input's typing, Enter, and blur to `on`.
fn subscribe_text<S: EventEmitter<InputEvent>>(
    input: &Entity<S>,
    window: &mut Window,
    cx: &mut Context<EditorView>,
    on: impl Fn(&mut EditorView, ControlEvent, &mut Window, &mut Context<EditorView>) + 'static,
) -> Subscription {
    cx.subscribe_in(
        input,
        window,
        move |this, _, event: &InputEvent, window, cx| {
            let event = match event {
                // `set_value` emits no change, so this is the person typing.
                InputEvent::Change => ControlEvent::Edited,
                InputEvent::PressEnter { .. } => ControlEvent::Submit { blur: false },
                InputEvent::Blur => ControlEvent::Submit { blur: true },
                InputEvent::Focus => return,
            };
            on(this, event, window, cx);
        },
    )
}

/// Renders `control`, disabled when `locked`. `shown_bool` is the switch
/// state; `hint` is the dimmed suffix of a single-line text (a number's
/// range) and the placeholder of a select (the value it shows when none of
/// the options is chosen).
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_control(
    id: impl Into<ElementId>,
    kind: &ControlKind,
    control: &Control,
    locked: bool,
    shown_bool: bool,
    hint: Option<String>,
    cx: &mut Context<EditorView>,
    on: impl Fn(&mut EditorView, ControlEvent, &mut Window, &mut Context<EditorView>) + Clone + 'static,
) -> AnyElement {
    let id = Arc::new(id.into());
    let child_id = |name: &'static str| ElementId::NamedChild(id.clone(), name.into());
    match control {
        Control::Text(input) if *kind == ControlKind::Path => {
            let choose = on.clone();
            let clear = on.clone();
            div()
                .flex()
                .items_center()
                .gap_1()
                .child(div().flex_1().min_w_0().child(text_input(
                    Input::new(input),
                    locked,
                    hint,
                    cx,
                    on,
                )))
                .child(
                    Button::new(child_id("choose"))
                        .outline()
                        .small()
                        .label("Choose…")
                        .disabled(locked)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            choose(this, ControlEvent::ChoosePath, window, cx);
                        })),
                )
                .child(
                    Button::new(child_id("none"))
                        .ghost()
                        .small()
                        .label("None")
                        .disabled(locked)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            clear(this, ControlEvent::ClearPath, window, cx);
                        })),
                )
                .into_any_element()
        }
        Control::Text(input) => text_input(Input::new(input), locked, hint, cx, on),
        Control::Textarea(input) => escapable(Textarea::new(input).disabled(locked), cx, on),
        Control::Switch => Switch::new(child_id("switch"))
            .small()
            .checked(shown_bool)
            .disabled(locked)
            .on_click(cx.listener(move |this, checked: &bool, window, cx| {
                on(this, ControlEvent::Toggled(*checked), window, cx);
            }))
            .into_any_element(),
        Control::Select(select) => Select::new(select)
            .small()
            .disabled(locked)
            .when_some(hint, |select, hint| select.placeholder(hint))
            .into_any_element(),
        Control::Color { text, picker } => div()
            .flex()
            .items_center()
            .gap_2()
            .child(if locked {
                color_swatch(picker.read(cx).value(), cx).into_any_element()
            } else {
                ColorPicker::new(picker).small().into_any_element()
            })
            .child(div().flex_1().min_w_0().child(text_input(
                Input::new(text),
                locked,
                None,
                cx,
                on,
            )))
            .into_any_element(),
    }
}

/// A single-line text input with `hint` as its dimmed suffix.
fn text_input(
    input: Input,
    locked: bool,
    hint: Option<String>,
    cx: &mut Context<EditorView>,
    on: impl Fn(&mut EditorView, ControlEvent, &mut Window, &mut Context<EditorView>) + 'static,
) -> AnyElement {
    let muted = cx.theme().muted_foreground;
    let input = input
        .small()
        .disabled(locked)
        .when_some(hint, |input, hint| {
            input.suffix(div().text_xs().text_color(muted).child(hint))
        });
    escapable(input, cx, on)
}

/// Wraps a text input so Escape in it reaches `on`.
fn escapable(
    input: impl IntoElement,
    cx: &mut Context<EditorView>,
    on: impl Fn(&mut EditorView, ControlEvent, &mut Window, &mut Context<EditorView>) + 'static,
) -> AnyElement {
    div()
        .w_full()
        .on_action(cx.listener(move |this, _: &Escape, window, cx| {
            on(this, ControlEvent::Escape, window, cx);
        }))
        .child(input)
        .into_any_element()
}

/// The color a disabled color control shows in place of the picker.
fn color_swatch(color: Option<Hsla>, cx: &mut Context<EditorView>) -> impl IntoElement {
    div()
        .flex_none()
        .size_5()
        .rounded(cx.theme().radius)
        .border_1()
        .border_color(cx.theme().input)
        .when_some(color, |swatch, color| swatch.bg(color))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_options_per_kind() {
        assert_eq!(input_options(&ControlKind::Text), Some((true, true)));
        for kind in [
            ControlKind::Number,
            ControlKind::String,
            ControlKind::Path,
            ControlKind::Color,
        ] {
            assert_eq!(input_options(&kind), Some((false, false)), "{kind:?}");
        }
        assert_eq!(input_options(&ControlKind::Boolean), None);
        assert_eq!(
            input_options(&ControlKind::Select(vec!["a".to_owned()])),
            None
        );
    }
}
