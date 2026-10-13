# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `Celesta-mcp`, a stdio MCP server that lets coding agents inspect, render, and export Celesta videos and read the Celesta docs through tools, with rendered frames returned as images.

**Architecture:** A new crate `crates/mcp` (binary `celesta-mcp`) built on `rmcp` 3.5. It calls the exporter as a library: the CLI's report and export dispatch move into `celesta-exporter` (`report::build`, `ExportJob::run`) so the CLI and the server share one code path and one error-code table. `inspect` drives `ReactBridge` directly and ports `inspect.mjs`'s scene summary to Rust; rendering tools run one at a time behind a mutex on `spawn_blocking`.

**Tech Stack:** Rust 2024, `rmcp` 3.5 (`server`, `macros`, `transport-io`; tests add `client`, `transport-child-process`), Tokio, `schemars` 1, `serde_json`, `base64` 0.22, `tempfile`.

**Spec:** `docs/superpowers/specs/2026-10-13-mcp-server-design.md`

## Global Constraints

- Shipped binary name: `Celesta-mcp` (`Celesta-mcp.exe` on Windows); cargo package and binary: `celesta-mcp`.
- Tools, exactly seven: `inspect`, `render_frames`, `contact_sheet`, `export_video`, `list_templates`, `init_project`, `read_docs`.
- Tool names `snake_case`; argument and report fields `camelCase`.
- `source` ending in `.json` is a JSON project; anything else is a React entry.
- `props`, `propsFile`, `project`, `debugGuides` on a JSON project are a `usage` error.
- `frames` and `every` are mutually exclusive; `frames` cannot be combined with `start`/`end`.
- Negative frames count from the end (`-1` is the last frame).
- At most 6 frames are returned as image content per `render_frames` call.
- Progress notifications: at most one per 250 ms, plus the last frame.
- Error codes are the CLI's (`skills/celesta/references/export.md#json-results`); only hint wording differs between `HintStyle::Cli` and `HintStyle::Mcp`.
- Nothing but JSON-RPC messages may be written to stdout; logs go to stderr.
- The CLI's `--json` output must not change; the existing exporter tests are the check.
- macOS builds need `PKG_CONFIG_PATH="$(brew --prefix ffmpeg@8)/lib/pkgconfig"`.
- Integration tests skip (print and return) when `packages/cli/dist/cli.js` is missing, like `crates/exporter/tests/inspect_integration.rs`; build it with `pnpm run build:runtime`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **`frames: [0, -1]` on a one-frame composition, or `[89, -1]` on 90 frames**: both name the same frame; an agent expects one PNG, not a `duplicate frame` error. `FromEnd` drops repeats. Pinned in Task 2.
2. **Repeating the same `render_frames` call without `outputDir`** (the normal check loop): the second call must not fail with `output_exists`. Pinned in Task 6.
3. **A relative `source` path**: resolved from the server's working directory, and every reported path is absolute. Pinned in Task 6.
4. **A cancelled export**: the GPU lock is released and no partial MP4 is left; the next rendering call runs. Pinned in Task 7.
5. **An entry whose `prepare()` throws, or invalid project properties**: `inspect` and `render_frames` return `isError` with the entry's message (`react` code) or `invalid_properties` issues, and the server keeps serving. Pinned in Tasks 5 and 6.

---

### Task 1: Report in the exporter library

**Files:**
- Modify: `crates/exporter/src/report.rs` (becomes the library module; drop `print`, `run`, `usage_error`, and the `progress::State` dependency)
- Modify: `crates/exporter/src/lib.rs` (`pub mod report;`)
- Create: `crates/exporter/src/json.rs` (binary-side printing)
- Modify: `crates/exporter/src/main.rs` (`mod json;` replaces `mod report;`)

**Interfaces:**
- Produces (`celesta_exporter::report`):
  - `#[derive(Clone, Copy, Debug, PartialEq, Eq)] pub enum HintStyle { Cli, Mcp }`
  - `#[derive(Serialize)] pub struct Report` — today's fields, unchanged, private.
  - `pub fn build(source: &Path, props_file: Option<PropsFileChoice>, hints: HintStyle, export: impl FnOnce(&mut dyn FnMut(ExportProgress)) -> Result<(), ExportError>) -> (Report, bool)`
  - `pub fn usage(message: &str) -> Report` — `status: error`, `code: "usage"`, message trimmed of `error: ` as `usage_error` does today; every other field absent.
