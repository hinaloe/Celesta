use super::*;

fn invalid(message: impl Into<String>) -> ExportError {
    ExportError::Io {
        operation: "export PNG frames",
        source: io::Error::new(io::ErrorKind::InvalidInput, message.into()),
    }
}

/// Resolves deterministic PNG paths and validates all selections before rendering.
fn outputs(
    frames: &[u64],
    total: u64,
    output: &Path,
    overwrite: bool,
) -> Result<Vec<PathBuf>, ExportError> {
    if frames.is_empty() {
        return Err(invalid("select at least one frame"));
    }
    if output.extension() != Some(OsStr::new("png")) {
        return Err(invalid("PNG output must use the .png extension"));
    }
    let mut seen = HashSet::new();
    let mut paths = Vec::new();
    for &frame in frames {
        if frame >= total || frame > i64::MAX as u64 {
            return Err(invalid(format!(
                "frame {frame} is out of range; composition has {total} frames (zero-based)"
            )));
        }
        if !seen.insert(frame) {
            return Err(invalid(format!("duplicate frame {frame}")));
        }
        let path = if frames.len() == 1 {
            output.to_owned()
        } else {
            let mut name = output
                .file_stem()
                .ok_or_else(|| invalid("missing output filename"))?
                .to_os_string();
            name.push(format!("-{frame:06}.png"));
            output.with_file_name(name)
        };
        if !overwrite && path.exists() {
            return Err(ExportError::OutputExists(path));
        }
        paths.push(path);
    }
    Ok(paths)
}

fn publish(
    frame: &celesta_gpu_renderer::GpuFrame,
    path: &Path,
    overwrite: bool,
) -> Result<(), ExportError> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|source| ExportError::Io {
        operation: "create output directory",
        source,
    })?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|source| ExportError::Io {
        operation: "create temporary PNG",
        source,
    })?;
    {
        let mut encoder = png::Encoder::new(file.as_file_mut(), frame.width(), frame.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| ExportError::Io {
            operation: "encode PNG",
            source: io::Error::other(e),
        })?;
        writer
            .write_image_data(frame.pixels())
            .map_err(|e| ExportError::Io {
                operation: "encode PNG",
                source: io::Error::other(e),
            })?;
        writer.finish().map_err(|e| ExportError::Io {
            operation: "finish PNG",
            source: io::Error::other(e),
        })?;
    }
    if overwrite {
        file.persist(path)
    } else {
        file.persist_noclobber(path)
    }
    .map_err(|e| {
        if e.error.kind() == io::ErrorKind::AlreadyExists {
            ExportError::OutputExists(path.to_owned())
        } else {
            ExportError::Io {
                operation: "publish PNG",
                source: e.error,
            }
        }
    })?;
    Ok(())
}

impl Exporter {
    /// Exports exact zero-based project frames without video encoding or audio mixing.
    /// Multiple selections append `-000090` style frame numbers to the output stem.
    pub fn export_project_png(
        &self,
        project: &Project,
        asset_root: &Path,
        frames: &[u64],
        output: &Path,
        mut progress: impl FnMut(ExportProgress),
    ) -> Result<(), ExportError> {
        if self.options.range.is_some() {
            return Err(invalid(
                "PNG frame selection cannot be combined with an export range",
            ));
        }
        let total = frame_count(
            project.effective_duration().map_err(ExportError::Time)?,
            project.settings.frame_rate,
        )?;
        let paths = outputs(frames, total, output, self.options.overwrite)?;
        let evaluator = Evaluator::new(project).map_err(ExportError::Evaluation)?;
        let mut renderer = export_renderer(
            asset_root,
            project.settings.frame_rate,
            ColorConversion::Encoder,
            self.options.render_quality,
        )?;
        let mut fallbacks = ReportedFontWarnings::default();
        for (index, (&frame, path)) in frames.iter().zip(&paths).enumerate() {
            progress(ExportProgress::Rendering {
                frame: index as u64 + 1,
                total: frames.len() as u64,
            });
            let time = Time::frames(frame as i64, project.settings.frame_rate)
                .map_err(ExportError::Time)?;
            let scene = evaluator.scene_at(time).map_err(ExportError::Evaluation)?;
            let rendered = renderer.render(&scene).map_err(ExportError::Render)?;
            report_font_fallbacks(&renderer, &mut fallbacks, &mut progress);
            publish(&rendered, path, self.options.overwrite)?;
        }
        Ok(())
    }

