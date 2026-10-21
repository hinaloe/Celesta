use crate::Evaluator;
use celesta_composition::{
    Animatable, AnimatablePoint, BackfaceVisibility, BlendMode, ImageAnimation, Scene, Transform,
};

use celesta_composition::{
    AudioDuck, DuckGroups, DuckLevel, Keyframe, KeyframeAnimation, KeyframeAnimationType,
    LayerContent, LayerFilter, Time,
};
use celesta_project::{
    Asset, AssetSource, LipSyncCue, LipSyncDefinition, MouthShape, Project, ProjectDuck,
    SourceRange, TimelineContent, TimelineEffects, TimelineGlow, TimelineShadow, TimelineTint,
    TimelineVignette,
};

fn example() -> Project {
    Project::from_json(include_str!("../../../examples/voiceroid.celesta.json")).unwrap()
}

#[test]
fn expands_dialogue_into_visual_and_audio_composition() {
    let project = example();
    let evaluator = Evaluator::new(&project).unwrap();

    assert!(
        evaluator
            .scene_at(Time::new(499, 100))
            .unwrap()
            .layers
            .is_empty()
    );

    let scene = evaluator.scene_at(Time::new(21, 4)).unwrap();
    assert_eq!(scene.layers.len(), 1);
    assert_eq!(scene.layers[0].opacity, 1.0);
    let LayerContent::Group { layers, .. } = &scene.layers[0].content else {
        panic!("dialogue must expand to a group");
    };
    assert_eq!(layers.len(), 2);
    assert!(matches!(layers[0].content, LayerContent::Image { .. }));
    assert!(matches!(layers[1].content, LayerContent::Text { .. }));

    let audio = evaluator.audio_graph().unwrap();
    assert_eq!(audio.clips.len(), 1);
    assert_eq!(audio.clips[0].id, "dialogue-001:voice");
    assert_eq!(audio.master_volume, 1.0);
}

#[test]
fn carries_an_items_blend_mode_onto_its_layer() {
    let mut project = example();
    let scene_time = Time::new(21, 4);
    let evaluator = Evaluator::new(&project).unwrap();
    assert_eq!(
        evaluator.scene_at(scene_time).unwrap().layers[0].blend_mode,
        BlendMode::Normal
    );

    project.tracks[0].items[0].blend_mode = Some(BlendMode::Screen);
    let evaluator = Evaluator::new(&project).unwrap();
    assert_eq!(
        evaluator.scene_at(scene_time).unwrap().layers[0].blend_mode,
        BlendMode::Screen
    );
}

#[test]
fn evaluates_animated_effects_at_item_local_time() {
    let mut project = example();
    let animated = Animatable::Keyframes(KeyframeAnimation {
        kind: KeyframeAnimationType::Keyframes,
        keyframes: vec![
            Keyframe {
                time: Time::ZERO,
                value: 0.0,
                easing: None,
            },
            Keyframe {
                time: Time::new(1, 1),
                value: 8.0,
                easing: None,
            },
        ],
    });
    project.tracks[0].items[0].effects = Some(TimelineEffects {
        blur: Some(animated.clone()),
        shadow: Some(TimelineShadow {
            color: Animatable::Keyframes(KeyframeAnimation {
                kind: KeyframeAnimationType::Keyframes,
                keyframes: vec![
                    Keyframe {
                        time: Time::ZERO,
                        value: "#00000080".to_owned(),
                        easing: None,
                    },
                    Keyframe {
                        time: Time::new(1, 1),
                        value: "#FF0000FF".to_owned(),
                        easing: None,
                    },
                ],
            }),
            blur: Animatable::Static(2.0),
            offset_x: animated,
            offset_y: Animatable::Static(3.0),
        }),
        glow: Some(TimelineGlow {
            color: Animatable::Static("#ffffff".to_owned()),
            blur: Animatable::Static(4.0),
        }),
        ..TimelineEffects::default()
    });
    let start = project.tracks[0].items[0].range.start;
    let time = start.checked_add(Time::new(1, 2)).unwrap();
    let scene = Evaluator::new(&project).unwrap().scene_at(time).unwrap();
    let layer = &scene.layers[0];
    assert_eq!(layer.effects.blur, 4.0);
    assert_eq!(layer.effects.shadow.as_ref().unwrap().offset_x, 4.0);
    assert_eq!(layer.effects.shadow.as_ref().unwrap().color, "#800000C0");
    assert_eq!(layer.effects.glow.as_ref().unwrap().blur, 4.0);
    assert!(layer.effects.filters.is_empty());
}

