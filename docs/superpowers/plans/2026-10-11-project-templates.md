# Project Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `blank`, `slideshow`, `ranking`, and `dialogue` template projects with the runtime, let `--init --template` and the GUI initialize them, and load an entry's `props.json` automatically so a template is customized without touching `film.tsx`.

**Architecture:** Templates live in `templates/<name>/` and are staged into `packages/cli/dist/templates/` by the CLI build, so every runtime (source build or desktop package) carries matching templates. A new Rust module `project_templates.rs` in `celesta-react-bridge` lists and copies them and owns `initialize_project`. A new property source `entryProps` (Rust `PropertySource::EntryProps`, TS `'entryProps'`) carries `<entry dir>/props.json` through the existing validation path.

**Tech Stack:** Rust 2024 (clap, serde, gpui-kit 0.6), TypeScript/React 18 runtime (`@celesta/*`), vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-11-project-templates-design.md`

## Global Constraints

- Build Rust with FFmpeg 8: `export PKG_CONFIG_PATH="$(brew --prefix ffmpeg@8)/lib/pkgconfig"` in every shell that runs Cargo (Homebrew's default `ffmpeg` is 9 and breaks the build).
- Node tests need the runtime built first: `pnpm install && pnpm --dir packages/react run codegen && pnpm run build:runtime`.
- `--init` without `--template` must produce exactly today's project (`blank`, keep-existing semantics).
- `--template` with any existing file the template would create writes nothing and lists every conflict.
- `package.json`, `tsconfig.json`, `.gitignore` are always kept when they exist.
- `props.json` is discovered only in the entry's own folder; explicit `--props-file` replaces it; `--props` wins over both.
- `entryProps` is strict when the entry declares properties, ignored with a warning when it declares none; malformed JSON or a non-object is always an error.
- `format` is `select` with options `['16:9', '9:16']` → 1920×1080 / 1080×1920, 30 fps, in every template except `blank`.
- Template metadata file is `template.json` with keys `title`, `description`, `edit`; it and `source/` are never copied into projects (`source/` is dropped at staging, `template.json` at copy).
- Template text uses Noto Sans JP loaded with `<Font>` from `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700` (as `examples/ranking` does today).
- Code comments in English; sample wording in Japanese.
- When updating this branch from `main`, rebase (AGENTS.md).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A project folder whose path has spaces and non-ASCII (`日本語 project`) — init and asset copy must work. Test in Task 2.
2. `--init --template` into a folder that already has unrelated files (`.git/`, `notes.txt`) — must succeed; only template paths conflict. Test in Task 2.
3. Plain `--init` re-run on a project made from a template — must add nothing but `.celesta/` refresh, and must not touch `props.json`. Test in Task 2.
4. Export run from a different working directory than the project — discovery is relative to the entry, not the cwd. Test in Task 4.
5. A user empties `slides.json` or names an unknown speaker in `script.json` — `prepare()` fails with a message naming the file and the problem, not a crash deep in rendering. Tests in Tasks 8 and 9.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `templates/package.json`, `templates/tsconfig.json` | `@celesta/templates` private workspace package: type check and tests for all templates |
| `templates/test/harness.mjs` | Spawns the CLI on a template entry, answers `probeMedia`/`measureText`, returns `config` or `error` |
| `templates/test/templates.test.mjs` | Evaluates every template in both formats; checks staging output |
| `templates/<name>/` | One template each (`template.json`, `film.tsx`, `props.json`, data, `assets/`, `README.md`, optional `source/`, `variants/`) |
| `packages/cli/scripts/stage-templates.mjs` | Copies `templates/<name>/` (minus `source/`) to `packages/cli/dist/templates/<name>/` |
| `crates/react-bridge/src/project_templates.rs` | List, conflict-check, copy templates; `initialize_project` |
| `crates/react-bridge/src/project_types.rs` | Only `.celesta/` management (loses `initialize_project`) |
| `crates/react-bridge/src/properties.rs` | `EntryProps` source, props-file resolution rule, `load_for_entry` |
| `packages/cli/src/property-inputs.ts`, `packages/cli/src/cli.ts` | `entryProps` validation and handshake acceptance |
| `crates/editor/src/cli.rs`, `crates/editor/src/main.rs` | `--template`, `--list-templates` |
| `crates/editor/src/source.rs`, `refresh.rs`, `panels.rs` | Editor discovery, reload watching, panel label |
| `crates/editor/src/lifecycle.rs` | GUI template chooser before the folder picker |
| `crates/exporter/src/main.rs`, `report.rs`, `progress.rs` | Exporter discovery, `propsFile`/`propsFileAuto`, dashboard line |
| `skills/celesta/scripts/inspect.mjs` | Same discovery rule in JS |

---

### Task 1: Template package, `blank`, and staging

**Files:**
- Create: `templates/package.json`, `templates/tsconfig.json`, `templates/blank/template.json`, `templates/test/harness.mjs`, `templates/test/templates.test.mjs`, `packages/cli/scripts/stage-templates.mjs`
- Move: `crates/react-bridge/templates/film.tsx` → `templates/blank/film.tsx` (`git mv`, content unchanged)
- Modify: `pnpm-workspace.yaml` (add `"templates"`), `packages/cli/package.json` (`build` script), `.github/workflows/ci.yml` (after `pnpm run test:runtime`, add `pnpm --dir templates test`)

**Interfaces:**
- Produces: `packages/cli/dist/templates/<name>/` for every `templates/<name>/` that has a `template.json`; `source/` excluded.
- Produces: `templates/test/harness.mjs` exporting
  `evaluate(entry: string, layers: object[]): Promise<{ config?: { width, height, fps, durationInFrames }, error?: string, invalidProperties?: object[] }>`
  and `entryPropsLayer(dir: string): object` returning `{ source: 'entryProps', file: <dir>/props.json, baseDir: <dir>, values: <parsed props.json> }`.
- Produces: `templates.test.mjs` iterates `readdirSync('templates')` folders with `template.json`; later tasks add per-template cases to the same file.

- [ ] **Step 1: Write `templates/blank/template.json`**

```json
{
  "title": "Blank",
  "description": "A five-second title card to start from scratch.",
  "edit": "Edit film.tsx."
}
```

- [ ] **Step 2: Write the failing staging test in `templates/test/templates.test.mjs`**

```js
test('staging copies every template and leaves out source/', () => {
  const staged = fileURLToPath(new URL('../../packages/cli/dist/templates/', import.meta.url));
  for (const name of templateNames()) {
    assert.ok(existsSync(join(staged, name, 'template.json')), name);
    assert.ok(!existsSync(join(staged, name, 'source')), `${name}/source`);
  }
});

