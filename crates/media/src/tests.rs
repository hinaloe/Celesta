use crate::color::{DynamicRange, VideoColor};
use crate::decoder::{AudioDecoder, VideoFrameDecoder};
use crate::error::{AudioMixError, MediaError};
use crate::ffmpeg::FfmpegBackend;
use crate::mix::{frame_byte_len, mix_audio_graph, mix_audio_graph_cancellable};
use crate::sequential::path_to_url;
use crate::types::AudioBuffer;
use celesta_composition::{AudioGraph, Rational, Time};
use ez_ffmpeg::Input;
use std::path::{Path, PathBuf};

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use celesta_composition::{Animatable, AssetLocation, AudioClip, ResolvedAsset, TimeRange};
use ez_ffmpeg::{FfmpegContext, Output};

/// Renders a synthetic `lavfi` source to a lossless MKV fixture through
/// the linked FFmpeg libraries, forcing the output frame rate so the
/// container records a real frame-duration hint.
fn generate_clip(path: &Path, lavfi: &str, fps: (i32, i32)) {
    FfmpegContext::builder()
        .input(Input::from(lavfi).set_format("lavfi"))
        .output(
            Output::from(path_to_url(path))
                .set_video_codec("ffv1")
                .set_framerate(fps.0, fps.1),
        )
        .build()
        .unwrap()
        .start()
        .unwrap()
        .wait()
        .unwrap();
}

fn fixture_dir(label: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "celesta-media-{label}-{}-{suffix}",
        std::process::id()
    ));
    fs::create_dir_all(&directory).unwrap();
    directory
}

#[test]
fn probes_stream_metadata_as_exact_rational_time() {
    let directory = fixture_dir("probe");
    let clip = directory.join("clip.mkv");
    generate_clip(&clip, "testsrc2=size=320x240:rate=25:duration=1", (25, 1));

    let mut backend = FfmpegBackend::new();
    let probe = backend.probe(&clip).unwrap();
    let video = probe.video.clone().unwrap();
    assert_eq!(video.frame_rate, Some(Rational::new(25, 1)));
    assert_eq!((video.width, video.height), (320, 240));
    let seconds = probe.duration.unwrap().as_seconds().unwrap();
    assert!((0.9..=1.1).contains(&seconds), "probed duration {seconds}");

    fs::remove_dir_all(&directory).ok();
}

#[test]
fn reports_a_missing_source_with_its_path() {
    let path = Path::new("/definitely-not-a-real/celesta-media.mkv");
    let mut backend = FfmpegBackend::new();
    for error in [
        backend.probe(path).err().unwrap(),
        backend.decode_frame(path, 0.0).err().unwrap(),
        backend.decode_audio(path, 48_000, 2).err().unwrap(),
    ] {
        assert!(matches!(&error, MediaError::NotFound(missing) if missing == path));
        assert_eq!(
            error.to_string(),
            "media file /definitely-not-a-real/celesta-media.mkv was not found"
        );
    }
}

#[test]
fn validates_rgba_frame_sizes() {
    assert_eq!(frame_byte_len(1920, 1080).unwrap(), 8_294_400);
}

#[test]
fn freezes_on_the_last_frame_past_the_source_end() {
    // A one-second, 64x64 testsrc clip whose content visibly changes
    // over time (so "the last frame" is distinguishable from the first).
    let directory = fixture_dir("eof");
    let clip = directory.join("clip.mkv");
    generate_clip(&clip, "testsrc=size=64x64:rate=10:duration=1", (10, 1));

    // One-shot decoding far past the end clamps to the source's final
    // frame instead of failing with an unexpected frame size, and that
    // frozen frame is a real decoded frame (different from the first).
    let mut backend = FfmpegBackend::new();
    let first = backend.decode_frame(&clip, 0.0).unwrap();
    let overrun = backend.decode_frame(&clip, 60.0).unwrap();
    assert_eq!((overrun.width, overrun.height), (64, 64));
    assert_ne!(overrun.pixels, first.pixels);

    // Sequential sessions freeze the same way while playback walks past
    // the end, and repeated tail requests keep returning identical
    // pixels.
    let mut sequential = FfmpegBackend::new().with_sequential_video(Rational::new(10, 1));
    let mut previous = sequential.decode_frame_for("clip", &clip, 0.0).unwrap();
    for step in 1..40 {
        previous = sequential
            .decode_frame_for("clip", &clip, f64::from(step) * 0.1)
            .unwrap_or_else(|error| panic!("frame {step} should decode: {error}"));
    }
    let tail_a = sequential.decode_frame_for("clip", &clip, 9.9).unwrap();
    let tail_b = sequential.decode_frame_for("clip", &clip, 30.3).unwrap();
    assert_eq!(tail_a.pixels, tail_b.pixels);
    assert_eq!(tail_a.pixels, previous.pixels);

    fs::remove_dir_all(&directory).ok();
}

