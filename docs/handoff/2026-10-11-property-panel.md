# Property panel (2026-10-11)

Sub-project 2 of 2, building on `2026-10-11-project-templates.md`. The React
Preview panel has a **Properties** section where every property an entry
declares with `defineProjectProperties()` can be changed. A change is written
to the props file in use and the preview reloads. The design is
`docs/superpowers/specs/2026-10-11-property-panel-design.md`.

## Interface

Shown only when the entry declares properties, below the panel's entry,
property-source, and Reload rows. One row per key in declaration order,
labelled with the field's `label` or else the key.

| Type | Control | Commits on |
| --- | --- | --- |
| `string` | single-line input | Enter or blur, only if the text was edited; Escape restores |
| `number` | numeric input (`min`/`max`/`step` are hints) | Enter or blur; a non-number marks the row invalid and is not saved |
| `boolean` | switch | toggle |
| `color` | swatch with a picker; `#RRGGBB`/`#RRGGBBAA` may be typed | picker close, or Enter in the text |
| `select` | dropdown of `options` | choice |
| `path` | text (relative path or `http(s)` URL), `Choose…` and `None` | file chosen, `None` (writes `""`), Enter/blur |

Also per row: `Reset to default` (when the effective value differs from the
default; removes the key from the file), a disabled control with the note
`Set by --props` for keys the `--props` layer sets, and the validation or
write error for that key. The heading shows a spinner while a write or the
reload after it runs. Issues with no key appear at the top of the section.

## Write rules (`crates/react-bridge/src/props_edit.rs`)

- Target: `resolve_props_file(entry, props_file)`. With neither a
  `--props-file` nor a `props.json`, the first commit creates
  `<entry dir>/props.json`.
- `set_property(file, key, Option<&Value>)` re-reads the file at commit
  time (so edits from another editor are kept), sets or, for `None`, removes
  the key, and keeps the file's top-level key order; a new key is appended.
  The project does not enable `serde_json`'s `preserve_order` itself (the
  spec forbids adding it). GPUI enables it in workspace builds, but the code
  does not depend on that: `OrderedObject` reads the object as an ordered
  list. Output is 2-space JSON plus a newline,
  written to a temporary file in the same folder and renamed over the target.
- A missing file is an empty object. A file that is not valid JSON, or not an
  object, is not touched: "Fix <file name> before editing: …" with the parse
  position. A read-only file is refused (the error says so). No temporary
  file is left behind on failure.
