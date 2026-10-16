use crate::EDITOR_DEMO_PROJECT;
use crate::audio::{AudioCacheKey, CachedAudioDecoder, take_latest};
use crate::audio_cache::DiskAudioCache;
use crate::editor_launch::{
    Invocation, LaunchError, default_opener, editor_invocation, editor_value,
    parse_login_shell_output, read_until_closing_marker, split_command,
};
use crate::export_worker::{ExportEvent, ExportRequest, ExportSource, ExportWorker};
use crate::helpers::{
    export_output, export_progress_label, export_range_for, export_suggested_name, loop_range_for,
};
use crate::layer_select::{
    SourceLookup, display_path, launch_outcome_applies, letterbox, scene_point, source_lookup,
    source_lookup_target, source_position,
};
use crate::react_audio::{react_audio_clip_id, react_tracks};
use crate::source::is_react_entry;
use crate::waveform::{
    clip_level_envelope, level_at_time, map_clip_waveform, master_volume_from_drag, waveform_peaks,
    waveform_segment,
};
use celesta_editor_core::ClipKind;
use celesta_gpu_renderer::GpuDriver;

use crate::preview::{
    ReactPreviewContext, ReactPreviewMode, collect_component_requests, records_hit_regions,
    splice_component_resolutions, strip_missing_components,
};
use celesta_composition::{
    Animatable, AssetLocation, AudioClip, EvaluatedTransform, GroupMask, Layer, LayerContent,
    LayerEffects, LayerFilter, LayerShader, MaskMode, Rational, ResolvedAsset, Scene, ShaderSource,
    Time, TimeRange,
};
use celesta_editor_core::ClipSummary;
use celesta_exporter::{ExportCancellation, ExportProgress, VideoFormat};
use celesta_media::{AudioBuffer, AudioDecoder};
use celesta_project::{Project, TrackKind};
use celesta_react_bridge::{ComponentResolutions, LayerSource};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[test]
fn background_workers_coalesce_queued_requests() {
    let (sender, receiver) = mpsc::channel();
    sender.send(2).unwrap();
    sender.send(3).unwrap();

    assert_eq!(take_latest(1, &receiver), 3);
}

#[test]
fn export_worker_reports_cancellation_without_creating_output() {
    let worker = ExportWorker::spawn().unwrap();
    let cancellation = ExportCancellation::default();
    cancellation.cancel();
    let output = std::env::temp_dir().join(format!(
        "celesta-cancelled-export-{}.mp4",
        std::process::id()
    ));
    let _ = fs::remove_file(&output);
    worker
        .request(ExportRequest {
            source: ExportSource::Project(Box::new(
                Project::from_json(EDITOR_DEMO_PROJECT).unwrap(),
            )),
            asset_root: PathBuf::from("examples"),
            output: output.clone(),
            format: VideoFormat::Mp4,
            range: None,
            cancellation,
            driver: GpuDriver::default(),
        })
        .unwrap();

    match worker.events.recv_timeout(Duration::from_secs(2)).unwrap() {
        ExportEvent::Finished {
            result, cancelled, ..
        } => {
            assert!(cancelled);
            assert_eq!(result.unwrap_err(), "export was cancelled");
        }
        ExportEvent::Progress(progress) => panic!("unexpected export progress: {progress:?}"),
    }
    assert!(!output.exists());
}

#[test]
fn open_recognizes_react_entries_but_not_projects() {
    assert!(is_react_entry(PathBuf::from("title.tsx").as_path()));
    assert!(is_react_entry(PathBuf::from("scene.mjs").as_path()));
    assert!(!is_react_entry(
        PathBuf::from("demo.celesta.json").as_path()
    ));
    assert!(!is_react_entry(PathBuf::from("notes.txt").as_path()));
}

#[test]
fn export_range_needs_both_markers_ordered() {
    let rate = Rational::new(30, 1);
    assert_eq!(export_range_for(None, Some(30), rate), None);
    assert_eq!(export_range_for(Some(30), None, rate), None);
    assert_eq!(export_range_for(Some(30), Some(30), rate), None);
    assert_eq!(export_range_for(Some(30), Some(20), rate), None);

    let range = export_range_for(Some(30), Some(90), rate).unwrap();
    assert_eq!(range.start, Time::frames(30, rate).unwrap());
    assert_eq!(range.end, Some(Time::frames(90, rate).unwrap()));
}

