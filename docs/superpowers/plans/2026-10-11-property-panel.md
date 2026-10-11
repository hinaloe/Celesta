# Property Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable "Properties" section to the React Preview panel that writes each committed value to the entry's props file and reloads the preview.

**Architecture:** File operations (`set_property`, `import_path`, an order-preserving JSON object reader) live in a new GPUI-free module `crates/react-bridge/src/props_edit.rs`. The bridge records the schema's declaration order and computes effective values. The editor keeps the last schema per entry, carries structured property issues and freshly read property inputs through reloads, and renders the section from `crates/editor/src/property_panel.rs`, serializing writes through a commit queue and calling the existing `request_react_reload` after each write.

**Tech Stack:** Rust 2024, serde/serde_json (without `preserve_order`), gpui-kit 0.6 (gpui-component inputs, switch, select, color picker).

**Spec:** `docs/superpowers/specs/2026-10-11-property-panel-design.md`

## Global Constraints

- Build Rust with FFmpeg 8: `export PKG_CONFIG_PATH="$(brew --prefix ffmpeg@8)/lib/pkgconfig"` in every shell that runs Cargo.
- Do not enable `serde_json`'s `preserve_order` feature.
- Props files are written with two-space indentation and a trailing newline, through a temporary file in the same folder renamed over the target.
- A props file that is not valid JSON or not an object is never written; the error text is `Fix <file name> before editing: <parse message>`.
- `path` values use `/` separators on every platform; a file outside the project root (the entry's folder) is copied into `<root>/assets/`.
- Write target: `resolve_props_file(entry, property_args.props_file)`, else `<entry dir>/props.json` (created on first commit).
- UI copy (exact): section title `Properties`; buttons `Choose…`, `None`, `Reset to default`; disabled-row note `Set by --props`.
- Commits are serialized; queued commits to the same key keep only the last value.
- Code comments in English.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; they are signed via 1Password — never bypass signing; on a signing error stage the work and report BLOCKED.
- This branch (`claude/celesta-property-panel`) sits on PR #245's branch; rebase onto `main` (not merge) once #245 merges (AGENTS.md).

## Review Focus

1. Another editor writes the props file between the panel's reads — the panel's commit must keep the other writer's keys. Test in Task 1.
2. A key is reset to default and was the file's only key — the file stays as `{}\n`, not deleted. Test in Task 1.
3. The props file is read-only — the commit fails with an error on the row and the file is unchanged. Test in Task 1 (Unix only, `#[cfg(unix)]`).
4. A number typed as `1,5`, `1e3`, `NaN`, or empty — `1e3` is accepted, the others are rejected before any write. Test in Task 5.
5. A color typed as `#fff`, `red`, or `#AABBCC` — only `#RRGGBB`/`#RRGGBBAA` (any case) are accepted before any write. Test in Task 5.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `crates/react-bridge/src/props_edit.rs` (new) | `OrderedObject`, `set_property`, `import_path`, `PropsEditError` |
| `crates/react-bridge/src/protocol.rs`, `types.rs`, `bridge.rs` | record `project_property_order` from the ready message |
| `crates/react-bridge/src/properties.rs` | `ValueSource`, `EffectiveValue`, `effective_values` |
| `crates/react-bridge/src/types.rs` | `ComponentPropertyField::default_json()` |
| `crates/editor/src/preview.rs`, `source.rs`, `refresh.rs` | kept schema + order on `ReactPreview`; reload carries fresh `PropertyInputs` and structured issues even when the spawn fails |
| `crates/editor/src/property_panel.rs` (new) | section rendering, row input state, `CommitQueue`, input parsing helpers, issue mapping |
| `crates/editor/src/panels.rs` | React Preview panel calls the section |

---

### Task 1: `props_edit::set_property`

**Files:**
- Create: `crates/react-bridge/src/props_edit.rs`
- Modify: `crates/react-bridge/src/lib.rs` (exports)

**Interfaces:**
- Produces:

```rust
/// A JSON object's entries in the order they appear in the text.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OrderedObject(pub Vec<(String, serde_json::Value)>);
impl<'de> serde::Deserialize<'de> for OrderedObject; // MapAccess visitor; non-object → error
impl serde::Serialize for OrderedObject;               // serializes as a map, in order

#[derive(Debug)]
pub enum PropsEditError {
    Io { file: PathBuf, source: io::Error },
    Invalid { file: PathBuf, message: String },
}
// Display: Io → "Couldn’t write {file}: {source}"; Invalid → "Fix {file name} before editing: {message}"

/// Sets `key` to `value`, or removes it for `None`. Missing file = `{}`.
pub fn set_property(file: &Path, key: &str, value: Option<&serde_json::Value>) -> Result<(), PropsEditError>;
```

- [ ] **Step 1: Write the failing tests** (in `props_edit.rs`, temp dirs under `std::env::temp_dir()` with a per-test name and process id, removed on drop like `project_types.rs`'s `Scratch`)

```rust
#[test] fn keeps_key_order_and_appends_new_keys()
// file: {"b":1,"a":2} → set c=3 → text == "{\n  \"b\": 1,\n  \"a\": 2,\n  \"c\": 3\n}\n"
#[test] fn replaces_a_value_in_place()            // set a=5 → order b, a kept
#[test] fn removes_a_key_and_keeps_an_empty_object()
// {"a":1} → remove a → text == "{}\n" and the file still exists
#[test] fn creates_a_missing_file()               // in "日本語 project/props.json"
#[test] fn keeps_keys_written_by_another_editor()
// set a=1; then overwrite file externally with {"a":1,"z":9}; set b=2 → keys a, z, b
#[test] fn refuses_to_write_a_broken_file()
// "{\"a\":" → Err(Invalid); to_string() starts with "Fix props.json before editing: "; file text unchanged
#[test] fn refuses_a_non_object()                 // "[1]" → Err(Invalid), unchanged
#[test] fn leaves_no_temporary_file()             // folder has exactly props.json afterwards
#[cfg(unix)] #[test] fn reports_a_read_only_file()
// chmod 0o444 → Err(Io), text unchanged (restore permissions before drop)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p celesta-react-bridge props_edit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `OrderedObject` (Deserialize via a `Visitor` whose `visit_map` pushes entries in order; Serialize via `serialize_map`), then `set_property`: read (NotFound → empty), parse into `OrderedObject` (error → `Invalid` with serde's message), replace in place / append / remove, `serde_json::to_string_pretty` + `"\n"`, write to `<dir>/.<name>.tmp-<pid>` and `fs::rename` over the target (remove the temp file if the rename fails). Export `OrderedObject`, `PropsEditError`, `set_property` from `lib.rs`.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p celesta-react-bridge props_edit`
Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(react-bridge): edit props files in place"`

---

### Task 2: `props_edit::import_path`

**Files:**
- Modify: `crates/react-bridge/src/props_edit.rs`, `crates/react-bridge/src/lib.rs`

**Interfaces:**
- Produces:

```rust
/// The value to store for `chosen` in a props file in `props_dir`. A file
/// under `project_root` is referenced in place; any other file is copied
/// into `<project_root>/assets/` first. Always `/`-separated, starting with
/// `./` or `../`.
pub fn import_path(project_root: &Path, props_dir: &Path, chosen: &Path) -> io::Result<String>;
```

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn a_file_in_the_project_is_relative_to_the_props_file()
// root/assets/a.png, props_dir=root → "./assets/a.png"; props_dir=root/variants → "../assets/a.png"
#[test] fn a_file_in_a_nested_folder_with_spaces_and_japanese()
// root/素材 フォルダ/b.png → "./素材 フォルダ/b.png"
#[test] fn an_outside_file_is_copied_into_assets()
// other/c.png → "./assets/c.png", root/assets/c.png has the same bytes; assets/ created if missing
#[test] fn identical_content_is_reused()
// copy c.png twice → second returns "./assets/c.png", no c-2.png
#[test] fn different_content_gets_a_number()
// root/assets/c.png exists with other bytes → "./assets/c-2.png"; again with third content → "./assets/c-3.png"
```

- [ ] **Step 2: Run to verify they fail** — `cargo test -p celesta-react-bridge import_path` → FAIL.
- [ ] **Step 3: Implement** with `std::path::absolute` on all three inputs, `strip_prefix(project_root)` to decide inside/outside, a relative path computed component-wise from `props_dir` to the target (`..` per remaining component of `props_dir` below their common prefix), joined with `/`, prefixed `./` when it does not start with `..`. Content comparison by reading both files' bytes.
- [ ] **Step 4: Run** `cargo test -p celesta-react-bridge props_edit import_path` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(react-bridge): import chosen files for path properties"`

---

### Task 3: Declaration order and effective values

**Files:**
- Modify: `crates/react-bridge/src/protocol.rs` (ready message), `crates/react-bridge/src/types.rs` (`ReactCompositionMetadata`, `ComponentPropertyField`), `crates/react-bridge/src/bridge.rs:~115-131`, `crates/react-bridge/src/properties.rs`, `crates/react-bridge/src/lib.rs`, existing struct literals of `ReactCompositionMetadata` (tests, editor)
- Test: `crates/react-bridge/src/tests.rs`

**Interfaces:**
- Consumes: `OrderedObject` (Task 1).
- Produces:

```rust
// types.rs
pub struct ReactCompositionMetadata { /* existing fields */ pub project_property_order: Vec<String> }
impl ComponentPropertyField { pub fn default_json(&self) -> serde_json::Value; }

// properties.rs
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueSource { Props, File, Default }
#[derive(Clone, Debug, PartialEq)]
pub struct EffectiveValue { pub value: serde_json::Value, pub source: ValueSource }
/// Per declared key: the `--props` layer, else the props-file layer
/// (`PropsFile` or `EntryProps`), else the declared default.
pub fn effective_values(
    schema: &BTreeMap<String, ComponentPropertyField>,
    inputs: &PropertyInputs,
) -> BTreeMap<String, EffectiveValue>;
```

`project_property_order` is read from the same ready-message bytes: deserialize a small `struct ReadyOrder { #[serde(rename = "propertySchema", default)] schema: Option<OrderedObject> }` and take its keys; empty when the entry declared none.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn ready_message_keeps_the_declared_property_order()
// ready JSON with propertySchema {"title":…,"subtitle":…,"accent":…} → order == ["title","subtitle","accent"]
#[test] fn effective_values_follow_props_then_file_then_default()
// schema title/accent/format; File layer {accent:"#000000"}; Props layer {format:"9:16"}
// → title Default(declared), accent File("#000000"), format Props("9:16")
#[test] fn entry_props_count_as_the_file_layer()   // EntryProps layer → ValueSource::File
#[test] fn default_json_matches_each_field_type()  // string/number/boolean/color/select/path
```

- [ ] **Step 2: Run** `cargo test -p celesta-react-bridge` → FAIL (missing items).
- [ ] **Step 3: Implement**; update every `ReactCompositionMetadata { … }` literal (`rg -n "ReactCompositionMetadata \{" crates`).
- [ ] **Step 4: Run** `cargo test --workspace` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(react-bridge): keep property order and compute effective values"`

---

### Task 4: Editor plumbing — kept schema, fresh inputs, structured issues

**Files:**
- Modify: `crates/editor/src/preview.rs` (`ReactPreview`), `crates/editor/src/source.rs` (initial load), `crates/editor/src/refresh.rs` (`request_react_reload`, `apply_react_reload`)
- Test: `crates/editor/src/refresh.rs` or a `#[cfg(test)]` module beside the new types

**Interfaces:**
- Consumes: `ReactCompositionMetadata::project_property_order` (Task 3), `ReactBridgeError::InvalidProperties(Vec<PropertyIssue>)`.
- Produces:

```rust
// preview.rs
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct KeptSchema {
    pub(crate) fields: BTreeMap<String, ComponentPropertyField>,
    pub(crate) order: Vec<String>,
}
pub(crate) struct ReactPreview {
    /* existing fields */
    /// The last schema a load of this entry returned; kept across failed loads.
    pub(crate) property_schema: Option<KeptSchema>,
    /// Issues from the last load, empty after a successful one.
    pub(crate) property_issues: Vec<PropertyIssue>,
}

// refresh.rs
pub(crate) struct ReactReload {
    pub(crate) watched: Option<SystemTime>,
    /// Inputs read from disk this time, even when the spawn then failed.
    pub(crate) properties: Option<PropertyInputs>,
    pub(crate) result: Result<(PathBuf, ReactCompositionMetadata), PreviewLoadError>,
}
#[derive(Debug, Clone)]
pub(crate) struct PreviewLoadError { pub(crate) message: String, pub(crate) property_issues: Vec<PropertyIssue> }
impl PreviewLoadError { pub(crate) fn from_bridge(error: ReactBridgeError) -> Self; }
```

Rules: a successful load sets `property_schema` from the metadata (`None` when the entry declared none) and clears `property_issues`; a failed load keeps `property_schema`, sets `property_issues` (empty unless `InvalidProperties`), and still stores `properties` when they were read. `preview_error` shows `message` as today.

- [ ] **Step 1: Write the failing tests** for a pure helper `fn apply_property_outcome(preview: &mut ReactPreview, reload: &ReactReload)` (extract it from `apply_react_reload`):

```rust
#[test] fn a_failed_load_keeps_the_schema_and_records_issues()
#[test] fn a_failed_load_still_updates_the_read_inputs()
#[test] fn a_successful_load_replaces_the_schema_and_clears_issues()
#[test] fn an_entry_without_properties_has_no_schema()
```

- [ ] **Step 2: Run** `cargo test -p celesta-editor property_outcome` → FAIL.
- [ ] **Step 3: Implement**; the initial load in `source.rs` sets `property_schema`/`property_issues` the same way (an initial failure has no schema to keep).
- [ ] **Step 4: Run** `cargo test -p celesta-editor && cargo build -p celesta-editor` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(editor): keep the property schema and issues across reloads"`

---

### Task 5: The Properties section

**Files:**
- Create: `crates/editor/src/property_panel.rs`
- Modify: `crates/editor/src/panels.rs` (`react_preview_panel` calls it), `crates/editor/src/view.rs` (panel state on `EditorView`), `crates/editor/src/main.rs` or `lib` module list

**Interfaces:**
- Consumes: `set_property`, `import_path`, `PropsEditError` (Tasks 1–2); `effective_values`, `ValueSource` (Task 3); `ReactPreview::{property_schema, property_issues, properties, property_args, entry}` (Task 4); `resolve_props_file`; `EditorView::request_react_reload`.
- Produces (pure, unit-tested):

```rust
pub(crate) struct CommitQueue { /* VecDeque<(String, Option<Value>)> */ }
impl CommitQueue {
    pub(crate) fn push(&mut self, key: String, value: Option<Value>); // same key: replace in place
    pub(crate) fn pop(&mut self) -> Option<(String, Option<Value>)>;
}
pub(crate) fn parse_number_input(text: &str) -> Result<f64, String>; // trims; finite only; "1e3" ok; "1,5"/""/"NaN" err
pub(crate) fn parse_color_input(text: &str) -> Result<String, String>; // #RRGGBB or #RRGGBBAA, any case, returned as typed
pub(crate) fn issues_by_key(issues: &[PropertyIssue]) -> (BTreeMap<String, Vec<String>>, Vec<String>); // empty key → second
pub(crate) fn props_target(entry: &Path, args: &PropertyArgs) -> PathBuf; // resolve_props_file or <entry dir>/props.json
```

Behaviour (from the spec's Panel section): one row per key in `KeptSchema::order`; control per type (string input, numeric input, switch, color swatch + picker + text, select, path text + `Choose…` + `None`); text, number, color text and path text commit on Enter or blur and Escape restores the shown value, the switch and select commit on change, the color picker on close; `Reset to default` when the effective source is `File` and the value differs from `default_json()` (commits `None`); rows whose source is `Props` are disabled with `Set by --props`; row errors from `issues_by_key` plus the row's last write error; section-level messages for empty-key issues; spinner in the heading while a write or reload runs. Committing pushes to the `CommitQueue`; a single background task drains it: `set_property(props_target, key, value)` on the background executor, then `request_react_reload`. `Choose…` opens `cx.prompt_for_paths` (files only) and commits `import_path(entry_dir, target_dir, chosen)`. Invoke the `gpui-kit` skill before writing GPUI code and follow its Coding Guides.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn queued_commits_to_one_key_keep_the_last_value()
// push(a,1), push(b,2), push(a,3) → pop (a,3), (b,2), None
#[test] fn number_input_accepts_finite_numbers_only()
// "1.5"→1.5, " 2 "→2, "1e3"→1000; "1,5", "", "NaN", "inf" → Err
#[test] fn color_input_accepts_six_or_eight_hex_digits()
// "#AABBCC", "#aabbccdd" ok; "#fff", "red", "AABBCC" Err
#[test] fn issues_are_grouped_by_key()
#[test] fn the_target_is_the_props_file_in_use_or_a_new_props_json()
// --props-file variants/a.json → that path; neither → <entry dir>/props.json
```

- [ ] **Step 2: Run** `cargo test -p celesta-editor property_panel` → FAIL.
- [ ] **Step 3: Implement** helpers, then the section UI.
- [ ] **Step 4: Run** `cargo test -p celesta-editor && cargo build -p celesta-editor && cargo clippy -p celesta-editor --no-deps` → PASS, no new warnings.
- [ ] **Step 5: Commit** — `git commit -m "feat(editor): edit project properties in the preview panel"`

---

### Task 6: Documentation, handoff, manual check list

**Files:**
- Modify: `README.md` ("Create a React project": edit properties in the preview's Properties section), `skills/celesta/references/setup.md`, `templates/{slideshow,ranking,dialogue}/README.md` (one line each)
- Create: `docs/handoff/2026-10-11-property-panel.md` (interface, write rules, kept schema, known limit: an entry whose first load fails has no schema to keep; tests; manual GUI check list from the spec's Testing section, marked pending)

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Full test run** — `pnpm run build:runtime && pnpm --dir templates test && cargo test --workspace` → all pass.
- [ ] **Step 3: Commit** — `git commit -m "docs: document the property panel"`
