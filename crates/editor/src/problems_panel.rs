//! The right dock's tab bar, the Problems tab, and its entry points.

use crate::problems::{ActiveProblem, LogEntry, Severity, Source, fenced};
use crate::view::{EditorView, RightTab};
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::clipboard::Clipboard;
use gpui_kit::component::tab::{Tab, TabBar};
use gpui_kit::component::text::TextView;
use gpui_kit::component::{ActiveTheme as _, Icon, IconName, Sizable as _};
use gpui_kit::prelude::*;
use gpui_kit::{App, ClipboardItem, Context, Hsla, SharedString, div};

impl EditorView {
    /// The right dock: a tab bar over the inspector (or React Preview panel)
    /// and the Problems tab.
    pub(crate) fn right_dock(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let details_label = if self.is_react_preview() {
            "React Preview"
        } else {
            "Inspector"
        };
        let count = self.problems.error_count() + self.problems.warning_count();
        let muted = cx.theme().muted_foreground;
        let tabs = TabBar::new("right-dock-tabs")
            .underline()
            .px_3()
            .selected_index(match self.right_tab {
                RightTab::Details => 0,
                RightTab::Problems => 1,
            })
            .child(Tab::new().label(details_label))
            .child(Tab::new().label("Problems").when(count > 0, |tab| {
                tab.suffix(div().text_xs().text_color(muted).child(count.to_string()))
            }))
            .on_click(cx.listener(|this, index: &usize, _, cx| {
                this.right_tab = if *index == 1 {
                    RightTab::Problems
                } else {
                    RightTab::Details
                };
                cx.notify();
            }));
        div()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(cx.theme().sidebar)
            .child(tabs)
            .child(match self.right_tab {
                RightTab::Details if self.is_react_preview() => {
                    self.react_preview_panel(cx).into_any_element()
                }
                RightTab::Details => self.inspector_panel(cx).into_any_element(),
                RightTab::Problems => self.problems_panel(cx).into_any_element(),
            })
    }

    /// Selects the Problems tab.
    pub(crate) fn show_problems(&mut self, cx: &mut Context<Self>) {
        self.right_tab = RightTab::Problems;
        cx.notify();
    }

