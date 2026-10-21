//! Media probing and frame decoding through the linked FFmpeg libraries
//! (`ez-ffmpeg`).

mod color;
mod converted;
mod decoder;
mod duck;
mod error;
mod ffmpeg;
mod loudness;
mod mix;
mod probe;
mod sequential;
mod stretch;
#[cfg(test)]
mod tests;
mod types;

pub use color::{DynamicRange, VideoColor};
pub use decoder::{AudioDecoder, VideoFrameDecoder};
pub use duck::{DuckCurves, audible_end};
pub use error::{AudioMixError, MediaError};
pub use ffmpeg::FfmpegBackend;
pub use loudness::{
    Loudness, LoudnessTarget, PeakHandling, TARGET_TOLERANCE_LU, measure_loudness,
    normalize_loudness,
};
pub use mix::{
    mix_audio_graph, mix_audio_graph_cancellable, mix_audio_graph_unclipped_cancellable,
    mix_audio_graph_with_ducks_cancellable,
};
pub use types::{AudioBuffer, AudioStream, MediaProbe, VideoFrame, VideoStream};
