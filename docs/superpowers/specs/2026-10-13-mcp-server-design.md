# MCP server design

## Goal

Coding agents (Claude Code, Cursor, Codex, …) already work with Celesta
through the shell: the `celesta` skill teaches the source format,
`skills/celesta/scripts/inspect.mjs` evaluates frames without the GUI, and
`Celesta-export --json` renders PNG frames, contact sheets, and MP4 files
with a machine-readable result. Celesta should also ship an MCP server so
that an agent can do the same through tools, which adds:

- **Images in the tool result.** Rendered frames come back as image
  content; the agent does not have to open the PNG files separately.
- **No tool discovery.** The agent registers one executable; it does not
  have to find `Celesta-export`, Node.js, or the React runtime.
- **Progress and cancellation** for long exports, through MCP progress
  notifications and `notifications/cancelled`.
- **Documentation that matches the binary.** The skill's Markdown is
  embedded in the server, so the docs an agent reads are the ones for the
  version it runs.

The server is headless. It does not talk to a running Celesta app, and it
does not edit source files: the agent edits files itself and uses the
server to check and render them.

## Non-goals

- Controlling the desktop app (opening files, seeking, capturing the
  preview).
- Reading or writing composition source.
- Keeping a React runtime warm between tool calls. The exporter library
  spawns a runtime per call; reusing one needs an exporter API that accepts
  an existing bridge, which is a separate change.
- Listing PSD layers (`inspect.mjs --psd-layers`). It runs `ag-psd` inside
  the Node runtime and only serves portrait setup; agents keep using
  `inspect.mjs` for it.
- Type-checking (`tsc`). Coding agents run it in the shell.
- MCP resources and prompts. Documentation is served by a tool, which
  agents call more reliably than they read resources.

## Packaging

- New crate `crates/mcp`, package `celesta-mcp`, binary `celesta-mcp`,
  shipped as `Celesta-mcp` (matching `Celesta-export`).
- Dependencies: `celesta-exporter` (as a library), `celesta-react-bridge`,
  `celesta-composition`, `rmcp` (the official Rust MCP SDK, stdio
  transport, `server` and `macros` features), `tokio`, `schemars`,
  `serde`, `serde_json`, `base64`, `tempfile`.
- macOS: `Contents/MacOS/Celesta-mcp`. `scripts/package-macos.py` builds
  `-p celesta-mcp`, copies the binary, passes it to `dylibbundler` with
  `-x`, and adds it to the required Mach-O set.
- Windows: `Celesta-mcp.exe` next to `Celesta.exe`.
  `scripts/package-windows.ps1` builds and copies it.
- Linux Docker image: `packaging/linux/Dockerfile` also builds and copies
  `celesta-mcp` into `/opt/celesta/`. The entry point stays the exporter.
- `scripts/test-package.mjs` starts the packaged `Celesta-mcp`, sends
  `initialize` and `tools/list`, and checks that every tool is listed.
- Runtime discovery is `celesta_react_bridge::runtime_paths()`, the same
  function the exporter and the app use.

Registering the server, for example with Claude Code:

```sh
claude mcp add celesta -- /Applications/Celesta.app/Contents/MacOS/Celesta-mcp
```

## Tools

Tool names are `snake_case`; argument names are `camelCase`, matching the
exporter's JSON report. Relative paths resolve from the server's working
directory; reported paths are absolute.

Arguments shared by several tools:

- `source` — a JSON project (`.json`, including `.celesta.json`) or a
  React entry (any other extension, normally `.tsx`). The extension
  decides which exporter path is used; it replaces `Celesta-export`'s
  `--react` flag.
- `project` — a companion `.celesta.json` for a React entry
  (`Celesta-export --project`).
- `props` (an object) and `propsFile` (a path) — project property values,
  with the same precedence as `--props` / `--props-file`; without
  `propsFile`, the entry's `props.json` is used. React entries only.
- `start` / `end` — timecodes as `Celesta-export --from` / `--to` accept
  them, parsed with `parse_timecode`. `end` must be after `start`.
- `frames` — zero-based composition frames. Negative numbers count from
  the end (`-1` is the last frame), as in `inspect.mjs --frames`.
- `every` — every `n`th frame of the range, plus its last frame
  (`FrameSelection::Every`).

`frames` and `every` are mutually exclusive. `frames` cannot be combined
with `start`/`end`, matching the exporter. React-only arguments on a JSON
project are a usage error.

### `inspect`

Evaluates React frames without rendering pixels, with real text shaping
and media probing — the same evaluation as `Celesta-export --inspect`.

- Input: `entry` (React only), `frames` or `every` (default
  `[0, -1]`), `loop` (boolean), `props`, `propsFile`.
