//! Runs an export job off the async runtime, one at a time, and reports it
//! as `Celesta-export --json` does.

use celesta_exporter::report::{self, HintStyle};
use celesta_exporter::{ExportCancellation, ExportJob, ExportProgress, ExportedFile};
use celesta_react_bridge::resolve_props_file;
use serde_json::Value;
use tokio::sync::Mutex;

/// A finished export: its report, whether it succeeded, and the files it
/// wrote.
pub struct Run {
    pub report: Value,
    pub ok: bool,
    pub files: Vec<ExportedFile>,
}

/// Runs `job` while holding `render_lock`, so exports never compete for
/// the GPU.
pub async fn run(job: ExportJob, render_lock: &Mutex<()>) -> Run {
    let _guard = render_lock.lock().await;
    let joined = tokio::task::spawn_blocking(move || {
        let props_file = job
            .react
            .then(|| resolve_props_file(&job.source, job.props_file.as_deref()))
            .flatten();
        let cancellation = ExportCancellation::default();
        let mut files = Vec::new();
        let (report, ok) = report::build(&job.source, props_file, HintStyle::Mcp, |collect| {
            job.run(&cancellation, &mut |event: ExportProgress| {
                if let ExportProgress::Wrote(file) = &event {
                    files.push(file.clone());
                }
                collect(event);
            })
        });
        Run {
            report: serde_json::to_value(report).expect("reports serialize"),
            ok,
            files,
        }
    })
    .await;
    joined.unwrap_or_else(|error| Run {
        report: serde_json::json!({
            "status": "error",
            "error": { "code": "internal", "message": format!("the export failed: {error}") },
        }),
        ok: false,
        files: Vec::new(),
    })
}