- Produces (binary): `json::run(source, props_file, export) -> bool` and `json::usage_error(message)`, printing one line as today.

- [ ] **Step 1: Move the existing tests** with the module and add `mcp_hints_name_tool_arguments`: with `HintStyle::Mcp`, `OutputExists` → hint `"set overwrite to replace it, or write to another path"`; `UnsupportedOutput` → `"write video to a .mp4 path with export_video, or render PNG frames with render_frames"`; `EmptyRange` → `"choose start/end inside the composition (composition.duration seconds)"`; codes equal the `Cli` ones; no Mcp hint contains `--`.
- [ ] **Step 2: Run** `cargo test -p celesta-exporter --lib report` — Expected: compile error, no `HintStyle`.
- [ ] **Step 3: Implement.** `error_report(error, hints)`; hints without CLI options (`invalid_properties`, `unsupported_dimensions`) are the same in both styles. Replace `State` with a private timer in `build`: start time; first `Rendering` starts the render clock; `MixingAudio`, `Muxing`, or a successful finish stops it; frames done = `total` once stopped, else `frame.saturating_sub(1).min(total)`; `renderFps` = done ÷ render seconds, absent when either is 0 — the same formula as `progress::State::metrics`.
- [ ] **Step 4: Run** `cargo test -p celesta-exporter` — Expected: PASS, including `tests/*_integration.rs` that check `--json` output.
- [ ] **Step 5: Commit** — `refactor(exporter): build JSON reports in the library`

### Task 2: `ExportJob`, `ReactRuntimeOptions::for_entry`, and `FrameSelection::FromEnd`

**Files:**
- Create: `crates/exporter/src/job.rs`
- Modify: `crates/exporter/src/react.rs`, `crates/exporter/src/stills.rs` (`FrameSelection`, `select`, tests at `mod tests`), `crates/exporter/src/lib.rs`, `crates/exporter/src/main.rs` (`export()` and `react_runtime()` become an `ExportJob`)

**Interfaces:**
- Produces:
  - `impl ReactRuntimeOptions { pub fn for_entry(entry: &Path, props_file: Option<&Path>, props: Option<&str>) -> Result<Self, ExportError> }` — today's `react_runtime()` body.
  - `FrameSelection::FromEnd(Vec<i64>)`: each negative `f` becomes `total + f`; a result below 0 or at/after `total` is `InvalidSelection("frame {f} is out of range; composition has {total} frames (zero-based)")`; repeats after resolution are dropped keeping first-seen order; combining with a range is the same error `Frames` gives.
  - ```rust
    pub struct ExportJob {
        pub source: PathBuf,
        pub react: bool,
        pub companion: Option<PathBuf>,
        pub props_file: Option<PathBuf>,
        pub props: Option<String>,
        pub output: PathBuf,
        pub png: Option<PngExport>,
        pub options: ExportOptions,
    }
    impl ExportJob {
        pub fn run(&self, cancellation: &ExportCancellation, progress: &mut dyn FnMut(ExportProgress)) -> Result<(), ExportError>;
    }
    ```
    `run` is the CLI's `export()`; MP4 paths call the `*_cancellable` methods with `cancellation` (JSON project: `Project::load` then `export_project_cancellable` with the project's folder as asset root).

- [ ] **Step 1: Write the failing tests** in `stills.rs` `mod tests`: `from_end_counts_back_from_the_last_frame` (total 90, `[0, -1, -30]` → `[0, 89, 60]`); `from_end_rejects_frames_before_the_start` (`[-91]` → `InvalidSelection` containing `out of range`); `from_end_drops_repeats` (`[89, -1]` → `[89]`; total 1, `[0, -1]` → `[0]`); `from_end_cannot_combine_with_a_range`.
- [ ] **Step 2: Run** `cargo test -p celesta-exporter --lib from_end` — Expected: compile error, no `FromEnd`.
- [ ] **Step 3: Implement** `FromEnd`, `for_entry`, and `ExportJob`; `main.rs` builds an `ExportJob` from `Cli` and calls `run(&ExportCancellation::default(), progress)`.
- [ ] **Step 4: Run** `cargo test -p celesta-exporter` — Expected: PASS (the CLI integration tests cover every `run` branch).
- [ ] **Step 5: Commit** — `refactor(exporter): share export dispatch as ExportJob`