    fn problems_panel(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let muted = cx.theme().muted_foreground;
        let active: Vec<(Source, ActiveProblem)> = self
            .problems
            .active_problems()
            .map(|(source, active)| (source, active.clone()))
            .collect();
        let warnings = self.problems.preview_warnings().to_vec();
        let nothing_active = active.is_empty() && warnings.is_empty();
        let history: Vec<LogEntry> = self.problems.history().rev().cloned().collect();
        let has_history = !history.is_empty();
        let history_text = self.problems.history_text();
        div()
            .id("problems-scroll")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_x_hidden()
            .overflow_y_scroll()
            .child(section_heading("Active", cx))
            .when(nothing_active, |panel| {
                panel.child(
                    div()
                        .px_3()
                        .pb_3()
                        .text_xs()
                        .text_color(muted)
                        .child("No problems"),
                )
            })
            .children(active.into_iter().map(|(source, active)| {
                let id: SharedString = format!("active-{}", source.label()).into();
                problem_block(
                    id,
                    severity_icon(source.severity(), cx),
                    format!(
                        "{} · {} · {}",
                        active.problem.title,
                        source.label(),
                        active.time.format("%H:%M:%S")
                    ),
                    &active.problem.detail,
                    cx,
                )
            }))
            .children(warnings.into_iter().enumerate().map(|(index, warning)| {
                problem_block(
                    format!("preview-warning-{index}").into(),
                    severity_icon(Severity::Warning, cx),
                    "Preview warning".to_owned(),
                    &warning,
                    cx,
                )
            }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .pr_2()
                    .child(section_heading("History", cx))
                    .when(has_history, |row| {
                        row.child(
                            div()
                                .flex()
                                .gap_1()
                                .child(
                                    Button::new("copy-history")
                                        .xsmall()
                                        .ghost()
                                        .label("Copy all")
                                        .on_click(move |_, _, cx| {
                                            cx.write_to_clipboard(ClipboardItem::new_string(
                                                history_text.clone(),
                                            ));
                                        }),
                                )
                                .child(
                                    Button::new("clear-history")
                                        .xsmall()
                                        .ghost()
                                        .label("Clear")
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.problems.clear_history();
                                            this.expanded_log_entries.clear();
                                            cx.notify();
                                        })),
                                ),
                        )
                    }),
            )
            .when(!has_history, |panel| {
                panel.child(
                    div()
                        .px_3()
                        .pb_3()
                        .text_xs()
                        .text_color(muted)
                        .child("Nothing logged yet"),
                )
            })
            .children(history.into_iter().map(|entry| self.history_row(entry, cx)))
    }

    fn history_row(&self, entry: LogEntry, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let expanded = self.expanded_log_entries.contains(&entry.id);
        let id = entry.id;
        let muted = cx.theme().muted_foreground;
        div()
            .flex()
            .flex_col()
            .child(
                div()
                    .id(SharedString::from(format!("log-row-{id}")))
                    .flex()
                    .items_center()
                    .gap_2()
                    .px_3()
                    .py_1()
                    .text_xs()
                    .hover(|row| row.bg(cx.theme().list_hover))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !this.expanded_log_entries.remove(&id) {
                            this.expanded_log_entries.insert(id);
                        }
                        cx.notify();
                    }))
                    .child(severity_icon(entry.severity, cx))
                    .child(div().text_color(muted).child(entry.source.label()))
                    .child(
                        div()
                            .text_color(muted)
                            .child(entry.time.format("%H:%M:%S").to_string()),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .overflow_hidden()
                            .whitespace_nowrap()
                            .text_ellipsis()
                            .text_color(cx.theme().foreground)
                            .child(entry.problem.title.clone()),
                    )
                    .child(
                        Icon::new(if expanded {
                            IconName::ChevronDown
                        } else {
                            IconName::ChevronRight
                        })
                        .xsmall()
                        .text_color(muted),
                    ),
            )
            .when(expanded && !entry.problem.detail.is_empty(), |row| {
                row.child(detail_block(
                    format!("log-detail-{id}").into(),
                    &entry.problem.detail,
                    cx,
                ))
            })
    }
}

fn section_heading(title: &'static str, cx: &App) -> impl IntoElement {
    div()
        .px_3()
        .pt_3()
        .pb_1()
        .text_xs()
        .text_color(cx.theme().muted_foreground)
        .child(title)
}

fn severity_icon(severity: Severity, cx: &App) -> Icon {
    let (name, color): (IconName, Hsla) = match severity {
        Severity::Error => (IconName::CircleX, cx.theme().danger),
        Severity::Warning => (IconName::TriangleAlert, cx.theme().warning),
        Severity::Done => (IconName::CircleCheck, cx.theme().success),
    };
    Icon::new(name).xsmall().text_color(color)
}

/// A problem's heading row and its full detail.
fn problem_block(
    id: SharedString,
    icon: Icon,
    heading: String,
    detail: &str,
    cx: &App,
) -> impl IntoElement + use<> {
    div()
        .flex()
        .flex_col()
        .gap_1()
        .px_3()
        .pb_3()
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .text_xs()
                .text_color(cx.theme().foreground)
                .child(icon)
                .child(div().flex_1().min_w_0().child(heading)),
        )
        .child(detail_block(id, detail, cx))
}

/// `detail`, verbatim, monospaced, wrapped, selectable, with a copy button
/// in the code block's corner.
pub(crate) fn detail_block(id: SharedString, detail: &str, _cx: &App) -> impl IntoElement + use<> {
    let copy_id = SharedString::from(format!("{id}-copy"));
    let value = SharedString::from(detail.to_owned());
    TextView::markdown(id, fenced(detail))
        .selectable(true)
        .code_block_actions(move |_, _, _| Clipboard::new(copy_id.clone()).value(value.clone()))
}
