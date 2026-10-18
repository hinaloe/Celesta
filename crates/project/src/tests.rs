use crate::character::{LipSyncCue, LipSyncDefinition, MouthShape};
use crate::document::{Project, ProjectVersion};
use crate::error::LoadError;
use crate::timeline::{TimelineContent, TimelineEffects, TimelineItem, TimelineShadow};
use crate::{Animatable, BlendMode, Time};
use serde_json::Value;

#[test]
fn image_display_fields_round_trip_and_validate() {
    let mut json: Value =
        serde_json::from_str(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    json["tracks"][0]["items"][0]["content"] = serde_json::json!({"type": "image", "asset": "akane-default", "width": 432, "height": 200, "fit": "cover"});
    let project = Project::from_json(&json.to_string()).unwrap();
    assert_eq!(
        Project::from_json(&project.to_json().unwrap()).unwrap(),
        project
    );
    json["tracks"][0]["items"][0]["content"]["width"] = 0.into();
    assert!(Project::from_json(&json.to_string()).is_err());
}

#[test]
fn text_letter_spacing_takes_px_or_em() {
    let mut json: Value =
        serde_json::from_str(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    for letter_spacing in [serde_json::json!(-1.5), serde_json::json!({ "em": -0.02 })] {
        json["tracks"][0]["items"][0]["content"] = serde_json::json!({
            "type": "text",
            "text": "Celesta",
            "style": { "fontSize": 64, "letterSpacing": letter_spacing },
        });
        let project = Project::from_json(&json.to_string()).unwrap();
        let saved: Value = serde_json::from_str(&project.to_json().unwrap()).unwrap();
        assert_eq!(
            saved["tracks"][0]["items"][0]["content"]["style"]["letterSpacing"],
            letter_spacing
        );
    }
    json["tracks"][0]["items"][0]["content"]["style"]["letterSpacing"] =
        serde_json::json!({ "px": 2 });
    assert!(Project::from_json(&json.to_string()).is_err());
}
#[test]
fn text_stroke_takes_one_stroke_or_a_list() {
    let mut json: Value =
        serde_json::from_str(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    let solid = |color: &str| serde_json::json!({ "type": "solid", "color": color });
    for stroke in [
        serde_json::json!({ "paint": solid("#FFFFFFFF"), "width": 6.0 }),
        serde_json::json!([
            { "paint": solid("#2E6B1FFF"), "width": 14.0 },
            { "paint": solid("#FFFFFFFF"), "width": 7.0 },
        ]),
    ] {
        json["tracks"][0]["items"][0]["content"] = serde_json::json!({
            "type": "text",
            "text": "Celesta",
            "style": { "fontSize": 64, "stroke": stroke },
        });
        let project = Project::from_json(&json.to_string()).unwrap();
        let saved: Value = serde_json::from_str(&project.to_json().unwrap()).unwrap();
        assert_eq!(
            saved["tracks"][0]["items"][0]["content"]["style"]["stroke"],
            stroke
        );
    }
    json["tracks"][0]["items"][0]["content"]["style"]["stroke"][1]["width"] = (-1.0).into();
    let errors = Project::from_json(&json.to_string())
        .unwrap_err()
        .to_string();
    assert!(errors.contains("style.stroke[1].width"), "{errors}");
}

#[test]
fn loads_the_minimal_project() {
    let project =
        Project::from_json(include_str!("../../../examples/minimal.celesta.json")).unwrap();
    assert_eq!(project.version, ProjectVersion::V0);
    assert_eq!(project.effective_duration().unwrap(), Time::ZERO);
}

#[test]
fn calculates_duration_from_the_latest_item_end() {
    let project =
        Project::from_json(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    assert_eq!(project.effective_duration().unwrap(), Time::new(8, 1));
}

#[test]
fn pretty_serialization_round_trips() {
    let project =
        Project::from_json(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();

    let json = project.to_json().unwrap();

    assert!(json.ends_with('\n'));
    assert!(json.contains("\n  \"settings\":"));
    assert_eq!(Project::from_json(&json).unwrap(), project);
}

#[test]
fn reads_and_writes_an_items_blend_mode() {
    let mut project =
        Project::from_json(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    assert!(!project.to_json().unwrap().contains("blendMode"));

    let mut item = serde_json::to_value(&project.tracks[0].items[0]).unwrap();
    item["blendMode"] = "difference".into();
    project.tracks[0].items[0] = serde_json::from_value(item).unwrap();
    assert_eq!(
        project.tracks[0].items[0].blend_mode,
        Some(BlendMode::Difference)
    );
    assert!(
        project
            .to_json()
            .unwrap()
            .contains("\"blendMode\": \"difference\"")
    );

    let mut item = serde_json::to_value(&project.tracks[0].items[0]).unwrap();
    item["blendMode"] = "softLight".into();
    let item: TimelineItem = serde_json::from_value(item).unwrap();
    assert_eq!(item.blend_mode, Some(BlendMode::SoftLight));

    // Multi-word modes are camelCase, not CSS's kebab-case.
    let mut item = serde_json::to_value(&project.tracks[0].items[0]).unwrap();
    item["blendMode"] = "soft-light".into();
    assert!(serde_json::from_value::<TimelineItem>(item).is_err());
}

#[test]
fn validates_and_round_trips_effect_properties() {
    let mut project =
        Project::from_json(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    project.tracks[0].items[0].effects = Some(TimelineEffects {
        blur: Some(Animatable::Static(3.0)),
        shadow: Some(TimelineShadow {
            color: Animatable::Static("#00000080".to_owned()),
            blur: Animatable::Static(5.0),
            offset_x: Animatable::Static(4.0),
            offset_y: Animatable::Static(-2.0),
        }),
        ..TimelineEffects::default()
    });
    project.validate().unwrap();
    let json = project.to_json().unwrap();
    assert!(json.contains("\"offsetX\": 4.0"));
    assert_eq!(Project::from_json(&json).unwrap(), project);

    project.tracks[0].items[0]
        .effects
        .as_mut()
        .unwrap()
        .shadow
        .as_mut()
        .unwrap()
        .color = Animatable::Static("not-a-color".to_owned());
    let errors = project.validate().unwrap_err();
    assert!(errors.to_string().contains("effects.shadow.color"));
}

#[test]
fn validates_and_round_trips_color_filters() {
    let mut project =
        Project::from_json(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    let mut item = serde_json::to_value(&project.tracks[0].items[0]).unwrap();
    item["effects"] = serde_json::json!({
        "brightness": 1.2,
        "contrast": 0.8,
        "saturation": 0,
        "hue": -30,
        "grayscale": 0.5,
        "invert": 1,
        "tint": { "color": "#704214" },
        "vignette": { "amount": 0.6, "softness": 0.25 },
    });
    project.tracks[0].items[0] = serde_json::from_value(item).unwrap();
    project.validate().unwrap();
    let effects = project.tracks[0].items[0].effects.as_ref().unwrap();
    assert_eq!(effects.tint.as_ref().unwrap().amount, None);
    assert_eq!(effects.vignette.as_ref().unwrap().radius, None);
    assert_eq!(
        effects.vignette.as_ref().unwrap().softness,
        Some(Animatable::Static(0.25))
    );
    assert_eq!(
        Project::from_json(&project.to_json().unwrap()).unwrap(),
        project
    );

    let cases: [(&str, serde_json::Value, &str); 9] = [
        ("brightness", serde_json::json!(-0.5), "effects.brightness"),
        ("contrast", serde_json::json!(-1), "effects.contrast"),
        ("saturation", serde_json::json!(-0.1), "effects.saturation"),
        ("grayscale", serde_json::json!(1.5), "effects.grayscale"),
        ("invert", serde_json::json!(-1), "effects.invert"),
        (
            "tint",
            serde_json::json!({ "color": "orange" }),
            "effects.tint.color",
        ),
        (
            "tint",
            serde_json::json!({ "color": "#ffffff", "amount": 2 }),
            "effects.tint.amount",
        ),
        (
            "vignette",
            serde_json::json!({ "amount": 2 }),
            "effects.vignette.amount",
        ),
        (
            "vignette",
            serde_json::json!({ "amount": 1, "radius": -1 }),
            "effects.vignette.radius",
        ),
    ];
    for (name, value, path) in cases {
        let mut broken = project.clone();
        let mut item = serde_json::to_value(&broken.tracks[0].items[0]).unwrap();
        item["effects"][name] = value;
        broken.tracks[0].items[0] = serde_json::from_value(item).unwrap();
        let errors = broken.validate().unwrap_err().to_string();
        assert!(errors.contains(path), "{name}: {errors}");
    }
}

#[test]
fn validates_the_3d_transform_fields() {
    let project =
        Project::from_json(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    let with_transform = |transform: serde_json::Value| {
        let mut broken = project.clone();
        let mut item = serde_json::to_value(&broken.tracks[0].items[0]).unwrap();
        item["transform"] = transform;
        broken.tracks[0].items[0] = serde_json::from_value(item).unwrap();
        broken
    };

    with_transform(serde_json::json!({
        "skew": { "x": 10 },
        "rotationX": 30,
        "rotationY": -20,
        "perspective": 800,
        "backfaceVisibility": "hidden",
    }))
    .validate()
    .unwrap();

    let errors = with_transform(serde_json::json!({ "rotationX": 30, "perspective": 0 }))
        .validate()
        .unwrap_err()
        .to_string();
    assert!(errors.contains("transform.perspective"), "{errors}");
    assert!(errors.contains("must be finite and positive"), "{errors}");
    assert!(!errors.contains("rotationX"), "{errors}");

    let mut broken = with_transform(serde_json::json!({ "skew": { "y": 1 } }));
    broken.tracks[0].items[0]
        .transform
        .as_mut()
        .unwrap()
        .skew
        .as_mut()
        .unwrap()
        .x = Some(Animatable::Keyframes(
        celesta_composition::KeyframeAnimation {
            kind: celesta_composition::KeyframeAnimationType::Keyframes,
            keyframes: vec![celesta_composition::Keyframe {
                time: Time::ZERO,
                value: f64::INFINITY,
                easing: None,
            }],
        },
    ));
    let errors = broken.validate().unwrap_err().to_string();
    assert!(errors.contains("transform.skew.x"), "{errors}");
    assert!(errors.contains("must be finite"), "{errors}");
}

#[test]
fn validates_project_master_volume() {
    let mut project =
        Project::from_json(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    project.settings.master_volume = Some(-0.1);

    let errors = project.validate().unwrap_err();

    assert_eq!(errors.as_slice()[0].path, "settings.masterVolume");
}

fn audio_project_json(pitch: Option<Value>) -> String {
    let mut json: Value =
        serde_json::from_str(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    let mut content = serde_json::json!({"type": "audio", "asset": "voice-001"});
    if let Some(pitch) = pitch {
        content["pitch"] = pitch;
    }
    json["tracks"][0]["items"][0]["content"] = content;
    json.to_string()
}

fn audio_pitch_keyframes(values: [f64; 2]) -> Value {
    serde_json::json!({
        "type": "keyframes",
        "keyframes": [
            {"time": {"value": 0, "timescale": 60}, "value": values[0]},
            {"time": {"value": 60, "timescale": 60}, "value": values[1]},
        ],
    })
}

#[test]
fn validates_audio_pitch_range() {
    let pitch_path = "tracks[0].items[0].content.pitch";
    let rejected_path = |pitch: Value| {
        let LoadError::Validation(errors) =
            Project::from_json(&audio_project_json(Some(pitch))).unwrap_err()
        else {
            panic!("expected validation error");
        };
        assert_eq!(errors.as_slice().len(), 1);
        errors.as_slice()[0].path.clone()
    };

    assert_eq!(rejected_path(serde_json::json!(24.5)), pitch_path);
    assert_eq!(
        rejected_path(audio_pitch_keyframes([0.0, -25.0])),
        format!("{pitch_path}.keyframes[1].value")
    );

    // JSON cannot carry NaN, so set it on a valid project in memory.
    let mut project = Project::from_json(&audio_project_json(None)).unwrap();
    let TimelineContent::Audio { pitch, .. } = &mut project.tracks[0].items[0].content else {
        panic!("expected an audio item");
    };
    *pitch = Some(Animatable::Static(f64::NAN));
    let errors = project.validate().unwrap_err();
    assert_eq!(errors.as_slice().len(), 1);
    assert_eq!(errors.as_slice()[0].path, pitch_path);

    for pitch in [
        serde_json::json!(-24.0),
        serde_json::json!(24.0),
        audio_pitch_keyframes([0.0, 24.0]),
    ] {
        Project::from_json(&audio_project_json(Some(pitch)))
            .unwrap()
            .validate()
            .unwrap();
    }
}

#[test]
fn audio_items_without_pitch_round_trip_unchanged() {
    let project = Project::from_json(&audio_project_json(None)).unwrap();
    let first = project.to_json().unwrap();
    let second = Project::from_json(&first).unwrap().to_json().unwrap();

    assert_eq!(first, second);
    assert!(!first.contains("pitch"));
    assert!(!first.contains("preservePitch"));

    let mut json: Value = serde_json::from_str(&first).unwrap();
    json["tracks"][0]["items"][0]["content"]["pitch"] = serde_json::json!(-3.0);
    json["tracks"][0]["items"][0]["content"]["preservePitch"] = serde_json::json!(true);
    let saved = Project::from_json(&json.to_string())
        .unwrap()
        .to_json()
        .unwrap();
    assert!(saved.contains("\"pitch\": -3.0"));
    assert!(saved.contains("\"preservePitch\": true"));
}

#[test]
fn lip_sync_configuration_and_cues_round_trip() {
    let mut project =
        Project::from_json(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    project
        .characters
        .get_mut("akane")
        .unwrap()
        .portrait
        .as_mut()
        .unwrap()
        .lip_sync = Some(LipSyncDefinition {
        a: "akane-default".to_owned(),
        i: "akane-default".to_owned(),
        u: "akane-default".to_owned(),
        e: "akane-default".to_owned(),
        o: "akane-default".to_owned(),
        closed: Some("akane-default".to_owned()),
        transform: None,
    });
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

    let json = project.to_json().unwrap();
    let loaded = Project::from_json(&json).unwrap();

    assert_eq!(loaded, project);
    assert!(json.contains("\"lipSync\""));
    assert!(json.contains("\"shape\": \"a\""));
}

#[test]
fn lip_sync_cues_require_voice_and_strict_time_order() {
    let mut project =
        Project::from_json(include_str!("../../../examples/voiceroid.celesta.json")).unwrap();
    let TimelineContent::Dialogue {
        audio, lip_sync, ..
    } = &mut project.tracks[0].items[0].content
    else {
        panic!("example must contain dialogue")
    };
    *audio = None;
    *lip_sync = vec![
        LipSyncCue {
            time: Time::new(1, 1),
            shape: MouthShape::I,
        },
        LipSyncCue {
            time: Time::new(1, 1),
            shape: MouthShape::Closed,
        },
    ];

    let errors = project.validate().unwrap_err();

    assert!(
        errors
            .as_slice()
            .iter()
            .any(|error| error.path.ends_with("content.lipSync"))
    );
    assert!(errors.as_slice().iter().any(|error| {
        error.path.ends_with("content.lipSync[1].time")
            && error.message.contains("strictly ascending")
    }));
}