- `import_path(root, props_dir, chosen)`: a file inside the project root
  (the entry's folder) becomes a path relative to the props file's folder
  (`./assets/x.png` from `props.json`, `../assets/x.png` from
  `variants/spring.json`). A file outside is copied into `<root>/assets/`:
  an identical file of the same name is reused, otherwise the copy is
  `x-2.png`, `x-3.png`, …. Separators are always `/`. A typed `http(s)` URL
  is written as is.
- Writes and copies run on the background executor.

Bridge additions: `ReactCompositionMetadata::project_property_order` (the
ready message's key order, read with the same ordered reader),
`ComponentPropertyField::default_json`, and `effective_values(schema,
inputs)` returning, per key, the value and its `ValueSource` (`Props`,
`File`, `Default`). A companion project layer is not considered.

## Reload and state rules

- `ReactPreview` keeps two sets of inputs: `properties`, from the last
  successful load, which rendering uses; and `disk_properties`, the latest
  read, which the panel shows. After a failed load the preview keeps
  rendering the last accepted values while the panel shows what is on disk.
- `property_schema: Option<KeptSchema>` is the last schema received for the
  entry; a failed load keeps it, so a wrong value can be fixed in the panel.
  `property_issues` maps `InvalidProperties` issues to rows by key. File ›
  Open for another entry discards both.
- Reloads carry sequence numbers (`refresh.rs`). A result older than one
  already applied is dropped, and its watched-mtime sample is not used, so an
  overlapping reload cannot overwrite newer state.
- The panel's own write samples the watched mtime before reading, so it does
  not trigger a second reload; edits from other editors still reach the
  preview through the watcher.
- Commits are serialized (`CommitQueue`): one write at a time, queued commits
  to one key keep only the last value. One reload runs after the queue
  drains.
- A row that was written is held (`hold_until`) so an older reload cannot
  flip it back; it follows the file again once a reload requested after the
  write has been applied.
- A write error is shown on the row that committed it and leaves the file
  unchanged; typed text stays as an edit.

### Keybinding context

The single-key editor shortcuts (`space`, `k`, `i`, `o`, `shift-x`, `shift-i`,
`shift-o`, arrows, …) are bound with the context `CelestaEditor && !Input`
(`EDITOR_KEYS` in `crates/editor/src/main.rs`) instead of `CelestaEditor`, so
typing in a property field does not toggle playback or set the export range.
Shortcuts with a modifier (Command-O, Command-R, …) keep `CelestaEditor`.

## Code layout

| Path | Responsibility |
| --- | --- |
| `crates/react-bridge/src/props_edit.rs` | `OrderedObject`, `set_property`, `import_path`; no GPUI |
| `crates/react-bridge/src/properties.rs` | `effective_values`, `ValueSource` |
| `crates/editor/src/property_panel.rs` | row state, commit queue and flow, kept-schema helpers, issue mapping |
| `crates/editor/src/property_panel_view.rs` | renders the section |
| `crates/editor/src/refresh.rs` | reload sequence numbers, kept schema and issues |
| `crates/editor/src/preview.rs` | `ReactPreview` fields, `KeptSchema` |

## Tests

```sh
export PKG_CONFIG_PATH="$(brew --prefix ffmpeg@8)/lib/pkgconfig"
pnpm run build:runtime
pnpm --dir templates test
cargo test --workspace
```

- `props_edit`: key order, append, replace, remove, create, keys
  from another editor, broken or non-object files, no temp file, read-only
  file, relative / nested / spaces-and-Japanese paths, copy, reuse, `-2`
  numbering, no extension, a folder.
- `react-bridge` `tests.rs`: `effective_values` precedence, ready-message
  property order.
- editor (`property_panel`, `refresh`): issues to rows, the kept
  schema after a failed load, collapsed queued commits, reload ordering and
  row holds.

Last full run (`pnpm run build:runtime && pnpm --dir templates test &&
cargo test --workspace`), all passing on 2026-10-11.

`ready_message_keeps_the_declared_property_order` builds its input as a
literal string. With `serde_json::json!` the keys were sorted whenever
`preserve_order` was not unified in (for example `cargo test -p
celesta-react-bridge` alone), so the test failed there and passed in the
workspace run.

## Known limits

- An entry whose first load fails has no schema to keep, so the panel cannot
  show. Fix the file in an external editor; the next successful load brings
  the panel back.
- Nested objects in a props file may get their keys sorted on write when
  `preserve_order` is not unified in (for example a build of
  `celesta-react-bridge` alone); in the editor binary they keep their order.
  Property values are scalars, so this does not occur with declared
  properties.
- A failed reload whose props file could not be read releases a written
  row's hold, so the old value shows briefly.
- `property_panel.rs` is about 1100 lines with its tests. Splitting
  `RowState` out is a follow-up.
- Not covered: the Inspector's "Project properties" for JSON projects with
  `settings.reactEntry`, list-shaped data files (`slides.json`, `script.json`,
  `data.json`), and undo.

## Manual GUI check (pending)

Nobody has clicked through the GUI yet. Check:

1. For each control type (string, number, boolean, color, select, path),
   commit a value: the props file changes and the preview shows it.
2. Edit the props file in another editor: the panel follows.
3. Type an invalid color: the row shows the error and the section stays;
   fix it in the panel.
4. Open with `--props-file variants/spring.json` (ranking template): that
   file is written, and a chosen image becomes `../assets/…`.
5. A key set with `--props` is disabled with `Set by --props`.
6. `Reset to default` removes the key from the file; `None` writes `""` for a
   path.
7. A file chosen from outside the project is copied into `assets/`; choosing
   the same file again reuses the copy.
8. With no property field focused, Space, the arrow keys, and I/O still
   play, step, and set the export range.
9. Typing Space in a text property inserts a space and does not toggle
   playback.
10. Press Escape in an edited text field: the old value returns.
11. Edit a row, then trigger an older reload (save the entry quickly after the
    edit): the just-edited row does not flip back.
12. Break `props.json` in another editor: the panel stays, and editing a row
    reports `Fix props.json before editing: …` without changing the file.
