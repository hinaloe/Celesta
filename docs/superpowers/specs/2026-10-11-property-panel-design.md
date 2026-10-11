# Property panel design (sub-project 2)

## Goal

Sub-project 1 (`2026-10-11-project-templates-design.md`) lets a person
turn a template into their own video by editing `props.json`. They still
have to open that file in a text editor. This design adds a "Properties"
section to the editor's right-hand panel where every property the entry
declares with `defineProjectProperties()` can be changed, saved to the
props file, and seen in the preview right away.

Success: change a value in the panel → the props file is updated → the
preview reloads with it. Editing the props file in another editor keeps
the panel in step. A wrong value never makes the panel disappear.

## Scope

- **In:** standalone React entries opened in the editor (the React Preview
  panel), writing to the props file in use: the `--props-file` the entry
  was opened with, or else `props.json` beside the entry.
- **Out:** the Inspector's "Project properties" for JSON projects with
  `settings.reactEntry` (a different file format and reload path); editing
  list-shaped data files (`slides.json`, `script.json`, `data.json`); undo.

## Panel

A "Properties" section is added to the React Preview panel, below its
existing rows (entry, property sources, Reload). It is shown only when the
entry declares properties.

One row per declared key, in the order `defineProjectProperties()`
declares them, labelled with the field's `label` or else the key.

The bridge holds the schema as `BTreeMap<String, ComponentPropertyField>`
(`types.rs`, `protocol.rs`), which sorts keys alphabetically and loses that
order. The ready message's JSON object is in declaration order, so the
bridge also records the key order (`project_property_order: Vec<String>`
beside the existing map, read with the same ordered-object reader as
`props_edit.rs`). The map stays as it is for existing callers.

| Type | Control | Commits on |
| --- | --- | --- |
| `string` | single-line input | Enter or blur; Escape restores the current value |
| `number` | numeric input; `min`/`max`/`step` are input hints only | Enter or blur; a non-number marks the field invalid and is not saved |
| `boolean` | switch | toggle |
| `color` | swatch with a color picker; `#RRGGBB`/`#RRGGBBAA` may be typed | picker close, or Enter in the text |
| `select` | dropdown of `options` | choice |
| `path` | editable text (relative path or `http(s)` URL), "Choose…" and "None" buttons | file chosen, "None" (writes `""`), or Enter/blur in the text |

Controls come from gpui-kit 0.6 (gpui-component's `input`, `switch`,
`select`, `color_picker`) and follow the gpui-kit Coding and Design
Guides.

Each row also shows:

- a "Reset to default" button when the effective value differs from the
  declared default; it removes the key from the props file;
- for a key set by `--props`, the value with the control disabled and the
  note "Set by --props", since a file edit would have no effect;
- the validation message for that key, when the last load rejected it.

While a write or the reload after it runs, the section heading shows a
small spinner. Problems that belong to no key are shown at the top of the
section.

## Effective values

`effective_values(schema, inputs)` in `crates/react-bridge/src/properties.rs`
returns, per declared key, the value the preview uses and where it came
from:

1. `Props` — the `--props` layer;
2. `File` — the props-file layer (`PropsFile` or `EntryProps`);
3. `Default` — the declared `defaultValue`.

A companion project layer does not apply to standalone entries and is not
considered. The panel displays these values; it never keeps its own copy
of the props file.

## Writing

### Target

The target is `resolve_props_file(entry, props_file)` from sub-project 1.
When it returns `None` (the entry declares properties but has no
`props.json` and no `--props-file`), the first commit creates
`<entry dir>/props.json`.

### Steps

`set_property(file, key, value: Option<Value>)` in the new
`crates/react-bridge/src/props_edit.rs`:

1. Read the file again at commit time, so changes made in another editor
   are kept, and parse it as a JSON object. A missing file is an empty
   object.
2. Set the key, or remove it when `value` is `None`. Keys keep the order
   they have in the file, and a new key is appended. `serde_json`'s
   `preserve_order` feature is not enabled, because it would change map
   ordering across the workspace; the module parses the object into an
   ordered list of entries itself.