- Implementation: spawn a `ReactBridge` with the property inputs, then
  `evaluate_at` each frame; with `loop`, evaluate frames `N` and `N + 1`
  with `evaluate_past_end` and compare them with frames `0` and `1`.
- Output: text content in the format `inspect.mjs` prints — the
  composition (size, fps, frames), then per frame the layer tree (type,
  position, size, opacity, paint, text), audio clips, and missing local
  media files; with `loop`, the differences between the scene pairs — plus
  `structuredContent` with the same data: `composition`, `frames` (each
  with `frame`, `layers`, `audio`, `missingFiles`), `loop` (when
  requested: `seamless` and `differences`), and `warnings`.
- `inspect.mjs`'s `printLayers`, `describeTransform`, `describePaint`,
  and `diffScenes` are ported to Rust; the text output matches theirs
  where the data allows.
- A missing local file or a frame that fails to evaluate sets `isError`.

### `render_frames`

Renders PNG frames and returns them as images.

- Input: `source`, `frames` or `every` (one is required), `start`/`end`,
  `debugGuides` (React only), `outputDir` (optional), `overwrite`
  (default false), `project`, `props`, `propsFile`.
- Implementation: `Exporter::export_react_png_with` or
  `export_project_png_with` with `contact_sheet: None`. Without
  `outputDir`, each call writes into a new subdirectory of a
  server-owned temporary directory that is removed when the server exits,
  so repeated checks never collide. The output path passed to the exporter
  is `<dir>/frame.png`: one frame is written there, several are written as
  `frame-000045.png` and so on, as the CLI does. With `outputDir`, an
  existing file is the exporter's `output_exists` error unless `overwrite`
  is set.
- Output: the first 6 frames as image content (`image/png`, base64), each
  preceded by a text line naming its frame and path, then the exporter
  report as text and `structuredContent`. Frames after the sixth appear
  only in the report's `outputs`.
- A JSON project is fully validated on load, so `render_frames` is also
  how an agent validates a `.celesta.json`.

### `contact_sheet`

Renders the selected frames on one PNG grid.

- Input: `source`, `every` or `frames` (one is required), `start`/`end`,
  `columns` (default 5), `tileWidth` (default 320), `debugGuides`,
  `output` (optional `.png`; without it, a new temporary subdirectory as
  for `render_frames`), `overwrite` (default false), `project`, `props`,
  `propsFile`.
- Implementation: the same exporter calls with
  `contact_sheet: Some(ContactSheet { columns, tile_width })`.
- Output: one image plus the report, whose output lists the tile frames
  in reading order.

### `export_video`

Exports an MP4.

- Input: `source`, `output` (required, `.mp4`), `start`/`end`,
  `overwrite` (default false), `preset`, `crf`, `bitDepth` (`8` or
  `10`), `project`, `props`, `propsFile`. Encoder values are parsed with
  the exporter's `FromStr` implementations, so the accepted values match
  the CLI.
- Implementation: `export_*_cancellable` with an `ExportCancellation`.
- Progress: when the request has a progress token, each
  `ExportProgress::Rendering { frame, total }` is sent as a progress
  notification (`progress: frame`, `total`), throttled to at most one per
  250 ms; `MixingAudio` and `Muxing` are sent with a message.
- Cancellation: `notifications/cancelled` for the request calls
  `ExportCancellation::cancel()`. The exporter stops and cleans up as it
  does for the editor; the tool returns the `cancelled` error.
- Output: the report (outputs, whether the video has audio, warnings,
  elapsed time, render fps).

### `list_templates`

Lists project templates: name, title, and description, from
`list_templates(project_templates_dir(cli_script))`.

### `init_project`

Creates a React project like `Celesta --init`.

- Input: `folder`, `template` (optional; `blank` when omitted).
- Implementation: `initialize_project(cli_script, folder, template)`.
- Output: the files created and the template used. An unknown template
  lists the available ones in the error.

### `read_docs`

Returns Celesta documentation as Markdown.

- Input: `topic` (optional). Without it, the tool returns the table of
  contents: every topic with its one-line description.
- Topics: `overview` (`skills/celesta/SKILL.md` without its front
  matter) and the file stem of every `skills/celesta/references/*.md`
  (`animation`, `text`, `export`, …). The tool's input schema lists them
  as an enum.
- The files are embedded with `include_str!`; a build-time test checks
  that every reference file is embedded, so a new reference cannot be
  forgotten.
- Shell-specific instructions in the skill (running `inspect.mjs`,
  calling `Celesta-export`) stay as they are; the server instructions say
  which tool replaces each.

## Server instructions

The `initialize` result carries a short `instructions` text:

- What Celesta is and that the agent edits the source itself.
- The rules that are easy to get wrong, one line each (one
  `<Composition>` root, Celesta elements only, pure frame functions, async
  work in `prepare()`, hex colors, relative paths, imports per package).