#[test]
fn evaluates_3d_transform_fields() {
    let mut project = example();
    let start = project.tracks[0].items[0].range.start;
    let time = start.checked_add(Time::new(1, 2)).unwrap();
    let transform_at = |project: &Project| {
        Evaluator::new(project)
            .unwrap()
            .scene_at(time)
            .unwrap()
            .layers[0]
            .transform
    };

    let defaults = transform_at(&project);
    assert_eq!((defaults.skew.x, defaults.skew.y), (0.0, 0.0));
    assert_eq!((defaults.origin.x, defaults.origin.y), (0.0, 0.0));
    assert_eq!(defaults.rotation_x, 0.0);
    assert_eq!(defaults.rotation_y, 0.0);
    assert_eq!(defaults.perspective, None);
    assert_eq!(defaults.backface_visibility, BackfaceVisibility::Visible);

    project.tracks[0].items[0].transform = Some(Transform {
        skew: Some(AnimatablePoint {
            x: Some(Animatable::Static(10.0)),
            y: None,
        }),
        origin: Some(AnimatablePoint {
            x: Some(Animatable::Static(960.0)),
            y: Some(Animatable::Static(540.0)),
        }),
        rotation_y: Some(Animatable::Keyframes(KeyframeAnimation {
            kind: KeyframeAnimationType::Keyframes,
            keyframes: vec![
                Keyframe {
                    time: Time::ZERO,
                    value: 0.0,
                    easing: None,
                },
                Keyframe {
                    time: Time::new(1, 1),
                    value: 180.0,
                    easing: None,
                },
            ],
        })),
        perspective: Some(Animatable::Static(900.0)),
        backface_visibility: Some(BackfaceVisibility::Hidden),
        ..Transform::default()
    });
    let transform = transform_at(&project);
    assert_eq!(transform.skew.x, 10.0);
    assert_eq!(transform.skew.y, 0.0);
    assert_eq!((transform.origin.x, transform.origin.y), (960.0, 540.0));
    assert_eq!(transform.rotation_x, 0.0);
    assert_eq!(transform.rotation_y, 90.0);
    assert_eq!(transform.perspective, Some(900.0));
    assert_eq!(transform.backface_visibility, BackfaceVisibility::Hidden);
}

#[test]
fn evaluates_color_filters_in_the_props_order_at_the_item_time() {
    let mut project = example();
    let ramp = |from: f64, to: f64| {
        Animatable::Keyframes(KeyframeAnimation {
            kind: KeyframeAnimationType::Keyframes,
            keyframes: vec![
                Keyframe {
                    time: Time::ZERO,
                    value: from,
                    easing: None,
                },
                Keyframe {
                    time: Time::new(1, 1),
                    value: to,
                    easing: None,
                },
            ],
        })
    };
    project.tracks[0].items[0].effects = Some(TimelineEffects {
        vignette: Some(TimelineVignette {
            amount: ramp(0.0, 1.0),
            radius: None,
            softness: Some(Animatable::Static(0.25)),
        }),
        tint: Some(TimelineTint {
            color: Animatable::Keyframes(KeyframeAnimation {
                kind: KeyframeAnimationType::Keyframes,
                keyframes: vec![
                    Keyframe {
                        time: Time::ZERO,
                        value: "#000000FF".to_owned(),
                        easing: None,
                    },
                    Keyframe {
                        time: Time::new(1, 1),
                        value: "#FF0000FF".to_owned(),
                        easing: None,
                    },
                ],
            }),
            amount: None,
        }),
        hue: Some(Animatable::Static(90.0)),
        brightness: Some(ramp(1.0, 2.0)),
        // Changes nothing, so adds no filter.
        saturation: Some(Animatable::Static(1.0)),
        ..TimelineEffects::default()
    });
    let start = project.tracks[0].items[0].range.start;
    let at = |offset| {
        let time = start.checked_add(offset).unwrap();
        Evaluator::new(&project)
            .unwrap()
            .scene_at(time)
            .unwrap()
            .layers[0]
            .effects
            .filters
            .clone()
    };
    assert_eq!(
        at(Time::new(1, 2)),
        [
            LayerFilter::Brightness { amount: 1.5 },
            LayerFilter::Hue { degrees: 90.0 },
            LayerFilter::Tint {
                color: "#800000FF".to_owned(),
                amount: 1.0,
            },
            LayerFilter::Vignette {
                amount: 0.5,
                radius: 0.5,
                softness: 0.25,
            },
        ]
    );
    // At the item's start the brightness and the vignette change nothing.
    assert_eq!(
        at(Time::ZERO),
        [
            LayerFilter::Hue { degrees: 90.0 },
            LayerFilter::Tint {
                color: "#000000FF".to_owned(),
                amount: 1.0,
            },
        ]
    );
}

