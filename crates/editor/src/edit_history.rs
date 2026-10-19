//! An in-memory undo history of the file writes the editor makes (props-file
//! edits now, canvas edits to the source file later). Each entry keeps the
//! whole file text before and after, so undo is a plain write of the old text;
//! it refuses when the file no longer holds what the entry wrote.

use crate::actions::{Redo, Undo};
use crate::problems::Source;
use crate::source::{PropertyArgs, watched_mtime};
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

impl FileEdit {
    /// Whether the edit changed the file's text (an edit that wrote nothing
    /// is not worth an undo step or a reload).
    pub(crate) fn changes(&self) -> bool {
        self.before.as_deref() != Some(self.after.as_str())
    }
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

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Step {
    Undo,
    Redo,
}

/// An entry taken off its stack while its file is being written elsewhere
/// (the UI thread hands it to a background task and settles it afterwards).
#[derive(Debug)]
pub(crate) struct Pending {
    edit: FileEdit,
    step: Step,
    epoch: u64,
}

impl Pending {
    /// Checks the file still holds what the step expects, then writes the other
    /// side. Touches only the file, so it may run off the UI thread.
    pub(crate) fn apply(&self) -> Result<(), HistoryError> {
        let edit = &self.edit;
        let (expected, written) = match self.step {
            Step::Undo => (Some(edit.after.as_str()), edit.before.as_deref()),
            Step::Redo => (edit.before.as_deref(), Some(edit.after.as_str())),
        };
        if read(&edit.path)?.as_deref() != expected {
            return Err(HistoryError::ChangedOutside {
                path: edit.path.clone(),
            });
        }
        write(&edit.path, written)
    }
}

#[derive(Debug, Default)]
pub(crate) struct EditHistory {
    /// Oldest first.
    undo: Vec<FileEdit>,
    redo: Vec<FileEdit>,
    /// A step or an own write is running off the UI thread; writes to one
    /// file stay serialized.
    busy: bool,
    /// Bumped by `clear`, so a task that started before it is ignored.
    epoch: u64,
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

    pub(crate) fn is_busy(&self) -> bool {
        self.busy
    }

    /// Takes the newest entry of `step`'s stack and marks the history busy.
    /// `None` when that stack is empty or the history is already busy.
    pub(crate) fn begin(&mut self, step: Step) -> Option<Pending> {
        if self.busy {
            return None;
        }
        let edit = match step {
            Step::Undo => self.undo.pop(),
            Step::Redo => self.redo.pop(),
        }?;
        self.busy = true;
        Some(Pending {
            edit,
            step,
            epoch: self.epoch,
        })
    }

    /// Puts the outcome of `pending.apply()` in the stacks: a success moves the
    /// entry to the other stack; a refusal drops it and the rest of its file's
    /// entries on that stack, since they cannot apply; any other error keeps
    /// it. `None` when the history was cleared meanwhile.
    pub(crate) fn settle(
        &mut self,
        pending: Pending,
        result: Result<(), HistoryError>,
    ) -> Option<Result<PathBuf, HistoryError>> {
        if pending.epoch != self.epoch {
            return None;
        }
        self.busy = false;
        let Pending { edit, step, .. } = pending;
        let (own, other) = match step {
            Step::Undo => (&mut self.undo, &mut self.redo),
            Step::Redo => (&mut self.redo, &mut self.undo),
        };
        Some(match result {
            Ok(()) => {
                let path = edit.path.clone();
                other.push(edit);
                Ok(path)
            }
            Err(error @ HistoryError::ChangedOutside { .. }) => {
                own.retain(|rest| rest.path != edit.path);
                Err(error)
            }
            Err(error) => {
                own.push(edit);
                Err(error)
            }
        })
    }

    /// Marks the history busy for an own write; returns the epoch to hand to
    /// `finish_write`, or `None` when it is already busy.
    pub(crate) fn begin_write(&mut self) -> Option<u64> {
        if self.busy {
            return None;
        }
        self.busy = true;
        Some(self.epoch)
    }

