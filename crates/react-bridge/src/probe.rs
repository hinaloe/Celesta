use celesta_composition::{Rational, Time};
use celesta_media::{AudioStream, DynamicRange, MediaProbe, VideoColor, VideoStream};
use celesta_renderer::image_source::AnimationInfo;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub(crate) struct MediaProbeRequest {
    /// A local path, or an `http`/`https` URL.
    pub(crate) path: String,
}

#[derive(Serialize)]
pub(crate) struct MediaProbeResponse<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) media: Option<MediaProbePayload<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaProbePayload<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) duration_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) video: Option<VideoProbePayload<'a>>,
    pub(crate) audio: Vec<AudioProbePayload<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) animation: Option<AnimationProbePayload>,
}

/// An animated GIF, APNG, or WebP, which FFmpeg does not read the way
/// `<Image>` draws it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnimationProbePayload {
    pub(crate) frame_count: usize,
    pub(crate) duration_seconds: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoProbePayload<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) codec: Option<&'a str>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) frame_rate: Option<Rational>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) duration_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) color: Option<ColorProbePayload<'a>>,
    /// `pq` or `hlg` for HDR video.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) hdr: Option<&'static str>,
}

#[derive(Serialize)]
pub(crate) struct ColorProbePayload<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) primaries: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) transfer: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) matrix: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioProbePayload<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) codec: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) sample_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) channels: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) duration_seconds: Option<f64>,
}

pub(crate) fn media_probe_payload(probe: &MediaProbe) -> MediaProbePayload<'_> {
    MediaProbePayload {
        duration_seconds: seconds(probe.duration),
        video: probe.video.as_ref().map(video_probe_payload),
        audio: probe.audio.iter().map(audio_probe_payload).collect(),
        animation: None,
    }
}

pub(crate) fn animation_probe_payload(animation: &AnimationInfo) -> MediaProbePayload<'static> {
    MediaProbePayload {
        duration_seconds: Some(animation.duration_seconds),
        video: Some(VideoProbePayload {
            codec: None,
            width: animation.width,
            height: animation.height,
            frame_rate: None,
            duration_seconds: Some(animation.duration_seconds),
            color: None,
            hdr: None,
        }),
        audio: Vec::new(),
        animation: Some(AnimationProbePayload {
            frame_count: animation.frame_count,
            duration_seconds: animation.duration_seconds,
        }),
    }
}

pub(crate) fn video_probe_payload(video: &VideoStream) -> VideoProbePayload<'_> {
    VideoProbePayload {
        codec: video.codec.as_deref(),
        width: video.width,
        height: video.height,
        frame_rate: video.frame_rate,
        duration_seconds: seconds(video.duration),
        color: color_probe_payload(&video.color),
        hdr: match video.color.dynamic_range() {
            DynamicRange::Sdr => None,
            DynamicRange::Pq => Some("pq"),
            DynamicRange::Hlg => Some("hlg"),
        },
    }
}

/// `None` for a stream with no color tags at all.
fn color_probe_payload(color: &VideoColor) -> Option<ColorProbePayload<'_>> {
    (*color != VideoColor::default()).then_some(ColorProbePayload {
        primaries: color.primaries.as_deref(),
        transfer: color.transfer.as_deref(),
        matrix: color.matrix.as_deref(),
    })
}

pub(crate) fn audio_probe_payload(audio: &AudioStream) -> AudioProbePayload<'_> {
    AudioProbePayload {
        codec: audio.codec.as_deref(),
        sample_rate: audio.sample_rate,
        channels: audio.channels,
        duration_seconds: seconds(audio.duration),
    }
}

pub(crate) fn seconds(time: Option<Time>) -> Option<f64> {
    time.and_then(|time| time.as_seconds().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(color: VideoColor) -> VideoStream {
        VideoStream {
            index: 0,
            codec: Some("hevc".to_owned()),
            width: 1920,
            height: 1080,
            frame_rate: None,
            duration: None,
            color,
        }
    }

    #[test]
    fn reports_color_tags_and_hdr() {
        let hlg = video(VideoColor {
            primaries: Some("bt2020".to_owned()),
            transfer: Some("arib-std-b67".to_owned()),
            matrix: Some("bt2020nc".to_owned()),
        });
        assert_eq!(
            serde_json::to_value(video_probe_payload(&hlg)).unwrap(),
            serde_json::json!({
                "codec": "hevc",
                "width": 1920,
                "height": 1080,
                "color": { "primaries": "bt2020", "transfer": "arib-std-b67", "matrix": "bt2020nc" },
                "hdr": "hlg",
            })
        );
        // An untagged stream reports neither.
        assert_eq!(
            serde_json::to_value(video_probe_payload(&video(VideoColor::default()))).unwrap(),
            serde_json::json!({ "codec": "hevc", "width": 1920, "height": 1080 })
        );
    }
}