test('blank evaluates without inputs', async () => {
  const result = await evaluate(join(templatesDir, 'blank/film.tsx'), []);
  assert.deepEqual(pick(result.config, ['width', 'height', 'fps', 'durationInFrames']),
    { width: 1920, height: 1080, fps: 30, durationInFrames: 150 });
});
```

`templateNames()` returns folder names under `templates/` holding `template.json`, sorted. `templates/package.json` script `"test": "vitest run"`, dependencies on every `@celesta/*` package the templates import plus `react` (`workspace:*` / `^18.3.1`), devDependencies `vitest`, `typescript`, `@types/react`, `@types/node`; script `"typecheck": "tsc -p tsconfig.json"`. `tsconfig.json`: `strict`, `noEmit`, `jsx: "react-jsx"`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `resolveJsonModule: true`, `include: ["*/film.tsx", "*/**/*.ts"]`, excluding `*/source`.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm install && pnpm --dir templates test`
Expected: FAIL — `dist/templates/blank/template.json` missing.

- [ ] **Step 4: Implement `stage-templates.mjs` and `harness.mjs`**

`stage-templates.mjs`: `rmSync(dist/templates)`, then for each `templates/<name>/` with `template.json`, `cpSync` recursively with a filter that drops the top-level `source` folder. Wire it into `packages/cli/package.json`: `"build": "tsc -b && node scripts/stage-project-types.mjs && node scripts/stage-templates.mjs"`.

