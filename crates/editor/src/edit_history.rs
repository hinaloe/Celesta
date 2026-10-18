//! An in-memory undo history of the file writes the editor makes (props-file
//! edits now, canvas edits to the source file later). Each entry keeps the
//! whole file text before and after, so undo is a plain write of the old text;
//! it refuses when the file no longer holds what the entry wrote.

use crate::actions::{Redo, Undo};
use crate::problems::Source;
use crate::source::watched_mtime;
use crate::view::EditorView;
use celesta_react_bridge::replace_file;
use gpui_kit::{Context, Window};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// The most entries kept; the oldest are dropped first.
const CAPACITY: usize = 100;

/// One write to one file.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct FileEdit {
    pub(crate) path: PathBuf,
    /// The text before the write; `None` when the file did not exist.
    pub(crate) before: Option<String>,
    pub(crate) after: String,
}

#[derive(Debug)]
pub(crate) enum HistoryError {
    /// The file no longer holds what the entry expects, so it was not touched.
    // `path` names the file for callers that report per file.
    #[allow(dead_code)]
    ChangedOutside { path: PathBuf },
    /// The file could not be read or written.
    Io { path: PathBuf, source: io::Error },
}

impl fmt::Display for HistoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ChangedOutside { .. } => formatter.write_str("The file changed outside Celesta"),
            Self::Io { path, source } => {
                write!(formatter, "Couldn’t write {}: {source}", path.display())
            }
        }
    }
}

impl std::error::Error for HistoryError {}

#[derive(Debug, Default)]
pub(crate) struct EditHistory {
    /// Oldest first.
    undo: Vec<FileEdit>,
    redo: Vec<FileEdit>,
}

impl EditHistory {
    /// Records a write that just happened. A new edit ends the redo chain.
    pub(crate) fn push(&mut self, edit: FileEdit) {
        self.redo.clear();
        self.undo.push(edit);
        if self.undo.len() > CAPACITY {
            self.undo.remove(0);
        }
    }

    /// Restores the newest edit's `before` (removing a file the edit created).
    /// `Ok(None)` when there is nothing to undo, otherwise the file written.
    /// When the file no longer holds the edit's `after`, that edit and the
    /// older ones for the same file are dropped, since they cannot apply.
    pub(crate) fn undo(&mut self) -> Result<Option<PathBuf>, HistoryError> {
        let Some(edit) = self.undo.pop() else {
            return Ok(None);
        };
        if read(&edit.path)?.as_deref() != Some(edit.after.as_str()) {
            self.undo.retain(|older| older.path != edit.path);
            return Err(HistoryError::ChangedOutside { path: edit.path });
        }
        if let Err(error) = write(&edit.path, edit.before.as_deref()) {
            self.undo.push(edit);
            return Err(error);
        }
        let path = edit.path.clone();
        self.redo.push(edit);
        Ok(Some(path))
    }

    /// Writes the newest undone edit's `after` again, if the file still holds
    /// the edit's `before`.
    pub(crate) fn redo(&mut self) -> Result<Option<PathBuf>, HistoryError> {
        let Some(edit) = self.redo.pop() else {
            return Ok(None);
        };
        if read(&edit.path)? != edit.before {
            self.redo.retain(|newer| newer.path != edit.path);
            return Err(HistoryError::ChangedOutside { path: edit.path });
        }
        if let Err(error) = write(&edit.path, Some(&edit.after)) {
            self.redo.push(edit);
            return Err(error);
        }
        let path = edit.path.clone();
        self.undo.push(edit);
        Ok(Some(path))
    }

    pub(crate) fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }
}

/// The file's text, or `None` when it does not exist.
fn read(path: &Path) -> Result<Option<String>, HistoryError> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(HistoryError::Io {
            path: path.to_owned(),
            source,
        }),
    }
}

/// Writes `text` atomically, or removes the file for `None`.
fn write(path: &Path, text: Option<&str>) -> Result<(), HistoryError> {
    match text {
        Some(text) => replace_file(path, text),
        None => fs::remove_file(path),
    }
    .map_err(|source| HistoryError::Io {
        path: path.to_owned(),
        source,
    })
}

