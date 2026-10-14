# Editor Problems Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editor's truncated title-bar status text with a Problems tab, a status bar indicator, toasts, and an in-place preview error panel, all backed by one problem store with a per-project log.

**Architecture:** A GPUI-free `Problems` store (`crates/editor/src/problems.rs`) replaces the ten error and status fields on `EditorView`. Setting a problem records a log entry when it is new or changed. The interface reads the store: a tab in the right dock lists active problems and history, the status bar shows counts, and render drains not-yet-announced entries into toasts.

**Tech Stack:** Rust 1.99, `gpui-kit` 0.6 (`TabBar`, `TextView`, `Clipboard`, `Notification`, `Button`), `chrono` 0.4 (`clock` feature).

**Spec:** `docs/superpowers/specs/2026-10-14-editor-problems-panel-design.md`

## Global Constraints

- Source labels: `Project`, `Media`, `Audio`, `Preview`, `Schemas`, `Export`, `TypeScript`.
- Default severities: `Audio` and `TypeScript` are warnings; every other source is an error.
- History keeps at most 500 entries and drops the oldest first.
- `reset` happens by opening a project successfully; a failed open keeps the log and appends the failure.
- Preview warnings count as warnings but are never logged.
- Toasts: `Error` entries do not autohide and have a `Show in Problems` action; `Done` entries autohide and show the title only; `Warning` entries get no toast. Toasts are keyed by source with `id1`.
- Details render as a selectable `TextView` over a fenced `text` code block whose fence is longer than any backtick run in the detail.
- The `ShowProblems` action is in the View menu as `Problems`, bound to `secondary-shift-m`.
- Interface copy follows the GPUI Kit Design Guides: titles name the condition (`Export failed`, never `Error`), ellipsis is `…`, apostrophes are `’`.
- Colors come from `cx.theme()` tokens only.
- Property validation issues stay out of Problems.

## Review Focus

- A detail containing triple backticks (React error output can): it must still render verbatim, not break out of its code block. Tested in Task 1 (`fenced_detail_uses_a_longer_fence_than_the_detail`).
- An error whose `Display` already embeds its cause (`could not run node: No such file…` plus `source()` returning the same `io::Error`): the cause must not appear twice. Tested in Task 2 (`error_chain_skips_causes_already_in_the_message`).
- The same error re-set every frame (the preview re-reports a failing frame on every refresh): it must log and toast once, not flood. Tested in Task 1 (`setting_the_same_problem_again_logs_nothing`).
- More than 500 entries while some are unannounced: announcing must not index past the trimmed history. Tested in Task 1 (`trimming_keeps_unannounced_within_history`).
- An empty or multi-line detail in a toast: the toast shows the first line, and an empty detail shows no message. Tested in Task 1 (`first_line_of_detail`).

---

## File Structure

| File | Responsibility |
|---|---|
| `crates/editor/src/problems.rs` (create) | `Source`, `Severity`, `Problem`, `ActiveProblem`, `LogEntry`, `Problems`, `error_chain`, `fenced`, `first_line`. No GPUI. Unit tests inline. |
| `crates/editor/src/problems_panel.rs` (create) | `impl EditorView`: the right dock tab bar, the Problems tab, the status bar indicator, toast announcement, and the `ShowProblems` handler. |
| `crates/editor/src/view.rs` | Field swap: ten fields out; `problems`, `right_tab`, `expanded_log_entries` in. `RightTab` enum. |
| `crates/editor/src/background.rs`, `audio_control.rs`, `playback.rs`, `export_control.rs`, `lifecycle.rs`, `refresh.rs` | Call sites move to `self.problems`. |
| `crates/editor/src/preview.rs`, `export_worker.rs`, `audio.rs`, `react_audio.rs`, `component_schema.rs`, `media_probe.rs` | Worker errors stringified with `error_chain`. |
| `crates/editor/src/panels.rs` | Title bar loses its messages; inspector reads the schema problem; panel headers that the tab bar replaces are removed. |
| `crates/editor/src/viewer.rs` | Preview error panel. |
| `crates/editor/src/render.rs` | Right dock uses the tab bar; status bar indicator; toast announcement each render. |
| `crates/editor/src/actions.rs`, `main.rs` | `ShowProblems` action, binding, menu item, module declarations. |
| `crates/editor/Cargo.toml` | `chrono` dependency. |

Build and test commands, run from the repository root:

- Tests: `cargo test -p celesta-editor`
- Single test: `cargo test -p celesta-editor problems::tests::<name>`
- Build: `cargo build -p celesta-editor`
- Format: `cargo fmt -p celesta-editor`
- Run: `cargo run -p celesta-editor -- <path to .celesta.json or .tsx>`

---

### Task 0: Capture the "before" screenshots

AGENTS.md requires before/after screenshots of the same scenes. Take the
"before" set now, from the unmodified code.

**Files:** none in the repository. Keep the screenshots and the scratch
project in a temporary directory outside the repository.

- [ ] **Step 1: Make a scratch React project**

Run the editor with no arguments, choose File > Create New Project…, pick
`blank`, and choose an empty temporary folder. The editor opens its
`film.tsx`.

- [ ] **Step 2: Make the preview fail**

Edit the scratch project's `film.tsx` so the composition's component
throws on render, for example by adding as its first statement:

```tsx
throw new Error("Scene `intro` references asset_id \"logo\" which does not exist in assets/ — check film.tsx line 12 and the asset table");
```

The editor reloads the entry and shows a preview error. The long message
is deliberate: it shows truncation.

- [ ] **Step 3: Make an export fail**

Choose Export… and save into a folder you have made read-only
(`chmod a-w <folder>` on macOS/Linux). The title bar shows an export
error.

- [ ] **Step 4: Screenshot**

Capture the whole window showing the truncated title bar messages and the
preview error. Name it `before.png`.

---

### Task 1: The `Problems` store

**Files:**
- Create: `crates/editor/src/problems.rs`
- Modify: `crates/editor/Cargo.toml` (dependencies)
- Modify: `crates/editor/src/main.rs:19-43` (module list)

**Interfaces:**
- Produces (all `pub(crate)`):
  - `enum Source { Project, Media, Audio, Preview, Schemas, Export, TypeScript }` with `fn label(self) -> &'static str`, `fn severity(self) -> Severity`, `fn failure_title(self) -> &'static str`; derives `Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash`.
  - `enum Severity { Error, Warning, Done }` with `fn label(self) -> &'static str`.
  - `struct Problem { title: String, detail: String }`, `Problem::new(title, detail)`.
  - `struct ActiveProblem { time: DateTime<Local>, problem: Problem }`.
  - `struct LogEntry { id: u64, time: DateTime<Local>, severity: Severity, source: Source, problem: Problem }` with `fn to_text(&self) -> String`.
  - `struct Problems` (`Default`) with `set`, `report`, `fail`, `clear`, `info`, `set_preview_warnings`, `active`, `active_problems`, `preview_warnings`, `history`, `history_text`, `clear_history`, `take_unannounced`, `error_count`, `warning_count`.
  - `fn fenced(detail: &str) -> String`, `fn first_line(detail: &str) -> &str`.