`harness.mjs`: spawn `node packages/cli/bin/celesta-react-render.js <entry> --properties-stdin`, write `{ propertyInputs: layers }` as the first line, then read stdout lines: answer `probeMedia` with `{ media: { durationSeconds: 2, audio: [{ durationSeconds: 2 }] } }` when the file exists, else `{ error: 'cannot probe <path>' }`; answer `measureText` with the same fake shape as `packages/react/test/text-metrics.test.mjs`; on `config`, `error`, or `invalidProperties`, end stdin and resolve with it.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm run build:runtime && pnpm --dir templates test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add templates pnpm-workspace.yaml pnpm-lock.yaml packages/cli/package.json packages/cli/scripts/stage-templates.mjs .github/workflows/ci.yml crates/react-bridge/templates
git commit -m "feat(templates): add the template package and stage it with the runtime"
```

---

### Task 2: `project_templates.rs` and `initialize_project`

**Files:**
- Create: `crates/react-bridge/src/project_templates.rs`
- Modify: `crates/react-bridge/src/project_types.rs` (remove `initialize_project`, `write_new`, the `include_str!`; move its test into the new module), `crates/react-bridge/src/lib.rs` (exports), `crates/editor/src/main.rs:71-85` and `crates/editor/src/lifecycle.rs:73-78` (call the new signature; behaviour unchanged for now)

**Interfaces:**
- Consumes: `set_up_project_types_in`, `ProjectTypesSetup`, `ProjectTsconfig`, `project_types_template` from `project_types.rs`.
- Produces:

```rust
pub const DEFAULT_TEMPLATE: &str = "blank";
pub fn project_templates_dir(cli_script: &Path) -> PathBuf; // <dir of cli.js>/templates

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct TemplateInfo {
    #[serde(skip)] pub name: String,
    pub title: String,
    pub description: String,
    pub edit: String,
}

/// `blank` first, the rest by name; folders without a parseable template.json are skipped.
pub fn list_templates(dir: &Path) -> Result<Vec<TemplateInfo>, TemplateError>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectSetup { pub types: ProjectTypesSetup, pub template: TemplateInfo }

/// `template: None` = blank, keeping existing files; `Some(name)` refuses any conflict.
pub fn initialize_project(cli_script: &Path, root: &Path, template: Option<&str>)
    -> Result<ProjectSetup, TemplateError>;

#[derive(Debug)]
pub enum TemplateError {
    Missing { dir: PathBuf, source: io::Error },
    Unknown { name: String, available: Vec<String> },
    Conflicts { root: PathBuf, paths: Vec<PathBuf> }, // relative to root, sorted
    Io(io::Error),
}
```

Display texts (exact):
- `Missing`: `Template files are missing from the Celesta runtime ({dir}): {source}`
- `Unknown`: ``Unknown template `{name}`; available: {a, b, c}``
- `Conflicts`: `{root} already has files from this template: {p1}, {p2}`

- [ ] **Step 1: Write the failing tests** (in `project_templates.rs`, reusing the `Scratch`/`write`/`template` helpers moved from `project_types.rs`; a helper `runtime(root)` writes `cli.js`, `project-types/` and `templates/{blank,slides}` with `template.json` and files)

```rust
#[test] fn lists_blank_first_and_skips_folders_without_metadata()
// templates: blank, slides, broken (template.json = "{"), empty (no template.json)
// assert names == ["blank", "slides"]

#[test] fn initialize_without_template_keeps_todays_behaviour()
// the moved initialize_creates_a_project_and_refreshes_only_generated_files test,
// with film.tsx content coming from templates/blank; existing film.tsx kept on re-run

#[test] fn template_copies_recursively_without_metadata()
// slides has film.tsx, props.json, assets/a.png; root "日本語 project"
// assert all three exist under root, root/template.json does not

#[test] fn template_refuses_every_conflict_and_writes_nothing()
// root has film.tsx and assets/a.png; Err(Conflicts{paths: ["assets/a.png","film.tsx"]});
// root has no props.json and no .celesta afterwards

#[test] fn template_ignores_unrelated_files()
// root has .git/HEAD and notes.txt → Ok

