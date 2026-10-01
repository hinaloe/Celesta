use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::process::ExitCode;
use std::time::{Duration, Instant};

use celesta_exporter::{
    CompanionProject, ExportOptions, ExportProgress, ExportRange, Exporter, ReactRuntimeOptions,
    RenderQuality, VideoEncoding, parse_timecode,
};
use celesta_project::Project;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Celesta export: {error}");
            ExitCode::FAILURE
        }
    }
}

const USAGE: &str = "PNG: --frame <n> or --frames <n,n,...> [--output-format png] <output.png>\nMultiple frames use output-000090.png names; frame numbers are zero-based.\nusage: celesta-exporter [--overwrite] [--from <timecode>] [--to <timecode>] [--preset <preset>] [--crf <crf>] [--color-conversion <where>] [--render-quality <quality>] <project.celesta.json> <output.mp4>\n       celesta-exporter [--overwrite] [--from <timecode>] [--to <timecode>] [--preset <preset>] [--crf <crf>] [--color-conversion <where>] [--render-quality <quality>] --react <entry.tsx> [--project <project.celesta.json>] <output.mp4>\n\ntimecode is HH:MM:SS(.mmm), MM:SS(.mmm) or SS(.mmm); --from/--to select a\nspan of the composition to export (the output starts at its own 00:00).\n--preset is a libx264 preset (ultrafast … veryslow, default medium): faster\npresets encode faster but produce larger files. --crf is 0-51 (default 18);\nlower is higher quality. --color-conversion (auto, gpu, or encoder; default\nauto) picks where RGB frames become YUV: auto uses the GPU unless it is a\nsoftware renderer. --render-quality (draft or final, default final) sets how\ncarefully scaled and rotated layers are drawn; draft skips re-rasterizing\nscaled text and is meant for quick checks of timing, not of pixels.";

fn run() -> Result<(), String> {
    let mut frames = Vec::<u64>::new();
    let mut output_format = None;
    let mut overwrite = false;
    let mut react = false;
    let mut companion_project_path: Option<OsString> = None;
    let mut from: Option<OsString> = None;
    let mut to: Option<OsString> = None;
    let mut video = VideoEncoding::default();
    let mut render_quality = RenderQuality::default();
    let mut paths = Vec::<OsString>::new();
    let mut arguments = std::env::args_os().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == "--frame" || argument == "--frames" {
            let value = arguments.next().ok_or(USAGE)?;
            for item in value
                .to_str()
                .ok_or("frame selection is not valid UTF-8")?
                .split(',')
            {
                frames.push(item.parse().map_err(|_| {
                    format!("invalid frame {item:?}; use zero-based non-negative integers")
                })?);
            }
        } else if argument == "--output-format" {
            let value = arguments.next().ok_or(USAGE)?;
            if value != "png" && value != "mp4" {
                return Err("--output-format must be png or mp4".into());
            }
            output_format = Some(value);
        } else if argument == "--overwrite" {
            overwrite = true;
        } else if argument == "--react" {
            react = true;
        } else if argument == "--project" {
            companion_project_path = Some(arguments.next().ok_or(USAGE)?);
        } else if argument == "--from" {
            from = Some(arguments.next().ok_or(USAGE)?);
        } else if argument == "--to" {
            to = Some(arguments.next().ok_or(USAGE)?);
        } else if argument == "--preset" {
            let value = arguments.next().ok_or(USAGE)?;
            video.preset = value
                .to_str()
                .ok_or("--preset is not valid UTF-8")?
                .parse()
                .map_err(|error| format!("--preset: {error}"))?;
        } else if argument == "--color-conversion" {
            let value = arguments.next().ok_or(USAGE)?;
            video.color_conversion = value
                .to_str()
                .ok_or("--color-conversion is not valid UTF-8")?
                .parse()
                .map_err(|error| format!("--color-conversion: {error}"))?;
        } else if argument == "--render-quality" {
            let value = arguments.next().ok_or(USAGE)?;
            render_quality = value
                .to_str()
                .ok_or("--render-quality is not valid UTF-8")?
                .parse()
                .map_err(|error| format!("--render-quality: {error}"))?;
        } else if argument == "--crf" {
            let value = arguments.next().ok_or(USAGE)?;
            video.crf = value
                .to_str()
                .and_then(|value| value.parse().ok())
                .filter(|crf| *crf <= VideoEncoding::MAX_CRF)
                .ok_or_else(|| {
                    format!(
                        "--crf must be an integer from 0 to {}",
                        VideoEncoding::MAX_CRF
                    )
                })?;
        } else {
            paths.push(argument);
        }
    }
    let [source, output] = paths.as_slice() else {
        return Err(USAGE.into());
    };
    if companion_project_path.is_some() && !react {
        return Err("--project requires --react".into());
    }
    if !frames.is_empty() && output_format.as_deref() == Some(OsStr::new("mp4")) {
        return Err("--frame/--frames requires PNG output".into());
    }
    let png = !frames.is_empty() || output_format.as_deref() == Some(OsStr::new("png"));
    if png && frames.is_empty() {
        return Err("PNG output requires --frame or --frames".into());
    }
    if png && (from.is_some() || to.is_some()) {
        return Err("--frame/--frames cannot be combined with --from/--to".into());
    }
    let range = export_range(from.as_deref(), to.as_deref())?;
    let exporter = Exporter::new(ExportOptions {
        overwrite,
        range,
        video,
        render_quality,
    });
    let mut rendering_started: Option<Instant> = None;
    let on_progress = |progress: ExportProgress| match progress {
        ExportProgress::Rendering { frame, total } => {
            // Reported as each frame starts, so `frame - 1` are done.
            let elapsed = rendering_started.get_or_insert_with(Instant::now).elapsed();
            // Trailing spaces clear what a longer previous line left behind.
            eprint!(
                "\rrendering frame {frame}/{total}  {}   ",
                rendering_rate(frame.saturating_sub(1), total, elapsed)
            );
            if frame == total {
                eprintln!();
            }
        }
        ExportProgress::MixingAudio => eprintln!("mixing audio"),
        ExportProgress::Muxing => eprintln!("muxing MP4"),
        // Replaces the unfinished progress line; the next frame redraws it
        // below.
        ExportProgress::Warning(warning) => eprintln!("\rwarning: {warning}"),
    };
    if png {
        let project_path = if react {
            companion_project_path.as_deref()
        } else {
            Some(source.as_os_str())
        };
        let project = project_path
            .map(|path| Project::load(Path::new(path)))
            .transpose()
            .map_err(|e| e.to_string())?;
        let root =
            project_path.map(|path| Path::new(path).parent().unwrap_or_else(|| Path::new(".")));
        if react {
            exporter
                .export_react_png(
                    Path::new(source),
                    &default_react_runtime(),
                    project
                        .as_ref()
                        .zip(root)
                        .map(|(project, project_asset_root)| CompanionProject {
                            project,
                            project_asset_root,
                        }),
                    &frames,
                    Path::new(output),
                    on_progress,
                )
                .map_err(|e| e.to_string())?;
        } else {
            exporter
                .export_project_png(
                    project.as_ref().ok_or("missing project")?,
                    root.ok_or("missing asset root")?,
                    &frames,
                    Path::new(output),
                    on_progress,
                )
                .map_err(|e| e.to_string())?;
        }
    } else if react {
        let runtime = default_react_runtime();
        match companion_project_path {
            Some(project_path) => {
                let project_path = Path::new(&project_path);
                let project = Project::load(project_path).map_err(|error| error.to_string())?;
                let project_asset_root = project_path.parent().unwrap_or_else(|| Path::new("."));
                exporter
                    .export_react_entry_with_project_and_progress(
                        source,
                        &runtime,
                        CompanionProject {
                            project: &project,
                            project_asset_root,
                        },
                        output,
                        on_progress,
                    )
                    .map_err(|error| error.to_string())?;
            }
            None => {
                exporter
                    .export_react_entry_with_progress(source, &runtime, output, on_progress)
                    .map_err(|error| error.to_string())?;
            }
        }
    } else {
        exporter
            .export_file_with_progress(source, output, on_progress)
            .map_err(|error| error.to_string())?;
    }
    eprintln!("export complete: {}", output.to_string_lossy());
    Ok(())
}