- [ ] **Step 1: Add the dependency and module**

In `crates/editor/Cargo.toml`, under `[dependencies]`, after the `celesta-react-bridge` line:

```toml
chrono = { version = "0.4", default-features = false, features = ["clock"] }
```

In `crates/editor/src/main.rs`, add `mod problems;` between `mod preview;` and `mod property_panel;`.

- [ ] **Step 2: Write the failing tests**

Create `crates/editor/src/problems.rs` with only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone as _;

    fn problem(title: &str, detail: &str) -> Problem {
        Problem::new(title, detail)
    }

    #[test]
    fn setting_a_new_problem_logs_one_entry() {
        let mut problems = Problems::default();
        problems.set(Source::Export, Some(problem("Export failed", "disk full")));
        assert_eq!(problems.history().count(), 1);
        let entry = problems.history().next().unwrap();
        assert_eq!(entry.severity, Severity::Error);
        assert_eq!(entry.source, Source::Export);
        assert_eq!(entry.problem, problem("Export failed", "disk full"));
        assert_eq!(
            problems.active(Source::Export).map(|active| &active.problem),
            Some(&problem("Export failed", "disk full"))
        );
    }

    #[test]
    fn setting_the_same_problem_again_logs_nothing() {
        let mut problems = Problems::default();
        for _ in 0..3 {
            problems.fail(Source::Preview, "node exited");
        }
        assert_eq!(problems.history().count(), 1);
        assert_eq!(problems.take_unannounced().len(), 1);
    }

    #[test]
    fn changing_a_problem_logs_another_entry() {
        let mut problems = Problems::default();
        problems.fail(Source::Preview, "first");
        problems.fail(Source::Preview, "second");
        let details: Vec<&str> = problems
            .history()
            .map(|entry| entry.problem.detail.as_str())
            .collect();
        assert_eq!(details, ["first", "second"]);
    }

    #[test]
    fn clearing_keeps_the_history_entry() {
        let mut problems = Problems::default();
        problems.fail(Source::Audio, "no output device");
        problems.clear(Source::Audio);
        assert!(problems.active(Source::Audio).is_none());
        assert_eq!(problems.history().count(), 1);
        assert_eq!(problems.history().next().unwrap().severity, Severity::Warning);
    }

    #[test]
    fn a_problem_that_recurs_after_clearing_is_logged_again() {
        let mut problems = Problems::default();
        problems.fail(Source::Audio, "no output device");
        problems.clear(Source::Audio);
        problems.fail(Source::Audio, "no output device");
        assert_eq!(problems.history().count(), 2);
    }

    #[test]
    fn info_logs_a_done_entry_without_active_state() {
        let mut problems = Problems::default();
        problems.info(Source::Export, "Export finished", "/tmp/out.mp4");
        assert!(problems.active(Source::Export).is_none());
        let entry = problems.history().next().unwrap();
        assert_eq!(entry.severity, Severity::Done);
        assert_eq!(entry.problem, problem("Export finished", "/tmp/out.mp4"));
    }

    #[test]
    fn counts_errors_and_warnings() {
        let mut problems = Problems::default();
        problems.fail(Source::Export, "disk full");
        problems.fail(Source::Preview, "node exited");
        problems.fail(Source::Audio, "no output device");
        problems.set_preview_warnings(vec!["font fallback".to_owned(), "missing glyph".to_owned()]);
        problems.info(Source::TypeScript, "TypeScript set up in film", "");
        assert_eq!(problems.error_count(), 2);
        assert_eq!(problems.warning_count(), 3);
    }

    #[test]
    fn preview_warnings_are_not_logged() {
        let mut problems = Problems::default();
        problems.set_preview_warnings(vec!["font fallback".to_owned()]);
        assert_eq!(problems.preview_warnings(), ["font fallback".to_owned()]);
        assert_eq!(problems.history().count(), 0);
    }

    #[test]
    fn history_is_capped_and_drops_the_oldest() {
        let mut problems = Problems::default();
        for index in 0..HISTORY_LIMIT + 10 {
            problems.info(Source::Export, "Export finished", index.to_string());
        }
        assert_eq!(problems.history().count(), HISTORY_LIMIT);
        assert_eq!(problems.history().next().unwrap().problem.detail, "10");
    }

    #[test]
    fn trimming_keeps_unannounced_within_history() {
        let mut problems = Problems::default();
        for index in 0..HISTORY_LIMIT + 10 {
            problems.info(Source::Export, "Export finished", index.to_string());
        }
        let announced = problems.take_unannounced();
        assert_eq!(announced.len(), HISTORY_LIMIT);
        assert_eq!(announced.first().unwrap().problem.detail, "10");
    }

    #[test]
    fn take_unannounced_returns_each_entry_once() {
        let mut problems = Problems::default();
        problems.fail(Source::Export, "disk full");
        problems.info(Source::TypeScript, "TypeScript set up in film", "");
        let first: Vec<Source> = problems
            .take_unannounced()
            .iter()
            .map(|entry| entry.source)
            .collect();
        assert_eq!(first, [Source::Export, Source::TypeScript]);
        assert!(problems.take_unannounced().is_empty());
        problems.fail(Source::Preview, "node exited");
        assert_eq!(problems.take_unannounced().len(), 1);
    }

    #[test]
    fn clear_history_empties_the_log_but_not_active_problems() {
        let mut problems = Problems::default();
        problems.fail(Source::Export, "disk full");
        problems.clear_history();
        assert_eq!(problems.history().count(), 0);
        assert!(problems.take_unannounced().is_empty());
        assert!(problems.active(Source::Export).is_some());
    }

    #[test]
    fn entry_ids_are_unique_and_increasing() {
        let mut problems = Problems::default();
        problems.fail(Source::Export, "a");
        problems.fail(Source::Export, "b");
        let ids: Vec<u64> = problems.history().map(|entry| entry.id).collect();
        assert!(ids[0] < ids[1]);
    }

    #[test]
    fn active_problems_are_listed_in_source_order() {
        let mut problems = Problems::default();
        problems.fail(Source::Export, "disk full");
        problems.fail(Source::Project, "bad json");
        let sources: Vec<Source> = problems.active_problems().map(|(source, _)| source).collect();
        assert_eq!(sources, [Source::Project, Source::Export]);
    }

    #[test]
    fn log_entry_text_names_time_severity_source_title_and_detail() {
        let entry = LogEntry {
            id: 0,
            time: Local.with_ymd_and_hms(2026, 10, 14, 12, 3, 41).unwrap(),
            severity: Severity::Error,
            source: Source::Export,
            problem: problem("Export failed", "ffmpeg exited\ncaused by: disk full"),
        };
        assert_eq!(
            entry.to_text(),
            "12:03:41 Error · Export · Export failed\nffmpeg exited\ncaused by: disk full"
        );
    }

    #[test]
    fn history_text_is_chronological_and_blank_line_separated() {
        let mut problems = Problems::default();
        problems.fail(Source::Export, "disk full");
        problems.info(Source::Export, "Export finished", "");
        let text = problems.history_text();
        let blocks: Vec<&str> = text.split("\n\n").collect();
        assert_eq!(blocks.len(), 2);
        assert!(blocks[0].contains("Export failed"));
        assert!(blocks[1].ends_with("Done · Export · Export finished"));
    }

    #[test]
    fn fenced_detail_uses_a_longer_fence_than_the_detail() {
        assert_eq!(fenced("plain"), "```text\nplain\n```");
        assert_eq!(
            fenced("before\n```js\nthrow 1\n```\nafter"),
            "````text\nbefore\n```js\nthrow 1\n```\nafter\n````"
        );
    }

    #[test]
    fn first_line_of_detail() {
        assert_eq!(first_line("one\ntwo"), "one");
        assert_eq!(first_line(""), "");
    }

    #[test]
    fn sources_have_labels_severities_and_failure_titles() {
        assert_eq!(Source::Schemas.label(), "Schemas");
        assert_eq!(Source::TypeScript.severity(), Severity::Warning);
        assert_eq!(Source::Audio.severity(), Severity::Warning);
        assert_eq!(Source::Project.severity(), Severity::Error);
        assert_eq!(Source::Export.failure_title(), "Export failed");
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p celesta-editor problems::tests`
Expected: compile errors, `cannot find type Problems in this scope` and similar.

- [ ] **Step 4: Implement the store**

Put this above the test module in `crates/editor/src/problems.rs`:

```rust
//! What is wrong right now, and a log of the errors, warnings, and finished
//! operations since the project opened. The Problems tab, the status bar
//! counts, and the toasts all read from here.

use chrono::{DateTime, Local};
use std::collections::{BTreeMap, VecDeque};

/// The most log entries kept; the oldest are dropped first.
pub(crate) const HISTORY_LIMIT: usize = 500;

/// Where a problem comes from, in the order the Problems tab lists them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Source {
    Project,
    Media,
    Audio,
    Preview,
    Schemas,
    Export,
    TypeScript,
}