### Task 3: `celesta-mcp` crate with `read_docs`, `list_templates`, `init_project`

**Files:**
- Modify: `Cargo.toml` (workspace member `crates/mcp`)
- Create: `crates/mcp/Cargo.toml`, `crates/mcp/src/main.rs`, `crates/mcp/src/server.rs`, `crates/mcp/src/docs.rs`, `crates/mcp/src/instructions.md`, `crates/mcp/tests/common/mod.rs`, `crates/mcp/tests/server.rs`

**Interfaces:**
- Consumes: `celesta_react_bridge::{runtime_paths, list_templates, project_templates_dir, initialize_project}`.
- Produces:
  - `pub struct CelestaServer` (`server.rs`) with `pub fn new() -> io::Result<Self>`, holding `tool_router: ToolRouter<Self>`, `render_lock: Arc<tokio::sync::Mutex<()>>`, `outputs: Arc<OutputDirs>` (Task 6 adds `OutputDirs`; leave the field for then). `#[tool_handler] impl ServerHandler` whose `get_info` is `ServerConfig::new(ServerCapabilities::builder().enable_tools().build()).with_instructions(include_str!("instructions.md"))` with server name `celesta` and the workspace version.
  - `docs.rs`: `pub struct Topic { pub name: &'static str, pub description: &'static str, pub markdown: &'static str }`, `pub static TOPICS: &[Topic]`, `pub fn read(topic: Option<&str>) -> Result<String, String>` (no topic → a Markdown list `- name — description`; unknown → `Err` naming the valid topics).
  - Tool results: `usage_error(message) -> CallToolResult` = `CallToolResult::structured_error(serde_json::to_value(report::usage(message)))`; every tool in later tasks uses it.
  - `tests/common/mod.rs`: `pub async fn client() -> RunningService<RoleClient, TestClient>` spawning `env!("CARGO_BIN_EXE_celesta-mcp")` with `TokioChildProcess`; `pub struct TestClient` (a `ClientHandler` forwarding `on_progress` params to an `mpsc::UnboundedSender`); `pub fn runtime_built() -> bool`; `pub fn entry(source: &str) -> (TempDir, PathBuf)` (a `scene.tsx` in `tempdir_in(packages/cli)`); `pub async fn call(client, name, args: Value) -> CallToolResult`.

