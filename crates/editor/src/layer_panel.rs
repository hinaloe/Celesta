//! The React Preview panel's Layer section: the layer picked in the viewer,
//! the JSX position that produced it, and the elements around that one, each
//! opening its position in the user's editor.

use crate::editor_launch::open_source;
use crate::layer_select::{SourceLookup, source_position};
use crate::view::EditorView;
use crate::widgets::{inspector_row, inspector_section};
use celesta_react_bridge::LayerSource;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{ActiveTheme as _, IconName, Sizable as _};
use gpui_kit::prelude::*;
use gpui_kit::{AnyElement, Context, Hsla, SharedString, div};
use std::path::{Path, PathBuf};

impl EditorView {
    /// The selected layer's section, or `None` while nothing is selected.
    pub(crate) fn layer_section(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let id = self.selected_layer.clone()?;
        let entry_dir = self.entry_dir();
        let muted = cx.theme().muted_foreground;
        let note = |text: SharedString, color: Hsla| {
            div().px_3().py_2().text_xs().text_color(color).child(text)
        };
        let section = div()
            .flex()
            .flex_col()
            .child(inspector_section("Layer", cx))
            .child(inspector_row("ID", id, cx));
        let section = match &self.source_lookup {
            Some(SourceLookup::Found(chain)) => {
                let (source, callers) = chain.split_first()?;
                section
                    .child(self.source_row("Source", 0, source, &entry_dir, cx))
                    .when(!callers.is_empty(), |section| {
                        section
                            .child(inspector_section("Called from", cx))
                            .children(callers.iter().enumerate().map(|(index, caller)| {
                                self.source_row("", index + 1, caller, &entry_dir, cx)
                            }))
                    })
            }
            Some(SourceLookup::NotInFrame) => {
                section.child(note("Not in this frame".into(), muted))
            }
            Some(SourceLookup::NoPosition) => {
                section.child(note("No source position".into(), muted))
            }
            Some(SourceLookup::Failed(error)) => {
                section.child(note(error.clone().into(), cx.theme().danger))
            }
            Some(SourceLookup::Pending) | None => {
                section.child(note("Looking up source…".into(), muted))
            }
        };
        Some(
            section
                .when_some(self.launch_error.clone(), |section, error| {
                    section.child(note(error.into(), cx.theme().danger))
                })
                .into_any_element(),
        )
    }

    /// One position in the chain: `<name>  <file>:<line>:<column>` as a
    /// button that opens it, under `label` when there is one.
    fn source_row(
        &self,
        label: &'static str,
        index: usize,
        source: &LayerSource,
        entry_dir: &Path,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let muted = cx.theme().muted_foreground;
        let opened = source.clone();
        div()
            .flex()
            .flex_col()
            .gap_1()
            .px_3()
            .py_2()
            .border_b_1()
            .border_color(cx.theme().border)
            .when(!label.is_empty(), |row| {
                row.child(div().text_xs().text_color(muted).child(label))
            })
            .child(
                Button::new(("layer-source", index))
                    .ghost()
                    .small()
                    .w_full()
                    .icon(IconName::ExternalLink)
                    .tooltip(format!(
                        "Open {}:{}:{}",
                        source.file.display(),
                        source.line,
                        source.column
                    ))
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .gap_2()
                            .overflow_hidden()
                            .child(div().flex_none().child(source.name.clone()))
                            .child(
                                div()
                                    .min_w_0()
                                    .overflow_hidden()
                                    .text_ellipsis()
                                    .text_color(muted)
                                    .child(source_position(source, entry_dir)),
                            ),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.open_layer_source(opened.clone(), cx);
                    })),
            )
            .into_any_element()
    }

    /// Opens `source` in the user's editor off the UI thread (finding the
    /// editor may run the login shell), then shows why it failed, if it did.
    fn open_layer_source(&mut self, source: LayerSource, cx: &mut Context<Self>) {
        let cwd = self.entry_dir();
        let session = self.session;
        self.launch_error = None;
        cx.notify();
        cx.spawn(async move |view, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { open_source(&source, &cwd) })
                .await;
            view.update(cx, |this, cx| {
                // Another file opened meanwhile; the message belongs to the old one.
                if this.session == session {
                    this.launch_error = result.err().map(|error| error.to_string());
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    /// The React entry's directory, which source paths are shown relative to
    /// and the editor runs in.
    fn entry_dir(&self) -> PathBuf {
        self.react_preview
            .as_ref()
            .and_then(|react| react.entry.parent())
            .map(Path::to_path_buf)
            .unwrap_or_default()
    }
}