impl Source {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Project => "Project",
            Self::Media => "Media",
            Self::Audio => "Audio",
            Self::Preview => "Preview",
            Self::Schemas => "Schemas",
            Self::Export => "Export",
            Self::TypeScript => "TypeScript",
        }
    }

    /// Audio and TypeScript problems leave the editor usable, so they are
    /// warnings; the rest block what the user asked for.
    pub(crate) fn severity(self) -> Severity {
        match self {
            Self::Audio | Self::TypeScript => Severity::Warning,
            _ => Severity::Error,
        }
    }

    /// The title for a failure that has no more specific one.
    pub(crate) fn failure_title(self) -> &'static str {
        match self {
            Self::Project => "Couldn’t open project",
            Self::Media => "Media probe failed",
            Self::Audio => "Audio unavailable",
            Self::Preview => "Preview unavailable",
            Self::Schemas => "Couldn’t load component schemas",
            Self::Export => "Export failed",
            Self::TypeScript => "TypeScript setup failed",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Severity {
    Error,
    Warning,
    Done,
}

impl Severity {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Error => "Error",
            Self::Warning => "Warning",
            Self::Done => "Done",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Problem {
    /// What happened: `Export failed`.
    pub(crate) title: String,
    /// The whole message, with its causes.
    pub(crate) detail: String,
}

impl Problem {
    pub(crate) fn new(title: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            detail: detail.into(),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ActiveProblem {
    /// When this problem was first set.
    pub(crate) time: DateTime<Local>,
    pub(crate) problem: Problem,
}

#[derive(Clone, Debug)]
pub(crate) struct LogEntry {
    /// Unique within a `Problems`, increasing; keys the interface's rows.
    pub(crate) id: u64,
    pub(crate) time: DateTime<Local>,
    pub(crate) severity: Severity,
    pub(crate) source: Source,
    pub(crate) problem: Problem,
}

impl LogEntry {
    /// `12:03:41 Error · Export · Export failed`, then the detail, if any.
    pub(crate) fn to_text(&self) -> String {
        let heading = format!(
            "{} {} · {} · {}",
            self.time.format("%H:%M:%S"),
            self.severity.label(),
            self.source.label(),
            self.problem.title
        );
        if self.problem.detail.is_empty() {
            heading
        } else {
            format!("{heading}\n{}", self.problem.detail)
        }
    }
}

#[derive(Default)]
pub(crate) struct Problems {
    active: BTreeMap<Source, ActiveProblem>,
    preview_warnings: Vec<String>,
    history: VecDeque<LogEntry>,
    /// How many of the newest history entries have not been announced.
    unannounced: usize,
    next_id: u64,
}

impl Problems {
    /// Replaces `source`'s active problem. A problem that differs from the
    /// current one is logged; setting the same one again is not.
    pub(crate) fn set(&mut self, source: Source, problem: Option<Problem>) {
        let Some(problem) = problem else {
            self.active.remove(&source);
            return;
        };
        if self
            .active
            .get(&source)
            .is_some_and(|active| active.problem == problem)
        {
            return;
        }
        let time = Local::now();
        self.push(time, source.severity(), source, problem.clone());
        self.active.insert(source, ActiveProblem { time, problem });
    }

    pub(crate) fn report(
        &mut self,
        source: Source,
        title: impl Into<String>,
        detail: impl Into<String>,
    ) {
        self.set(source, Some(Problem::new(title, detail)));
    }

    /// Reports a failure under `source`'s default title.
    pub(crate) fn fail(&mut self, source: Source, detail: impl Into<String>) {
        self.report(source, source.failure_title(), detail);
    }

    pub(crate) fn clear(&mut self, source: Source) {
        self.set(source, None);
    }

    /// Logs a finished operation, such as an export.
    pub(crate) fn info(
        &mut self,
        source: Source,
        title: impl Into<String>,
        detail: impl Into<String>,
    ) {
        self.push(
            Local::now(),
            Severity::Done,
            source,
            Problem::new(title, detail),
        );
    }

    /// Replaces the preview's warnings. They are recomputed on every preview
    /// reload, so they are counted but not logged.
    pub(crate) fn set_preview_warnings(&mut self, warnings: Vec<String>) {
        self.preview_warnings = warnings;
    }

    pub(crate) fn active(&self, source: Source) -> Option<&ActiveProblem> {
        self.active.get(&source)
    }

    pub(crate) fn active_problems(&self) -> impl Iterator<Item = (Source, &ActiveProblem)> {
        self.active.iter().map(|(source, active)| (*source, active))
    }

    pub(crate) fn preview_warnings(&self) -> &[String] {
        &self.preview_warnings
    }

    /// Log entries, oldest first.
    pub(crate) fn history(&self) -> impl DoubleEndedIterator<Item = &LogEntry> {
        self.history.iter()
    }

    /// The whole log as plain text, oldest first, one block per entry.
    pub(crate) fn history_text(&self) -> String {
        self.history
            .iter()
            .map(LogEntry::to_text)
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    pub(crate) fn clear_history(&mut self) {
        self.history.clear();
        self.unannounced = 0;
    }

    /// The entries logged since the last call, oldest first.
    pub(crate) fn take_unannounced(&mut self) -> Vec<LogEntry> {
        let start = self.history.len() - self.unannounced;
        self.unannounced = 0;
        self.history.range(start..).cloned().collect()
    }

    pub(crate) fn error_count(&self) -> usize {
        self.count(Severity::Error)
    }

    pub(crate) fn warning_count(&self) -> usize {
        self.count(Severity::Warning) + self.preview_warnings.len()
    }

    fn count(&self, severity: Severity) -> usize {
        self.active
            .keys()
            .filter(|source| source.severity() == severity)
            .count()
    }

    fn push(&mut self, time: DateTime<Local>, severity: Severity, source: Source, problem: Problem) {
        self.history.push_back(LogEntry {
            id: self.next_id,
            time,
            severity,
            source,
            problem,
        });
        self.next_id += 1;
        self.unannounced += 1;
        while self.history.len() > HISTORY_LIMIT {
            self.history.pop_front();
        }
        self.unannounced = self.unannounced.min(self.history.len());
    }
}

/// `detail` as a Markdown code block that shows it verbatim: the fence is
/// longer than any run of backticks inside it.
pub(crate) fn fenced(detail: &str) -> String {
    let longest = detail
        .split(|character| character != '`')
        .map(str::len)
        .max()
        .unwrap_or(0);
    let fence = "`".repeat(longest.max(2) + 1);
    format!("{fence}text\n{detail}\n{fence}")
}

/// The first line of `detail`, for a toast.
pub(crate) fn first_line(detail: &str) -> &str {
    detail.lines().next().unwrap_or_default()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p celesta-editor problems::tests`
Expected: all tests in `problems::tests` pass. `dead_code` warnings for items not used yet are expected until Task 3.

- [ ] **Step 6: Commit**

```bash
cargo fmt -p celesta-editor
git add crates/editor/Cargo.toml crates/editor/src/problems.rs crates/editor/src/main.rs Cargo.lock
git commit -m "feat(editor): add a problem store with a per-project log"
```

---

### Task 2: Keep error causes in messages

**Files:**
- Modify: `crates/editor/src/problems.rs` (add `error_chain` and tests)
- Modify: `crates/editor/src/preview.rs:189`, `crates/editor/src/export_worker.rs:94`, `crates/editor/src/audio.rs:189`, `crates/editor/src/react_audio.rs:53,61`, `crates/editor/src/component_schema.rs:57`, `crates/editor/src/media_probe.rs:54`

**Interfaces:**
- Produces: `pub(crate) fn error_chain(error: &dyn std::error::Error) -> String` in `problems.rs`.

- [ ] **Step 1: Write the failing tests**

Add to `problems::tests`:

```rust
    #[derive(Debug)]
    struct Outer {
        message: &'static str,
        cause: Option<Inner>,
    }

    #[derive(Debug)]
    struct Inner(&'static str);

    impl std::fmt::Display for Outer {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str(self.message)
        }
    }

    impl std::fmt::Display for Inner {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str(self.0)
        }
    }

    impl std::error::Error for Outer {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            self.cause.as_ref().map(|cause| cause as _)
        }
    }

    impl std::error::Error for Inner {}

    #[test]
    fn error_chain_lists_causes_one_per_line() {
        let error = Outer {
            message: "export failed",
            cause: Some(Inner("disk full")),
        };
        assert_eq!(error_chain(&error), "export failed\ncaused by: disk full");
    }

    #[test]
    fn error_chain_skips_causes_already_in_the_message() {
        let error = Outer {
            message: "could not run node: No such file or directory",
            cause: Some(Inner("No such file or directory")),
        };
        assert_eq!(
            error_chain(&error),
            "could not run node: No such file or directory"
        );
    }

    #[test]
    fn error_chain_without_causes_is_the_message() {
        let error = Outer {
            message: "bad json",
            cause: None,
        };
        assert_eq!(error_chain(&error), "bad json");
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p celesta-editor problems::tests::error_chain`
Expected: compile error, `cannot find function error_chain`.

- [ ] **Step 3: Implement `error_chain`**

Add to `problems.rs`, after `first_line`, and add `use std::error::Error;` and `use std::fmt::Write as _;` to its imports:

```rust
/// `error` and the errors that caused it, outermost first, one per line.
/// A cause whose text the message already contains is left out.
pub(crate) fn error_chain(error: &dyn Error) -> String {
    let mut text = error.to_string();
    let mut cause = error.source();
    while let Some(error) = cause {
        let message = error.to_string();
        if !text.contains(&message) {
            write!(text, "\ncaused by: {message}").expect("writing to a String cannot fail");
        }
        cause = error.source();
    }
    text
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p celesta-editor problems::tests`
Expected: all pass.

- [ ] **Step 5: Use it where workers stringify errors**

At each of these lines, replace `.map_err(|error| error.to_string())` with `.map_err(|error| error_chain(&error))`, and add `use crate::problems::error_chain;` to the file:

- `crates/editor/src/preview.rs:189` (`renderer.render_preview(&scene)`)
- `crates/editor/src/export_worker.rs:94` (`result.map_err(...)` in `ExportEvent::Finished`)
- `crates/editor/src/audio.rs:189`
- `crates/editor/src/react_audio.rs:53` and `:61`
- `crates/editor/src/component_schema.rs:57`
- `crates/editor/src/media_probe.rs:54`

If the error at a site is a `Box<dyn Error>` (or `Box<dyn Error + Send + Sync>`), write `error_chain(error.as_ref())`. If its type does not implement `std::error::Error` (the compiler says `the trait bound ...: std::error::Error is not satisfied`), leave that site as `error.to_string()`.

- [ ] **Step 6: Build and test**

Run: `cargo build -p celesta-editor && cargo test -p celesta-editor`
Expected: builds; all tests pass.

- [ ] **Step 7: Commit**

```bash
cargo fmt -p celesta-editor
git add crates/editor/src
git commit -m "feat(editor): keep error causes in worker messages"
```

---

### Task 3: Move editor error state into `Problems`

Behavior stays as it is in this task except for where the text comes
from: the title bar renders active problems from the store (it is removed
in Task 5), the viewer and inspector read their problems from the store,
and success messages (`Exported …`, `TypeScript set up in …`) are logged
instead of shown. Toasts bring them back in Task 6.

**Files:**
- Modify: `crates/editor/src/view.rs` (fields at 37, 109, 116-128; initializers at 221, 265, 272-284)
- Modify: `crates/editor/src/background.rs`, `crates/editor/src/audio_control.rs`, `crates/editor/src/playback.rs:82,135`, `crates/editor/src/export_control.rs`, `crates/editor/src/lifecycle.rs`, `crates/editor/src/refresh.rs`
- Modify: `crates/editor/src/panels.rs:22-96,296-305`, `crates/editor/src/viewer.rs:79-107`

**Interfaces:**
- Consumes: Task 1's `Problems`, `Source`, `Problem`; Task 2's `error_chain`.
- Produces: `EditorView::problems: Problems` (`pub(crate)`). These fields no longer exist: `open_error`, `component_schema_error`, `preview_error`, `preview_warnings`, `media_error`, `audio_error`, `export_error`, `export_message`, `typescript_error`, `typescript_message`.

- [ ] **Step 1: Swap the fields**

In `crates/editor/src/view.rs`, delete the ten field declarations listed above and their initializers in `from_document`. Add, after `opening: bool,`:

```rust
    /// Every error and warning, and the log since this project opened.
    pub(crate) problems: Problems,
```

and in the initializer, after `opening: false,`:

```rust
            problems: Problems::default(),
```

Add `use crate::problems::Problems;`. A successful open builds a new `EditorView` and `replace_contents` swaps it in, so the log resets there without extra code. A failed open never reaches `replace_contents`, so the old log stays.

- [ ] **Step 2: Build to list every call site**

Run: `cargo build -p celesta-editor 2>&1 | grep -E "^error|-->"`
Expected: `no field ... on type EditorView` errors at the sites below.

- [ ] **Step 3: Rewrite the call sites**

Add `use crate::problems::{Source, error_chain};` (only what each file uses) to each file. Apply exactly these replacements. `error` is the binding already at the site. Throughout this step: where `error_chain(&error)` or `error_chain(error.as_ref())` does not compile because the error type does not implement `std::error::Error`, use `error.to_string()` instead.

`crates/editor/src/background.rs`:

| Line | Was | Becomes |
|---|---|---|
| 28 | `self.preview_error = None;` | `self.problems.clear(Source::Preview);` |
| 31 | `self.preview_error = Some(error.into());` | `self.problems.fail(Source::Preview, error);` |
| 34 | `self.preview_warnings = result.warnings.into_iter().map(Into::into).collect();` | `self.problems.set_preview_warnings(result.warnings);` |
| 40 | `self.preview_error = Some("preview worker stopped unexpectedly".into());` | `self.problems.fail(Source::Preview, "preview worker stopped unexpectedly");` |
| 60 | `self.media_error = Some("media probe worker stopped unexpectedly".into());` | `self.problems.fail(Source::Media, "media probe worker stopped unexpectedly");` |
| 78 | `self.component_schema_error = None;` | `self.problems.clear(Source::Schemas);` |
| 83 | `self.component_schema_error = Some(error.into());` | `self.problems.fail(Source::Schemas, error);` |
| 91-92 | `self.component_schema_error = Some("component schema worker stopped unexpectedly".into());` | `self.problems.fail(Source::Schemas, "component schema worker stopped unexpectedly");` |
| 111, 164 | `self.audio_error = None;` | `self.problems.clear(Source::Audio);` |
| 121, 129, 172 | `self.audio_error = Some(error.into());` | `self.problems.fail(Source::Audio, error);` |
| 137 | `self.audio_error = Some("react audio worker stopped unexpectedly".into());` | `self.problems.fail(Source::Audio, "react audio worker stopped unexpectedly");` |
| 161 | `self.audio_error = Some(error.to_string().into());` | `self.problems.fail(Source::Audio, error_chain(error.as_ref()));` |
| 183 | `self.audio_error = Some("audio mix worker stopped unexpectedly".into());` | `self.problems.fail(Source::Audio, "audio mix worker stopped unexpectedly");` |

In the export `Finished` arm (lines 211-227), replace the three result arms with:

```rust
                    match result {
                        Ok(()) => {
                            self.problems.clear(Source::Export);
                            self.problems.info(
                                Source::Export,
                                "Export finished",
                                output.display().to_string(),
                            );
                            self.export_path = Some(output);
                        }
                        Err(_) if cancelled => {
                            self.export_path = None;
                            self.problems.clear(Source::Export);
                            self.problems.info(Source::Export, "Export cancelled", "");
                        }
                        Err(error) => {
                            self.export_path = None;
                            self.problems.fail(Source::Export, error);
                        }
                    }
```

In the export `Disconnected` arm (lines 230-238), delete `self.export_message = None;` and replace the `export_error` line with `self.problems.fail(Source::Export, "export worker stopped unexpectedly");`.

`crates/editor/src/audio_control.rs`:

| Line | Becomes |
|---|---|
| 25, 45, 49 | `self.problems.clear(Source::Audio);` |
| 36, 57 | `self.problems.fail(Source::Audio, error);` |
| 63 | `self.problems.fail(Source::Audio, error_chain(&error));` |
| 74, 85 | `Err(error) => self.problems.report(Source::Audio, "Couldn’t change the track", error_chain(&error)),` |

`crates/editor/src/playback.rs` lines 82 and 135: `self.problems.fail(Source::Audio, error_chain(error.as_ref()));`

`crates/editor/src/export_control.rs`:

| Line | Becomes |
|---|---|
| 35-36 | `self.problems.clear(Source::Export);` (one line replaces both) |
| 49-50 | `this.problems.report(Source::Export, "Couldn’t show the Export dialog", error_chain(error.as_ref()));` |
| 59-60 | `this.problems.report(Source::Export, "Export dialog was interrupted", error.to_string());` |
| 120-121 | `self.problems.clear(Source::Export);` (one line replaces both) |
| 126 | `self.problems.fail(Source::Export, error);` |
| 138, 150 | `self.problems.clear(Source::Export);` |

For lines 49 and 59, if the compiler rejects `error.as_ref()` or `error_chain`, use `error.to_string()`; the title already carries the context the old prefix gave.

`crates/editor/src/lifecycle.rs`:

| Line | Becomes |
|---|---|
| 57-63 | `self.problems.report(Source::Project, "Couldn’t create project", format!("No templates found in {}.", dir.display()));` |
| 68 | `self.problems.report(Source::Project, "Couldn’t create project", error_chain(&error));` |
| 195-196 | `this.problems.report(Source::Project, "Couldn’t show the folder dialog", error_chain(error.as_ref()));` |
| 210, 475 | `self.problems.clear(Source::Project);` (`this.` at 210) |
| 239-240 | `this.problems.report(Source::Project, "Couldn’t create project", error_chain(error.as_ref()));` |
| 285-286 | `this.problems.report(Source::Project, "Couldn’t show the Open dialog", error_chain(error.as_ref()));` |
| 332-333, 354-355 | `self.problems.clear(Source::TypeScript);` (one line replaces each pair) |
| 335-337 | `self.problems.report(Source::TypeScript, "TypeScript setup needs a React entry", "Open a React entry, or use Set Up TypeScript in Folder… for a new project.");` |
| 369-370 | `this.problems.report(Source::TypeScript, "Couldn’t show the folder dialog", error_chain(error.as_ref()));` |
| 494 | `this.problems.fail(Source::Project, error);` |

Lines 406-422 in `run_typescript_setup` become:

```rust
                match result {
                    Ok(setup) if setup.tsconfig == ProjectTsconfig::MissingExtends => {
                        this.problems.report(
                            Source::TypeScript,
                            "Add “extends” to tsconfig.json",
                            "Types are installed. Add \"extends\": \"./.celesta/tsconfig.json\" to tsconfig.json to enable them.",
                        );
                    }
                    Ok(setup) => {
                        let name = setup.root.file_name().unwrap_or(setup.root.as_os_str());
                        this.problems.clear(Source::TypeScript);
                        this.problems.info(
                            Source::TypeScript,
                            format!("TypeScript set up in {}", name.to_string_lossy()),
                            setup.root.display().to_string(),
                        );
                    }
                    Err(error) => {
                        this.problems.fail(Source::TypeScript, error_chain(&error));
                    }
                }
```

Wherever a dialog error at lines 195, 239, 285, or 369 does not accept `as_ref()` or `error_chain`, use `error.to_string()`.

Update the doc comments that mention the title bar: `run_typescript_setup` ("reports the outcome in the title bar") becomes "reports the outcome in Problems"; `load_path` ("the error shows in the title bar") becomes "the error goes to Problems".

`crates/editor/src/refresh.rs`:

| Line | Becomes |
|---|---|
| 189-190 | `self.problems.clear(Source::Preview);` and `self.problems.set_preview_warnings(Vec::new());` |
| 205 | `self.problems.fail(Source::Preview, error);` |
| 210 | `self.problems.fail(Source::Preview, error_chain(&error));` |
| 321 | `self.problems.clear(Source::Preview);` |
| 326 | `self.problems.report(Source::Preview, "React reload failed", error.message.clone());` |
| 405 | `self.problems.fail(Source::Media, error);` |
| 419, 425 | `self.problems.clear(Source::Schemas);` |
| 437 | `self.problems.fail(Source::Schemas, error);` |

- [ ] **Step 4: Point the readers at the store**

`crates/editor/src/viewer.rs:79-107`: replace the two `.when...` blocks with:

```rust
            .when_some(self.problems.active(Source::Preview).cloned(), |area, active| {
                area.child(
                    div()
                        .p_4()
                        .text_sm()
                        .text_color(cx.theme().danger)
                        .child(format!("{}: {}", active.problem.title, active.problem.detail)),
                )
            })
            .when(!self.problems.preview_warnings().is_empty(), |area| {
                area.child(
                    div()
                        .absolute()
                        .bottom(px(8.0))
                        .left(px(8.0))
                        .right(px(8.0))
                        .flex()
                        .flex_col()
                        .gap_1()
                        .rounded(cx.theme().radius)
                        .border_1()
                        .border_color(cx.theme().warning.opacity(0.5))
                        .bg(cx.theme().warning.opacity(0.12))
                        .p_2()
                        .text_xs()
                        .text_color(cx.theme().warning)
                        .children(self.problems.preview_warnings().iter().cloned()),
                )
            });
```

(Task 7 replaces the error block with the full panel.) Add `use crate::problems::Source;`.

`crates/editor/src/panels.rs:296-305`: replace the schema block with:

```rust
            .when_some(self.problems.active(Source::Schemas).cloned(), |panel, active| {
                panel.child(
                    div()
                        .px_3()
                        .py_2()
                        .text_xs()
                        .text_color(cx.theme().danger)
                        .child(format!("{}: {}", active.problem.title, active.problem.detail)),
                )
            })
```

`crates/editor/src/panels.rs:76-96` (title bar): replace the seven `.when_some(...)` message calls with one that renders the active problems, so behavior holds until Task 5:

```rust
                .children(self.problems.active_problems().map(|(source, active)| {
                    let color = match source.severity() {
                        Severity::Warning => warning,
                        _ => danger,
                    };
                    message(
                        format!("{}: {}", active.problem.title, active.problem.detail),
                        color,
                    )
                }))
```

Remove the now-unused `success` binding at line 26. Add `use crate::problems::{Severity, Source};`.

- [ ] **Step 5: Build and test**

Run: `cargo build -p celesta-editor && cargo test -p celesta-editor`
Expected: builds without errors or `unused` warnings for the removed fields; all tests pass. Then `grep -rn "_error\b\|_message\b" crates/editor/src --include='*.rs' | grep -E "open_error|media_error|audio_error|preview_error|export_error|typescript_error|component_schema_error|export_message|typescript_message"` prints nothing.

- [ ] **Step 6: Smoke-run**

Run the editor on the Task 0 scratch project (`cargo run -p celesta-editor -- <scratch>/film.tsx`). The preview error still appears in the viewer and in the title bar, prefixed by its title.

- [ ] **Step 7: Commit**

```bash
cargo fmt -p celesta-editor
git add crates/editor/src
git commit -m "refactor(editor): keep errors and status in the problem store"
```

---

### Task 4: Right dock tabs and the Problems tab

**Files:**
- Create: `crates/editor/src/problems_panel.rs`
- Modify: `crates/editor/src/view.rs` (new fields and `RightTab`)
- Modify: `crates/editor/src/lifecycle.rs` (`replace_contents` keeps `right_tab`)
- Modify: `crates/editor/src/render.rs:121-141` (right dock)
- Modify: `crates/editor/src/panels.rs:392,598` (drop the headers the tab bar replaces)
- Modify: `crates/editor/src/main.rs` (module list)

**Interfaces:**
- Consumes: `Problems::{active_problems, preview_warnings, history, history_text, clear_history, error_count, warning_count}`, `LogEntry`, `ActiveProblem`, `Severity`, `fenced`.
- Produces:
  - `pub(crate) enum RightTab { Details, Problems }` in `view.rs` (`Default` = `Details`, derives `Clone, Copy, PartialEq, Eq, Debug`).
  - `EditorView::right_tab: RightTab`, `EditorView::expanded_log_entries: HashSet<u64>`.
  - `EditorView::right_dock(&self, cx: &mut Context<Self>) -> impl IntoElement` and `EditorView::show_problems(&mut self, cx: &mut Context<Self>)` in `problems_panel.rs`.

- [ ] **Step 1: Add the state**

In `view.rs`, add above `pub(crate) struct EditorView`:

```rust
/// Which tab the right dock shows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum RightTab {
    /// The inspector, or the React Preview panel in React-preview mode.
    #[default]
    Details,
    Problems,
}
```

Add fields after `problems`:

```rust
    pub(crate) right_tab: RightTab,
    /// History rows the user expanded, by `LogEntry::id`.
    pub(crate) expanded_log_entries: HashSet<u64>,
```

initialized with `right_tab: RightTab::Details,` and `expanded_log_entries: HashSet::new(),`. Change `use std::collections::{BTreeMap, HashMap};` to include `HashSet`.

In `lifecycle.rs` `replace_contents`, after `next.show_safe_areas = self.show_safe_areas;`, add:

```rust
        next.right_tab = self.right_tab;
```

- [ ] **Step 2: Write the panel**

Create `crates/editor/src/problems_panel.rs`:

```rust
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
                panel.child(div().px_3().pb_3().text_xs().text_color(muted).child("No problems"))
            })
            .children(active.into_iter().map(|(source, active)| {
                let id: SharedString = format!("active-{}", source.label()).into();
                problem_block(
                    id,
                    severity_icon(source.severity(), cx),
                    format!("{} · {} · {}", active.problem.title, source.label(), active.time.format("%H:%M:%S")),
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
                panel.child(div().px_3().pb_3().text_xs().text_color(muted).child("Nothing logged yet"))
            })
            .children(history.into_iter().map(|entry| self.history_row(entry, cx)))
    }

    fn history_row(&self, entry: LogEntry, cx: &mut Context<Self>) -> impl IntoElement {
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
                    .child(div().text_color(muted).child(entry.time.format("%H:%M:%S").to_string()))
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
                    .child(Icon::new(if expanded {
                        IconName::ChevronDown
                    } else {
                        IconName::ChevronRight
                    })
                    .xsmall()
                    .text_color(muted)),
            )
            .when(expanded && !entry.problem.detail.is_empty(), |row| {
                row.child(detail_block(format!("log-detail-{id}").into(), &entry.problem.detail, cx))
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
) -> impl IntoElement {
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

/// `detail`, verbatim, monospaced, wrapped, selectable, with a copy button.
pub(crate) fn detail_block(id: SharedString, detail: &str, cx: &App) -> impl IntoElement {
    div()
        .relative()
        .rounded(cx.theme().radius)
        .border_1()
        .border_color(cx.theme().border)
        .bg(cx.theme().background)
        .p_2()
        .pr_8()
        .text_xs()
        .child(TextView::markdown(id.clone(), fenced(detail)).selectable(true))
        .child(
            div()
                .absolute()
                .top_1()
                .right_1()
                .child(Clipboard::new(SharedString::from(format!("{id}-copy"))).value(detail.to_owned())),
        )
}
```

Theme tokens and builder names above are taken from gpui-kit 0.6; if one does not exist (for example `list_hover` or `Icon::xsmall`), use the nearest token or size the compiler suggests and keep the intent: a hover background for the row, an extra-small icon.

Add `mod problems_panel;` after `mod problems;` in `main.rs`.

- [ ] **Step 3: Use it in the workspace**

In `render.rs:121-141`, replace the right `resizable_panel()`'s inner `.child(if react { ... } else { ... })` with `.child(self.right_dock(cx))`. Keep the wrapper div with `border_l_1()`.

In `panels.rs`, delete `.child(panel_header("Inspector", 0, cx))` (line 392) and `.child(panel_header("React Preview", 0, cx))` (line 598): the tab bar names the panel now. Keep `panel_header` itself; the asset panel still uses it.

- [ ] **Step 4: Build and run**

Run: `cargo build -p celesta-editor && cargo test -p celesta-editor`
Expected: builds; tests pass.

Run the editor on the scratch project from Task 0. Check:
- The right dock shows `React Preview | Problems 1`; with a `.celesta.json` it shows `Inspector | Problems`.
- Problems shows the preview error under Active with its full text wrapped; dragging across it selects text; ⌘C pastes it intact elsewhere; the copy button copies the whole detail.
- History shows the entry; clicking expands and collapses it.
- `Copy all` copies text starting with a `HH:MM:SS Error · Preview · …` line; `Clear` empties History and hides both buttons.
- Opening another project via File > Open… empties History.

- [ ] **Step 5: Commit**

```bash
cargo fmt -p celesta-editor
git add crates/editor/src
git commit -m "feat(editor): list problems and their history in a right dock tab"
```

---

### Task 5: Status bar indicator, `ShowProblems`, and a quiet title bar

**Files:**
- Modify: `crates/editor/src/actions.rs` (new action)
- Modify: `crates/editor/src/main.rs:113-139,226-232` (binding, View menu)
- Modify: `crates/editor/src/render.rs:42-88,188-220` (action handler, indicator)
- Modify: `crates/editor/src/problems_panel.rs` (indicator, action handler)
- Modify: `crates/editor/src/panels.rs:18-96` (title bar)

**Interfaces:**
- Consumes: `EditorView::show_problems`, `Problems::{error_count, warning_count}`.
- Produces: action `ShowProblems`; `EditorView::show_problems_action`; `EditorView::problems_indicator(&self, cx: &mut Context<Self>) -> impl IntoElement`.

- [ ] **Step 1: Add the action**

In `actions.rs`, add `ShowProblems,` after `ToggleSafeAreas,`.

In `main.rs`, add to the key bindings after the `ToggleSafeAreas` binding:

```rust
            KeyBinding::new("secondary-shift-m", ShowProblems, Some("CelestaEditor")),
```

and in the View menu, after `MenuItem::action("Safe Areas", ToggleSafeAreas),`:

```rust
            MenuItem::action("Problems", ShowProblems),
```

Add `ShowProblems` to the `use actions::{...}` list in `main.rs`.

- [ ] **Step 2: Add the handler and indicator**

Append to the `impl EditorView` in `problems_panel.rs`:

```rust
    pub(crate) fn show_problems_action(
        &mut self,
        _: &ShowProblems,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.show_problems(cx);
    }

    /// `⊗ 1  ⚠ 2` at the end of the status bar; opens the Problems tab. It
    /// stays at zero so the tab always has the same entry point.
    pub(crate) fn problems_indicator(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let errors = self.problems.error_count();
        let warnings = self.problems.warning_count();
        let muted = cx.theme().muted_foreground;
        let count = |icon: IconName, color: Hsla, value: usize| {
            div()
                .flex()
                .items_center()
                .gap_1()
                .child(
                    Icon::new(icon)
                        .xsmall()
                        .text_color(if value > 0 { color } else { muted }),
                )
                .child(value.to_string())
        };
        Button::new("problems-indicator")
            .ghost()
            .xsmall()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .text_xs()
                    .child(count(IconName::CircleX, cx.theme().danger, errors))
                    .child(count(IconName::TriangleAlert, cx.theme().warning, warnings)),
            )
            .on_click(cx.listener(|this, _, _, cx| this.show_problems(cx)))
    }
```

Add `use crate::actions::ShowProblems;` and `Window` to the `gpui_kit` import.

In `render.rs` `editor_shell`, add `.on_action(cx.listener(Self::show_problems_action))` after the `toggle_safe_areas_action` line.

In `render.rs` `status_bar`, add as the last builder call:

```rust
            .right(self.problems_indicator(cx))
```

- [ ] **Step 3: Quiet the title bar**

In `panels.rs` `title_bar`, delete the `danger`, `warning`, `success` bindings, the `message` closure, and the `.children(self.problems.active_problems()...)` call added in Task 3. Update the doc comment to: "The window's title bar: the menu bar (outside macOS, which shows it natively), the open file, and the window-wide commands — Create New Project…, Open…, and Export…." Remove imports that become unused (`Severity`, and `px` if nothing else uses it).

- [ ] **Step 4: Build and run**

Run: `cargo build -p celesta-editor && cargo test -p celesta-editor`
Expected: builds without unused warnings; tests pass.

Run the editor on the scratch project. Check:
- The title bar shows only the project name, `React composition`, and the buttons.
- The status bar ends with `⊗ 1  ⚠ 0`; clicking it selects the Problems tab.
- With the Details tab selected, ⇧⌘M selects Problems, and so does View > Problems.
- With no problems, the indicator reads `⊗ 0  ⚠ 0` in the muted color.

- [ ] **Step 5: Commit**

```bash
cargo fmt -p celesta-editor
git add crates/editor/src
git commit -m "feat(editor): open Problems from the status bar and the View menu"
```

---

### Task 6: Toasts

**Files:**
- Modify: `crates/editor/src/problems_panel.rs` (announcement)
- Modify: `crates/editor/src/render.rs:11-37` (call it each render)

**Interfaces:**
- Consumes: `Problems::take_unannounced`, `first_line`, `EditorView::show_problems`.
- Produces: `EditorView::announce_problems(&mut self, window: &mut Window, cx: &mut Context<Self>)`.

- [ ] **Step 1: Write the announcement**

Append to the `impl EditorView` in `problems_panel.rs`:

```rust
    /// Toasts for the entries logged since the last render: errors stay
    /// until closed and link to Problems; finished operations fade out;
    /// warnings only count in the status bar. `push_notification` needs the
    /// window, which most code that records a problem does not have, so
    /// render announces them.
    pub(crate) fn announce_problems(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let view = cx.entity().downgrade();
        for entry in self.problems.take_unannounced() {
            let key = entry.source.label();
            let note = match entry.severity {
                Severity::Warning => continue,
                Severity::Done => Notification::new()
                    .with_type(NotificationType::Success)
                    .title(entry.problem.title),
                Severity::Error => {
                    let view = view.clone();
                    let note = Notification::new()
                        .with_type(NotificationType::Error)
                        .title(entry.problem.title.clone());
                    let message = first_line(&entry.problem.detail);
                    let note = if message.is_empty() {
                        note
                    } else {
                        note.message(message.to_owned())
                    };
                    note.action(move |_, _, _| {
                        let view = view.clone();
                        Button::new("show-in-problems")
                            .xsmall()
                            .outline()
                            .label("Show in Problems")
                            .on_click(move |_, _, cx| {
                                view.update(cx, |this, cx| this.show_problems(cx)).ok();
                            })
                    })
                }
            };
            window.push_notification(note.id1::<ProblemToast>(key), cx);
        }
    }
```

Add at the bottom of the file:

```rust
/// Keys toasts by source, so a repeated problem replaces its toast.
struct ProblemToast;
```

Add imports: `use crate::problems::first_line;`, `use gpui_kit::component::notification::{Notification, NotificationType};`, and `WindowExt as _` to the `gpui_kit::component::{...}` list.

- [ ] **Step 2: Call it**

In `render.rs` `render`, after `self.sync_property_panel(window, cx);`, add:

```rust
        self.announce_problems(window, cx);
```

- [ ] **Step 3: Build and run**

Run: `cargo build -p celesta-editor && cargo test -p celesta-editor`
Expected: builds; tests pass.

Run the editor on the scratch project. Check:
- At startup, an error toast titled `React reload failed` or `Preview unavailable` shows the first line of the error and a `Show in Problems` button; it stays until closed; the button selects the Problems tab.
- Saving `film.tsx` again with the same error does not add a toast.
- Fix `film.tsx`, then Export… to a writable folder: when it finishes, a success toast `Export finished` appears and fades out.
- Export to the read-only folder: an `Export failed` toast replaces nothing else and stays.

- [ ] **Step 4: Commit**

```bash
cargo fmt -p celesta-editor
git add crates/editor/src
git commit -m "feat(editor): toast new errors and finished operations"
```

---

### Task 7: The preview error panel

**Files:**
- Modify: `crates/editor/src/viewer.rs:79-87`

**Interfaces:**
- Consumes: `Problems::active(Source::Preview)`, `detail_block` from `problems_panel.rs`, `EditorView::show_problems`.

- [ ] **Step 1: Replace the preview error block**

In `viewer.rs`, replace the `.when_some(self.problems.active(Source::Preview)...)` block from Task 3 with:

```rust
            .when_some(self.problems.active(Source::Preview).cloned(), |area, active| {
                area.child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .p_6()
                        .child(
                            div()
                                .id("preview-error")
                                .flex()
                                .flex_col()
                                .gap_2()
                                .w_full()
                                .max_w(px(560.0))
                                .max_h_full()
                                .overflow_y_scroll()
                                .rounded(cx.theme().radius)
                                .border_1()
                                .border_color(cx.theme().danger.opacity(0.5))
                                .bg(cx.theme().popover)
                                .p_3()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .text_sm()
                                        .text_color(cx.theme().danger)
                                        .child(Icon::new(IconName::CircleX).small())
                                        .child(active.problem.title.clone()),
                                )
                                .child(detail_block(
                                    "preview-error-detail".into(),
                                    &active.problem.detail,
                                    cx,
                                ))
                                .child(
                                    div().flex().justify_end().child(
                                        Button::new("preview-error-show-problems")
                                            .xsmall()
                                            .outline()
                                            .label("Show in Problems")
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.show_problems(cx)
                                            })),
                                    ),
                                ),
                        ),
                )
            })