#[test] fn plain_init_after_template_adds_nothing()
// init Some("slides"), edit props.json, init None → props.json unchanged, no new files except .celesta refresh

#[test] fn unknown_template_lists_the_available_ones()
// Err(Unknown{name:"nope", available:["blank","slides"]}), to_string() matches exact text

#[test] fn missing_templates_dir_is_reported_before_anything_is_created()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p celesta-react-bridge project_templates`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`initialize_project` order: read the types stamp and resolve the template (Missing/Unknown) → for `Some`, collect conflicts by walking the template folder (excluding `template.json`) and checking `root.join(rel).exists()` → only then `create_dir_all(root)`, `set_up_project_types_in`, copy (keep-existing per file for `None`, plain create for `Some`), then write `package.json`/`.gitignore` with today's `write_new` contents (tsconfig is already handled by `set_up_project_types_in`). `.gitignore` stays `node_modules/\noutput.mp4\n`.

- [ ] **Step 4: Run to verify they pass, plus the editor build**

Run: `cargo test -p celesta-react-bridge && cargo build -p celesta-editor`
Expected: PASS; editor builds.

- [ ] **Step 5: Commit**

```bash
git add crates/react-bridge crates/editor/src/main.rs crates/editor/src/lifecycle.rs
git commit -m "feat(react-bridge): initialize projects from runtime templates"
```

---

### Task 3: `entryProps` in the Node validator

**Files:**
- Modify: `packages/cli/src/property-inputs.ts`, `packages/cli/src/cli.ts:260-270` (`isPropertyInputLayer` accepts `'entryProps'`)
- Test: `packages/project/test/project-properties.test.mjs`

**Interfaces:**
- Produces: `PropertyInputLayer.source: 'project' | 'propsFile' | 'entryProps' | 'props'`; `describeSource` → `` `props.json ${file}` ``.

- [ ] **Step 1: Write the failing tests**

```js
test('entry props.json is strict when the entry declares properties', () => {
  // layer { source: 'entryProps', file: join(dir,'props.json'), baseDir: dir, values: { titel: 'x', accent: 'red' } }
  // expect invalidProperties with 2 issues, each source === `props.json ${file}`
});

test('entry props.json is ignored with a warning when the entry declares nothing', () => {
  // entry without defineProjectProperties; status 0, a config line, stderr matches /ignoring .*props\.json.*declares no project properties/
});

test('entry props.json values reach prepare() and rendering, and paths resolve from its folder', () => {
  // SCHEMA_ENTRY, values { title: 'Auto', data: './auto.txt' } with auto.txt in dir → textOf contains 'Auto' and auto.txt's line
});

test('entry props.json naming a missing file is reported by key', () => {
  // values { data: './gone.txt' } → invalidProperties [{ key: 'data', ... }]
});
```

