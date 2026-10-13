//! The `inspect` tool: evaluates a React entry's frames through the same
//! bridge an export uses, without rendering pixels, and summarizes them as
//! `inspect.mjs` does.

use std::fmt::Write;
use std::path::{Path, PathBuf};

use celesta_composition::{Rational, Time};
use celesta_exporter::report::{self, HintStyle};
use celesta_exporter::{ExportError, ReactRuntimeOptions};
use celesta_react_bridge::{FrameEvaluation, ReactBridge, ReactBridgeError, resolve_props_file};
use rmcp::model::{CallToolResult, ContentBlock};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::server::usage_error;
use crate::summary::{FileCheck, describe_frame, diff_scenes, fmt, format_value};

/// At most this many differences are printed per compared pair.
const LOOP_DIFFERENCE_LIMIT: usize = 20;

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InspectArgs {
    /// The React entry (`.tsx`) to inspect.
    entry: PathBuf,
    /// Zero-based frames to evaluate; negative numbers count from the end
    /// (`-1` is the last frame). Default: the first, middle, and last frames.
    frames: Option<Vec<i64>>,
    /// Evaluate every `n`th frame, plus the last one, instead of `frames`.
    every: Option<u64>,
    /// Check a seamless loop instead: compare the frame after the last
    /// (evaluated as if the video went on) with frame 0, and the next with 1.
    #[serde(rename = "loop", default)]
    loop_check: bool,
    /// Project property values, over the props file's.
    props: Option<Map<String, Value>>,
    /// The props file; default: the entry's `props.json`.
    props_file: Option<PathBuf>,
}

pub fn inspect(args: InspectArgs) -> CallToolResult {
    if args.frames.is_some() && args.every.is_some() {
        return usage_error("pass frames or every, not both");
    }
    if args.every == Some(0) {
        return usage_error("every must be at least 1");
    }
    let entry = std::path::absolute(&args.entry).unwrap_or_else(|_| args.entry.clone());
    let props = args.props.map(|props| Value::Object(props).to_string());
    let failed = |error: ExportError| {
        let choice = resolve_props_file(&entry, args.props_file.as_deref());
        let (report, _) = report::build(&entry, choice, HintStyle::Mcp, |_| Err(error));
        CallToolResult::structured_error(serde_json::to_value(report).expect("reports serialize"))
    };
    let runtime = match ReactRuntimeOptions::for_entry(
        &entry,
        args.props_file.as_deref(),
        props.as_deref(),
    ) {
        Ok(runtime) => runtime,
        Err(error) => return failed(error),
    };
    let bridge = ReactBridge::spawn_with_properties(
        &runtime.node,
        &runtime.cli_script,
        &entry,
        &runtime.properties,
    );
    let mut bridge = match bridge {
        Ok(bridge) => bridge,
        Err(error) => return failed(ExportError::React(error)),
    };
    let entry_dir = entry.parent().unwrap_or_else(|| Path::new(".")).to_owned();
    let mut inspection = Inspection::new(&bridge, entry_dir);
    if args.loop_check {
        inspection.check_loop(&mut bridge);
    } else {
        let frames = inspection.select(args.frames.as_deref(), args.every);
        inspection.evaluate(&mut bridge, &frames);
    }
    inspection.finish()
}

struct Inspection {
    frame_rate: Rational,
    total: u64,
    entry_dir: PathBuf,
    text: String,
    composition: Value,
    frames: Vec<Value>,
    loop_check: Option<Value>,
    warnings: Vec<String>,
    missing: Vec<String>,
    problems: usize,
}