3. Serialize with two-space indentation and a trailing newline, write to a
   temporary file in the same folder, and rename it over the target, so a
   reader never sees a half-written file.
4. If the existing file is not valid JSON or not an object, nothing is
   written, and the error names the file and the parse position:
   "Fix props.json before editing: …".

Writes run on the background executor, never on the UI thread.

### `path` values

`import_path(project_root, props_dir, chosen) -> String`, also in
`props_edit.rs`. The project root is the entry's folder.

- A file inside the project root is written as a path relative to the
  props file's folder: `./assets/x.png` for `props.json`,
  `../assets/x.png` for `variants/spring.json`.
- A file outside it is copied into `<project root>/assets/` (created if
  missing):
  - a file of the same name and identical content is reused;
  - otherwise the copy is named `x-2.png`, `x-3.png`, … ;
  - the written value is relative to the props file's folder, as above.
- Separators are always `/`, on every platform.
- A typed `http(s)` URL is written as is.

## Reloading and state

- After a successful write the panel calls the existing
  `request_react_reload`. It samples the watched mtime before reading, so
  the editor's own write does not trigger a second reload; edits from other
  editors still reach the preview through the watcher.
- Commits are serialized: one write at a time. Commits made meanwhile are
  queued, and queued commits to the same key keep only the last value.
- **The last schema is kept.** Today a load whose properties fail
  validation returns no composition metadata, so no schema. The panel keeps
  the last schema it received for the current entry and keeps showing its
  rows after a failed load, so a wrong value can be fixed in the panel.
  Opening another entry with File › Open discards it.
- `ReactBridgeError::InvalidProperties` issues are mapped to rows by key;
  issues with an empty key go to the top of the section.
- A write error (unreadable file, broken JSON, copy failure) is shown on the
  row that committed it and leaves the file unchanged.

## Code layout

| Path | Responsibility |
| --- | --- |
| `crates/react-bridge/src/props_edit.rs` (new) | `set_property`, `import_path`, the ordered JSON object reader; no GPUI |
| `crates/react-bridge/src/properties.rs` | `effective_values` |
| `crates/react-bridge/src/types.rs`, `protocol.rs` | `project_property_order` recorded from the ready message |
| `crates/editor/src/property_panel.rs` (new) | the section: rows and their input state, the commit queue, the kept schema, issue-to-row mapping |
| `crates/editor/src/panels.rs` | the React Preview panel calls the section |

## Testing

Rust unit tests:

- `props_edit::set_property`: keeps key order and appends new keys;
  removes a key; creates a missing file; leaves a broken file unchanged
  with the parse position in the error; leaves no temporary file behind;
  works in a folder whose path has spaces and Japanese characters.
- `props_edit::import_path`: a file inside the root becomes a relative
  path (`./…` from `props.json`, `../…` from `variants/`); a file outside
  is copied; identical content is reused; different content gets `-2`;
  the result uses `/` separators.
- `effective_values`: the three-level precedence; a key set by `--props`
  reports `Props`.
- The ready message's property order survives into `project_property_order`
  (declared `title, subtitle, accent` stays in that order).
- Editor: invalid-property issues map to the right rows; the kept schema
  is used after a failed load; queued commits to one key collapse to the
  last value.

Manual GUI check, recorded in the handoff note:

- For each control type, commit a value → the props file changes → the
  preview shows it.
- Edit the props file in another editor → the panel follows.
- Type an invalid color → the row shows the error and the panel stays →
  fix it in the panel.
- Open with `--props-file variants/spring.json` → that file is written, and
  a chosen image becomes `../assets/…`.
- A key set with `--props` is disabled with its note.

## Documentation

- README and `skills/celesta/references/setup.md`: editing properties in
  the preview's Properties section.
- Each template README: one line pointing at the Properties section.
- `docs/handoff/<date>-property-panel.md`.

## Dependencies

Builds on sub-project 1 (PR #245): `resolve_props_file`, the `EntryProps`
source, and automatic `props.json` loading. This work branches from that
PR's branch and is rebased onto `main` once #245 merges.
