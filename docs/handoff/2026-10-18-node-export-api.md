# Node.js export API (#315)

```ts
import { exportVideo, getComposition } from '@celesta/exporter';
const { composition } = await getComposition({ source: 'scene.tsx' });
await exportVideo({ source: 'scene.tsx', output: 'scene.mp4', signal, onProgress });
```

`packages/exporter` (`@celesta/exporter`) is a separate package with no
dependencies: `exportVideo()`, `exportStills()` and `getComposition()` run
`celesta-exporter --json` as a child process and resolve with its result or
reject with a `CelestaExportError` carrying the result's `code`, `message`,
`hint` and `issues`. It is not part of `@celesta/cli`'s runtime closure:
compositions never import it, and the editor's runtime does not serve it.
Its README documents the options, the events, and how the executable is
found (option, `CELESTA_EXPORTER`, the installed app's `Celesta-export`,
`/opt/celesta/celesta-exporter`, then `PATH`).

The exporter gained three flags for it, all usable on their own:

- `--json-progress` (requires `--json`) prints a `report::Event` line per
  `ExportProgress` event before the result. Lines have an `event` tag; the
  result has none, which is how a reader tells them apart. The payloads reuse
  the result's `Composition` and `Output` serializations (`report::Events`
  keeps the frame rate a `wrote` output's times need).
- `--stdin-cancel` cancels the export's `ExportCancellation` when stdin reads
  `cancel` or closes. A closed stdin counting as cancel means an exporter
  whose parent dies stops and cleans up. It conflicts with `--inspect`,
  which reads requests from stdin.
- `--info` reports the composition without rendering, through the new
  `ExportJob::describe()` (`Exporter::describe_project` /
  `describe_react_entry`). It takes no output and no render flags; with
  `--json` the result has `outputs: []`.

Still exports now check cancellation before each frame:
`export_project_stills_with` and `export_react_stills_with` take an
`&ExportCancellation`, and `ExportJob::run` passes its own, so cancelling an
MCP or CLI still export no longer waits for the last frame. Stills already
written stay, as on any other failure.

The package adds `exporter_not_found`, `exporter_failed` (no result; keeps
stderr) and its own `usage` and `cancelled` errors. Aborting writes `cancel`
and kills the exporter after `CANCEL_TIMEOUT_MS` (10 s). A `usage` error
naming one of the new flags gets a hint that the exporter is too old, since
installed apps lag the repository.

## Verification

- `cargo test -p celesta-exporter -p celesta-mcp` (unit and integration),
  `cargo clippy -p celesta-exporter -p celesta-mcp -p celesta-editor
  --all-targets -- -D warnings`, `cargo fmt --all -- --check`.
- New Rust tests: `report::progress_events_match_the_report`, and CLI parse
  tests for `--info`, `--json-progress` and `--stdin-cancel`.
- `pnpm --dir packages/exporter test`: argument building, executable
  resolution, and the process protocol against a fake exporter script
  (progress, report errors, an old exporter, a crash, cancel on stdin, a
  throwing callback). The fake needs a shebang, so those tests skip on
  Windows. CI's "Test Celesta packages" step runs them.
- By hand on macOS with a release build and `packages/cli/examples/title.tsx`:
  `getComposition`, two stills with progress, a video aborted at frame 10
  (`cancelled`, no file or `.celesta-export-*` workspace left), an
  `unsupported_output` error with its hint, a missing executable, and a
  parent `process.exit()` mid-export leaving no exporter running.