    /// Ends an own write, recording its edit. `false` when the history was
    /// cleared meanwhile (the edit is then not recorded).
    pub(crate) fn finish_write(&mut self, epoch: u64, edit: Option<FileEdit>) -> bool {
        if epoch != self.epoch {
            return false;
        }
        self.busy = false;
        if let Some(edit) = edit {
            self.push(edit);
        }
        true
    }

    /// Undoes synchronously (the view runs the same steps in the background).
    #[cfg(test)]
    fn run(&mut self, step: Step) -> Result<Option<PathBuf>, HistoryError> {
        let Some(pending) = self.begin(step) else {
            return Ok(None);
        };
        let result = pending.apply();
        self.settle(pending, result).transpose()
    }

    #[cfg(test)]
    fn undo(&mut self) -> Result<Option<PathBuf>, HistoryError> {
        self.run(Step::Undo)
    }

    #[cfg(test)]
    fn redo(&mut self) -> Result<Option<PathBuf>, HistoryError> {
        self.run(Step::Redo)
    }

    pub(crate) fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
        self.busy = false;
        self.epoch += 1;
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
/// text, and writes it atomically; an existing file whose text `edit` left
/// as it was is not written (see [`FileEdit::changes`]).
pub(crate) fn write_recorded(
    path: &Path,
    edit: impl FnOnce(&str) -> Result<String, String>,
) -> Result<FileEdit, String> {
    let before = read(path).map_err(|error| error.to_string())?;
    let after = edit(before.as_deref().unwrap_or(""))?;
    if before.as_deref() == Some(after.as_str()) {
        return Ok(FileEdit {
            path: path.to_owned(),
            before,
            after,
        });
    }
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
        // The reload that reads this write keeps the selected layer, whose
        // transform targets are resolved again from the reloaded code.
        self.selection_keep.own_write();
        self.transform.invalidate();
        if let Some(react) = self.react_preview.as_mut()
            && watched.is_some()
        {
            react.watched_mtime = watched;
            self.watched_since = next_reload;
        }
        next_reload
    }

    /// The entry and arguments the reload watcher's mtime sample reads.
    fn watch_sample_inputs(&self) -> Option<(PathBuf, PropertyArgs)> {
        let react = self.react_preview.as_ref()?;
        Some((react.entry.clone(), react.property_args.clone()))
    }