- [ ] **Step 1: Write the failing tests.** Unit (`docs.rs`): `every_reference_is_a_topic` (each `*.md` stem under `skills/celesta/references`, read at test time, is in `TOPICS`, plus `overview`); `overview_has_no_front_matter` (does not start with `---`). Integration (`tests/server.rs`): `lists_the_seven_tools` (exact name set; register Tasks 5–7's tools as stubs returning `usage_error("not implemented")` so the list is complete now); `instructions_name_the_workflow` (contains `inspect`, `render_frames`, `read_docs`); `read_docs_lists_and_reads` (no topic → contains `animation`; `topic: "export"` → contains `JSON results`; `topic: "nope"` → `isError`); `list_templates_starts_with_blank` and `init_project_creates_a_project` (tempdir; `template: "slideshow"` → `film.tsx` and `props.json` exist; output names the template and its `edit` note) — both skip without the runtime.
- [ ] **Step 2: Run** `cargo test -p celesta-mcp` — Expected: compile errors (crate missing).
- [ ] **Step 3: Implement.** `main.rs`: multi-thread Tokio runtime, `CelestaServer::new()?.serve(rmcp::transport::stdio()).await?.waiting().await`, errors to stderr, `ExitCode::FAILURE` on error. `instructions.md` holds what the spec's "Server instructions" section lists. `docs.rs` embeds `skills/celesta/SKILL.md` (front matter stripped at first use) and every reference with `include_str!("../../../skills/celesta/…")`; descriptions are one line each, from SKILL.md's References table.
- [ ] **Step 4: Run** `cargo test -p celesta-mcp` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mcp): add the Celesta MCP server with docs and templates`

### Task 4: Scene summary and loop differences

**Files:**
- Create: `crates/mcp/src/summary.rs`

**Interfaces:**
- Produces (pure functions over the serde JSON of `Scene` / `ReactAudioClipDescriptor`):
  - `pub fn fmt(value: f64) -> String` — `inspect.mjs`'s `fmt`.
  - `pub struct FileCheck { entry_dir: PathBuf, pub missing: BTreeSet<String> }` with `pub fn new(entry_dir) -> Self` and `pub fn check(&mut self, src: Option<&str>) -> &'static str` (`""` or `"  ← MISSING FILE"`; URLs never missing).
  - `pub fn describe_frame(scene: &Value, audio: &[Value], files: &mut FileCheck, warnings: &mut Vec<String>) -> String` — `inspect.mjs`'s per-frame lines: fonts, `(no layers: the frame is black)`, `printLayers`, audio lines.
  - `#[derive(Serialize)] pub struct Difference { pub path: String, pub end: Value, pub start: Value }` and `pub fn diff_scenes(end: &Value, start: &Value) -> Vec<Difference>` — `diffScenes` (ignores `id` keys and the top-level `time`, 1e-6 relative tolerance, hex colors ±1 per channel, lists of different length reported once via `describeList`).
  - `pub fn format_value(value: &Value) -> String` — `formatValue`.

- [ ] **Step 1: Write the failing tests** with literal scene JSON: `fmt` (`2.0`→`"2"`, `1.5`→`"1.5"`, `1/3`→`"0.333"`); a rect `100×50` at `(10, 20)` with solid `#ff0000` → `rect 100×50 at (10, 20) fill #ff0000`; a text layer → `text "Hi" at (0, 0) [sans-serif 48px #ffffff]`; a group → children indented by two spaces; an image with a missing `./nope.png` → line ends `  ← MISSING FILE` and `missing == {"./nope.png"}`; a `missingComponent` → `UNREGISTERED COMPONENT Foo` plus a warning; `diff_scenes` ignores differing `id`s and `time`, ignores `0.1` vs `0.1000000001`, ignores `#ff0000` vs `#fe0000`, reports `#ff0000` vs `#fd0000` and `opacity` `1` vs `0.5` with paths like `layers[0](a).opacity`.
- [ ] **Step 2: Run** `cargo test -p celesta-mcp --lib summary` — Expected: compile error.
- [ ] **Step 3: Implement** by porting `skills/celesta/scripts/inspect.mjs` (`fmt`, `describeTransform`, `describePaint`, `printLayers`, `diffScenes`, `describeList`, `formatValue`) line for line.
- [ ] **Step 4: Run** `cargo test -p celesta-mcp --lib summary` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mcp): summarize scenes like inspect.mjs`

### Task 5: `inspect` tool

**Files:**
- Create: `crates/mcp/src/inspect.rs`
- Modify: `crates/mcp/src/server.rs` (replace the stub)
- Test: `crates/mcp/tests/inspect.rs`

**Interfaces:**
- Consumes: Task 4's `summary`; `ReactBridge::spawn_with_properties`, `evaluate_at`, `evaluate_past_end`; `PropertyInputs::load_for_entry`; `runtime_paths()`.
- Produces: `#[derive(Deserialize, JsonSchema)] #[serde(rename_all = "camelCase")] pub struct InspectArgs { entry: PathBuf, frames: Option<Vec<i64>>, every: Option<u64>, #[serde(rename = "loop", default)] loop_check: bool, props: Option<serde_json::Map<String, Value>>, props_file: Option<PathBuf> }` and `pub fn inspect(args: &InspectArgs) -> CallToolResult` (run on `spawn_blocking`; not behind the render lock).
- Output text: `composition: W×H @ fps fps, N frames (S s)`, then `── frame F (T s) ──` blocks, then warnings, `missing:` lines, and `OK: entry loads and every inspected frame evaluates` or `N problem(s) found` — as `inspect.mjs`. With `loop`: its loop-check text. `structuredContent`: `{ composition: {width, height, fps, frames, duration}, frames: [{frame, time, layers, audio, missingFiles} | {frame, error}], loop?: {seamless, pairs: [{frame, against, differences}]}, warnings }`. `isError` when any frame fails, a file is missing, or the loop has a seam. Startup failures: `InvalidProperties` → `invalid_properties` with issues; anything else → `react` with the bridge's message.

