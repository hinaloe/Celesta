//! Pins `evaluate_f64` / `integrate_f64` to `tests/fixtures/keyframe-evaluation.json`,
//! which `packages/web/test/keyframes.test.mjs` checks the browser port against.

use celesta_composition::{Animatable, Time, evaluate_f64, integrate_f64};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    animation: Animatable<f64>,
    samples: Vec<Sample>,
}

#[derive(Deserialize)]
struct Sample {
    time: Time,
    value: Option<f64>,
    integral: Option<f64>,
}

fn matches(expected: Option<f64>, actual: f64) -> bool {
    expected.is_some_and(|expected| (expected - actual).abs() <= 1e-9)
}

#[test]
fn keyframe_fixture_matches_the_evaluator() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("fixtures/keyframe-evaluation.json")).unwrap();
    let mut mismatches = Vec::new();
    for case in &fixture.cases {
        for sample in &case.samples {
            let value = evaluate_f64(&case.animation, sample.time).unwrap();
            let integral = integrate_f64(&case.animation, sample.time).unwrap();
            if !matches(sample.value, value) || !matches(sample.integral, integral) {
                mismatches.push(format!(
                    "{} @ {}/{}: value {value:?}, integral {integral:?}",
                    case.name, sample.time.value, sample.time.timescale
                ));
            }
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}