/// Reads `path` (a missing file reads as `""`), lets `edit` compute the new
/// text, and writes it atomically.
pub(crate) fn write_recorded(
    path: &Path,
    edit: impl FnOnce(&str) -> Result<String, String>,
) -> Result<FileEdit, String> {
    let before = read(path).map_err(|error| error.to_string())?;
    let after = edit(before.as_deref().unwrap_or(""))?;
    // Renaming over a read-only file would succeed, so refuse it explicitly.
    if fs::metadata(path).is_ok_and(|metadata| metadata.permissions().readonly()) {
        return Err(format!(
            "Couldn’t write {}: the file is read-only",
            path.display()
        ));
    }
    write(path, Some(&after)).map_err(|error| error.to_string())?;
    Ok(FileEdit {
        path: path.to_owned(),
        before,
        after,
    })
}

impl EditorView {
    /// The React entry file the view has open.
    pub(crate) fn react_entry(&self) -> Option<&Path> {
        self.react_preview
            .as_ref()
            .map(|react| react.entry.as_path())
    }

    /// Takes a write the editor made itself as seen: `watched` (the watched
    /// files' mtime sampled after the write) replaces the reload watcher's, so
    /// the write is not mistaken for an edit from elsewhere. Returns the reload
    /// order a reload requested from now on will read the write at.
    pub(crate) fn apply_own_write_sample(&mut self, watched: Option<SystemTime>) -> u64 {
        let next_reload = self.react_reloads.next();
        if let Some(react) = self.react_preview.as_mut()
            && watched.is_some()
        {
            react.watched_mtime = watched;
            self.watched_since = next_reload;
        }
        next_reload
    }

    /// Call after the editor wrote a watched file (undo, redo, or a canvas
    /// edit): samples the watched files, then reloads the entry.
    pub(crate) fn finish_own_write(&mut self, cx: &mut Context<Self>) {
        let Some(react) = self.react_preview.as_ref() else {
            return;
        };
        let watched = watched_mtime(&react.entry, &react.property_args);
        self.apply_own_write_sample(watched);
        self.request_react_reload(cx);
    }

    pub(crate) fn undo_action(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        self.step_history(EditHistory::undo, "Couldn’t undo", cx);
    }

    pub(crate) fn redo_action(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        self.step_history(EditHistory::redo, "Couldn’t redo", cx);
    }