#[test]
fn loop_range_falls_back_when_marks_leave_the_composition() {
    assert_eq!(loop_range_for(Some(10), Some(20), 100), (10, 20));
    assert_eq!(loop_range_for(Some(10), Some(200), 100), (10, 100));
    // A reload shortened the composition under both marks.
    assert_eq!(loop_range_for(Some(150), Some(200), 100), (0, 100));
    assert_eq!(loop_range_for(Some(20), Some(10), 100), (0, 100));
    assert_eq!(loop_range_for(Some(10), None, 100), (0, 100));
}

#[test]
fn export_name_replaces_project_extensions() {
    assert_eq!(
        export_suggested_name(
            Some(PathBuf::from("demo.celesta.json").as_path()),
            "ignored"
        ),
        "demo.mp4"
    );
    assert_eq!(export_suggested_name(None, "Untitled"), "Untitled.mp4");
}

#[test]
fn muxing_label_names_no_container() {
    assert_eq!(export_progress_label(&ExportProgress::Muxing), "Muxing…");
}

#[test]
fn export_output_keeps_video_extensions() {
    let case = |path: &str| export_output(PathBuf::from(path));
    assert_eq!(case("a.mov"), (PathBuf::from("a.mov"), VideoFormat::Mov));
    assert_eq!(case("a.WebM"), (PathBuf::from("a.WebM"), VideoFormat::Webm));
    assert_eq!(case("a.mp4"), (PathBuf::from("a.mp4"), VideoFormat::Mp4));
    assert_eq!(case("a"), (PathBuf::from("a.mp4"), VideoFormat::Mp4));
    assert_eq!(case("a.gif"), (PathBuf::from("a.mp4"), VideoFormat::Mp4));
}

#[test]
fn waveform_peaks_are_aligned_and_downsampled_for_clips() {
    let buffer = AudioBuffer {
        sample_rate: 4,
        channels: 2,
        samples: vec![0.1, -0.2, 0.4, -0.3, 0.8, -0.7, 0.2, -0.1],
    };

    let peaks = waveform_peaks(&buffer, 4);
    assert_eq!(peaks, vec![0.2, 0.4, 0.8, 0.2]);
    assert_eq!(waveform_segment(&peaks, 0.5, 0.5, 1), vec![0.8]);
}

#[test]
fn clip_waveforms_follow_source_ranges_and_playback_rate() {
    let mut clip = AudioClip {
        id: "clip".to_owned(),
        asset: ResolvedAsset {
            id: "audio".to_owned(),
            location: AssetLocation::File {
                path: "audio.wav".to_owned(),
            },
        },
        range: TimeRange {
            start: Time::ZERO,
            duration: Time::new(1, 1),
        },
        source_start: Time::new(1, 2),
        source_duration: Some(Time::new(1, 2)),
        playback_rate: Animatable::Static(1.0),
        volume: Animatable::Static(1.0),
        muted: false,
        r#loop: false,
        pitch: Animatable::Static(0.0),
        preserve_pitch: false,
    };
    let peaks = vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

    assert_eq!(
        map_clip_waveform(&peaks, 8, 4, &clip, 4),
        vec![0.3, 0.4, 0.0, 0.0]
    );

    clip.source_duration = None;
    clip.playback_rate = Animatable::Static(2.0);
    assert_eq!(
        map_clip_waveform(&peaks, 8, 4, &clip, 4),
        vec![0.4, 0.6, 0.8, 0.0]
    );

    // Looping, the source starts over where it ran out.
    clip.r#loop = true;
    assert_eq!(
        map_clip_waveform(&peaks, 8, 4, &clip, 4),
        vec![0.4, 0.6, 0.8, 0.2]
    );
    clip.r#loop = false;

    clip.volume = Animatable::Static(0.5);
    assert_eq!(
        clip_level_envelope(&[0.4, 0.6, 0.8, 0.0], &clip),
        vec![0.2, 0.3, 0.4, 0.0]
    );
}

