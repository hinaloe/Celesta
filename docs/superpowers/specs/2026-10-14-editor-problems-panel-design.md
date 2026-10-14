# Editor problems panel design

## Goal

The editor shows errors as one-line text in the title bar. Each message is
capped at 420 px and ellipsized, cannot be selected or copied, and is gone as
soon as the condition clears. Users cannot read what went wrong, paste it into
a bug report, or see what happened earlier.

Established editors split the job in two: the problem is shown where it
happened (Premiere Pro's and Final Cut Pro's offline-media frames, Remotion
Studio's error overlay), and a persistent, inspectable list collects
everything (Premiere Pro's Events panel behind a status indicator, DaVinci
Resolve's Workspace > Console). Celesta should do the same:

- A **Problems** tab in the right dock lists the active errors and warnings
  in full, plus a timestamped history of errors, warnings, and completed
  operations. Every message can be selected and copied.
- A **status bar indicator** shows the error and warning counts and opens the
  Problems tab.
- **Toasts** announce new errors and completed operations.
- The **preview** shows its own error in full, in place.

## Non-goals

- Writing the log to a file.
- A separate log window.
- Filtering the list by source or severity.
- Listing property validation issues. They stay next to their fields in the
  inspector.
- Changing the React bridge to capture more child-process output (see
  [Error detail](#error-detail)).

## State model

A new module, `crates/editor/src/problems.rs`, owns all error state and the
log. It has no GPUI dependency, so it is unit-tested on its own.

```rust
pub(crate) enum Source { Project, Media, Audio, Preview, Schemas, Export, TypeScript }
pub(crate) enum Severity { Error, Warning, Done }

pub(crate) struct Problem {
    pub title: String,   // what happened: "Export failed"
    pub detail: String,  // the full message, with its cause chain
}

pub(crate) struct LogEntry {
    pub time: chrono::DateTime<chrono::Local>,
    pub severity: Severity,
    pub source: Source,
    pub problem: Problem,
}

pub(crate) struct Problems {
    active: BTreeMap<Source, (chrono::DateTime<chrono::Local>, Problem)>,
    preview_warnings: Vec<String>,
    history: VecDeque<LogEntry>,
    unannounced: usize,
}
```

Timestamps use `chrono`, already in the dependency tree. The editor crate
adds it directly with only the `clock` feature.

- `Source` has a display label (`Project`, `Media`, `Audio`, `Preview`,
  `Schemas`, `Export`, `TypeScript`) and a default severity: `Audio` and
  `TypeScript` are warnings, the rest are errors. This matches the colors
  the title bar uses today.
- `set(source, Option<Problem>)` replaces the active problem for `source`.
  Setting a problem whose title and detail differ from the current one
  appends a history entry. Setting the same problem again does not. Setting
  `None` removes the active problem and leaves the history untouched.
- `info(source, title, detail)` appends a `Done` entry, such as a finished
  export or TypeScript setup. It has no active state.
- `set_preview_warnings(Vec<String>)` replaces the preview warnings.
  They count as warnings but are not logged, because they are recomputed on
  every preview reload.
- `reset()` clears everything. It runs when a project opens successfully.
  A failed open keeps the previous project and therefore keeps its log, and
  the failure is appended to it.
- The history keeps at most 500 entries and drops the oldest first.
- `take_unannounced()` returns the entries appended since the last call, once.
- `error_count()` and `warning_count()` count the active problems and the
  preview warnings by severity.

`EditorView` replaces these fields with one `problems: Problems` field:
`open_error`, `media_error`, `audio_error`, `preview_error`,
`component_schema_error`, `export_error`, `typescript_error`,
`preview_warnings`, `export_message`, and `typescript_message`. Every place
that assigns them calls `set` or `info` instead. `open_error` becomes
`Source::Project`, because it also covers project creation.

## Error detail

Each call site passes a short title and the full detail instead of one
prefixed string.

- **Title** names the condition: `Couldn’t open project`,
  `Couldn’t create project`, `Media probe failed`, `Audio unavailable`,
  `Preview unavailable`, `Couldn’t load component schemas`, `Export failed`,
  `TypeScript setup failed`. Generic titles such as `Error` are not used.
- **Detail** is the whole message. Where a typed error is available, it is
  formatted with its `source()` chain, one `caused by: …` line per cause.
  An `error_chain` helper in the editor crate does this, following the
  helper of the same name in `crates/gpu-renderer/src/shader.rs`.
- Background workers turn errors into strings before sending them. They use
  the same helper at that point, so causes survive the channel.
- Some messages carry very little, such as `node exited` from the React
  bridge. The implementation checks whether `ReactBridgeError` already holds
  the child's stderr and includes it in the detail if it does. If capturing
  it requires bridge changes, that becomes a separate issue.

## Interface

### Right dock tabs

The right dock gets an underline `TabBar` with two tabs. The left tab is
`Inspector`, or `Composition` in React-preview mode, and shows the panel it
shows today. The right tab is `Problems`, with a badge holding the active
error and warning count. `EditorView` stores the selected tab in a new
`right_tab` field.

```
┌ Inspector │ Problems ②  ──────────────┐
│ Active                                 │
│ ⊗ Export failed · 12:03:41        [⧉] │
│ ┌────────────────────────────────────┐ │
│ │ ffmpeg exited with status 1:       │ │
│ │ Unknown encoder 'libx265'          │ │
│ └────────────────────────────────────┘ │
│ ⚠ Audio unavailable · 12:01:07    [⧉] │
│ ┌────────────────────────────────────┐ │
│ │ no default output device           │ │
│ └────────────────────────────────────┘ │
│                                        │
│ History           [Copy all] [Clear]   │
│ ⊗ Export   12:03:41  Export failed   ▸ │
│ ✓ Export   11:58:20  Exported        ▸ │
│ ⚠ Audio    12:01:07  Audio unavail…  ▸ │
└────────────────────────────────────────┘
```

- **Active** lists the current problems, then the preview warnings. Each
  problem shows a severity icon, its title, its source label, the time it
  was set, a `Clipboard` copy button, and the full detail. With nothing
  active, the section shows a muted `No problems`.
- **History** lists log entries newest first, one line each: severity icon,
  source label, time, and title. Clicking a row expands it to show the full
  detail and a copy button, as in Active.
- `Copy all` copies the history as plain text, one entry per block, for bug
  reports. `Clear` empties the history. Both appear only when the history
  has entries.
- Details render as a selectable `TextView` holding a fenced `text` code
  block, so the text is monospaced, wraps, and keeps characters that
  Markdown would otherwise interpret. Copied selections use plain text
  (`SelectionFormat`), not Markdown source. A detail that itself contains a
  backtick fence is fenced with a longer one.

### Status bar

The right end of the status bar gets a ghost, extra-small button showing
`⊗ <errors>  ⚠ <warnings>`. It stays visible at zero, in the muted color,
so the Problems tab always has the same entry point. Clicking it selects the
Problems tab.

### Toasts

During render, the view calls `take_unannounced()` and pushes a toast per
entry through the notification layer it already mounts.
`push_notification` needs a `Window`, and most errors are recorded where
none is available, so toasts are driven from render rather than from `set`.

- **Error** entries: the title is the problem title, the message is the
  first line of the detail, and a `Show in Problems` action selects the
  Problems tab. Because of the action, the toast does not autohide. Toasts
  are keyed with `id1` by source, so a repeated error from the same source
  replaces its toast instead of stacking.
- **Done** entries: the title only, autohiding.
- **Warning** entries: no toast. They are visible in the status bar count.

### Title bar

The title bar drops every status message and keeps only the project name,
the React composition label, and the commands.

### Preview

The preview's error shows as a centered panel over the viewer: the title,
the full detail as selectable text, a copy button, and a
`Show in Problems` button. The preview warnings strip stays as it is.

### Inspector

The component schema error stays in the inspector where it is today, and
also appears in Problems.

### Keyboard

The tab bar has its standard keyboard navigation. A new `ShowProblems`
action, listed in the View menu as `Problems` and bound to
`secondary-shift-m`, selects the Problems tab.

## Testing

Unit tests in `problems.rs`:

- Setting a new problem appends one entry; setting it again does not.
- Changing the title or detail appends another entry.
- Clearing a problem removes it from active and keeps its history entry.
- `info` appends a `Done` entry without active state.
- `reset` empties active state, warnings, and history.
- The history drops the oldest entries beyond 500.
- `take_unannounced` returns each entry once.
- `error_count` and `warning_count` count active problems and preview
  warnings by severity.

A unit test covers `error_chain` formatting. Existing tests that read the
replaced fields switch to `problems`.

The editor crate has no GPUI interface tests, so the interface is verified
by running the editor.

## Verification

Screenshots of the same scenes before and after the change:

1. Open a project that references a missing file, to raise a media error.
2. Export to a location that cannot be written, to raise an export error.
3. Before: the truncated title bar messages.
4. After: the status bar indicator with a toast, the Problems tab with
   active problems and history, the preview error panel, and a selected
   detail being copied.
