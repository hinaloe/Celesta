# Celesta MCP server (2026-10-13)

`Celesta-mcp` (`crates/mcp`, binary `celesta-mcp`) is a stdio MCP server
for coding agents. It is headless: it never talks to a running app and
never edits source. Design: `docs/superpowers/specs/2026-10-13-mcp-server-design.md`.

- Tools: `inspect`, `render_frames`, `contact_sheet`, `export_video`,
  `list_templates`, `init_project`, `read_docs`. The `initialize` result
  carries `crates/mcp/src/instructions.md`.
- Shared with the CLI, in the exporter library:
  - `celesta_exporter::report` builds the `--json` report.
    `HintStyle::Cli`/`Mcp` only changes hints that name options; codes are
    the same, so `skills/celesta/references/export.md#json-results` covers
    both. `crates/exporter/src/json.rs` prints it for the CLI.
  - `ExportJob::run` is the CLI's former `export()` dispatch (JSON project or
    React entry, PNG or MP4, companion project); MP4 paths honor an
    `ExportCancellation`. `ReactRuntimeOptions::for_entry` is the former
    `react_runtime()`.
  - `FrameSelection::FromEnd` takes negative frames counted from the end and
    drops frames named twice; the CLI still uses `Frames`.
- `runtime_paths()` treats an executable named `Celesta-mcp` as packaged, so
  the Windows package finds its `runtime` folder.
- `crates/mcp/src`:
  - `server.rs`: the `rmcp` tool router (`#[tool_router]`), result helpers
    (`usage_error`, `error_result`, `success`, `rendered`).
  - `args.rs`: rendering tool arguments; `job()` validates them (usage
    errors) and builds an `ExportJob`. A `source` ending in `.json` is a JSON
    project.
  - `export.rs`: runs a job on `spawn_blocking` behind `render_lock`, so
    rendering tools take turns on the GPU; `inspect` and the other tools do
    not take the lock. Progress goes out as MCP progress notifications when
    the request has a progress token (frames of the total, throttled to
    250 ms; audio mixing and muxing as two more steps). A cancelled request
    (`notifications/cancelled`) cancels the `ExportCancellation`; `rmcp`
    sends no response to it, and the lock is released once the exporter has
    stopped and removed its temporary file.
  - `frames.rs`: `OutputDirs` gives each call without an output its own
    folder under a temporary directory removed on exit; `image_blocks`
    returns the first 6 frames (or the contact sheet) as image content.
  - `inspect.rs` + `summary.rs`: a port of `inspect.mjs`. Frames are
    evaluated through `ReactBridge` (native text shaping and media probing);
    the text matches `inspect.mjs --native` line for line.
  - `docs.rs`: the skill's Markdown via `include_str!`; a unit test fails
    when a new `skills/celesta/references/*.md` is not listed in `TOPICS`.
- Adding a tool: an args struct deriving `Deserialize` + `JsonSchema`
  (camelCase), a `#[tool(description = …)]` method on `CelestaServer`
  returning `CallToolResult`, blocking work on `spawn_blocking` (or
  `export::run` if it renders), a test in `crates/mcp/tests/`, the name in
  `tests/server.rs`'s tool list and `scripts/test-package.mjs`, and a row in
  `skills/celesta/references/setup.md`.
- Tests: `crates/mcp/tests/*.rs` start the built binary through `rmcp`'s
  client and skip without `packages/cli/dist/cli.js`.
  `stdout_carries_only_json_rpc` checks that nothing else reaches stdout.
- Packaging: macOS `Contents/MacOS/Celesta-mcp`, Windows `Celesta-mcp.exe`,
  Linux image `/opt/celesta/celesta-mcp`. `scripts/test-package.mjs` lists
  the tools of the packaged server.