`run()` in this file needs to capture `stderr` (`result.stderr`) for the warning assertion.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --dir packages/cli run build && pnpm --dir packages/project exec vitest run test/project-properties.test.mjs`
Expected: FAIL — handshake rejects `entryProps`.

- [ ] **Step 3: Implement**

In `resolvePropertyInputs`: when `!schema && layer.source === 'entryProps'`, `console.warn(\`Celesta: ignoring ${layer.file}: the entry declares no project properties\`)` and continue; otherwise `entryProps` is strict like `propsFile`. Update the doc comments' layer order: project, propsFile or entryProps, props.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm run build:runtime && pnpm run test:runtime`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src packages/project/test/project-properties.test.mjs
git commit -m "feat(cli): accept an entry's props.json as a property source"
```

---

### Task 4: Rust discovery, editor, exporter, inspect.mjs

**Files:**
- Modify: `crates/react-bridge/src/properties.rs`, `crates/react-bridge/src/lib.rs`, `crates/editor/src/source.rs:33-141`, `crates/editor/src/refresh.rs:116`, `crates/editor/src/panels.rs:556-580`, `crates/exporter/src/main.rs:205,357-362`, `crates/exporter/src/report.rs`, `crates/exporter/src/progress.rs` (`Settings`, settings panel ~line 436-465), `skills/celesta/scripts/inspect.mjs:145-172`
- Test: `crates/react-bridge/src/tests.rs`, `crates/exporter/src/report.rs` tests, `crates/editor/src/source.rs` tests

**Interfaces:**
- Consumes: TS `'entryProps'` from Task 3.
- Produces:

```rust
pub enum PropertySource { Project, PropsFile, EntryProps, Props } // serde: "entryProps"
pub const ENTRY_PROPS_FILE: &str = "props.json";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PropsFileChoice { pub path: PathBuf /* absolute */, pub auto: bool }

/// The one rule: explicit `--props-file`, else `<entry dir>/props.json` if it is a file.
pub fn resolve_props_file(entry: &Path, props_file: Option<&Path>) -> Option<PropsFileChoice>;

impl PropertyInputs {
    pub fn load_for_entry(entry: &Path, props_file: Option<&Path>, props: Option<&str>)
        -> Result<Self, PropertyInputError>;
}
```

`load_for_entry` uses `resolve_props_file`; an auto file becomes an `EntryProps` layer with `file: Some(absolute path)` and parse/read error origin `props.json {path}`. `PropertyInputs::load` stays for callers without an entry.

- [ ] **Step 1: Write the failing Rust tests**

```rust
#[test] fn discovers_props_json_beside_the_entry()        // layers()[0].source == EntryProps, base_dir == entry dir
#[test] fn explicit_props_file_replaces_the_entry_props()  // one PropsFile layer only
#[test] fn inline_props_stay_on_top()                      // [EntryProps, Props]
#[test] fn no_props_json_adds_no_layer()
#[test] fn discovery_follows_the_entry_not_the_current_directory()
// entry given as an absolute path in another temp dir; cwd unchanged → EntryProps found
#[test] fn malformed_entry_props_is_an_error()             // "[" → Parse with origin starting "props.json "
```

In `report.rs` tests: `json_report_names_the_props_file` — `build(source, props_file, export)` (the existing tests call `build`; it gains the `props_file` parameter) given `Some(PropsFileChoice { path, auto: true })` → `value["propsFile"] == path`, `value["propsFileAuto"] == true`; given `None` → both keys absent.

In `source.rs` tests: `watched_mtime_notices_props_json_deletion` — entry dir with film.tsx and props.json; sample; delete props.json (sleep enough for mtime granularity); sample again; values differ.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p celesta-react-bridge props && cargo test -p celesta-exporter report && cargo test -p celesta-editor watched_mtime`
Expected: FAIL — symbols missing.

- [ ] **Step 3: Implement**

- Editor: `PropertyArgs::load(&self, entry: &Path)` calls `load_for_entry`; update both callers. `watched_mtime` also takes the entry directory's own mtime (covers creation and deletion). The panel's sources list shows `props.json (auto)` when `resolve_props_file(entry, args.props_file)` is `Some` with `auto`, before `--props`; `No overrides` only when nothing applies.
- Exporter: `react_runtime` calls `load_for_entry(&cli.source, …)`. `report::run(source, props_file: Option<PropsFileChoice>, export)`; `Report` gains `props_file: Option<PathBuf>` and `props_file_auto: Option<bool>` (both skipped when `None`). `main` computes `cli.react.then(|| resolve_props_file(&cli.source, cli.props_file.as_deref())).flatten()` once and passes it to both `report::run` and `progress::Settings { props: Option<String> }`, displayed as ` Props    props.json (auto)` or ` Props    <file name>`.
- `inspect.mjs`: when `options.propsFile === null` and `path.join(path.dirname(entry), 'props.json')` is a file, push `{ source: 'entryProps', file, baseDir: dirname, values }` with the same `object()` parsing.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test --workspace`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates skills/celesta/scripts/inspect.mjs
git commit -m "feat: load the entry's props.json in preview, export, and inspect"
```

---

### Task 5: `--template` and `--list-templates`

**Files:**
- Modify: `crates/editor/src/cli.rs`, `crates/editor/src/main.rs:69-86`

**Interfaces:**
- Consumes: `initialize_project`, `list_templates`, `project_templates_dir`, `TemplateInfo` (Task 2).

```rust
/// Template to initialize from (see --list-templates); refuses to overwrite its files.
#[arg(long, value_name = "NAME", requires = "init")]
pub template: Option<String>,
/// List the templates --init --template accepts, then exit.
#[arg(long, conflicts_with_all = ["path", "init", "props", "props_file"])]
pub list_templates: bool,
```

- [ ] **Step 1: Write the failing parse tests in `cli.rs`**

```rust
#[test] fn parses_templates() {
    assert_eq!(parse(&["--init", "v", "--template", "slideshow"]).unwrap().template.as_deref(), Some("slideshow"));
    assert_eq!(parse(&["--template", "slideshow"]).unwrap_err().kind(), ErrorKind::MissingRequiredArgument);
    assert!(parse(&["--list-templates"]).unwrap().list_templates);
    for args in [&["--list-templates", "film.tsx"][..], &["--list-templates", "--init"]] {
        assert_eq!(parse(args).unwrap_err().kind(), ErrorKind::ArgumentConflict);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p celesta-editor parses_templates`
Expected: FAIL — no field `template`.

- [ ] **Step 3: Implement `main.rs`**

`--list-templates` prints one line per template, `format!("{:<12}{} — {}", name, title, description)`, and returns. `--init` passes `args.template.as_deref()`; after today's messages, print `template.edit` (for `blank`, `Edit film.tsx.`), then the existing "Open film.tsx with Celesta…" line.

- [ ] **Step 4: Verify end to end**

Run: `cargo test -p celesta-editor && cargo run -p celesta-editor -- --list-templates && cargo run -p celesta-editor -- --init "$TMPDIR/tpl test" --template blank && cargo run -p celesta-editor -- --init "$TMPDIR/tpl test" --template blank; echo "exit $?"`
Expected: list shows `blank` first; first init succeeds; second prints the conflict error listing `film.tsx` and exits 1.

- [ ] **Step 5: Commit**

```bash
git add crates/editor/src/cli.rs crates/editor/src/main.rs
git commit -m "feat(editor): choose a template with --init --template"
```

---

### Task 6: GUI template chooser

**Files:**
- Modify: `crates/editor/src/lifecycle.rs` (`request_create_project`)

**Interfaces:**
- Consumes: `list_templates`, `project_templates_dir`, `initialize_project` (Task 2). Load the `gpui-kit` skill first; use `WindowExt::open_dialog` (gpui-component `Root::open_dialog`) and a selectable list.

Behaviour: `request_create_project` lists templates (on error, set `open_error` to `Couldn’t create project: {error}` and stop), opens a dialog titled `Create New Project` showing each template's title and description, `blank` selected initially, Enter/OK confirms, Escape/Cancel closes. On confirm, close the dialog and run today's folder-picker flow with the chosen name; pass `None` to `initialize_project` for `blank` (keep-existing, as today) and `Some(name)` otherwise. Errors keep today's `Couldn’t create project: {error}` text.

- [ ] **Step 1: Implement** the split into `request_create_project` (dialog) → `create_project_in_folder(template: Option<String>, …)` (today's body).

- [ ] **Step 2: Build and run the editor**

Run: `cargo build -p celesta-editor && cargo run -p celesta-editor`
Expected: File › Create New Project… shows the chooser; choosing `slideshow` then a new folder opens its `film.tsx`; choosing `slideshow` again for the same folder shows the conflict error; Escape cancels without a folder dialog. (Templates other than `blank` exist after Tasks 7–9; until then verify with `blank` and a temporary template folder in `packages/cli/dist/templates`.)

- [ ] **Step 3: Commit**

```bash
git add crates/editor/src/lifecycle.rs
git commit -m "feat(editor): pick a template when creating a project"
```

---

### Task 7: `ranking` template

**Files:**
- Move: `examples/ranking/{film.tsx,README.md,variants/}` → `templates/ranking/`; `examples/ranking/data/sample.json` → `templates/ranking/data.json`; delete `examples/ranking/{package.json,tsconfig.json}`
- Create: `templates/ranking/template.json`, `templates/ranking/props.json`
- Modify: `templates/ranking/film.tsx`, every reference to `examples/ranking` (`rg -l 'examples/ranking'`: README.md, skills references, docs/handoff are historical — leave `docs/handoff/` unchanged)
- Test: `templates/test/templates.test.mjs`

`template.json`: title `ランキング`, description `データ JSON からランキングカードを作ります。配色やタイトルも差し替えられます。`, edit `Edit props.json and data.json.`

`props.json` holds every declared key with today's defaults plus `"format": "16:9"` and `"data": "./data.json"`. Add `format` to `defineProjectProperties`; the composition reads it with `useProjectProperty` for width/height (1920×1080 or 1080×1920), and every layout constant is derived from those (rows stack in a taller column in 9:16). Move layout numbers into the constants block at the top.

- [ ] **Step 1: Write the failing tests**

```js
for (const format of ['16:9', '9:16']) test(`ranking evaluates in ${format}`, async () => {
  const dir = join(templatesDir, 'ranking');
  const result = await evaluate(join(dir, 'film.tsx'), [entryPropsLayer(dir), { source: 'props', baseDir: dir, values: { format } }]);
  assert.deepEqual([result.config.width, result.config.height], format === '16:9' ? [1920, 1080] : [1080, 1920]);
  assert.equal(result.config.fps, 30);
});
test('ranking variants validate', async () => { /* each variants/*.json as a propsFile layer → config, no invalidProperties */ });
test('ranking rejects an empty data file', async () => { /* data → temp file "[]" → error matches /must be a non-empty array/ */ });
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --dir templates test` → FAIL (no `templates/ranking`).
- [ ] **Step 3: Move and adapt** the template as above.
- [ ] **Step 4: Run** `pnpm run build:runtime && pnpm --dir templates test && pnpm --dir templates typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(templates): turn the ranking example into a template"`

---

### Task 8: `slideshow` template

**Files:**
- Create: `templates/slideshow/{template.json,film.tsx,props.json,slides.json,README.md}`, `templates/slideshow/assets/{photo-01..05.png,music.wav}`, `templates/slideshow/source/{draw-photos.tsx,make-music.py,generate.sh}`
- Test: `templates/test/templates.test.mjs`

`template.json`: title `写真スライドショー`, description `写真とキャプションを並べ、トランジションでつなぐスライドショー。`, edit `Edit props.json and slides.json, and replace the files in assets/.`

Properties and defaults (spec table): `title` `旅の記録`, `subtitle` `2026 秋`, `format` `16:9`, `accent` `#f2c14e`, `transition` `crossfade` (options `crossfade`/`slide`/`wipe`), `secondsPerSlide` `4`, `slides` `./slides.json`, `music` `./assets/music.wav`.

Constants block: `TITLE_SECONDS = 3`, `TRANSITION_FRAMES = 20`, `ZOOM = 0.08` (scale grows 1 → 1.08 over a slide), `CAPTION_SIZE` 56 (16:9) / 64 (9:16), `MARGIN` 80, `MUSIC_FADE_SECONDS = 1`.

`prepare()` reads `slides`, resolves each `image` against the slides file's folder, and throws `` `${file}: slides must be a non-empty array of { image, caption? }` `` for an empty array or `` `${file}: slide ${i} has no image` ``. Duration = title card + n × `secondsPerSlide` (frames), minus the `<TransitionSeries>` overlaps (let `<TransitionSeries>` compute it; feed its total into `<Composition durationInFrames>` the way the transitions package documents). `music === ''` renders no `<Audio>`.

`source/`: `draw-photos.tsx` renders five 1920×1280 gradient-landscape stills with Celesta's exporter (`--frames`), `make-music.py` synthesizes a ~30 s ambient loop (WAV, 48 kHz) the way `examples/*/make-score.py` do, `generate.sh` runs both into `../assets/`. Commit the generated assets.

- [ ] **Step 1: Failing tests** — `slideshow evaluates in 16:9 / 9:16` (sizes, fps 30, `durationInFrames === 590`: a 90-frame title card plus five 120-frame slides, minus five 20-frame transitions); `slideshow rejects empty slides` (`/slides must be a non-empty array/`); `slideshow without music` (`music: ''` → config).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** film, data, README (what to replace, property table, `--props-file` variant example, asset license: same as the repository).
- [ ] **Step 4: Run** `pnpm run build:runtime && pnpm --dir templates test && pnpm --dir templates typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(templates): add a photo slideshow template"`

---

### Task 9: `dialogue` template

**Files:**
- Create: `templates/dialogue/{template.json,film.tsx,props.json,script.json,README.md}`, `templates/dialogue/assets/` (copies of `examples/assets/dialogue-demo/portraits/*.png` and `voices/*.wav`, under `assets/` and `assets/voices/`)
- Test: `templates/test/templates.test.mjs`

`template.json`: title `キャラクター会話`, description `立ち絵・字幕・音声で二人が会話する解説動画。`, edit `Edit props.json and script.json, and replace the portraits and voices in assets/.`

Properties: `title` `セリフの並べ方`, `format` `16:9`, `script` `./script.json`, `background` `""`, `backgroundColor` `#1f2433`, `music` `""`.

`script.json` follows the spec's shape (`characters` with `name`, `color`, `portraits`, `mouths` = `closed`,`a`,`i`,`u`,`e`,`o`; `lines` with `speaker`, `text`, `reading?`, `expression?`, `voice`), converted from `examples/assets/dialogue-demo/script.json` (keep its lines and `scene`). `prepare()` resolves paths against the script's folder and throws `` `${file}: line ${i}: speaker "${speaker}" is not in characters` `` and `` `${file}: line ${i}: ${speaker} has no "${expression}" portrait` ``, then calls `planDialogue()`. Follow `packages/cli/examples/with-dialogue-series.tsx` for `<DialogueSeries>`, `subtitle.render`, lip sync, and name plates. Layout: 16:9 portraits left/right, subtitle band bottom; 9:16 portraits along the bottom, band above them.

README credits: copy the voice-credit section from `examples/assets/dialogue-demo/README.md` (CC BY 3.0, Nagoya Institute of Technology HTS voices "Mei" and "Takumi"); portraits same license as the repository.

- [ ] **Step 1: Failing tests** — `dialogue evaluates in 16:9 / 9:16` (sizes, fps 30, duration > 0 with the harness's 2 s probe); `dialogue rejects an unknown speaker` (`/speaker "mira" is not in characters/`); `dialogue rejects a missing expression`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm run build:runtime && pnpm --dir templates test && pnpm --dir templates typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(templates): add a character dialogue template"`

---

### Task 10: Documentation, handoff, and manual verification

**Files:**
- Modify: `README.md` ("Create a React project": `--list-templates`, `--template`, the four templates, `props.json`; "Render variants of one composition": `templates/ranking` paths), `skills/celesta/references/setup.md`, `skills/celesta/references/project-data.md` (automatic `props.json`, precedence list from the spec), `skills/celesta/SKILL.md` (task-table row "Start from a ready-made video" → `--init --template`, setup.md)
- Create: `docs/handoff/2026-10-11-project-templates.md` (interface, precedence, staging, test commands, manual results)

- [ ] **Step 1: Manual export check** — for each of `slideshow`, `ranking`, `dialogue` and each format:

```bash
cargo run -p celesta-editor -- --init "$TMPDIR/celesta-tpl/<name>" --template <name>
cargo run -p celesta-exporter --release -- --react --every 30 --contact-sheet --props '{"format":"9:16"}' "$TMPDIR/celesta-tpl/<name>/film.tsx" "$TMPDIR/celesta-tpl/<name>-916.png"
```

Expected: the export's `--json` (run once with `--json`) shows `"propsFileAuto": true`; contact sheets look right (no clipped text, portraits and captions inside the frame). Record findings in the handoff.

- [ ] **Step 2: Manual GUI check** — chooser → folder → preview; edit `props.json` `title` and see the preview reload; delete `props.json` and see defaults return.

- [ ] **Step 3: Full test run**

Run: `pnpm run test:runtime && pnpm --dir templates test && cargo test --workspace`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add README.md skills docs/handoff/2026-10-11-project-templates.md
git commit -m "docs: document project templates and props.json"
```
