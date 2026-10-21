use crate::options::{VideoEncoding, VideoFormat};
use celesta_composition::TimeError;
use celesta_evaluator::EvaluationError;
use celesta_gpu_renderer::GpuRenderError;
use celesta_media::AudioMixError;
use celesta_project::LoadError;
use celesta_react_bridge::{PropertyInputError, ReactBridgeError};
use std::error::Error;
use std::path::PathBuf;
use std::{fmt, io};

#[derive(Debug)]
pub enum ExportError {
    Project(LoadError),
    Evaluation(EvaluationError),
    Render(GpuRenderError),
    Audio(AudioMixError),
    React(ReactBridgeError),
    /// `--props` or `--props-file` is not a readable JSON object.
    Properties(PropertyInputError),
    Time(TimeError),
    Io {
        operation: &'static str,
        source: io::Error,
    },
    Ffmpeg {
        stage: &'static str,
        source: ez_ffmpeg::error::Error,
    },
    OutputExists(PathBuf),
    /// The still frame selection, its output name or quality, or its
    /// contact sheet layout cannot be exported.
    InvalidSelection(String),
    /// The output path's extension is not the one `format` writes.
    UnsupportedOutput {
        path: PathBuf,
        format: VideoFormat,
    },
    /// The subtitle file's extension is neither `.srt` nor `.vtt`.
    UnsupportedSubtitles(PathBuf),
    /// Subtitles in several languages would go to one file, a path without
    /// `{lang}`.
    MixedSubtitleLanguages {
        path: PathBuf,
        /// Each language, `(none)` for subtitles without one.
        languages: Vec<String>,
    },
    /// An export with neither a video nor a subtitle file to write.
    NoOutput,
    /// The linked FFmpeg build lacks an encoder `format` needs.
    EncoderUnavailable {
        format: VideoFormat,
        encoder: &'static str,
    },
    UnsupportedDimensions {
        width: u32,
        height: u32,
    },
    /// [`VideoEncoding::crf`] is above [`VideoEncoding::MAX_CRF`].
    InvalidCrf(u8),
    EmptyTimeline,
    /// The requested export range, once clamped to the composition and
    /// snapped to frames, covers zero frames.
    EmptyRange,
    Cancelled,
    TimelineTooLong,
    /// One composition frame could not be evaluated, rendered or written.
    Frame(Box<FrameFailure>),
    /// A contact sheet was written with failure tiles in place of the frames
    /// in `failures`, which could not be evaluated or rendered; the others
    /// rendered.
    FramesFailed {
        path: PathBuf,
        /// Tiles on the sheet, failed ones included.
        frames: usize,
        failures: Vec<FrameFailure>,
    },
}

/// Why zero-based composition frame `frame` failed.
#[derive(Debug)]
pub struct FrameFailure {
    pub frame: u64,
    pub error: ExportError,
}

impl ExportError {
    /// `self` as the failure of composition frame `frame`.
    pub(crate) fn at_frame(self, frame: u64) -> Self {
        match self {
            Self::Cancelled | Self::Frame(_) => self,
            error => Self::Frame(Box::new(FrameFailure { frame, error })),
        }
    }

    /// Whether the error is about one frame's content, so the frames after
    /// it can still be evaluated and rendered: a scene that failed to
    /// evaluate or render, not a React runtime that stopped answering, a GPU
    /// or readback failure, or a file that could not be written.
    pub(crate) fn is_frame_scoped(&self) -> bool {
        match self {
            Self::Evaluation(_)
            | Self::React(ReactBridgeError::Render(_) | ReactBridgeError::InvalidDuck { .. }) => {
                true
            }
            Self::Render(error) => error.is_scene_error(),
            _ => false,
        }
    }
}

impl fmt::Display for FrameFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "frame {}: {}", self.frame, self.error)
    }
}