- [ ] **Step 1: Write the failing tests** (skip without the runtime): `inspect_lists_layers` (a 30-frame entry with `<Rect width={100} height={50} fill="#336699" />`; default frames are 0, 15, 29; text contains `rect 100×50`); `inspect_resolves_negative_frames` (`frames: [-1]` → structured `frames[0].frame == 29`); `inspect_reports_missing_files` (`<Image src="./nope.png" …/>` → `isError`, `missingFiles == ["./nope.png"]`); `inspect_finds_a_loop_seam` (opacity `frame / 30` → `loop.seamless == false`), and a static scene → `true`; `inspect_measures_text` (`useTextMetrics` in render → no error); `inspect_reports_a_failing_prepare` (`prepare()` throws `boom` → `isError`, code `react`, message contains `boom`; a following `list_templates` call still answers).
- [ ] **Step 2: Run** `cargo test -p celesta-mcp --test inspect` — Expected: FAIL (stub returns `not implemented`).
- [ ] **Step 3: Implement** `inspect.rs`. Frame times are `Time::frames(frame, metadata.frame_rate)`; `every` and negatives resolve as `inspect.mjs` does (dedupe, drop out-of-range).
- [ ] **Step 4: Run** `cargo test -p celesta-mcp` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mcp): inspect React entries without rendering`

### Task 6: `render_frames` and `contact_sheet`

**Files:**
- Create: `crates/mcp/src/args.rs`, `crates/mcp/src/frames.rs`, `crates/mcp/src/export.rs`
- Modify: `crates/mcp/src/server.rs`
- Test: `crates/mcp/tests/render.rs`

**Interfaces:**
- Consumes: Task 1 `report::{build, HintStyle::Mcp}`, Task 2 `ExportJob`, `FrameSelection::FromEnd`, `parse_timecode`.
- Produces:
  - `args.rs`: `#[derive(Deserialize, JsonSchema)] pub struct SourceArgs { source: PathBuf, project: Option<PathBuf>, props: Option<Map<String, Value>>, props_file: Option<PathBuf>, start: Option<String>, end: Option<String> }` (flattened into each tool's args); `RenderFramesArgs { #[serde(flatten)] source: SourceArgs, frames: Option<Vec<i64>>, every: Option<u64>, debug_guides: Option<bool>, output_dir: Option<PathBuf>, overwrite: Option<bool> }`; `ContactSheetArgs { flatten source, frames, every, columns: Option<u32>, tile_width: Option<u32>, debug_guides, output: Option<PathBuf>, overwrite }`; `ExportVideoArgs { flatten source, output: PathBuf, overwrite, preset: Option<String>, crf: Option<u8>, bit_depth: Option<u8> }`. Each has `fn job(&self, outputs: &OutputDirs) -> Result<ExportJob, String>` returning the usage message on invalid arguments (rules in Global Constraints; also: neither `frames` nor `every`, empty `frames`, `every`/`columns`/`tileWidth` of 0, bad timecode, `end` not after `start`, wrong output extension, unknown `preset`, `bitDepth` not 8 or 10). Relative paths are made absolute against the current directory.
  - `frames.rs`: `pub struct OutputDirs` with `pub fn new() -> io::Result<Self>` (one `TempDir`, removed on drop) and `pub fn fresh(&self) -> io::Result<PathBuf>` (`<root>/0001`, `0002`, …); `pub fn image_blocks(files: &[ExportedFile]) -> Vec<ContentBlock>` (per frame: `ContentBlock::text("frame F: PATH")` then `ContentBlock::image(base64, "image/png")`, first 6 frames only; a contact sheet is one image).
  - `export.rs`: `pub struct Run { pub report: Value, pub ok: bool, pub files: Vec<ExportedFile> }` and `pub async fn run(job: ExportJob, render_lock: &Mutex<()>, ctx: &RequestContext<RoleServer>) -> Run` — takes the lock, runs `report::build(&job.source, props_file, HintStyle::Mcp, |collect| job.run(&cancellation, &mut |event| { files…; collect(event) }))` on `spawn_blocking`. `props_file` is `resolve_props_file(source, props_file)` for React jobs, as the CLI does. Task 7 adds progress and cancellation here.
  - Tool result: `ok` → `CallToolResult::success(images ++ [text(report JSON)])` with `structured_content = report`; otherwise `structured_error(report)`.