```

Add `use crate::problems_panel::detail_block;` and `Icon` to the `gpui_kit::component::{...}` import.

- [ ] **Step 2: Build and run**

Run: `cargo build -p celesta-editor && cargo test -p celesta-editor`
Expected: builds; tests pass.

Run the editor on the scratch project with the throwing `film.tsx`. Check:
- The viewer shows a centered panel with `React reload failed` (or `Preview unavailable`), the whole error wrapped and selectable, a copy button, and `Show in Problems`.
- A long error scrolls inside the panel instead of overflowing the viewer.
- Fixing `film.tsx` removes the panel and the frame renders.
- The preview warnings strip still appears at the bottom when the frame has font fallbacks.

- [ ] **Step 3: Commit**

```bash
cargo fmt -p celesta-editor
git add crates/editor/src
git commit -m "feat(editor): show the preview error in full over the viewer"
```

---

### Task 8: Verification and "after" screenshots

**Files:**
- Modify: whatever the design review in Step 2 finds in `crates/editor/src/problems_panel.rs`, `viewer.rs`, or `render.rs`

- [ ] **Step 1: Full test run**

Run: `cargo test -p celesta-editor && cargo build --workspace --all-targets`
Expected: all pass, no warnings in `celesta-editor`.

- [ ] **Step 2: Design review**

Run the GPUI Kit Design Guides' Design review checklist and Accessibility checklist against the Problems tab, the status bar indicator, the toasts, and the preview panel. Fix what fails.

- [ ] **Step 3: "After" screenshots of the Task 0 scenes**

With the scratch project and the read-only export folder from Task 0, capture:

1. `after-toast.png`: the window right after the failed export: status bar `⊗ 2`, the `Export failed` toast, and the preview error panel.
2. `after-problems.png`: the Problems tab with both errors under Active and History entries, one expanded.
3. `after-copy.png`: part of a detail selected in the Problems tab.

- [ ] **Step 4: Note the React stderr follow-up**

`celesta-react-bridge` spawns Node with `Stdio::inherit()` for stderr (`crates/react-bridge/src/bridge.rs:98`), so `ReactBridgeError::UnexpectedExit` carries no reason. Capturing it needs bridge changes, which the spec puts out of scope. Record it as a follow-up in the PR description and ask the user whether to open an issue for it.

- [ ] **Step 5: Commit fixes from the design review**

If Step 2 changed code:

```bash
cargo fmt -p celesta-editor
git add crates/editor/src
git commit -m "fix(editor): address design review findings in the problems panel"
```
