use crate::error::MediaError;
use crate::types::{AudioBuffer, VideoFrame};
use std::path::Path;

pub trait VideoFrameDecoder: Send {
    fn decode_frame(
        &mut self,
        path: &Path,
        source_time_seconds: f64,
    ) -> Result<VideoFrame, MediaError>;

    fn decode_frame_for(
        &mut self,
        request_id: &str,
        path: &Path,
        source_time_seconds: f64,
    ) -> Result<VideoFrame, MediaError> {
        let _ = request_id;
        self.decode_frame(path, source_time_seconds)
    }

    /// Seconds one pass through the video at `path` lasts, or `None` when
    /// that is not known.
    fn video_duration(&mut self, path: &Path) -> Result<Option<f64>, MediaError> {
        let _ = path;
        Ok(None)
    }

    /// The time into the video at `path` that a clip looping it shows at
    /// `source_time_seconds`: past the end, the time into its next pass. A
    /// video of unknown length holds its last frame instead.
    fn loop_source_time(
        &mut self,
        path: &Path,
        source_time_seconds: f64,
    ) -> Result<f64, MediaError> {
        Ok(match self.video_duration(path)? {
            Some(duration) if duration > 0.0 => source_time_seconds.rem_euclid(duration),
            _ => source_time_seconds,
        })
    }
}

pub trait AudioDecoder {
    fn decode_audio(
        &mut self,
        path: &Path,
        sample_rate: u32,
        channels: u16,
    ) -> Result<AudioBuffer, MediaError>;
}