#[test]
fn loops_video_from_its_first_frame_past_the_source_end() {
    let directory = fixture_dir("loop");
    let clip = directory.join("clip.mkv");
    generate_clip(&clip, "testsrc=size=64x64:rate=10:duration=1", (10, 1));

    let mut backend = FfmpegBackend::new();
    let duration = backend.video_duration(&clip).unwrap().unwrap();
    assert!((duration - 1.0).abs() < 1e-9, "video duration {duration}");
    // The last frame still shows just before the end; at the end, and a
    // whole pass later, the first one does again.
    assert!((backend.loop_source_time(&clip, 0.95).unwrap() - 0.95).abs() < 1e-9);
    assert!(backend.loop_source_time(&clip, 1.0).unwrap().abs() < 1e-9);
    assert!((backend.loop_source_time(&clip, 2.3).unwrap() - 0.3).abs() < 1e-9);

    let mut sequential = FfmpegBackend::new().with_sequential_video(Rational::new(10, 1));
    let first = sequential.decode_frame_for("clip", &clip, 0.0).unwrap();
    let third = sequential.decode_frame_for("clip", &clip, 0.2).unwrap();
    let wrapped = sequential.loop_source_time(&clip, 1.0).unwrap();
    assert_eq!(
        sequential
            .decode_frame_for("clip", &clip, wrapped)
            .unwrap()
            .pixels,
        first.pixels
    );
    let wrapped = sequential.loop_source_time(&clip, 2.2).unwrap();
    assert_eq!(
        sequential
            .decode_frame_for("clip", &clip, wrapped)
            .unwrap()
            .pixels,
        third.pixels
    );

    fs::remove_dir_all(&directory).ok();
}

/// A 10-bit limited-range gray clip of luma code `luma`, tagged BT.2020
/// with `transfer`.
fn generate_hdr_clip(path: &Path, luma: u16, transfer: &str) {
    generate_clip(
        path,
        &format!(
            "color=s=32x16:r=10:d=1,format=yuv420p10le,geq=lum={luma}:cb=512:cr=512,\
             setparams=color_primaries=bt2020:color_trc={transfer}:colorspace=bt2020nc:range=tv"
        ),
        (10, 1),
    );
}

fn center_pixel(frame: &crate::VideoFrame) -> [u8; 4] {
    let offset = ((frame.height / 2 * frame.width + frame.width / 2) * 4) as usize;
    frame.pixels[offset..offset + 4].try_into().unwrap()
}

