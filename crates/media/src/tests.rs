use crate::color::{DynamicRange, VideoColor};
use crate::decoder::{AudioDecoder, VideoFrameDecoder};
use crate::error::{AudioMixError, MediaError};
use crate::ffmpeg::FfmpegBackend;
use crate::mix::{frame_byte_len, mix_audio_graph, mix_audio_graph_cancellable};
use crate::probe::displayed_size;
use crate::sequential::path_to_url;
use crate::stretch::needs_stretch;
use crate::types::{AudioBuffer, VideoFrame};
use celesta_composition::{AudioGraph, Rational, Time};
use ez_ffmpeg::Input;
use std::path::{Path, PathBuf};

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use celesta_composition::{
    Animatable, AssetLocation, AudioClip, Keyframe, KeyframeAnimation, KeyframeAnimationType,
    ResolvedAsset, TimeRange, integrate_f64,
};
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

/// Rewrites the identity matrix in a MOV's track header (`tkhd`) to the
/// display matrix a portrait iPhone recording carries: show the coded
/// frame rotated 90° clockwise. This is what `ffmpeg -display_rotation`
/// changes, and the mov muxer has no other way to be told it.
fn tag_portrait_rotation(path: &Path) {
    const IDENTITY: [u32; 9] = [0x1_0000, 0, 0, 0, 0x1_0000, 0, 0, 0, 0x4000_0000];
    const PORTRAIT: [u32; 9] = [0, 0x1_0000, 0, 0xFFFF_0000, 0, 0, 0, 0, 0x4000_0000];
    let encode = |matrix: [u32; 9]| -> Vec<u8> {
        matrix
            .iter()
            .flat_map(|value| value.to_be_bytes())
            .collect()
    };
    let identity = encode(IDENTITY);
    let mut bytes = fs::read(path).unwrap();
    let tkhd = bytes
        .windows(4)
        .position(|window| window == b"tkhd")
        .expect("MOV has a track header");
    let offset = tkhd
        + bytes[tkhd..]
            .windows(identity.len())
            .position(|window| window == identity)
            .expect("track header has an identity matrix");
    bytes[offset..offset + identity.len()].copy_from_slice(&encode(PORTRAIT));
    fs::write(path, bytes).unwrap();
}

/// `frame`'s RGBA pixels turned 90° clockwise.
fn rotate_clockwise(frame: &VideoFrame) -> Vec<u8> {
    let (width, height) = (frame.width as usize, frame.height as usize);
    let mut rotated = Vec::with_capacity(frame.pixels.len());
    for y in 0..width {
        for x in 0..height {
            let source = ((height - 1 - x) * width + y) * 4;
            rotated.extend_from_slice(&frame.pixels[source..source + 4]);
        }
    }
    rotated
}