    /// Exports selected React frames with one runtime/prepare call and shared font/asset caches.
    pub fn export_react_png(
        &self,
        entry: &Path,
        runtime: &ReactRuntimeOptions,
        companion: Option<CompanionProject<'_>>,
        frames: &[u64],
        output: &Path,
        mut progress: impl FnMut(ExportProgress),
    ) -> Result<(), ExportError> {
        if self.options.range.is_some() {
            return Err(invalid(
                "PNG frame selection cannot be combined with an export range",
            ));
        }
        let asset_root = entry.parent().unwrap_or_else(|| Path::new("."));
        let asset_root = &fs::canonicalize(asset_root).unwrap_or_else(|_| asset_root.to_owned());
        let project_owned = companion.map(|c| {
            (
                c.project,
                fs::canonicalize(c.project_asset_root)
                    .unwrap_or_else(|_| c.project_asset_root.to_owned()),
            )
        });
        let project = project_owned.as_ref().map(|(p, root)| (*p, root.as_path()));
        let mut bridge = ReactBridge::spawn(&runtime.node, &runtime.cli_script, entry)
            .map_err(ExportError::React)?;
        let metadata = bridge.metadata().clone();
        let paths = outputs(
            frames,
            metadata.duration_in_frames,
            output,
            self.options.overwrite,
        )?;
        let filtered_project = project.map(|(project, _)| visual_only_project(project));
        let project_evaluator = filtered_project
            .as_ref()
            .map(Evaluator::new)
            .transpose()
            .map_err(ExportError::Evaluation)?;
        let project_asset_root = project.map(|(_, asset_root)| asset_root);
        let project_fonts = project_evaluator
            .as_ref()
            .map(|evaluator| -> Result<_, EvaluationError> {
                let mut fonts = evaluator.scene_at(Time::ZERO)?.fonts;
                if let Some(asset_root) = project_asset_root {
                    absolutize_fonts(&mut fonts, asset_root);
                }
                Ok(fonts)
            })
            .transpose()
            .map_err(ExportError::Evaluation)?
            .unwrap_or_default();

        let mut renderer = export_renderer(
            asset_root,
            metadata.frame_rate,
            ColorConversion::Encoder,
            self.options.render_quality,
        )?;
        let mut fallbacks = ReportedFontWarnings::default();
        for (index, (&frame, path)) in frames.iter().zip(&paths).enumerate() {
            progress(ExportProgress::Rendering {
                frame: index as u64 + 1,
                total: frames.len() as u64,
            });
            let time =
                Time::frames(frame as i64, metadata.frame_rate).map_err(ExportError::Time)?;
            let project_frame = project_evaluator
                .as_ref()
                .zip(filtered_project.as_ref())
                .map(
                    |(evaluator, filtered_project)| -> Result<_, EvaluationError> {
                        let mut scene = evaluator.scene_at(time)?;
                        let mut tracks = BTreeMap::new();
                        for track in &filtered_project.tracks {
                            let mut layers = evaluator.layers_for_track(&track.id, time)?;
                            if let Some(asset_root) = project_asset_root {
                                absolutize_layers(&mut layers, asset_root);
                            }
                            tracks.insert(track.id.clone(), layers);
                        }
                        if let Some(asset_root) = project_asset_root {
                            absolutize_layers(&mut scene.layers, asset_root);
                        }
                        Ok((scene.layers, tracks))
                    },
                )
                .transpose()
                .map_err(ExportError::Evaluation)?;
            let evaluation = bridge
                .evaluate_at(
                    time,
                    project_frame.as_ref().map(|(layers, tracks)| ProjectFrame {
                        layers: layers.as_slice(),
                        tracks,
                    }),
                )
                .map_err(ExportError::React)?;
            let mut scene = evaluation.scene;
            scene.fonts.extend(project_fonts.iter().cloned());

            let rendered = renderer.render(&scene).map_err(ExportError::Render)?;
            report_font_fallbacks(&renderer, &mut fallbacks, &mut progress);
            publish(&rendered, path, self.options.overwrite)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_first_last_and_out_of_range_frames() {
        assert_eq!(
            outputs(&[0, 89], 90, Path::new("check.png"), false).unwrap(),
            vec![
                PathBuf::from("check-000000.png"),
                PathBuf::from("check-000089.png")
            ]
        );
        assert!(
            outputs(&[90], 90, Path::new("check.png"), false)
                .unwrap_err()
                .to_string()
                .contains("frame 90 is out of range")
        );
        assert!(outputs(&[0], 0, Path::new("check.png"), false).is_err());
        assert!(outputs(&[u64::MAX], u64::MAX, Path::new("check.png"), false).is_err());
    }

    #[test]
    fn rejects_empty_duplicate_and_non_png_selections() {
        for frames in [&[][..], &[1, 1][..]] {
            assert!(outputs(frames, 90, Path::new("check.png"), false).is_err());
        }
        assert!(outputs(&[0], 90, Path::new("check.mp4"), false).is_err());
    }

    #[test]
    fn checks_every_output_before_rendering() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("check.png");
        let existing = dir.path().join("check-000089.png");
        fs::write(&existing, b"keep").unwrap();
        assert!(
            matches!(outputs(&[0, 89], 90, &output, false), Err(ExportError::OutputExists(path)) if path == existing)
        );
        assert!(outputs(&[0, 89], 90, &output, true).is_ok());
        assert_eq!(fs::read(existing).unwrap(), b"keep");
    }
}
