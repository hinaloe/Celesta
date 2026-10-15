use crate::control::{ExportCancellation, ExportProgress};
use crate::error::ExportError;
use crate::exporter::Exporter;
use crate::options::ExportOptions;
use crate::react::{CompanionProject, ReactRuntimeOptions};
use crate::stills::StillExport;
use celesta_project::Project;
use std::path::{Path, PathBuf};

/// One export as `Celesta-export` and the MCP server describe it: a JSON
/// project or a React entry, written as PNG stills or a video (MP4, MOV or WebM).
#[derive(Clone, Debug)]
pub struct ExportJob {
    pub source: PathBuf,
    /// Whether `source` is a React entry rather than a JSON project.
    pub react: bool,
    /// Root composition ID; absent selects the first root.
    pub composition_id: Option<String>,
    /// A `.celesta.json` exported alongside a React entry.
    pub companion: Option<PathBuf>,
    /// The React entry's property file; `None` uses its `props.json`.
    pub props_file: Option<PathBuf>,
    /// Property values as a JSON object, over `props_file`'s.
    pub props: Option<String>,
    pub output: PathBuf,
    /// `Some` writes PNG stills instead of a video.
    pub stills: Option<StillExport>,
    pub options: ExportOptions,
}

impl ExportJob {
    /// Runs the export. Only video exports check `cancellation`.
    pub fn run(
        &self,
        cancellation: &ExportCancellation,
        progress: &mut dyn FnMut(ExportProgress),
    ) -> Result<(), ExportError> {
        let exporter = Exporter::new(self.options.clone());
        let load = |path: &Path| Project::load(path).map_err(ExportError::Project);
        let companion = self
            .companion
            .as_deref()
            .map(|path| load(path).map(|project| (project, path)))
            .transpose()?;
        let companion = companion.as_ref().map(|(project, path)| CompanionProject {
            project,
            project_asset_root: asset_root(path),
        });
        let runtime = || {
            ReactRuntimeOptions::for_entry(
                &self.source,
                self.props_file.as_deref(),
                self.props.as_deref(),
            )
            .map(|runtime| runtime.with_composition(self.composition_id.clone()))
        };
        match (&self.stills, self.react) {
            (Some(stills), true) => exporter.export_react_stills_with(
                &self.source,
                &runtime()?,
                companion,
                stills,
                &self.output,
                progress,
            ),
            (Some(stills), false) => exporter.export_project_stills_with(
                &load(&self.source)?,
                asset_root(&self.source),
                stills,
                &self.output,
                progress,
            ),
            (None, true) => {
                let runtime = runtime()?;
                match companion {
                    Some(companion) => exporter.export_react_entry_with_project_cancellable(
                        &self.source,
                        &runtime,
                        companion,
                        &self.output,
                        cancellation,
                        progress,
                    ),
                    None => exporter.export_react_entry_cancellable(
                        &self.source,
                        &runtime,
                        &self.output,
                        cancellation,
                        progress,
                    ),
                }
            }
            (None, false) => exporter.export_project_cancellable(
                &load(&self.source)?,
                asset_root(&self.source),
                &self.output,
                cancellation,
                progress,
            ),
        }
    }
}

/// Where a project's relative asset paths resolve from.
fn asset_root(project_path: &Path) -> &Path {
    project_path.parent().unwrap_or_else(|| Path::new("."))
}