#[test]
fn react_audio_clips_take_one_track_per_file_and_more_only_to_overlap() {
    let clip = |index: usize, src: &str, start: i64, end: i64, muted: bool| AudioClip {
        id: format!("react-audio:{index}"),
        asset: ResolvedAsset {
            id: src.to_owned(),
            location: AssetLocation::File {
                path: format!("/project/{src}"),
            },
        },
        range: TimeRange {
            start: Time::new(start, 1),
            duration: Time::new(end - start, 1),
        },
        source_start: Time::ZERO,
        source_duration: None,
        playback_rate: Animatable::Static(1.0),
        volume: Animatable::Static(0.5),
        muted,
        r#loop: false,
        pitch: Animatable::Static(0.0),
        preserve_pitch: false,
    };
    let tracks = react_tracks(
        &[
            clip(0, "./voice.wav", 2, 4, false),
            clip(1, "https://example.com/clip.mp4", 0, 6, false),
            clip(2, "./voice.wav", 3, 5, false),
            clip(3, "./voice.wav", 0, 2, true),
        ],
        &HashMap::new(),
    );

    let layout = tracks
        .iter()
        .map(|track| {
            let clips = track
                .clips
                .iter()
                .map(|clip| clip.id.as_str())
                .collect::<Vec<_>>();
            (
                track.id.as_str(),
                track.name.as_str(),
                track.item_count,
                clips,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        layout,
        vec![
            // The two voice clips that overlap take a track each; the muted
            // one before them shares the first.
            (
                "react-audio-track:0",
                "voice.wav",
                2,
                vec!["react-audio:3", "react-audio:0"]
            ),
            ("react-audio-track:1", "voice.wav", 1, vec!["react-audio:2"]),
            ("react-audio-track:2", "clip.mp4", 1, vec!["react-audio:1"]),
        ]
    );
    let muted = &tracks[0].clips[0];
    assert_eq!((muted.kind, muted.enabled), (ClipKind::Audio, false));
    assert_eq!(muted.volume, Some(Animatable::Static(0.5)));
    assert_eq!(
        (muted.start, muted.duration),
        (Time::new(0, 1), Time::new(2, 1))
    );
}

#[test]
fn react_videos_take_video_tracks_and_keep_their_sound_on_audio_tracks() {
    let clip = |index: usize, src: &str, start: i64, end: i64, muted: bool| AudioClip {
        id: format!("react-audio:{index}"),
        asset: ResolvedAsset {
            id: src.to_owned(),
            location: AssetLocation::File {
                path: format!("/project/{src}"),
            },
        },
        range: TimeRange {
            start: Time::new(start, 1),
            duration: Time::new(end - start, 1),
        },
        source_start: Time::ZERO,
        source_duration: None,
        playback_rate: Animatable::Static(1.0),
        volume: Animatable::Static(1.0),
        muted,
        r#loop: false,
        pitch: Animatable::Static(0.0),
        preserve_pitch: false,
    };
    let videos = HashMap::from([
        ("react-audio:1".to_owned(), true),
        ("react-audio:2".to_owned(), true),
        ("react-audio:3".to_owned(), false),
    ]);
    let tracks = react_tracks(
        &[
            clip(0, "./score.wav", 0, 24, false),
            clip(1, "./film.mp4", 0, 4, true),
            clip(2, "./film.mp4", 2, 6, false),
            clip(3, "./silent.mp4", 0, 2, false),
        ],
        &videos,
    );

    let layout = tracks
        .iter()
        .map(|track| {
            let clips = track
                .clips
                .iter()
                .map(|clip| (clip.id.as_str(), clip.kind, clip.enabled))
                .collect::<Vec<_>>();
            (track.id.as_str(), track.kind, track.name.as_str(), clips)
        })
        .collect::<Vec<_>>();
    assert_eq!(
        layout,
        vec![
            // Pictures first, overlapping ones on a track each; a muted
            // video still shows.
            (
                "react-video-track:0",
                TrackKind::Video,
                "film.mp4",
                vec![("react-audio:1:video", ClipKind::Video, true)]
            ),
            (
                "react-video-track:1",
                TrackKind::Video,
                "film.mp4",
                vec![("react-audio:2:video", ClipKind::Video, true)]
            ),
            (
                "react-video-track:2",
                TrackKind::Video,
                "silent.mp4",
                vec![("react-audio:3:video", ClipKind::Video, true)]
            ),
            // Sound after, without the video that has none.
            (
                "react-audio-track:0",
                TrackKind::Audio,
                "score.wav",
                vec![("react-audio:0", ClipKind::Audio, true)]
            ),
            (
                "react-audio-track:1",
                TrackKind::Audio,
                "film.mp4",
                vec![("react-audio:1", ClipKind::Audio, false)]
            ),
            (
                "react-audio-track:2",
                TrackKind::Audio,
                "film.mp4",
                vec![("react-audio:2", ClipKind::Audio, true)]
            ),
        ]
    );
    assert_eq!(tracks[0].clips[0].volume, None);
    assert_eq!(react_audio_clip_id("react-audio:1:video"), "react-audio:1");
    assert_eq!(react_audio_clip_id("react-audio:1"), "react-audio:1");
}

#[test]
fn track_levels_follow_the_active_clip_and_master_drag_is_clamped() {
    let clip = ClipSummary {
        id: "clip".to_owned(),
        name: "Clip".to_owned(),
        start: Time::new(10, 1),
        duration: Time::new(2, 1),
        kind: ClipKind::Audio,
        enabled: true,
        volume: Some(Animatable::Static(1.0)),
        component: None,
        dialogue: None,
    };

    assert_eq!(level_at_time(&[0.2, 0.8], &clip, Time::new(10, 1)), 0.2);
    assert_eq!(level_at_time(&[0.2, 0.8], &clip, Time::new(11, 1)), 0.8);
    assert_eq!(level_at_time(&[0.2, 0.8], &clip, Time::new(12, 1)), 0.0);
    assert_eq!(master_volume_from_drag(1.0, 22.0), 1.5);
    assert_eq!(master_volume_from_drag(1.0, -100.0), 0.0);
    assert_eq!(master_volume_from_drag(1.0, 100.0), 2.0);
}

#[test]
fn audio_decoder_reuses_session_pcm_cache() {
    let path = PathBuf::from("/does/not/need/to/exist.wav");
    let key = AudioCacheKey {
        path: path.clone(),
        sample_rate: 48_000,
        channels: 2,
    };
    let expected = AudioBuffer {
        sample_rate: 48_000,
        channels: 2,
        samples: vec![0.25, -0.25],
    };
    let mut decoder = CachedAudioDecoder::new();
    decoder.buffers.insert(key, expected.clone());

    let decoded = decoder.decode_audio(&path, 48_000, 2).unwrap();

    assert_eq!(decoded, expected);
}

#[test]
fn audio_decoder_reuses_pcm_cache_across_sessions() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "celesta-editor-disk-cache-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&root).unwrap();
    let path = root.join("voice.wav");
    fs::write(&path, b"not valid audio; cache must be used").unwrap();
    let expected = AudioBuffer {
        sample_rate: 48_000,
        channels: 2,
        samples: vec![0.25, -0.25],
    };
    let disk_cache = DiskAudioCache::new(root.join("cache"));
    disk_cache.store(&path, &expected, &[0.25]).unwrap();
    let mut decoder = CachedAudioDecoder::with_disk_cache(disk_cache);

    let decoded = decoder.decode_audio(&path, 48_000, 2).unwrap();

    assert_eq!(decoded, expected);
    assert_eq!(decoder.waveforms.values().next().unwrap(), &[0.25]);
    fs::remove_dir_all(root).unwrap();
}

fn missing(name: &str) -> Layer {
    Layer {
        id: name.to_owned(),
        transform: EvaluatedTransform::default(),
        opacity: 1.0,
        blend_mode: Default::default(),
        effects: Default::default(),
        content: LayerContent::MissingComponent {
            component: name.to_owned(),
            props: Default::default(),
        },
    }
}

fn masked_group(children: Vec<Layer>, mask: Vec<Layer>) -> Layer {
    Layer {
        content: LayerContent::Group {
            layers: children,
            clip: None,
            mask: Some(GroupMask {
                layers: mask,
                mode: MaskMode::Alpha,
                invert: false,
            }),
            motion_blur: false,
        },
        ..missing("group")
    }
}

#[test]
fn component_requests_reach_into_masks_after_the_children() {
    let layers = vec![masked_group(vec![missing("Child")], vec![missing("Matte")])];
    let mut requests = Vec::new();
    collect_component_requests(&layers, &mut requests);
    let names: Vec<_> = requests.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, ["Child", "Matte"]);
}

