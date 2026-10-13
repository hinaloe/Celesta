//! `--json`: one machine-readable result document on stdout in place of
//! progress output, for scripts and AI agents. Nothing is written to stderr.

use std::io::{self, Write};
use std::path::Path;

use celesta_exporter::report::{self, HintStyle, Report};
use celesta_exporter::{ExportError, ExportProgress};
use celesta_react_bridge::PropsFileChoice;

/// Runs `export`, then prints its report. Returns whether it succeeded.
pub fn run(
    source: &Path,
    props_file: Option<PropsFileChoice>,
    export: impl FnOnce(&mut dyn FnMut(ExportProgress)) -> Result<(), ExportError>,
) -> bool {
    let (report, ok) = report::build(source, props_file, HintStyle::Cli, export);
    print(&report);
    ok
}

/// Prints the report for arguments rejected before anything ran.
pub fn usage_error(message: &str) {
    print(&report::usage(message));
}

fn print(report: &Report) {
    let mut stdout = io::stdout().lock();
    // A closed stdout leaves nobody to report to.
    let _ = serde_json::to_writer(&mut stdout, report);
    let _ = writeln!(stdout);
}