/// Throughput, elapsed time, and the estimated time left, so a slow export
/// can be told apart from a stalled one.
fn rendering_rate(done: u64, total: u64, elapsed: Duration) -> String {
    let seconds = elapsed.as_secs_f64();
    if done == 0 || seconds <= 0.0 {
        return format!("elapsed {}", clock(elapsed));
    }
    let fps = done as f64 / seconds;
    let remaining = Duration::from_secs_f64(total.saturating_sub(done) as f64 / fps);
    format!(
        "{fps:.1} fps  elapsed {}  eta {}",
        clock(elapsed),
        clock(remaining)
    )
}

fn clock(duration: Duration) -> String {
    let seconds = duration.as_secs();
    format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600,
        seconds / 60 % 60,
        seconds % 60
    )
}

/// Builds an [`ExportRange`] from the `--from` / `--to` timecodes. Returns
/// `None` when neither is given (export the whole composition). `--to` must
/// be strictly after `--from`.
fn export_range(from: Option<&OsStr>, to: Option<&OsStr>) -> Result<Option<ExportRange>, String> {
    let parse = |flag: &str, value: &OsStr| -> Result<celesta_composition::Time, String> {
        let text = value
            .to_str()
            .ok_or_else(|| format!("{flag} timecode is not valid UTF-8"))?;
        parse_timecode(text).map_err(|error| format!("{flag}: {error}"))
    };

    let start = from.map(|value| parse("--from", value)).transpose()?;
    let end = to.map(|value| parse("--to", value)).transpose()?;
    if start.is_none() && end.is_none() {
        return Ok(None);
    }

    if let (Some(start), Some(end)) = (start, end)
        && end
            .cmp_exact(start)
            .map_err(|error| error.to_string())?
            .is_le()
    {
        return Err("--to must be after --from".into());
    }

    Ok(Some(ExportRange {
        start: start.unwrap_or(celesta_composition::Time::ZERO),
        end,
    }))
}

fn default_react_runtime() -> ReactRuntimeOptions {
    let (node, cli_script) = celesta_react_bridge::runtime_paths();
    ReactRuntimeOptions::new(node, cli_script)
}