#[test]
fn strips_missing_components_inside_masks() {
    let mut layers = vec![masked_group(vec![missing("Child")], vec![missing("Matte")])];
    strip_missing_components(&mut layers);
    let LayerContent::Group {
        layers: children,
        mask: Some(mask),
        ..
    } = &layers[0].content
    else {
        panic!("the group lost its mask");
    };
    assert!(children.is_empty());
    assert!(mask.layers.is_empty());
}

fn shader(id: &str) -> ShaderSource {
    ShaderSource {
        id: id.to_owned(),
        name: None,
        wgsl: format!("fn effect(input: EffectInput) -> vec4f {{ return vec4f(0.0); }} // {id}"),
        params: Vec::new(),
    }
}

fn shaded(id: &str) -> Layer {
    Layer {
        effects: LayerEffects {
            filters: vec![LayerFilter::Shader(LayerShader {
                id: id.to_owned(),
                params: Vec::new(),
                padding: 0.0,
            })],
            ..Default::default()
        },
        content: LayerContent::Group {
            layers: Vec::new(),
            clip: None,
            mask: None,
            motion_blur: false,
        },
        ..missing(id)
    }
}

#[test]
fn splicing_component_resolutions_lists_their_shaders_once() {
    let mut scene = Scene {
        width: 16,
        height: 16,
        frame_rate: Rational::new(30, 1),
        time: Time::new(0, 30),
        fonts: Vec::new(),
        shaders: vec![shader("listed")],
        layers: vec![
            missing("Ripple"),
            masked_group(vec![missing("Unregistered")], vec![missing("Matte")]),
        ],
    };
    let unresolved = splice_component_resolutions(
        &mut scene,
        ComponentResolutions {
            components: vec![
                Some(vec![shaded("ripple"), shaded("listed")]),
                None,
                Some(vec![shaded("ripple")]),
            ],
            shaders: vec![shader("ripple"), shader("listed")],
        },
    );

    assert_eq!(unresolved, ["Unregistered"]);
    let ids: Vec<_> = scene
        .shaders
        .iter()
        .map(|shader| shader.id.as_str())
        .collect();
    assert_eq!(ids, ["listed", "ripple"]);
    let LayerContent::Group { layers, .. } = &scene.layers[0].content else {
        panic!("the component did not resolve to a group");
    };
    assert_eq!(layers.len(), 2);
    let LayerContent::Group {
        layers: children,
        mask: Some(mask),
        ..
    } = &scene.layers[1].content
    else {
        panic!("the group lost its mask");
    };
    assert!(children.is_empty());
    assert!(
        matches!(&mask.layers[0].content, LayerContent::Group { layers, .. } if layers.len() == 1)
    );
}