- [ ] **Step 1: Write the failing tests.** Unit (`args.rs`): one test per usage rule, each asserting `job()` returns `Err` whose message names the offending argument; `relative_source_becomes_absolute`. Integration (skip without the runtime): `render_frames_returns_pngs` (10-frame React fixture, `frames: [0, -1]` → 2 image blocks whose base64 decodes to bytes starting `\x89PNG\r\n\x1a\n`; report `outputs` frames `[0, 9]`, absolute paths); `render_frames_inlines_at_most_six` (`every: 1` → 6 images, 10 outputs); `render_frames_twice_does_not_collide` (same args twice, both ok); `output_dir_refuses_existing_files_unless_overwrite` (second call → `output_exists`, hint contains `overwrite`, not `--`; with `overwrite: true` → ok); `render_frames_validates_json_projects` (`examples/minimal.celesta.json` `frames: [0]` → ok; a project missing `tracks` → `project_validation` with `issues`); `react_arguments_on_json_are_usage_errors`; `render_frames_reports_invalid_properties` (entry with `defineProjectProperties({ n: { type: 'number', defaultValue: 1 } })`, `props: {"n": "x"}` → `invalid_properties` with an issue keyed `n`); `contact_sheet_returns_one_image` (20 frames, `every: 5` → one image; output `frames == [0, 5, 10, 15, 19]`).
- [ ] **Step 2: Run** `cargo test -p celesta-mcp --test render` — Expected: FAIL (stubs).
- [ ] **Step 3: Implement** the three modules and wire both tools; `CelestaServer::new` creates `OutputDirs`.
- [ ] **Step 4: Run** `cargo test -p celesta-mcp` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mcp): render PNG frames and contact sheets as images`

### Task 7: `export_video` with progress and cancellation

**Files:**
- Modify: `crates/mcp/src/export.rs`, `crates/mcp/src/server.rs`
- Test: `crates/mcp/tests/export.rs`

**Interfaces:**
- Consumes: Task 6's `run`, `ExportVideoArgs::job`.
- Produces: `run` forwards progress and honors cancellation for every rendering tool:
  - Progress: when `ctx.meta.get_progress_token()` is set, blocking-side events go through an unbounded channel; the async side sends `ProgressNotificationParam::new(token, frame).with_total(total)` for `Rendering` (throttled per Global Constraints) and a message-only notification for `MixingAudio` (`"mixing audio"`) and `Muxing` (`"writing the MP4"`).
  - Cancellation: a task awaiting `ctx.ct.cancelled()` calls `ExportCancellation::cancel()`; it is aborted once the export returns. The lock is held until the blocking export returns.

- [ ] **Step 1: Write the failing tests** (skip without the runtime): `export_video_writes_an_mp4_with_progress` (60 frames at 320×180; at least one progress notification with `total == 60`; output exists; report `outputs[0].type == "video"`); `export_video_cancel_stops_and_frees_the_gpu` (600 frames at 640×360 via `send_cancellable_request`; cancel after the first progress notification; a following `render_frames` call returns ok within 60 s; the MP4 does not exist); `export_video_refuses_png_output` (`output: "a.png"` → `usage`); `stdout_carries_only_json_rpc` (raw `std::process::Command`: write `initialize`, `notifications/initialized`, `tools/call render_frames` on a fixture, `tools/call read_docs`, close stdin; every stdout line parses as JSON with `"jsonrpc": "2.0"`).
- [ ] **Step 2: Run** `cargo test -p celesta-mcp --test export` — Expected: FAIL (stub).
- [ ] **Step 3: Implement** progress, cancellation, and the `export_video` tool.
- [ ] **Step 4: Run** `cargo test -p celesta-mcp && cargo clippy -p celesta-mcp -p celesta-exporter --all-targets -- -D warnings` — Expected: PASS, no warnings.
- [ ] **Step 5: Commit** — `feat(mcp): export MP4 with progress and cancellation`

### Task 8: Packaging

**Files:**
- Modify: `crates/react-bridge/src/runtime.rs` (`packaged_name` accepts `Celesta-mcp`; test in its `mod tests`)
- Modify: `scripts/package-macos.py` (`-p celesta-mcp`; copy `celesta-mcp` → `Contents/MacOS/Celesta-mcp`; `dylibbundler -x`; the required Mach-O set and its error message)
- Modify: `scripts/package-windows.ps1` (`-p celesta-mcp`; copy to `Celesta-mcp.exe`)
- Modify: `packaging/linux/Dockerfile` (`cargo build -p celesta-exporter -p celesta-mcp`; copy `celesta-mcp` to `/out/`), `packaging/linux/README.md` (how to run it with `--entrypoint /opt/celesta/celesta-mcp -i`)
- Modify: `scripts/test-package.mjs` (MCP smoke test)
- Modify: `packaging/windows/Celesta.iss` if it lists files individually

**Interfaces:**
- Consumes: the `celesta-mcp` binary.

- [ ] **Step 1: Write the failing test** `packaged_mcp_uses_the_runtime_folder` in `runtime.rs`: `paths_for(Some(Path::new("/opt/c/Celesta-mcp")))` returns `/opt/c/runtime/node` (`node.exe` on Windows) and `/opt/c/runtime/react/dist/cli.js`, mirroring the existing `Celesta-export` test.
- [ ] **Step 2: Run** `cargo test -p celesta-react-bridge --lib runtime` — Expected: FAIL.
- [ ] **Step 3: Implement** the name check and the script changes. In `test-package.mjs`, spawn the packaged `Celesta-mcp` with the same clean `env`, write `initialize`, `notifications/initialized`, and `tools/list` lines, end stdin, and assert the `tools/list` result names all seven tools.
- [ ] **Step 4: Run** `cargo test -p celesta-react-bridge --lib runtime` (PASS) and, on macOS, `python3 scripts/package-macos.py --version 0.6.1` — Expected: the build finishes and its `test-package.mjs` run passes. Windows and Linux are checked by `package-build.yml` on the PR.
- [ ] **Step 5: Commit** — `build: ship Celesta-mcp in the macOS, Windows, and Linux packages`

### Task 9: Documentation

**Files:**
- Modify: `skills/celesta/references/setup.md` (new section "Use the Celesta MCP server": per-platform path — `/Applications/Celesta.app/Contents/MacOS/Celesta-mcp`, `<install dir>\Celesta-mcp.exe`, `target/release/celesta-mcp` from source; `claude mcp add celesta -- <path>`; the tool that replaces each shell command)
- Modify: `skills/celesta/SKILL.md` (Workflow step 1: prefer the Celesta MCP tools when they are available)
- Modify: `README.md` (a short "Use with AI agents" section after "What you can do")
- Create: `docs/handoff/2026-10-13-mcp-server.md` (what moved into the exporter library, the server layout, the render lock, how cancellation behaves, how to add a tool)
- Modify: `HANDOFF.md` only if it lists crates

- [ ] **Step 1: Write the docs.** `read_docs` embeds `SKILL.md` and `setup.md`, so rebuild afterwards.
- [ ] **Step 2: Run** `cargo test -p celesta-mcp --lib docs` — Expected: PASS.
- [ ] **Step 3: Commit** — `docs: describe the Celesta MCP server`
