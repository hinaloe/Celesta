//! Pins `duck_curve` to `tests/fixtures/duck-curves.json`, which
//! `packages/media-utils/test/duck.test.mts` checks `duckEnvelope` against.

use celesta_composition::{
    Animatable, AudioDuck, DuckGroups, DuckLevel, Keyframe, Time, duck_curve,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    intervals: Vec<(f64, f64)>,
    duck: Authored,
    curve: Animatable<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Authored {
    to: Option<DuckLevel>,
    attack: Option<f64>,
    release: Option<f64>,
    hold_gap: Option<f64>,
}

fn time(seconds: Option<f64>) -> Option<Time> {
    seconds.map(|seconds| Time::new((seconds * 1_000_000.0).round() as i64, 1_000_000))
}

fn keyframes(curve: &Animatable<f64>) -> Option<&[Keyframe<f64>]> {
    match curve {
        Animatable::Keyframes(animation) => Some(&animation.keyframes),
        Animatable::Static(_) => None,
    }
}

#[test]
fn duck_fixture_matches_duck_curve() {
    let fixture: Fixture = serde_json::from_str(include_str!("fixtures/duck-curves.json")).unwrap();
    for case in fixture.cases {
        let duck = AudioDuck::resolve(
            &DuckGroups::One("voice".to_owned()),
            case.duck.to,
            time(case.duck.attack),
            time(case.duck.release),
            time(case.duck.hold_gap),
        )
        .unwrap();
        let curve = duck_curve(&case.intervals, &duck).unwrap();
        match (keyframes(&case.curve), keyframes(&curve)) {
            (None, None) => assert_eq!(curve, case.curve, "{}", case.name),
            (Some(expected), Some(actual)) => {
                assert_eq!(actual.len(), expected.len(), "{}: {actual:?}", case.name);
                for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
                    let at = format!("{} key {index}", case.name);
                    assert_eq!(actual.time.value, expected.time.value, "{at}");
                    assert_eq!(actual.time.timescale, expected.time.timescale, "{at}");
                    assert!(
                        (actual.value - expected.value).abs() <= 1e-12,
                        "{at}: {}",
                        actual.value
                    );
                    assert_eq!(actual.easing, expected.easing, "{at}");
                }
            }
            _ => panic!("{}: expected {:?}, got {curve:?}", case.name, case.curve),
        }
    }
}