fn layer_source_at(file: &str, line: u32, column: u32) -> LayerSource {
    LayerSource {
        name: "Title".to_string(),
        file: PathBuf::from(file),
        line,
        column,
    }
}

fn invocation(program: &str, args: &[&str]) -> Invocation {
    Invocation {
        program: program.to_string(),
        args: args.iter().map(|arg| arg.to_string()).collect(),
    }
}

#[test]
fn editor_value_prefers_visual_over_editor() {
    let env = |name: &str| match name {
        "VISUAL" => Some("code".to_string()),
        "EDITOR" => Some("vim".to_string()),
        _ => None,
    };

    assert_eq!(editor_value(env), Some("code".to_string()));
}

#[test]
fn editor_value_falls_back_to_editor_when_visual_is_empty() {
    let env = |name: &str| match name {
        "VISUAL" => Some(String::new()),
        "EDITOR" => Some("zed".to_string()),
        _ => None,
    };

    assert_eq!(editor_value(env), Some("zed".to_string()));
}

#[test]
fn editor_value_is_none_when_both_are_unset_or_empty() {
    assert_eq!(editor_value(|_| None), None);
    assert_eq!(editor_value(|_| Some(String::new())), None);
    assert_eq!(editor_value(|_| Some("  ".to_string())), None);
}