- The workflow: edit the source, `inspect`, `render_frames` and look at
  the images, `contact_sheet` for the whole video, `export_video` only for
  audio or the final file.
- Which tool replaces which skill command (`inspect.mjs` → `inspect`,
  `Celesta-export --frames` → `render_frames`, `--contact-sheet` →
  `contact_sheet`, `--init` → `init_project`).
- Call `read_docs` before writing an unfamiliar feature.

## Shared code in the exporter

The MCP server returns the same report and error codes as
`Celesta-export --json`, so the CLI's error table
(`skills/celesta/references/export.md#json-results`) applies to both.

- Move the report types and `error_report()` from
  `crates/exporter/src/report.rs` into a public library module,
  `celesta_exporter::report`. The CLI keeps printing through it; its output
  does not change (the existing `--json` tests check this).
- The library module builds a report from a `ReportBuilder` that consumes
  `ExportProgress` events (`Composition`, `Warning`, `Wrote`,
  `Rendering`) and the final `Result<(), ExportError>`, plus the source,
  props file, and elapsed time. The CLI-specific parts (printing,
  clap usage errors, `progress::State`) stay in the binary.
- Move `react_runtime()` from `main.rs` into the library as
  `ReactRuntimeOptions::for_entry(entry, props_file, props)`, which both
  binaries call.

## Server internals

`crates/mcp/src`:

- `main.rs` — starts the server on stdio with a Tokio runtime. Logging
  goes to stderr.
- `server.rs` — the `rmcp` tool router: argument structs (`serde` +
  `schemars`), validation, and dispatch to the modules below.
- `inspect.rs` — frame evaluation through `ReactBridge`, the scene summary,
  and the loop comparison.
- `frames.rs` — frame-number resolution (negative frames need the
  composition's length, so the selection is resolved after the composition
  is known), the temporary output directory, and PNG files to image
  content.
- `export.rs` — calls into the exporter on `spawn_blocking`, forwards
  progress, and wires cancellation.
- `docs.rs` — the embedded Markdown and the topic list.

Rendering tools (`render_frames`, `contact_sheet`, `export_video`) run one
at a time behind a `tokio::sync::Mutex`, so concurrent calls do not compete
for the GPU. `inspect`, `list_templates`, `init_project`, and `read_docs`
run concurrently.

stdout carries the MCP protocol, so nothing else may write to it. The
exporter library and the React bridge do not print to stdout (the Node
runtime's stdout is the bridge's pipe); an integration test checks that
every stdout line of a full session is a JSON-RPC message.

## Errors

- Invalid arguments (both `frames` and `every`, a wrong extension, React
  arguments on a JSON project, an invalid timecode) return `isError` with
  `code: "usage"` before the exporter is called.
- Exporter failures return `isError` with the shared report: `code`,
  `message`, optional `hint`, and `issues`. Hints name CLI options
  (`pass --overwrite …`), so `error_report()` takes the hint wording as a
  parameter: the CLI keeps its text and the server names its own
  arguments (`set overwrite …`). Codes are identical.
- Cancellation returns the `cancelled` error.
- A missing React runtime (the server is not inside a package and the
  repository runtime is not built) is reported by the first tool that needs
  it with the bridge's existing message, not at startup, so `read_docs`
  still works.

## Testing

Unit tests in `crates/mcp`:

- Scene summary and loop differences against fixed scene JSON.
- Frame selection: negative frames, out-of-range frames, `frames` with
  `every`, `frames` with `start`/`end`.
- Argument validation for every tool.
- Every `skills/celesta/references/*.md` is embedded in `read_docs`.

Integration tests in `crates/mcp/tests`, with the same prerequisites as
the exporter's integration tests (the built React runtime and a GPU or
lavapipe):

- Start the built `celesta-mcp` binary over stdio; `initialize` returns
  the instructions and `tools/list` lists the seven tools.
- `inspect` on a fixture entry reports its layers; a missing image file
  sets `isError`.
- `render_frames` on `examples/minimal.celesta.json` and on a React
  fixture returns image content whose bytes start with the PNG signature.
- `contact_sheet` returns one image and the tile frames.
- `export_video` of a short fixture writes an MP4 and sends progress
  notifications; a cancelled export returns `cancelled` and leaves no
  output file.
- Errors carry the expected `code`.
- Every stdout line in the session is a JSON-RPC message.

The exporter's existing `--json` tests must pass unchanged after the
report move.

## Documentation

- `skills/celesta/references/setup.md`: registering `Celesta-mcp` with an
  agent, per platform path, and that the tools replace the shell commands.
- `skills/celesta/SKILL.md`: one line saying to prefer the Celesta MCP
  tools when they are available.
- `README.md`: a short "Use with AI agents" section.
- `docs/handoff/2026-10-13-mcp-server.md`: the task note.