    /// Writes `path` as an own write off the UI thread: `edit` computes the new
    /// text from the file's current text (`""` when missing), the write goes
    /// through `write_recorded`, and the watched files are sampled after it.
    /// Back on the UI thread the edit is pushed to the history, the sample is
    /// applied and the entry reloads; then `done` gets the result. An edit
    /// that leaves the text as it was writes nothing, records nothing and
    /// reloads nothing, and `done` gets `Ok`. When the history or a property
    /// write is busy, `done` gets an error at once.
    pub(crate) fn record_own_write(
        &mut self,
        path: PathBuf,
        edit: impl FnOnce(&str) -> Result<String, String> + Send + 'static,
        done: impl FnOnce(&mut Self, Result<(), String>, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let (Some((entry, property_args)), false) =
            (self.watch_sample_inputs(), self.property_panel.is_writing())
        else {
            return done(self, Err(BUSY.to_owned()), cx);
        };
        let Some(epoch) = self.edit_history.begin_write() else {
            return done(self, Err(BUSY.to_owned()), cx);
        };
        cx.spawn(async move |view, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let edit = write_recorded(&path, edit)?;
                    Ok((edit, watched_mtime(&entry, &property_args)))
                })
                .await;
            view.update(cx, |this, cx| {
                let outcome = match result {
                    Ok((edit, watched)) => {
                        let changes = edit.changes();
                        if this
                            .edit_history
                            .finish_write(epoch, changes.then_some(edit))
                            && changes
                        {
                            this.apply_own_write_sample(watched);
                            this.request_react_reload(cx);
                        }
                        Ok(())
                    }
                    Err(message) => {
                        this.edit_history.finish_write(epoch, None);
                        Err(message)
                    }
                };
                done(this, outcome, cx);
                this.drain_property_commits(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn undo_action(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        self.step_history(Step::Undo, cx);
    }

    pub(crate) fn redo_action(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        self.step_history(Step::Redo, cx);
    }

    /// Undoes or redoes the newest edit off the UI thread, then reloads.
    fn step_history(&mut self, step: Step, cx: &mut Context<Self>) {
        // A property write still running has no entry yet, and writes to one
        // file must not overlap.
        if self.property_panel.is_writing() {
            return;
        }
        let Some((entry, property_args)) = self.watch_sample_inputs() else {
            return;
        };
        let Some(pending) = self.edit_history.begin(step) else {
            return;
        };
        let failure = match step {
            Step::Undo => "Couldn’t undo",
            Step::Redo => "Couldn’t redo",
        };
        cx.spawn(async move |view, cx| {
            let (pending, result, watched) = cx
                .background_executor()
                .spawn(async move {
                    let result = pending.apply();
                    // Sampled after the write, so the reload watcher does not
                    // take it for an edit from elsewhere.
                    let watched = watched_mtime(&entry, &property_args);
                    (pending, result, watched)
                })
                .await;
            view.update(cx, |this, cx| {
                match this.edit_history.settle(pending, result) {
                    Some(Ok(_)) => {
                        this.apply_own_write_sample(watched);
                        this.request_react_reload(cx);
                    }
                    Some(Err(error)) => {
                        this.problems
                            .report(Source::Project, failure, error.to_string());
                    }
                    None => {}
                }
                this.drain_property_commits(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

const BUSY: &str = "Another edit is still being saved";

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
    fn a_read_error_keeps_the_entry() {
        let dir = scratch("readerror");
        // Reading a folder fails with something other than "not found".
        let folder = dir.join("props.json");
        fs::create_dir(&folder).unwrap();
        let mut history = EditHistory::default();
        history.push(edit(&folder, Some("a"), "b"));

        assert!(matches!(history.undo(), Err(HistoryError::Io { .. })));
        assert!(!history.is_busy());
        fs::remove_dir(&folder).unwrap();
        fs::write(&folder, "b").unwrap();
        assert_eq!(history.undo().unwrap(), Some(folder.clone()));
        assert_eq!(fs::read_to_string(&folder).unwrap(), "a");

        // The same goes for redo.
        fs::remove_file(&folder).unwrap();
        fs::create_dir(&folder).unwrap();
        assert!(matches!(history.redo(), Err(HistoryError::Io { .. })));
        fs::remove_dir(&folder).unwrap();
        fs::write(&folder, "a").unwrap();
        assert_eq!(history.redo().unwrap(), Some(folder.clone()));
    }

    #[test]
    fn a_cleared_history_ignores_a_step_that_was_running() {
        let file = scratch("epoch").join("a.txt");
        fs::write(&file, "b").unwrap();
        let mut history = EditHistory::default();
        history.push(edit(&file, Some("a"), "b"));
        let pending = history.begin(Step::Undo).unwrap();
        assert!(history.begin(Step::Undo).is_none());
        history.clear();

        let result = pending.apply();

        assert!(history.settle(pending, result).is_none());
        assert!(!history.is_busy());
        assert_eq!(history.undo().unwrap(), None);
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
    fn an_edit_that_changes_nothing_is_not_written() {
        let file = scratch("same").join("a.txt");
        fs::write(&file, "x").unwrap();
        // Read-only: a write would fail, so success shows nothing was written.
        let mut permissions = fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&file, permissions).unwrap();

        let recorded = write_recorded(&file, |text| Ok(text.to_owned())).unwrap();

        assert!(!recorded.changes());
        assert!(edit(&file, Some("x"), "y").changes());
        assert!(edit(&file, None, "").changes());
        let mut history = EditHistory::default();
        let epoch = history.begin_write().unwrap();
        assert!(history.finish_write(epoch, recorded.changes().then_some(recorded)));
        assert_eq!(history.undo().unwrap(), None, "no history entry");
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