#[test]
fn editor_invocation_passes_the_position_the_way_each_editor_expects() {
    let source = layer_source_at("/p/a.tsx", 12, 5);
    let goto = ["--goto", "/p/a.tsx:12:5"];
    let cases: Vec<(&str, Invocation)> = vec![
        ("code", invocation("code", &goto)),
        (
            "code -n",
            invocation("code", &["-n", "--goto", "/p/a.tsx:12:5"]),
        ),
        ("cursor", invocation("cursor", &goto)),
        ("windsurf", invocation("windsurf", &goto)),
        ("codium", invocation("codium", &goto)),
        ("code-insiders", invocation("code-insiders", &goto)),
        ("zed", invocation("zed", &["/p/a.tsx:12:5"])),
        ("subl", invocation("subl", &["/p/a.tsx:12:5"])),
        (
            "sublime_text",
            invocation("sublime_text", &["/p/a.tsx:12:5"]),
        ),
        (
            "idea",
            invocation("idea", &["--line", "12", "--column", "5", "/p/a.tsx"]),
        ),
        (
            "rustrover",
            invocation("rustrover", &["--line", "12", "--column", "5", "/p/a.tsx"]),
        ),
        ("mate", invocation("mate", &["--line", "12", "/p/a.tsx"])),
        ("emacs", invocation("emacs", &["+12", "/p/a.tsx"])),
        ("gedit", invocation("gedit", &["+12", "/p/a.tsx"])),
        (
            "emacsclient -c",
            invocation("emacsclient", &["-c", "+12", "/p/a.tsx"]),
        ),
    ];

    for (value, expected) in cases {
        assert_eq!(
            editor_invocation(value, &source),
            Ok(expected),
            "value {value:?}"
        );
    }
}

#[test]
fn editor_invocation_keeps_a_quoted_program_path_with_spaces() {
    let source = layer_source_at("/p/a.tsx", 12, 5);

    assert_eq!(
        editor_invocation(
            "'/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl'",
            &source
        ),
        Ok(invocation(
            "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
            &["/p/a.tsx:12:5"]
        ))
    );
}

#[test]
fn editor_invocation_matches_a_windows_program_path_without_extension() {
    let source = layer_source_at("/p/a.tsx", 12, 5);

    assert_eq!(
        editor_invocation("\"C:\\Tools\\Code.exe\"", &source),
        Ok(invocation(
            "C:\\Tools\\Code.exe",
            &["--goto", "/p/a.tsx:12:5"]
        ))
    );
    assert_eq!(
        split_command("C:\\Tools\\Code.exe --wait", true),
        Some(vec![
            "C:\\Tools\\Code.exe".to_string(),
            "--wait".to_string()
        ])
    );
    assert_eq!(
        split_command("\"C:\\Program Files\\Code.exe\" -n", true),
        Some(vec![
            "C:\\Program Files\\Code.exe".to_string(),
            "-n".to_string()
        ])
    );
}

#[test]
fn editor_invocation_refuses_terminal_editors() {
    let source = layer_source_at("/p/a.tsx", 12, 5);
    let cases = [
        ("vim", "vim"),
        ("nvim", "nvim"),
        ("nano", "nano"),
        ("hx", "hx"),
        ("/usr/bin/vim", "vim"),
        ("emacs -nw", "emacs"),
        ("emacsclient -t", "emacsclient"),
        ("emacs --tty", "emacs"),
    ];

    for (value, name) in cases {
        assert_eq!(
            editor_invocation(value, &source),
            Err(LaunchError::TerminalEditor(name.to_string())),
            "value {value:?}"
        );
    }
}

#[test]
fn editor_invocation_rejects_an_unbalanced_quote() {
    let source = layer_source_at("/p/a.tsx", 12, 5);

    assert_eq!(
        editor_invocation("code '--goto", &source),
        Err(LaunchError::Unparsable("code '--goto".to_string()))
    );
    assert!(matches!(
        editor_invocation("  ", &source),
        Err(LaunchError::Unparsable(_))
    ));
}

#[test]
fn parse_login_shell_output_reads_both_variables_between_the_markers() {
    let output = "motd noise\n__CELESTA_EDITOR__vim\0code__CELESTA_EDITOR__\ntrailing";
    assert_eq!(parse_login_shell_output(output), Some("vim".to_string()));

    let empty_visual = "banner\n__CELESTA_EDITOR__\0code__CELESTA_EDITOR__\n";
    assert_eq!(
        parse_login_shell_output(empty_visual),
        Some("code".to_string())
    );
}