#[test]
fn probes_and_tone_maps_hdr_video_like_chrome() {
    let directory = fixture_dir("hdr");
    // Luma 573 is PQ's 203 nits and 721 HLG's 75% signal: both the HDR
    // reference white, which Chrome draws at half of SDR white's light.
    for (name, luma, transfer, range) in [
        ("pq.mkv", 573, "smpte2084", DynamicRange::Pq),
        ("hlg.mkv", 721, "arib-std-b67", DynamicRange::Hlg),
    ] {
        let clip = directory.join(name);
        generate_hdr_clip(&clip, luma, transfer);

        let mut backend = FfmpegBackend::new();
        let video = backend.probe(&clip).unwrap().video.clone().unwrap();
        assert_eq!(
            video.color,
            VideoColor {
                primaries: Some("bt2020".to_owned()),
                transfer: Some(transfer.to_owned()),
                matrix: Some("bt2020nc".to_owned()),
            }
        );
        assert_eq!(video.color.dynamic_range(), range);

        let frame = backend.decode_frame(&clip, 0.5).unwrap();
        assert_eq!((frame.width, frame.height), (32, 16));
        let [r, g, b, a] = center_pixel(&frame);
        assert!(
            [r, g, b].iter().all(|channel| channel.abs_diff(188) <= 2) && a == 255,
            "{name} reference white decoded as {:?}",
            [r, g, b, a]
        );

        // Sequential playback converts the same way, frame after frame.
        let mut sequential = FfmpegBackend::new().with_sequential_video(Rational::new(10, 1));
        for step in 0..10 {
            let next = sequential
                .decode_frame_for("clip", &clip, f64::from(step) * 0.1)
                .unwrap_or_else(|error| panic!("{name} frame {step} should decode: {error}"));
            assert_eq!(next.pixels, frame.pixels, "{name} frame {step}");
        }
        assert_eq!(sequential.sequential_video_processes_started(), 1);
    }
    fs::remove_dir_all(&directory).ok();
}

#[test]
fn leaves_sdr_video_on_the_packed_path() {
    let directory = fixture_dir("sdr-color");
    let clip = directory.join("clip.mkv");
    generate_clip(
        &clip,
        "color=c=0x949494:s=32x16:r=10:d=1,format=yuv420p,\
         setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
        (10, 1),
    );
    let mut backend = FfmpegBackend::new();
    let video = backend.probe(&clip).unwrap().video.clone().unwrap();
    assert_eq!(video.color.dynamic_range(), DynamicRange::Sdr);
    assert_eq!(video.color.conversion(), None);
    let frame = backend.decode_frame(&clip, 0.0).unwrap();
    let [r, g, b, _] = center_pixel(&frame);
    assert!([r, g, b].iter().all(|channel| channel.abs_diff(148) <= 1));
    fs::remove_dir_all(&directory).ok();
}

#[test]
fn decodes_aac_without_the_encoder_padding_after_its_last_sample() {
    let directory = fixture_dir("aac");
    let tone = directory.join("tone.m4a");
    // One second is 46.875 AAC frames, so the encoder pads the last one.
    FfmpegContext::builder()
        .input(Input::from("sine=frequency=440:sample_rate=48000:duration=1").set_format("lavfi"))
        .output(Output::from(path_to_url(&tone)).set_audio_codec("aac"))
        .build()
        .unwrap()
        .start()
        .unwrap()
        .wait()
        .unwrap();

    let audio = FfmpegBackend::new().decode_audio(&tone, 48_000, 2).unwrap();
    assert_eq!(audio.frame_count(), 48_000);

    fs::remove_dir_all(&directory).ok();
}

#[test]
fn mixes_audio_at_exact_timeline_and_source_offsets() {
    struct Decoder;

    impl AudioDecoder for Decoder {
        fn decode_audio(
            &mut self,
            path: &Path,
            sample_rate: u32,
            channels: u16,
        ) -> Result<AudioBuffer, MediaError> {
            assert_eq!(path, Path::new("assets/voice.wav"));
            assert_eq!((sample_rate, channels), (4, 2));
            Ok(AudioBuffer {
                sample_rate,
                channels,
                samples: [0.0_f32, 0.25, 0.5, 0.75, 1.0]
                    .into_iter()
                    .flat_map(|sample| [sample, sample])
                    .collect(),
            })
        }
    }

    let mut graph = AudioGraph {
        sample_rate: 4,
        master_volume: 1.0,
        clips: vec![AudioClip {
            id: "voice".to_owned(),
            asset: ResolvedAsset {
                id: "voice".to_owned(),
                location: AssetLocation::File {
                    path: "voice.wav".to_owned(),
                },
            },
            range: TimeRange {
                start: Time::new(1, 2),
                duration: Time::new(1, 1),
            },
            source_start: Time::new(1, 4),
            source_duration: None,
            playback_rate: Animatable::Static(1.0),
            volume: Animatable::Static(0.5),
            muted: false,
            r#loop: false,
        }],
    };

    let mixed =
        mix_audio_graph(&graph, Path::new("assets"), Time::new(2, 1), &mut Decoder).unwrap();

    assert_eq!((mixed.sample_rate, mixed.channels), (4, 2));
    let left = mixed
        .samples
        .as_chunks::<2>()
        .0
        .iter()
        .map(|frame| frame[0])
        .collect::<Vec<_>>();
    assert_eq!(left, vec![0.0, 0.0, 0.125, 0.25, 0.375, 0.5, 0.0, 0.0]);

    graph.master_volume = 0.5;
    let quieter =
        mix_audio_graph(&graph, Path::new("assets"), Time::new(2, 1), &mut Decoder).unwrap();
    assert_eq!(quieter.samples[4], 0.0625);

    graph.master_volume = 1.0;
    graph.clips[0].source_duration = Some(Time::new(1, 2));
    let source_trimmed =
        mix_audio_graph(&graph, Path::new("assets"), Time::new(2, 1), &mut Decoder).unwrap();
    let left = source_trimmed
        .samples
        .as_chunks::<2>()
        .0
        .iter()
        .map(|frame| frame[0])
        .collect::<Vec<_>>();
    assert_eq!(left, vec![0.0, 0.0, 0.125, 0.25, 0.0, 0.0, 0.0, 0.0]);
}

