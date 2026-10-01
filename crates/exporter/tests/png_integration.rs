use std::path::{Path, PathBuf};
use std::process::Command;

use celesta_exporter::{ExportOptions, ExportProgress, Exporter, ReactRuntimeOptions};
use celesta_project::Project;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn pixels(path: &Path) -> Vec<u8> {
    let mut reader = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(path).unwrap()))
        .read_info()
        .unwrap();
    assert_eq!((reader.info().width, reader.info().height), (3, 3));
    assert_eq!(reader.info().color_type, png::ColorType::Rgba);
    let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
    reader.next_frame(&mut pixels).unwrap();
    pixels
}

#[test]
fn json_cli_exports_first_last_and_rejects_overwrite_and_invalid_frames() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = Project::load(root().join("examples/minimal.celesta.json")).unwrap();
    project.settings.width = 3;
    project.settings.height = 3;
    project.settings.duration = Some(celesta_composition::Time::new(1, 1));
    project.settings.frame_rate = celesta_composition::Rational::new(4, 1);
    let source = dir.path().join("project.celesta.json");
    std::fs::write(&source, serde_json::to_vec(&project).unwrap()).unwrap();
    let output = dir.path().join("check.png");
    let invoke = |frames: &str, extra: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_celesta-exporter"))
            .arg(&source)
            .args(["--frames", frames])
            .args(extra)
            .arg(&output)
            .output()
            .unwrap()
    };
    let result = invoke("0,3", &[]);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(pixels(&dir.path().join("check-000000.png")).len(), 36);
    assert_eq!(pixels(&dir.path().join("check-000003.png")).len(), 36);
    assert!(!invoke("0,3", &[]).status.success());
    assert!(invoke("0,3", &["--overwrite"]).status.success());
    let invalid = invoke("0,4", &["--overwrite"]);
    assert!(!invalid.status.success());
    assert!(String::from_utf8_lossy(&invalid.stderr).contains("frame 4 is out of range"));
    assert!(!invoke("-1", &[]).status.success());
    assert!(!invoke("0", &["--from", "0"]).status.success());
    assert!(!invoke("0", &["--output-format", "mp4"]).status.success());
}

#[test]
fn react_png_preserves_sequence_boundaries_and_prepares_once_without_audio_mix() {
    let runtime_path = root().join("packages/react/dist/cli.js");
    if !runtime_path.exists() {
        eprintln!("skipping React PNG test: build packages/react first");
        return;
    }
    let dir = tempfile::tempdir_in(root().join("packages/react")).unwrap();
    let entry = dir.path().join("film.tsx");
    std::fs::write(
        &entry,
        r##"
import { Composition, Rect, Sequence, Audio } from '@celesta/react';
import { appendFileSync } from 'node:fs';
export async function prepare() { appendFileSync(PREPARED_PATH, 'once\n'); }
export default function Root() {
  return <Composition width={3} height={3} fps={4} durationInFrames={4}>
    <Sequence from={0} durationInFrames={2}><Rect width={3} height={3} fill="#ff0000" /></Sequence>
    <Sequence from={2} durationInFrames={2}><Rect width={3} height={3} fill="#0000ff" /></Sequence>
    <Audio src="./missing-audio.wav" />
  </Composition>;
}
"##
        .replace(
            "PREPARED_PATH",
            &serde_json::to_string(&dir.path().join("prepared.txt")).unwrap(),
        ),
    )
    .unwrap();
    let mut progress = Vec::new();
    Exporter::new(ExportOptions::default())
        .export_react_png(
            &entry,
            &ReactRuntimeOptions::new("node", runtime_path),
            None,
            &[0, 1, 2, 3],
            &dir.path().join("check.png"),
            |event| progress.push(event),
        )
        .unwrap();
    for frame in [0, 1] {
        assert_eq!(
            &pixels(&dir.path().join(format!("check-{frame:06}.png")))[..4],
            &[255, 0, 0, 255]
        );
    }
    for frame in [2, 3] {
        assert_eq!(
            &pixels(&dir.path().join(format!("check-{frame:06}.png")))[..4],
            &[0, 0, 255, 255]
        );
    }
    assert_eq!(
        std::fs::read_to_string(dir.path().join("prepared.txt")).unwrap(),
        "once\n"
    );
    assert!(
        !progress
            .iter()
            .any(|event| matches!(event, ExportProgress::MixingAudio | ExportProgress::Muxing))
    );
}