#[test]
fn parse_login_shell_output_is_none_without_a_value_or_markers() {
    assert_eq!(parse_login_shell_output("no markers here\n"), None);
    assert_eq!(
        parse_login_shell_output("__CELESTA_EDITOR__\0__CELESTA_EDITOR__\n"),
        None
    );
    assert_eq!(parse_login_shell_output("__CELESTA_EDITOR__code"), None);
}

#[test]
fn default_opener_uses_the_os_default_application() {
    let expected = if cfg!(target_os = "macos") {
        invocation("open", &["/p/a.tsx"])
    } else if cfg!(windows) {
        invocation("cmd", &["/C", "start", "", "/p/a.tsx"])
    } else {
        invocation("xdg-open", &["/p/a.tsx"])
    };

    assert_eq!(default_opener(Path::new("/p/a.tsx")), expected);
}

#[test]
fn launch_error_displays_the_panel_copy() {
    assert_eq!(
        LaunchError::TerminalEditor("vim".to_string()).to_string(),
        "VISUAL/EDITOR is a terminal editor (vim); set VISUAL to a graphical editor"
    );
    assert_eq!(
        LaunchError::Unparsable("code '--goto".to_string()).to_string(),
        "VISUAL/EDITOR could not be parsed: code '--goto"
    );
    assert_eq!(
        LaunchError::Spawn("No such file or directory".to_string()).to_string(),
        "Could not open the editor: No such file or directory"
    );
}

/// Yields `chunks`, then panics: a read past them means the caller waited for
/// an end of stream that a daemon holding the pipe would never deliver.
struct ChunksThenForever {
    chunks: std::vec::IntoIter<&'static [u8]>,
}

impl std::io::Read for ChunksThenForever {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let chunk = self.chunks.next().expect("read past the closing marker");
        buf[..chunk.len()].copy_from_slice(chunk);
        Ok(chunk.len())
    }
}

#[test]
fn reading_login_shell_output_stops_at_the_closing_marker_without_eof() {
    let reader = ChunksThenForever {
        chunks: vec![
            b"noise\n__CELESTA_EDI".as_slice(),
            b"TOR__code\0vim__CELESTA_EDITOR__\n".as_slice(),
        ]
        .into_iter(),
    };

    let output = read_until_closing_marker(reader);

    assert_eq!(parse_login_shell_output(&output), Some("code".to_string()));
}

#[test]
fn reading_login_shell_output_returns_what_it_got_at_eof() {
    let output = read_until_closing_marker(&b"only noise"[..]);

    assert_eq!(output, "only noise");
    assert_eq!(parse_login_shell_output(&output), None);
}

/// The viewer area the layer selection tests click in: 960 x 960 at the origin.
fn square_viewer() -> gpui_kit::Bounds<gpui_kit::Pixels> {
    gpui_kit::Bounds::new(
        gpui_kit::point(gpui_kit::px(0.0), gpui_kit::px(0.0)),
        gpui_kit::size(gpui_kit::px(960.0), gpui_kit::px(960.0)),
    )
}

#[test]
fn layer_select_letterboxes_a_wide_frame_in_a_square_area() {
    assert_eq!(
        letterbox(square_viewer(), (1920.0, 1080.0)),
        Some((0.0, 210.0, 0.5))
    );
}

#[test]
fn layer_select_letterboxes_nothing_for_a_frame_without_size() {
    assert_eq!(letterbox(square_viewer(), (0.0, 1080.0)), None);
    assert_eq!(letterbox(square_viewer(), (1920.0, 0.0)), None);
}

#[test]
fn layer_select_maps_a_click_in_the_frame_to_scene_pixels() {
    let point = scene_point(
        square_viewer(),
        (1920.0, 1080.0),
        gpui_kit::point(gpui_kit::px(480.0), gpui_kit::px(480.0)),
    );

    assert_eq!(
        point,
        Some(celesta_composition::Point { x: 960.0, y: 540.0 })
    );
}