#[test]
fn evaluates_lip_sync_as_a_mouth_overlay_without_replacing_the_expression() {
    let mut project = example();
    let portrait = project
        .characters
        .get_mut("akane")
        .unwrap()
        .portrait
        .as_mut()
        .unwrap();
    portrait.lip_sync = Some(LipSyncDefinition {
        a: "akane-a".to_owned(),
        i: "akane-default".to_owned(),
        u: "akane-default".to_owned(),
        e: "akane-default".to_owned(),
        o: "akane-default".to_owned(),
        closed: Some("akane-default".to_owned()),
        transform: None,
    });
    project.assets.insert(
        "akane-a".to_owned(),
        project.assets["akane-default"].clone(),
    );
    let TimelineContent::Dialogue { lip_sync, .. } = &mut project.tracks[0].items[0].content else {
        panic!("example must contain dialogue")
    };
    *lip_sync = vec![
        LipSyncCue {
            time: Time::ZERO,
            shape: MouthShape::Closed,
        },
        LipSyncCue {
            time: Time::new(1, 2),
            shape: MouthShape::A,
        },
    ];
    let evaluator = Evaluator::new(&project).unwrap();

    let closed = evaluator.scene_at(Time::new(21, 4)).unwrap();
    let open = evaluator.scene_at(Time::new(23, 4)).unwrap();
    let mouth_asset = |scene: &Scene| {
        let LayerContent::Group { layers, .. } = &scene.layers[0].content else {
            panic!("dialogue must expand to a group")
        };
        assert_eq!(layers.len(), 3);
        let LayerContent::Image { asset, .. } = &layers[1].content else {
            panic!("second dialogue layer must be the mouth")
        };
        asset.id.clone()
    };

    assert_eq!(mouth_asset(&closed), "akane-default");
    assert_eq!(mouth_asset(&open), "akane-a");

    project
        .characters
        .get_mut("akane")
        .unwrap()
        .portrait
        .as_mut()
        .unwrap()
        .lip_sync
        .as_mut()
        .unwrap()
        .closed = None;
    let closed = Evaluator::new(&project)
        .unwrap()
        .scene_at(Time::new(21, 4))
        .unwrap();
    let LayerContent::Group { layers, .. } = &closed.layers[0].content else {
        panic!("dialogue must expand to a group")
    };
    assert_eq!(layers.len(), 2, "no closed overlay uses the base portrait");
}

#[test]
fn applies_track_mute_and_project_master_volume_to_audio_graph() {
    let mut project = example();
    project.settings.master_volume = Some(0.5);
    project.tracks[0].muted = Some(true);

    let audio = Evaluator::new(&project).unwrap().audio_graph().unwrap();

    assert!(audio.clips.is_empty());
    assert_eq!(audio.master_volume, 0.5);
}

#[test]
fn audio_graph_preserves_source_range_and_playback_mapping() {
    let mut project = example();
    project.tracks[0].items[0].content = TimelineContent::Audio {
        asset: "voice-001".to_owned(),
        source_range: Some(SourceRange {
            start: Time::new(1, 2),
            duration: Some(Time::new(3, 2)),
        }),
        playback_rate: Some(Animatable::Static(2.0)),
        volume: None,
        muted: None,
        pitch: None,
        preserve_pitch: None,
        fade_in: None,
        fade_out: None,
        duck_group: None,
        duck: None,
    };

    let audio = Evaluator::new(&project).unwrap().audio_graph().unwrap();

    assert_eq!(audio.clips[0].source_start, Time::new(1, 2));
    assert_eq!(audio.clips[0].source_duration, Some(Time::new(3, 2)));
    assert_eq!(audio.clips[0].playback_rate, Animatable::Static(2.0));
}

