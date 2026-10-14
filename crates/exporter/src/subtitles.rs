//! The SRT or WebVTT file a video export writes beside the video
//! (`ExportOptions::subtitles`): a React entry's `<Subtitles>` cues and
//! `<Dialogue>` lines, or a project's dialogue items, timed like the video.

use crate::error::ExportError;
use celesta_composition::TimeError;
use celesta_project::{Project, TimelineContent};
use celesta_react_bridge::ReactSubtitleDescriptor;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fmt::Write as _;
use std::io::{self, Write as _};
use std::path::Path;

/// The format of a subtitle file, chosen by its extension.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubtitleFormat {
    Srt,
    Vtt,
}

impl SubtitleFormat {
    pub const ALL: [Self; 2] = [Self::Srt, Self::Vtt];

    /// The file extension.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Srt => "srt",
            Self::Vtt => "vtt",
        }
    }

    /// The format whose extension `path` has, ignoring case.
    pub fn from_extension(path: &Path) -> Option<Self> {
        let extension = path.extension().and_then(OsStr::to_str)?;
        Self::ALL
            .into_iter()
            .find(|format| format.as_str().eq_ignore_ascii_case(extension))
    }
}

/// One subtitle of the written file, in seconds from the file's start.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Cue {
    pub(crate) start: f64,
    pub(crate) end: f64,
    pub(crate) text: String,
}

/// The exported span of the composition, in composition seconds: the file's
/// time 0 is `start`, and nothing after `start + duration` is shown.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Window {
    pub(crate) start: f64,
    pub(crate) duration: f64,
}

impl Window {
    /// `text` shown from `start` to `end` composition seconds, shifted to
    /// the file's clock and cut to the window; `None` outside it.
    fn cue(self, text: &str, start: f64, end: f64) -> Option<Cue> {
        let start = (start - self.start).max(0.0);
        let end = (end - self.start).min(self.duration);
        (end > start && !text.trim().is_empty()).then(|| Cue {
            start,
            end,
            text: text.to_owned(),
        })
    }
}

/// The cues a React entry's frames reported, each once, ordered by start.
/// A subtitle is reported by every frame that shows it, with the same
/// numbers each time, so equal reports are one subtitle.
pub(crate) fn react_cues(reports: &[ReactSubtitleDescriptor], window: Window) -> Vec<Cue> {
    let mut seen = HashSet::new();
    let mut cues: Vec<Cue> = reports
        .iter()
        .filter(|report| seen.insert((&report.text, report.start.to_bits(), report.end.to_bits())))
        .filter_map(|report| window.cue(&report.text, report.start, report.end))
        .collect();
    cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    cues
}

/// The project's dialogue items on enabled tracks, ordered by start.
pub(crate) fn project_cues(project: &Project, window: Window) -> Result<Vec<Cue>, TimeError> {
    let mut cues = Vec::new();
    for track in project
        .tracks
        .iter()
        .filter(|track| track.enabled != Some(false))
    {
        for item in track
            .items
            .iter()
            .filter(|item| item.enabled != Some(false))
        {
            if let TimelineContent::Dialogue { text, .. } = &item.content {
                let start = item.range.start.as_seconds()?;
                let end = item.range.end()?.as_seconds()?;
                cues.extend(window.cue(text, start, end));
            }
        }
    }
    cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    Ok(cues)
}

/// The file's text. SRT cues are numbered from 1; blank lines inside a cue
/// are dropped, since they would end it, and WebVTT escapes `&`, `<`, `>`.
/// `parseSubtitles()` in `@celesta/react` reads it back.
pub(crate) fn format(cues: &[Cue], format: SubtitleFormat) -> String {
    let mut output = String::new();
    if format == SubtitleFormat::Vtt {
        output.push_str("WEBVTT\n\n");
    }
    let mut number = 0;
    for cue in cues {
        let text = cue_text(&cue.text, format);
        if text.is_empty() {
            continue;
        }
        if number > 0 {
            output.push('\n');
        }
        number += 1;
        if format == SubtitleFormat::Srt {
            let _ = writeln!(output, "{number}");
        }
        let _ = writeln!(
            output,
            "{} --> {}\n{text}",
            timestamp(cue.start, format),
            timestamp(cue.end, format)
        );
    }
    output
}