impl Inspection {
    fn new(bridge: &ReactBridge, entry_dir: PathBuf) -> Self {
        let metadata = bridge.metadata();
        let rate = metadata.frame_rate;
        let fps = f64::from(rate.numerator) / f64::from(rate.denominator);
        let total = metadata.duration_in_frames;
        let mut text = format!(
            "composition: {}×{} @ {} fps, {total} frames ({} s)\n",
            metadata.width,
            metadata.height,
            fmt(fps),
            fmt(total as f64 / fps)
        );
        if !metadata.component_schemas.is_empty() {
            let names: Vec<&str> = metadata
                .component_schemas
                .keys()
                .map(String::as_str)
                .collect();
            let _ = writeln!(
                text,
                "registered components with schemas: {}",
                names.join(", ")
            );
        }
        if metadata.project_property_schema.is_some() {
            let _ = writeln!(
                text,
                "project properties: {}",
                metadata.project_property_order.join(", ")
            );
        }
        let mut warnings = Vec::new();
        if !metadata.width.is_multiple_of(2) || !metadata.height.is_multiple_of(2) {
            warnings.push(format!(
                "width/height {}×{} must be even for MP4 export",
                metadata.width, metadata.height
            ));
        }
        Self {
            frame_rate: rate,
            total,
            entry_dir,
            text,
            composition: json!({
                "width": metadata.width,
                "height": metadata.height,
                "fps": fps,
                "frames": total,
                "duration": total as f64 / fps,
            }),
            frames: Vec::new(),
            loop_check: None,
            warnings,
            missing: Vec::new(),
            problems: 0,
        }
    }

    fn seconds(&self, frame: u64) -> f64 {
        frame as f64 * f64::from(self.frame_rate.denominator) / f64::from(self.frame_rate.numerator)
    }

    fn time(&self, frame: u64) -> Option<Time> {
        Time::frames(i64::try_from(frame).ok()?, self.frame_rate).ok()
    }

    /// The frames to evaluate, as `inspect.mjs` picks them: repeats and
    /// frames outside the composition are dropped.
    fn select(&self, frames: Option<&[i64]>, every: Option<u64>) -> Vec<u64> {
        let total = self.total;
        let wanted: Vec<i64> = match (frames, every) {
            (_, Some(step)) => {
                let mut frames: Vec<i64> = (0..total)
                    .step_by(step as usize)
                    .map(|f| f as i64)
                    .collect();
                if total > 0 && frames.last() != Some(&(total as i64 - 1)) {
                    frames.push(total as i64 - 1);
                }
                frames
            }
            (Some(frames), None) => frames.to_vec(),
            (None, None) => vec![0, (total / 2) as i64, total as i64 - 1],
        };
        let mut selected = Vec::new();
        for frame in wanted {
            let frame = if frame < 0 {
                total as i64 + frame
            } else {
                frame
            };
            if let Ok(frame) = u64::try_from(frame)
                && frame < total
                && !selected.contains(&frame)
            {
                selected.push(frame);
            }
        }
        selected
    }

    fn evaluate(&mut self, bridge: &mut ReactBridge, frames: &[u64]) {
        for &frame in frames {
            let _ = write!(
                self.text,
                "\n── frame {frame} ({} s) ──\n",
                fmt(self.seconds(frame))
            );
            let evaluated = match self.time(frame) {
                Some(time) => bridge.evaluate_at(time, None),
                None => Err(ReactBridgeError::Render(format!(
                    "frame {frame} is out of range"
                ))),
            };
            match evaluated {
                Ok(evaluation) => self.describe(frame, &evaluation),
                Err(error) => {
                    self.problems += 1;
                    let fatal = is_fatal(&error);
                    let message = message(&error);
                    let _ = writeln!(self.text, "ERROR: {message}");
                    self.frames.push(
                        json!({ "frame": frame, "time": self.seconds(frame), "error": message }),
                    );
                    if fatal {
                        break;
                    }
                }
            }
        }
    }

    fn describe(&mut self, frame: u64, evaluation: &FrameEvaluation) {
        let scene = serde_json::to_value(&evaluation.scene).expect("scenes serialize");
        let audio: Vec<Value> = evaluation
            .audio
            .iter()
            .map(|clip| serde_json::to_value(clip).expect("audio clips serialize"))
            .collect();
        let mut files = FileCheck::new(&self.entry_dir);
        let lines = describe_frame(&scene, &audio, &mut files, &mut self.warnings);
        self.text.push_str(&lines);
        for src in &files.missing {
            if !self.missing.contains(src) {
                self.missing.push(src.clone());
            }
        }
        self.frames.push(json!({
            "frame": frame,
            "time": self.seconds(frame),
            "layers": scene["layers"],
            "audio": audio,
            "missingFiles": files.missing,
        }));
    }