#[test]
fn audio_graph_carries_pitch_and_preserve_pitch() {
    let audio_content = |pitch, preserve_pitch| TimelineContent::Audio {
        asset: "voice-001".to_owned(),
        source_range: None,
        playback_rate: None,
        volume: None,
        muted: None,
        pitch,
        preserve_pitch,
        fade_in: None,
        fade_out: None,
        duck_group: None,
        duck: None,
    };
    let mut project = example();
    project.tracks[0].items[0].content = audio_content(Some(Animatable::Static(-3.0)), Some(true));
    let audio = Evaluator::new(&project).unwrap().audio_graph().unwrap();
    assert_eq!(audio.clips[0].pitch, Animatable::Static(-3.0));
    assert!(audio.clips[0].preserve_pitch);

    project.tracks[0].items[0].content = audio_content(None, None);
    let audio = Evaluator::new(&project).unwrap().audio_graph().unwrap();
    assert_eq!(audio.clips[0].pitch, Animatable::Static(0.0));
    assert!(!audio.clips[0].preserve_pitch);

    project.assets.insert(
        "clip-001".to_owned(),
        Asset::Video {
            name: None,
            source: AssetSource::File {
                path: "./assets/clip.mp4".to_owned(),
            },
        },
    );
    project.tracks[0].items[0].content = TimelineContent::Video {
        asset: "clip-001".to_owned(),
        source_range: None,
        playback_rate: None,
        volume: None,
        muted: None,
        duck_group: None,
        duck: None,
    };
    let audio = Evaluator::new(&project).unwrap().audio_graph().unwrap();
    assert_eq!(audio.clips[0].pitch, Animatable::Static(0.0));
    assert!(!audio.clips[0].preserve_pitch);
}

#[test]
fn audio_graph_carries_fades_of_audio_items_only() {
    let mut project = example();
    project.tracks[0].items[0].content = TimelineContent::Audio {
        asset: "voice-001".to_owned(),
        source_range: None,
        playback_rate: None,
        volume: None,
        muted: None,
        pitch: None,
        preserve_pitch: None,
        fade_in: Some(Time::new(3, 2)),
        fade_out: Some(Time::new(3, 1)),
        duck_group: None,
        duck: None,
    };
    let audio = Evaluator::new(&project).unwrap().audio_graph().unwrap();
    assert_eq!(audio.clips[0].fade_in, Time::new(3, 2));
    assert_eq!(audio.clips[0].fade_out, Time::new(3, 1));

    // Dialogue voices have no fades.
    let audio = Evaluator::new(&example()).unwrap().audio_graph().unwrap();
    assert_eq!(audio.clips[0].fade_in, Time::ZERO);
    assert_eq!(audio.clips[0].fade_out, Time::ZERO);
}

#[test]
fn audio_items_carry_resolved_ducking() {
    let mut project = example();
    project.tracks[0].items[0].content = TimelineContent::Audio {
        asset: "voice-001".to_owned(),
        source_range: None,
        playback_rate: None,
        volume: None,
        muted: None,
        pitch: None,
        preserve_pitch: None,
        fade_in: None,
        fade_out: None,
        duck_group: Some("music".to_owned()),
        duck: Some(ProjectDuck {
            under: DuckGroups::One("voice".to_owned()),
            to: Some(DuckLevel::Db { db: -20.0 }),
            attack: None,
            release: Some(Time::new(1, 1)),
            hold_gap: None,
        }),
    };
    let audio = Evaluator::new(&project).unwrap().audio_graph().unwrap();
    assert_eq!(audio.clips[0].duck_group.as_deref(), Some("music"));
    let duck = audio.clips[0].duck.as_ref().unwrap();
    assert_eq!(duck.under, ["voice"]);
    assert!((duck.to - 0.1).abs() < 1e-12);
    assert_eq!(duck.attack, AudioDuck::DEFAULT_ATTACK);
    assert_eq!(duck.release, Time::new(1, 1));
    assert_eq!(duck.hold_gap, AudioDuck::DEFAULT_HOLD_GAP);
}