fn cue_text(text: &str, format: SubtitleFormat) -> String {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect();
    let text = lines.join("\n");
    match format {
        SubtitleFormat::Srt => text,
        SubtitleFormat::Vtt => text
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;"),
    }
}

/// `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (WebVTT), rounded to the millisecond.
fn timestamp(seconds: f64, format: SubtitleFormat) -> String {
    let total = (seconds * 1000.0).round().max(0.0) as u64;
    let separator = match format {
        SubtitleFormat::Srt => ',',
        SubtitleFormat::Vtt => '.',
    };
    format!(
        "{:02}:{:02}:{:02}{separator}{:03}",
        total / 3_600_000,
        total / 60_000 % 60,
        total / 1000 % 60,
        total % 1000
    )
}

/// The format `path` is written in, failing before anything renders when
/// its extension is neither `.srt` nor `.vtt` or, without `overwrite`, when
/// it exists.
pub(crate) fn check_output(path: &Path, overwrite: bool) -> Result<SubtitleFormat, ExportError> {
    let format = SubtitleFormat::from_extension(path)
        .ok_or_else(|| ExportError::UnsupportedSubtitles(path.to_owned()))?;
    if !overwrite && path.exists() {
        return Err(ExportError::OutputExists(path.to_owned()));
    }
    Ok(format)
}