    fn check_loop(&mut self, bridge: &mut ReactBridge) {
        let total = self.total;
        self.text.push_str(
            "loop check: frames after the last are evaluated as if the video went on, then compared with the start\n\n",
        );
        let mut pairs = Vec::new();
        for start in if total > 1 { vec![0, 1] } else { vec![0] } {
            let label = format!("frame {} vs frame {start}", total + start);
            let first = self.time(start).map(|time| bridge.evaluate_at(time, None));
            let past = self
                .time(total + start)
                .map(|time| bridge.evaluate_past_end(time));
            let (Some(first), Some(past)) = (first, past) else {
                continue;
            };
            match (first, past) {
                (Ok(first), Ok(past)) => {
                    let first = serde_json::to_value(&first.scene).expect("scenes serialize");
                    let past = serde_json::to_value(&past.scene).expect("scenes serialize");
                    let differences = diff_scenes(&past, &first);
                    self.problems += differences.len();
                    if differences.is_empty() {
                        let _ = writeln!(self.text, "{label}: same Scene");
                    } else {
                        let _ = writeln!(self.text, "{label}: {} difference(s)", differences.len());
                        for difference in differences.iter().take(LOOP_DIFFERENCE_LIMIT) {
                            let at = if difference.path.is_empty() {
                                "(scene)"
                            } else {
                                &difference.path
                            };
                            let _ = writeln!(
                                self.text,
                                "  {at}: {} at frame {}, {} at frame {start}",
                                format_value(difference.end.as_ref()),
                                total + start,
                                format_value(difference.start.as_ref()),
                            );
                        }
                        if differences.len() > LOOP_DIFFERENCE_LIMIT {
                            let _ = writeln!(
                                self.text,
                                "  … and {} more (structuredContent lists them all)",
                                differences.len() - LOOP_DIFFERENCE_LIMIT
                            );
                        }
                    }
                    pairs.push(json!({ "frame": total + start, "against": start, "differences": differences }));
                }
                (Err(error), _) | (_, Err(error)) => {
                    self.problems += 1;
                    let _ = writeln!(self.text, "{label}: ERROR: {}", message(&error));
                    pairs.push(json!({ "frame": total + start, "against": start, "error": message(&error) }));
                }
            }
        }
        self.loop_check = Some(json!({ "seamless": self.problems == 0, "pairs": pairs }));
    }

    fn finish(mut self) -> CallToolResult {
        self.problems += self.missing.len();
        self.text.push('\n');
        let mut warnings = Vec::new();
        for warning in &self.warnings {
            if !warnings.contains(warning) {
                warnings.push(warning.clone());
            }
        }
        for warning in &warnings {
            let _ = writeln!(self.text, "warning: {warning}");
        }
        for src in &self.missing {
            let _ = writeln!(
                self.text,
                "missing: {src} (relative paths resolve from {})",
                self.entry_dir.display()
            );
        }
        let summary = match (&self.loop_check, self.problems) {
            (Some(_), 0) => "OK: the last frame runs into the first (picture only; sound is not compared)".to_owned(),
            (Some(_), _) if self.missing.is_empty() => {
                "The loop has a seam: the frames above should match. Sound is not compared; see read_docs topic loops."
                    .to_owned()
            }
            (None, 0) => "OK: entry loads and every inspected frame evaluates".to_owned(),
            (_, problems) => format!("{problems} problem(s) found"),
        };
        self.text.push_str(&summary);
        let mut value = json!({
            "composition": self.composition,
            "warnings": warnings,
            "missingFiles": self.missing,
        });
        match self.loop_check {
            Some(loop_check) => value["loop"] = loop_check,
            None => value["frames"] = Value::Array(self.frames),
        }
        let mut result = if self.problems == 0 {
            CallToolResult::success(vec![ContentBlock::text(self.text)])
        } else {
            CallToolResult::error(vec![ContentBlock::text(self.text)])
        };
        result.structured_content = Some(value);
        result
    }
}

/// Whether the runtime is gone or out of step after `error`, as
/// `Celesta-export --inspect` decides it.
fn is_fatal(error: &ReactBridgeError) -> bool {
    !matches!(
        error,
        ReactBridgeError::Render(_)
            | ReactBridgeError::Time(_)
            | ReactBridgeError::OpenEndUnsupported
    )
}

/// The entry's own message for errors it raised; the bridge's otherwise.
fn message(error: &ReactBridgeError) -> String {
    match error {
        ReactBridgeError::EntryFailed(message) | ReactBridgeError::Render(message) => {
            message.clone()
        }
        error => error.to_string(),
    }
}