#[test]
fn probes_and_decodes_a_rotated_video_at_its_displayed_size() {
    // A 64x32 coding tagged like a portrait iPhone recording displays as
    // 32x64, and FFmpeg's autorotation delivers its frames that way.
    let directory = fixture_dir("rotated");
    let plain = directory.join("plain.mov");
    let rotated = directory.join("rotated.mov");
    generate_clip(&plain, "testsrc=size=64x32:rate=10:duration=1", (10, 1));
    fs::copy(&plain, &rotated).unwrap();
    tag_portrait_rotation(&rotated);

    let mut backend = FfmpegBackend::new();
    let video = backend.probe(&rotated).unwrap().video.clone().unwrap();
    assert_eq!((video.width, video.height), (32, 64));

    let upright = rotate_clockwise(&backend.decode_frame(&plain, 0.5).unwrap());
    let one_shot = backend.decode_frame(&rotated, 0.5).unwrap();
    assert_eq!((one_shot.width, one_shot.height), (32, 64));
    assert_eq!(*one_shot.pixels, upright);

    let mut sequential = FfmpegBackend::new().with_sequential_video(Rational::new(10, 1));
    let mut frame = None;
    for step in 0..=5 {
        frame = Some(
            sequential
                .decode_frame_for("clip", &rotated, f64::from(step) * 0.1)
                .unwrap_or_else(|error| panic!("frame {step} should decode: {error}")),
        );
    }
    let frame = frame.unwrap();
    assert_eq!((frame.width, frame.height), (32, 64));
    assert_eq!(*frame.pixels, upright);

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
fn tone_maps_a_rotated_hdr_video_at_its_displayed_size() {
    // The HDR conversion decodes through its own filter graph; autorotation
    // turns its frames too, so they must match the rotated probe.
    let directory = fixture_dir("rotated-hdr");
    let clip = directory.join("pq.mov");
    generate_hdr_clip(&clip, 573, "smpte2084");
    tag_portrait_rotation(&clip);

    let mut backend = FfmpegBackend::new();
    let video = backend.probe(&clip).unwrap().video.clone().unwrap();
    assert_eq!(video.color.dynamic_range(), DynamicRange::Pq);
    assert_eq!((video.width, video.height), (16, 32));

    let frame = backend.decode_frame(&clip, 0.5).unwrap();
    assert_eq!((frame.width, frame.height), (16, 32));
    let [r, g, b, _] = center_pixel(&frame);
    assert!(
        [r, g, b].iter().all(|channel| channel.abs_diff(188) <= 2),
        "reference white decoded as {:?}",
        [r, g, b]
    );

    let mut sequential = FfmpegBackend::new().with_sequential_video(Rational::new(10, 1));
    for step in 0..=5 {
        let next = sequential
            .decode_frame_for("clip", &clip, f64::from(step) * 0.1)
            .unwrap_or_else(|error| panic!("frame {step} should decode: {error}"));
        assert_eq!(next.pixels, frame.pixels, "frame {step}");
    }

    fs::remove_dir_all(&directory).ok();
}

#[test]
fn swaps_the_probed_size_for_quarter_turn_rotations_of_either_sign() {
    for rotate in [90, 270, -90, -270, 450] {
        assert_eq!(displayed_size(64, 32, rotate), (32, 64), "rotate {rotate}");
    }
    for rotate in [0, 180, -180, 360] {
        assert_eq!(displayed_size(64, 32, rotate), (64, 32), "rotate {rotate}");
    }
}

#[test]
fn names_the_decoded_size_in_a_frame_size_mismatch() {
    let error = MediaError::UnexpectedFrameSize {
        width: 360,
        height: 640,
        actual: 921_600,
        expected_width: 640,
        expected_height: 360,
        expected: 921_600,
    };
    assert_eq!(
        error.to_string(),
        "decoded 360x640 RGBA frame has 921600 bytes, expected 640x360 (921600 bytes)"
    );
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
            pitch: Animatable::Static(0.0),
            preserve_pitch: false,
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
            pitch: Animatable::Static(0.0),
            preserve_pitch: false,
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

/// Hands every clip the same in-memory source.
struct BufferDecoder(AudioBuffer);

impl AudioDecoder for BufferDecoder {
    fn decode_audio(&mut self, _: &Path, _: u32, _: u16) -> Result<AudioBuffer, MediaError> {
        Ok(self.0.clone())
    }
}

const RATE: u32 = 48_000;

fn seconds(value: f64) -> Time {
    Time::samples((value * f64::from(RATE)).round() as i64, RATE)
}

/// A 48 kHz stereo sine of amplitude 0.5 sounding over `[from_s, to_s)` of
/// a `total_s` source, silent elsewhere.
fn tone(hz: f64, from_s: f64, to_s: f64, total_s: f64) -> AudioBuffer {
    let frames = (total_s * f64::from(RATE)).round() as usize;
    let samples = (0..frames)
        .flat_map(|frame| {
            let time = frame as f64 / f64::from(RATE);
            let sample = if (from_s..to_s).contains(&time) {
                (0.5 * (std::f64::consts::TAU * hz * time).sin()) as f32
            } else {
                0.0
            };
            [sample, sample]
        })
        .collect();
    AudioBuffer {
        sample_rate: RATE,
        channels: 2,
        samples,
    }
}

fn clip(range_start_s: f64, duration_s: f64) -> AudioClip {
    AudioClip {
        id: "tone".to_owned(),
        asset: ResolvedAsset {
            id: "tone".to_owned(),
            location: AssetLocation::File {
                path: "tone.wav".to_owned(),
            },
        },
        range: TimeRange {
            start: seconds(range_start_s),
            duration: seconds(duration_s),
        },
        source_start: Time::ZERO,
        source_duration: None,
        playback_rate: Animatable::Static(1.0),
        volume: Animatable::Static(1.0),
        muted: false,
        r#loop: false,
        pitch: Animatable::Static(0.0),
        preserve_pitch: false,
    }
}

fn linear(from: f64, to: f64, over_s: f64) -> Animatable<f64> {
    Animatable::Keyframes(KeyframeAnimation {
        kind: KeyframeAnimationType::Keyframes,
        keyframes: vec![
            Keyframe {
                time: Time::ZERO,
                value: from,
                easing: None,
            },
            Keyframe {
                time: seconds(over_s),
                value: to,
                easing: None,
            },
        ],
    })
}

/// The left channel of a `duration_s` timeline holding only `clip`.
fn mix_left(clip: AudioClip, source: AudioBuffer, duration_s: f64) -> Vec<f32> {
    let graph = AudioGraph {
        sample_rate: RATE,
        master_volume: 1.0,
        clips: vec![clip],
    };
    mix_audio_graph(
        &graph,
        Path::new("assets"),
        seconds(duration_s),
        &mut BufferDecoder(source),
    )
    .unwrap()
    .samples
    .as_chunks::<2>()
    .0
    .iter()
    .map(|frame| frame[0])
    .collect()
}

fn window(left: &[f32], from_s: f64, to_s: f64) -> &[f32] {
    let frame = |time: f64| ((time * f64::from(RATE)).round() as usize).min(left.len());
    &left[frame(from_s)..frame(to_s)]
}

/// Rising zero crossings per second over `[from_s, to_s)`.
fn frequency(left: &[f32], from_s: f64, to_s: f64) -> f64 {
    let crossings = window(left, from_s, to_s)
        .windows(2)
        .filter(|pair| pair[0] < 0.0 && pair[1] >= 0.0)
        .count();
    crossings as f64 / (to_s - from_s)
}

fn onset(left: &[f32]) -> Option<usize> {
    left.iter().position(|sample| sample.abs() > 0.05)
}

fn rms(left: &[f32], from_s: f64, to_s: f64) -> f32 {
    let samples = window(left, from_s, to_s);
    (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
}

#[track_caller]
fn assert_near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= expected.abs() * tolerance,
        "{actual} is not within {}% of {expected}",
        tolerance * 100.0
    );
}

#[test]
fn fast_path_is_chosen_without_pitch_work() {
    let base = clip(0.0, 1.0);
    let with = |change: fn(&mut AudioClip)| {
        let mut clip = base.clone();
        change(&mut clip);
        needs_stretch(&clip)
    };

    assert!(!needs_stretch(&base));
    assert!(!with(|clip| clip.playback_rate = Animatable::Static(2.0)));
    assert!(!with(|clip| {
        clip.playback_rate = Animatable::Static(2.0);
        clip.pitch = Animatable::Static(0.0);
        clip.preserve_pitch = false;
    }));
    assert!(!with(|clip| clip.preserve_pitch = true));
    assert!(with(|clip| clip.pitch = Animatable::Static(1.0)));
    assert!(with(|clip| {
        clip.playback_rate = Animatable::Static(2.0);
        clip.preserve_pitch = true;
    }));
}

#[test]
fn pitch_up_an_octave_doubles_frequency() {
    let mut clip = clip(0.0, 1.0);
    clip.pitch = Animatable::Static(12.0);

    let left = mix_left(clip, tone(440.0, 0.0, 1.0, 1.0), 1.0);

    assert_near(frequency(&left, 0.2, 0.8), 880.0, 0.02);
}

#[test]
fn preserved_pitch_at_double_rate_halves_length() {
    let mut clip = clip(0.0, 1.0);
    clip.playback_rate = Animatable::Static(2.0);
    clip.preserve_pitch = true;

    let left = mix_left(clip, tone(440.0, 0.0, 0.5, 1.0), 1.0);

    assert_near(frequency(&left, 0.05, 0.2), 440.0, 0.02);
    assert!(rms(&left, 0.3, 1.0) < 0.01);
    assert!(rms(&left, 0.05, 0.2) > 0.2);
}

#[test]
fn tape_rate_with_pitch_down_an_octave_cancels() {
    let mut clip = clip(0.0, 1.0);
    clip.playback_rate = Animatable::Static(2.0);
    clip.pitch = Animatable::Static(-12.0);

    let left = mix_left(clip, tone(440.0, 0.0, 2.0, 2.0), 1.0);

    assert_near(frequency(&left, 0.2, 0.8), 440.0, 0.02);
}

#[test]
fn keyframed_pitch_rises_over_the_clip() {
    let mut clip = clip(0.0, 1.0);
    clip.pitch = linear(0.0, 12.0, 1.0);

    let left = mix_left(clip, tone(440.0, 0.0, 1.0, 1.0), 1.0);

    let first = frequency(&left, 0.05, 0.15);
    let last = frequency(&left, 0.85, 0.95);
    assert!(first < last, "{first} Hz does not rise to {last} Hz");
    assert_near(last, 440.0 * 2.0_f64.powf(0.9), 0.03);
}

#[test]
fn stretched_onset_matches_the_fast_path() {
    let source = tone(440.0, 0.25, 1.0, 1.0);
    let mut shifted = clip(0.0, 1.0);
    shifted.pitch = Animatable::Static(1.0);

    let fast = onset(&mix_left(clip(0.0, 1.0), source.clone(), 1.0)).unwrap();
    let stretched = onset(&mix_left(shifted, source, 1.0)).unwrap();

    assert!(
        fast.abs_diff(stretched) <= 240,
        "stretched onset {stretched} is not near {fast}"
    );
}

#[test]
fn stretched_clip_honors_loop_and_source_duration() {
    let mut looped = clip(0.0, 1.0);
    looped.r#loop = true;
    looped.pitch = Animatable::Static(12.0);
    let left = mix_left(looped, tone(440.0, 0.0, 0.25, 0.25), 1.0);
    assert!(rms(&left, 0.85, 0.95) > 0.2);

    let mut trimmed = clip(0.0, 1.0);
    trimmed.source_duration = Some(seconds(0.25));
    trimmed.pitch = Animatable::Static(12.0);
    let left = mix_left(trimmed, tone(440.0, 0.0, 1.0, 1.0), 1.0);
    assert!(rms(&left, 0.35, 1.0) < 0.01);
}

#[test]
fn cancels_a_stretched_clip_between_blocks() {
    let mut clip = clip(0.0, 2.0);
    clip.pitch = Animatable::Static(12.0);
    let graph = AudioGraph {
        sample_rate: RATE,
        master_volume: 1.0,
        clips: vec![clip],
    };
    let mut calls = 0;

    // Before the mix, per clip, after decoding, then the first block.
    let error = mix_audio_graph_cancellable(
        &graph,
        Path::new("assets"),
        seconds(2.0),
        &mut BufferDecoder(tone(440.0, 0.0, 2.0, 2.0)),
        || {
            calls += 1;
            calls >= 4
        },
    )
    .unwrap_err();

    assert!(matches!(error, AudioMixError::Cancelled));
}

#[test]
fn clamps_pitch_beyond_two_octaves() {
    let source = tone(110.0, 0.0, 1.0, 1.0);
    let mut beyond = clip(0.0, 1.0);
    beyond.pitch = Animatable::Static(48.0);
    let mut limit = clip(0.0, 1.0);
    limit.pitch = Animatable::Static(24.0);

    let beyond = frequency(&mix_left(beyond, source.clone(), 1.0), 0.2, 0.8);
    let limit = frequency(&mix_left(limit, source, 1.0), 0.2, 0.8);

    assert_near(beyond, limit, 0.02);
    assert_near(limit, 440.0, 0.02);
}

#[test]
fn short_stretched_clip_stays_inside_its_range() {
    // 240 frames, far fewer than the stretcher's latency.
    let mut clip = clip(0.1, 0.005);
    clip.pitch = Animatable::Static(12.0);

    let left = mix_left(clip, tone(440.0, 0.0, 1.0, 1.0), 0.2);

    assert_eq!(rms(&left, 0.0, 0.099), 0.0);
    assert_eq!(rms(&left, 0.106, 0.2), 0.0);
}

#[test]
fn stretched_clip_starting_before_zero_plays_from_its_offset() {
    let mut clip = clip(-0.5, 1.0);
    clip.pitch = Animatable::Static(1.0);

    let left = mix_left(clip, tone(440.0, 0.5, 1.0, 1.0), 0.5);

    let onset = onset(&left).unwrap();
    assert!(onset <= 240, "onset {onset} is not near frame 0");
}

#[test]
fn animated_rate_with_preserved_pitch_does_not_drift() {
    let mut clip = clip(0.0, 2.0);
    clip.playback_rate = linear(1.0, 2.0, 2.0);
    clip.preserve_pitch = true;
    // The first frame whose source position reaches the tone at 1.5 s.
    let expected = (0..2 * RATE as i64)
        .find(|&frame| {
            integrate_f64(&clip.playback_rate, Time::samples(frame, RATE)).unwrap() >= 1.5
        })
        .unwrap() as usize;

    let left = mix_left(clip, tone(440.0, 1.5, 3.0, 3.0), 2.0);

    // Stretching at a rate other than 1 smears the tone's attack over the
    // stretcher's window, so its first 10 % arrives ~12 ms early whatever the
    // drift; a drifting source position would move the half-level point too.
    let onset = left.iter().position(|sample| sample.abs() > 0.25).unwrap();
    assert!(
        onset.abs_diff(expected) <= 240,
        "onset {onset} is not near {expected}"
    );
}

#[test]
fn slow_rate_with_preserved_pitch_keeps_pitch_and_stays_continuous() {
    let mut clip = clip(0.0, 2.0);
    clip.playback_rate = Animatable::Static(0.5);
    clip.preserve_pitch = true;

    let left = mix_left(clip, tone(440.0, 0.0, 1.0, 1.0), 2.0);

    assert_near(frequency(&left, 0.2, 1.8), 440.0, 0.02);
    for start in (0..36).map(|index| 0.1 + f64::from(index) * 0.05) {
        let level = rms(&left, start, start + 0.05);
        assert!(level > 0.2, "rms {level} at {start} s");
    }
}