#[test]
fn dialogue_voices_belong_to_voice_unless_told_otherwise() {
    let group = |duck_group: Option<Option<String>>| {
        let mut project = example();
        for item in project.tracks.iter_mut().flat_map(|track| &mut track.items) {
            if let TimelineContent::Dialogue {
                duck_group: group, ..
            } = &mut item.content
            {
                *group = duck_group.clone();
            }
        }
        let audio = Evaluator::new(&project).unwrap().audio_graph().unwrap();
        audio.clips[0].duck_group.clone()
    };
    assert_eq!(group(None).as_deref(), Some("voice"));
    assert_eq!(group(Some(None)), None);
    assert_eq!(
        group(Some(Some("narrator".to_owned()))).as_deref(),
        Some("narrator")
    );
}

#[test]
fn solo_tracks_exclude_audio_from_other_tracks() {
    let mut project = example();
    let mut solo = project.tracks[0].clone();
    solo.id = "solo-dialogue".to_owned();
    solo.items[0].id = "solo-dialogue-item".to_owned();
    solo.solo = Some(true);
    project.tracks.push(solo);

    let audio = Evaluator::new(&project).unwrap().audio_graph().unwrap();

    assert_eq!(audio.clips.len(), 1);
    assert_eq!(audio.clips[0].id, "solo-dialogue-item:voice");
}

#[test]
fn evaluates_a_single_track_independent_of_the_others() {
    let mut project = example();
    let mut other = project.tracks[0].clone();
    other.id = "other".to_owned();
    other.items[0].id = "other-item".to_owned();
    project.tracks.push(other);
    let evaluator = Evaluator::new(&project).unwrap();

    let time = Time::new(21, 4);
    let dialogue_layers = evaluator.layers_for_track("dialogue", time).unwrap();
    let other_layers = evaluator.layers_for_track("other", time).unwrap();
    // Both tracks hold an equivalent dialogue item, evaluated the same
    // way, but each track's own evaluation stays scoped to itself.
    assert_eq!(dialogue_layers.len(), 1);
    assert_eq!(other_layers.len(), 1);
    assert_eq!(dialogue_layers[0].id, "dialogue-001");
    assert_eq!(other_layers[0].id, "other-item");
    assert_eq!(evaluator.scene_at(time).unwrap().layers.len(), 2);
}

#[test]
fn unknown_or_disabled_track_evaluates_to_no_layers() {
    let mut project = example();
    let evaluator = Evaluator::new(&project).unwrap();
    let time = Time::new(21, 4);

    assert!(
        evaluator
            .layers_for_track("does-not-exist", time)
            .unwrap()
            .is_empty()
    );

    project.tracks[0].enabled = Some(false);
    let evaluator = Evaluator::new(&project).unwrap();
    assert!(
        evaluator
            .layers_for_track("dialogue", time)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn item_end_is_exclusive() {
    let project = example();
    let evaluator = Evaluator::new(&project).unwrap();
    assert!(
        evaluator
            .scene_at(Time::new(8, 1))
            .unwrap()
            .layers
            .is_empty()
    );
}

#[test]
fn returns_missing_components_as_placeholder_layers() {
    let mut project = example();
    project.tracks[0].items[0].content = TimelineContent::Component {
        component: "BossIntroduction".to_owned(),
        props: None,
    };
    let evaluator = Evaluator::new(&project).unwrap();
    let scene = evaluator.scene_at(Time::new(6, 1)).unwrap();
    assert!(matches!(
        scene.layers[0].content,
        LayerContent::MissingComponent { .. }
    ));
}

#[test]
fn an_image_item_plays_an_animation_from_its_own_start_and_loops() {
    let mut project = example();
    let item = &mut project.tracks[0].items[0];
    item.content = TimelineContent::Image {
        asset: "akane-default".to_owned(),
        width: None,
        height: None,
        fit: None,
    };
    let evaluator = Evaluator::new(&project).unwrap();
    // The item starts at 5 s.
    let scene = evaluator.scene_at(Time::new(13, 2)).unwrap();
    let LayerContent::Image { animation, .. } = &scene.layers[0].content else {
        panic!("an image item must evaluate to an image layer");
    };
    assert_eq!(
        *animation,
        Some(ImageAnimation {
            source_time_seconds: 1.5,
            r#loop: true,
        })
    );
}