    fn step_history(
        &mut self,
        step: fn(&mut EditHistory) -> Result<Option<PathBuf>, HistoryError>,
        failure: &str,
        cx: &mut Context<Self>,
    ) {
        // A property write is still in flight; its entry is not recorded yet.
        if !self.is_react_preview() || self.property_panel.is_writing() {
            return;
        }
        match step(&mut self.edit_history) {
            Ok(Some(_)) => self.finish_own_write(cx),
            Ok(None) => {}
            Err(error) => self
                .problems
                .report(Source::Project, failure, error.to_string()),
        }
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use celesta_react_bridge::set_property_text;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn scratch(name: &str) -> PathBuf {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "celesta-history-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn edit(path: &Path, before: Option<&str>, after: &str) -> FileEdit {
        FileEdit {
            path: path.to_owned(),
            before: before.map(str::to_owned),
            after: after.to_owned(),
        }
    }

    #[test]
    fn undo_restores_before_and_redo_reapplies() {
        let file = scratch("undo").join("a.txt");
        fs::write(&file, "two").unwrap();
        let mut history = EditHistory::default();
        history.push(edit(&file, Some("one"), "two"));

        assert_eq!(history.undo().unwrap(), Some(file.clone()));
        assert_eq!(fs::read_to_string(&file).unwrap(), "one");
        assert_eq!(history.redo().unwrap(), Some(file.clone()));
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        assert_eq!(history.redo().unwrap(), None);
    }

    #[test]
    fn undo_of_a_created_file_removes_it_and_redo_creates_it_again() {
        let file = scratch("created").join("a.txt");
        fs::write(&file, "new").unwrap();
        let mut history = EditHistory::default();
        history.push(edit(&file, None, "new"));

        history.undo().unwrap();
        assert!(!file.exists());
        history.redo().unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
    }

    #[test]
    fn undo_refuses_when_file_changed_outside() {
        let dir = scratch("outside");
        let (a, b) = (dir.join("a.txt"), dir.join("b.txt"));
        fs::write(&a, "a1").unwrap();
        fs::write(&b, "b1").unwrap();
        let mut history = EditHistory::default();
        history.push(edit(&a, Some("a0"), "a1"));
        history.push(edit(&b, Some("b0"), "b1"));
        history.push(edit(&a, Some("a1"), "a2"));
        fs::write(&a, "someone else").unwrap();

        let error = history.undo().unwrap_err();

        assert!(matches!(error, HistoryError::ChangedOutside { .. }));
        assert_eq!(error.to_string(), "The file changed outside Celesta");
        assert_eq!(fs::read_to_string(&a).unwrap(), "someone else");
        // Older entries for `a` are gone too; `b`'s entry is kept.
        assert_eq!(history.undo().unwrap(), Some(b.clone()));
        assert_eq!(fs::read_to_string(&b).unwrap(), "b0");
        assert_eq!(history.undo().unwrap(), None);
    }

    #[test]
    fn undo_refuses_when_the_created_file_was_deleted() {
        let file = scratch("deleted").join("a.txt");
        let mut history = EditHistory::default();
        history.push(edit(&file, None, "new"));

        assert!(matches!(
            history.undo(),
            Err(HistoryError::ChangedOutside { .. })
        ));
    }

    #[test]
    fn push_clears_redo() {
        let file = scratch("redo").join("a.txt");
        fs::write(&file, "b").unwrap();
        let mut history = EditHistory::default();
        history.push(edit(&file, Some("a"), "b"));
        history.undo().unwrap();
        history.push(edit(&file, Some("a"), "c"));

        assert_eq!(history.redo().unwrap(), None);
    }

    #[test]
    fn cap_keeps_latest_100() {
        let file = scratch("cap").join("a.txt");
        let mut history = EditHistory::default();
        for index in 0..105 {
            history.push(edit(
                &file,
                Some(&index.to_string()),
                &(index + 1).to_string(),
            ));
        }
        fs::write(&file, "105").unwrap();

        let mut undone = 0;
        while history.undo().unwrap().is_some() {
            undone += 1;
        }

        assert_eq!(undone, 100);
        assert_eq!(fs::read_to_string(&file).unwrap(), "5");
    }

    #[test]
    fn undo_after_failed_reload_restores_before() {
        // The history only looks at the file, never at reload results.
        let file = scratch("reload").join("a.txt");
        fs::write(&file, "broken").unwrap();
        let mut history = EditHistory::default();
        history.push(edit(&file, Some("fine"), "broken"));

        history.undo().unwrap();

        assert_eq!(fs::read_to_string(&file).unwrap(), "fine");
    }

    #[test]
    fn property_commit_is_recorded() {
        let file = scratch("property").join("props.json");
        fs::write(&file, "{\n  \"a\": 1\n}\n").unwrap();

        let recorded = write_recorded(&file, |text| {
            set_property_text(&file, text, "a", Some(&json!(2))).map_err(|error| error.to_string())
        })
        .unwrap();

        let after: serde_json::Value = serde_json::from_str(&recorded.after).unwrap();
        assert_eq!(after, json!({ "a": 2 }));
        assert_eq!(recorded.before.as_deref(), Some("{\n  \"a\": 1\n}\n"));
        assert_eq!(fs::read_to_string(&file).unwrap(), recorded.after);
    }

    #[test]
    fn writing_a_missing_file_records_no_before() {
        let file = scratch("missing").join("props.json");

        let recorded = write_recorded(&file, |text| {
            assert_eq!(text, "");
            Ok("{}\n".to_owned())
        })
        .unwrap();

        assert_eq!(recorded.before, None);
        assert_eq!(fs::read_to_string(&file).unwrap(), "{}\n");
    }

    #[test]
    fn a_failed_edit_leaves_the_file_alone() {
        let file = scratch("failed").join("a.txt");
        fs::write(&file, "x").unwrap();

        let error = write_recorded(&file, |_| Err("nope".to_owned())).unwrap_err();

        assert_eq!(error, "nope");
        assert_eq!(fs::read_to_string(&file).unwrap(), "x");
    }
}