#[test]
fn loops_audio_from_the_start_of_the_source_past_its_end() {
    struct Decoder;

    impl AudioDecoder for Decoder {
        fn decode_audio(
            &mut self,
            _: &Path,
            sample_rate: u32,
            channels: u16,
        ) -> Result<AudioBuffer, MediaError> {
            Ok(AudioBuffer {
                sample_rate,
                channels,
                samples: [0.0_f32, 0.25, 0.5, 0.75, 1.0]
                    .into_iter()
                    .flat_map(|sample| [sample, sample])
                    .collect(),
            })
        }
    }

    let mut graph = AudioGraph {
        sample_rate: 4,
        master_volume: 1.0,
        clips: vec![AudioClip {
            id: "loop".to_owned(),
            asset: ResolvedAsset {
                id: "loop".to_owned(),
                location: AssetLocation::File {
                    path: "loop.wav".to_owned(),
                },
            },
            range: TimeRange {
                start: Time::ZERO,
                duration: Time::new(2, 1),
            },
            source_start: Time::new(1, 1),
            source_duration: None,
            playback_rate: Animatable::Static(1.0),
            volume: Animatable::Static(1.0),
            muted: false,
            r#loop: true,
        }],
    };
    let left = |graph: &AudioGraph| {
        mix_audio_graph(graph, Path::new("assets"), Time::new(2, 1), &mut Decoder)
            .unwrap()
            .samples
            .as_chunks::<2>()
            .0
            .iter()
            .map(|frame| frame[0])
            .collect::<Vec<_>>()
    };

    // `startFrom` one second into a 1.25 s source: its last sample, then
    // the source again from its first.
    assert_eq!(
        left(&graph),
        vec![1.0, 0.0, 0.25, 0.5, 0.75, 1.0, 0.0, 0.25]
    );

    // Between samples, the last one blends into the first.
    graph.clips[0].source_start = Time::new(9, 8);
    assert_eq!(left(&graph)[0], 0.5);

    graph.clips[0].source_start = Time::new(1, 1);
    graph.clips[0].r#loop = false;
    assert_eq!(left(&graph), vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
}

#[test]
fn cancels_audio_mix_before_decoding() {
    struct Decoder;

    impl AudioDecoder for Decoder {
        fn decode_audio(&mut self, _: &Path, _: u32, _: u16) -> Result<AudioBuffer, MediaError> {
            panic!("cancelled mixes must not decode audio");
        }
    }

    let error = mix_audio_graph_cancellable(
        &AudioGraph {
            sample_rate: 48_000,
            master_volume: 1.0,
            clips: Vec::new(),
        },
        Path::new("assets"),
        Time::new(1, 1),
        &mut Decoder,
        || true,
    )
    .unwrap_err();

    assert!(matches!(error, AudioMixError::Cancelled));
}