/// Writes `cues` to `path` as its extension says, all at once, and returns
/// the format it wrote.
pub(crate) fn write(
    path: &Path,
    cues: &[Cue],
    overwrite: bool,
) -> Result<SubtitleFormat, ExportError> {
    let format = check_output(path, overwrite)?;
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let io_error = |operation| move |source| ExportError::Io { operation, source };
    std::fs::create_dir_all(parent).map_err(io_error("create subtitle directory"))?;
    let mut file = tempfile::Builder::new()
        .prefix(".celesta-export-")
        .suffix(&format!(".{}", format.as_str()))
        .tempfile_in(parent)
        .map_err(io_error("create temporary subtitles"))?;
    file.write_all(self::format(cues, format).as_bytes())
        .map_err(io_error("write subtitles"))?;
    if overwrite {
        file.persist(path)
    } else {
        file.persist_noclobber(path)
    }
    .map_err(|error| {
        if error.error.kind() == io::ErrorKind::AlreadyExists {
            ExportError::OutputExists(path.to_owned())
        } else {
            ExportError::Io {
                operation: "publish subtitles",
                source: error.error,
            }
        }
    })?;
    Ok(format)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(text: &str, start: f64, end: f64) -> ReactSubtitleDescriptor {
        ReactSubtitleDescriptor {
            text: text.to_owned(),
            start,
            end,
        }
    }

    fn cue(text: &str, start: f64, end: f64) -> Cue {
        Cue {
            start,
            end,
            text: text.to_owned(),
        }
    }

    const WHOLE: Window = Window {
        start: 0.0,
        duration: f64::INFINITY,
    };

    #[test]
    fn repeated_reports_are_one_cue_in_start_order() {
        let reports = [
            report("second", 2.0, 3.0),
            report("first", 0.5, 1.5),
            report("second", 2.0, 3.0),
            report("first", 0.5, 1.5),
            report("  ", 0.0, 1.0),
        ];
        assert_eq!(
            react_cues(&reports, WHOLE),
            [cue("first", 0.5, 1.5), cue("second", 2.0, 3.0)]
        );
    }

    #[test]
    fn a_range_shifts_cues_and_cuts_them_to_the_exported_span() {
        let reports = [
            report("before", 0.0, 1.0),
            report("across start", 1.5, 2.5),
            report("inside", 3.0, 4.0),
            report("across end", 4.5, 6.0),
            report("after", 5.0, 6.0),
        ];
        let window = Window {
            start: 2.0,
            duration: 3.0,
        };
        assert_eq!(
            react_cues(&reports, window),
            [
                cue("across start", 0.0, 0.5),
                cue("inside", 1.0, 2.0),
                cue("across end", 2.5, 3.0),
            ]
        );
    }

    #[test]
    fn project_dialogue_items_on_enabled_tracks_are_cues() {
        let item = |id: &str, start: i64, text: &str, enabled: &str| {
            format!(
                r#"{{"id": "{id}", {enabled} "range": {{"start": {{"value": {start}, "timescale": 2}}, "duration": {{"value": 1, "timescale": 1}}}},
                "content": {{"type": "dialogue", "character": "akane", "text": "{text}"}}}}"#
            )
        };
        let json = format!(
            r#"{{
                "version": 0,
                "settings": {{"width": 64, "height": 64, "frameRate": {{"numerator": 30, "denominator": 1}}, "sampleRate": 48000}},
                "assets": {{}},
                "characters": {{"akane": {{"name": "Akane"}}}},
                "tracks": [
                    {{"id": "a", "name": "A", "kind": "dialogue", "items": [{}, {}, {}]}},
                    {{"id": "b", "name": "B", "kind": "dialogue", "enabled": false, "items": [{}]}}
                ],
                "properties": {{}}
            }}"#,
            item("late", 4, "Later", ""),
            item("early", 1, "First", ""),
            item("off", 0, "Disabled item", r#""enabled": false,"#),
            item("hidden", 0, "Disabled track", ""),
        );
        let project = Project::from_json(&json).unwrap();
        let window = Window {
            start: 1.0,
            duration: 2.0,
        };
        assert_eq!(
            project_cues(&project, window).unwrap(),
            [cue("First", 0.0, 0.5), cue("Later", 1.0, 2.0)]
        );
    }

    #[test]
    fn srt_numbers_cues_and_drops_blank_lines() {
        let cues = [
            cue("Hello\n\nworld & <you>", 0.0, 1.5),
            cue("\n", 1.5, 2.0),
            cue("An hour in", 3600.0, 3600.0334),
        ];
        assert_eq!(
            format(&cues, SubtitleFormat::Srt),
            "1\n00:00:00,000 --> 00:00:01,500\nHello\nworld & <you>\n\n\
             2\n01:00:00,000 --> 01:00:00,033\nAn hour in\n"
        );
    }

    #[test]
    fn webvtt_has_a_header_and_escapes_markup() {
        let cues = [cue("a < b && c > d", 61.25, 62.0)];
        assert_eq!(
            format(&cues, SubtitleFormat::Vtt),
            "WEBVTT\n\n00:01:01.250 --> 00:01:02.000\na &lt; b &amp;&amp; c &gt; d\n"
        );
        assert_eq!(format(&[], SubtitleFormat::Vtt), "WEBVTT\n\n");
        assert_eq!(format(&[], SubtitleFormat::Srt), "");
    }

    #[test]
    fn the_extension_picks_the_format() {
        assert_eq!(
            SubtitleFormat::from_extension(Path::new("a.SRT")),
            Some(SubtitleFormat::Srt)
        );
        assert_eq!(
            SubtitleFormat::from_extension(Path::new("a.vtt")),
            Some(SubtitleFormat::Vtt)
        );
        assert_eq!(SubtitleFormat::from_extension(Path::new("a.ass")), None);
        assert!(matches!(
            check_output(Path::new("captions.txt"), false),
            Err(ExportError::UnsupportedSubtitles(_))
        ));
    }

    #[test]
    fn write_keeps_an_existing_file_without_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/captions.srt");
        write(&path, &[cue("one", 0.0, 1.0)], false).unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "1\n00:00:00,000 --> 00:00:01,000\none\n"
        );
        assert!(matches!(
            write(&path, &[], false),
            Err(ExportError::OutputExists(_))
        ));
        write(&path, &[], true).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "");
    }
}