impl fmt::Display for ExportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Project(error) => write!(formatter, "could not load export project: {error}"),
            Self::Evaluation(error) => write!(formatter, "could not evaluate export: {error}"),
            Self::Render(error) => write!(formatter, "could not render export: {error}"),
            Self::Audio(error) => write!(formatter, "could not mix export audio: {error}"),
            Self::React(error) => write!(formatter, "could not evaluate React export: {error}"),
            Self::Properties(error) => {
                write!(formatter, "could not read project properties: {error}")
            }
            Self::Time(error) => write!(formatter, "could not calculate export time: {error}"),
            Self::Io { operation, source } => write!(formatter, "could not {operation}: {source}"),
            Self::Ffmpeg { stage, source } => {
                write!(formatter, "FFmpeg {stage} failed: {source}")
            }
            Self::OutputExists(path) => {
                write!(formatter, "output already exists: {}", path.display())
            }
            Self::InvalidSelection(message) => {
                write!(formatter, "could not export still frames: {message}")
            }
            Self::UnsupportedOutput { path, format } => write!(
                formatter,
                "export output must use the .{format} extension: {}",
                path.display()
            ),
            Self::UnsupportedSubtitles(path) => write!(
                formatter,
                "subtitles must use the .srt or .vtt extension: {}",
                path.display()
            ),
            Self::MixedSubtitleLanguages { path, languages } => write!(
                formatter,
                "subtitles in several languages ({}) cannot share one file: {}",
                languages.join(", "),
                path.display()
            ),
            Self::NoOutput => {
                formatter.write_str("an export needs a video output or a subtitle file to write")
            }
            Self::EncoderUnavailable { format, encoder } => write!(
                formatter,
                "this FFmpeg build has no {encoder} encoder, which {format} export needs"
            ),
            Self::UnsupportedDimensions { width, height } => write!(
                formatter,
                "video export requires non-zero even dimensions, got {width}x{height}"
            ),
            Self::InvalidCrf(crf) => write!(
                formatter,
                "H.264 CRF must be between 0 and {}, got {crf}",
                VideoEncoding::MAX_CRF
            ),
            Self::EmptyTimeline => formatter.write_str("cannot export an empty timeline"),
            Self::EmptyRange => {
                formatter.write_str("the requested export range does not cover any frames")
            }
            Self::Cancelled => formatter.write_str("export was cancelled"),
            Self::TimelineTooLong => formatter.write_str("export timeline is too long"),
            Self::Frame(failure) => failure.fmt(formatter),
            Self::FramesFailed {
                path,
                frames,
                failures,
            } => {
                write!(
                    formatter,
                    "{} of {frames} contact sheet frames failed; {} shows them as failed tiles:",
                    failures.len(),
                    path.display()
                )?;
                for failure in failures {
                    write!(formatter, "\n  {failure}")?;
                }
                Ok(())
            }
        }
    }
}

impl Error for ExportError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Project(error) => Some(error),
            Self::Evaluation(error) => Some(error),
            Self::Render(error) => Some(error),
            Self::Audio(error) => Some(error),
            Self::React(error) => Some(error),
            Self::Properties(error) => Some(error),
            Self::Time(error) => Some(error),
            Self::Io { source, .. } => Some(source),
            Self::Ffmpeg { source, .. } => Some(source),
            Self::Frame(failure) => Some(&failure.error),
            Self::OutputExists(_)
            | Self::InvalidSelection(_)
            | Self::UnsupportedOutput { .. }
            | Self::UnsupportedSubtitles(_)
            | Self::MixedSubtitleLanguages { .. }
            | Self::NoOutput
            | Self::EncoderUnavailable { .. }
            | Self::UnsupportedDimensions { .. }
            | Self::InvalidCrf(_)
            | Self::EmptyTimeline
            | Self::EmptyRange
            | Self::Cancelled
            | Self::TimelineTooLong
            | Self::FramesFailed { .. } => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_failure_is_named_once() {
        let error = ExportError::EmptyTimeline.at_frame(4).at_frame(9);
        assert!(matches!(&error, ExportError::Frame(failure) if failure.frame == 4));
        assert_eq!(
            error.to_string(),
            "frame 4: cannot export an empty timeline"
        );
        assert!(matches!(
            ExportError::Cancelled.at_frame(4),
            ExportError::Cancelled
        ));
    }

    #[test]
    fn only_a_frames_own_content_lets_the_next_frame_render() {
        assert!(ExportError::React(ReactBridgeError::Render("bad fill".into())).is_frame_scoped());
        assert!(
            !ExportError::React(ReactBridgeError::UnexpectedExit {
                stderr: String::new()
            })
            .is_frame_scoped()
        );
        assert!(
            !ExportError::Io {
                operation: "publish image",
                source: io::Error::other("disk full"),
            }
            .is_frame_scoped()
        );
        assert!(!ExportError::Cancelled.is_frame_scoped());
    }

    #[test]
    fn a_gpu_failure_stops_a_contact_sheet_but_bad_content_does_not() {
        let shader = GpuRenderError::Shader {
            shader: "tint".to_owned(),
            message: "does not compile".to_owned(),
        };
        assert!(ExportError::Render(shader).is_frame_scoped());
        assert!(ExportError::Render(GpuRenderError::TooManyLayers(1 << 20)).is_frame_scoped());
        for error in [
            GpuRenderError::MapCallbackDropped,
            GpuRenderError::ReadbackThread(io::Error::other("no threads")),
            GpuRenderError::SurfaceValidation,
        ] {
            assert!(!ExportError::Render(error).is_frame_scoped());
        }
    }
}