#[test]
fn layer_select_maps_a_click_in_the_letterbox_bar_to_nothing() {
    let point = scene_point(
        square_viewer(),
        (1920.0, 1080.0),
        gpui_kit::point(gpui_kit::px(480.0), gpui_kit::px(100.0)),
    );

    assert_eq!(point, None);
}

#[test]
fn layer_select_reads_each_lookup_outcome() {
    let chain = vec![layer_source_at("/project/title.tsx", 12, 5)];

    assert_eq!(source_lookup(Ok(None)), SourceLookup::NotInFrame);
    assert_eq!(
        source_lookup(Ok(Some(Vec::new()))),
        SourceLookup::NoPosition
    );
    assert_eq!(
        source_lookup(Ok(Some(chain.clone()))),
        SourceLookup::Found(chain)
    );
    assert_eq!(
        source_lookup(Err("bridge closed".to_string())),
        SourceLookup::Failed("bridge closed".to_string())
    );
}

#[test]
fn layer_select_shows_a_file_inside_the_entry_directory_relative_to_it() {
    let entry_dir = Path::new("/project/src");
    // Joined, so the separators are the platform's, as the runtime's are.
    let file = entry_dir.join("components").join("title.tsx");
    let source = layer_source_at(file.to_str().expect("an ASCII path"), 12, 5);

    assert_eq!(
        display_path(&source.file, entry_dir),
        Path::new("components")
            .join("title.tsx")
            .display()
            .to_string()
    );
    assert_eq!(
        source_position(&source, entry_dir),
        format!(
            "{}:12:5",
            Path::new("components").join("title.tsx").display()
        )
    );
}

#[test]
fn layer_select_shows_a_launch_error_only_under_the_layer_it_opened() {
    let started = (3, Some("title"));

    assert!(launch_outcome_applies(started, (3, Some("title"))));
    assert!(!launch_outcome_applies(started, (3, Some("subtitle"))));
    assert!(!launch_outcome_applies(started, (3, None)));
    assert!(!launch_outcome_applies(started, (4, Some("title"))));
}

#[test]
fn layer_select_shows_a_file_outside_the_entry_directory_in_full() {
    let entry_dir = Path::new("/project/src");
    let file = Path::new("/project/shared/title.tsx");

    assert_eq!(display_path(file, entry_dir), file.display().to_string());
}

fn react_context(source_locations: bool) -> ReactPreviewContext {
    ReactPreviewContext {
        composition_id: None,
        node: PathBuf::from("node"),
        cli_script: PathBuf::from("cli.js"),
        entry: PathBuf::from("entry.tsx"),
        properties: celesta_react_bridge::PropertyInputs::default(),
        source_locations,
    }
}

#[test]
fn layer_select_respawns_the_bridge_when_the_mode_changes() {
    // `ensure_react_bridge` respawns Node whenever the context differs.
    assert_ne!(react_context(true), react_context(false));
}

#[test]
fn layer_select_records_hit_regions_only_in_interactive_mode() {
    let interactive = react_context(true);
    let preview = react_context(false);

    assert!(records_hit_regions(
        ReactPreviewMode::WholeScene,
        Some(&interactive)
    ));
    assert!(!records_hit_regions(
        ReactPreviewMode::WholeScene,
        Some(&preview)
    ));
    assert!(!records_hit_regions(
        ReactPreviewMode::ResolveComponents,
        Some(&interactive)
    ));
    assert!(!records_hit_regions(ReactPreviewMode::WholeScene, None));
}

#[test]
fn layer_select_looks_up_sources_only_in_interactive_mode() {
    let found = SourceLookup::Found(Vec::new());

    // Paused with a selection: looked up while picking, never otherwise.
    assert_eq!(
        source_lookup_target(Some("root.2"), true, false, Some(&found)),
        Some("root.2".to_string())
    );
    assert_eq!(
        source_lookup_target(Some("root.2"), false, false, Some(&found)),
        None
    );
    // Playing: only a selection still waiting for its first answer.
    assert_eq!(
        source_lookup_target(Some("root.2"), true, true, Some(&SourceLookup::Pending)),
        Some("root.2".to_string())
    );
    assert_eq!(
        source_lookup_target(Some("root.2"), true, true, Some(&found)),
        None
    );
    assert_eq!(source_lookup_target(None, true, false, None), None);
}
