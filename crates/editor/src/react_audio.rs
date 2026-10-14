use crate::audio::take_latest;
use crate::problems::error_chain;
use celesta_composition::{AudioClip, AudioGraph};
use celesta_editor_core::{ClipKind, ClipSummary, TrackSummary};
use celesta_project::TrackKind;
use celesta_react_bridge::{PropertyInputs, ReactBridge};
use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;

pub(crate) struct ReactAudioRequest {
    pub(crate) generation: u64,
    pub(crate) node: PathBuf,
    pub(crate) cli_script: PathBuf,
    pub(crate) entry: PathBuf,
    pub(crate) properties: PropertyInputs,
    pub(crate) sample_rate: u32,
    pub(crate) master_volume: f64,
}

pub(crate) struct ReactAudioResult {
    pub(crate) generation: u64,
    pub(crate) graph: Result<AudioGraph, String>,
}

/// Spawns a transient `@celesta/cli` process, sweeps every frame of a
/// standalone entry for its `<Audio>` declarations, and returns the assembled
/// [`AudioGraph`] — the standalone-preview counterpart of the audio graph
/// `celesta-exporter` accumulates while rendering. Runs on its own thread
/// because `ReactBridge::spawn` and the per-frame sweep both block.
pub(crate) struct ReactAudioWorker {
    pub(crate) requests: mpsc::Sender<ReactAudioRequest>,
    pub(crate) results: mpsc::Receiver<ReactAudioResult>,
}

impl ReactAudioWorker {
    pub(crate) fn spawn() -> Result<Self, Box<dyn Error>> {
        let (request_tx, request_rx) = mpsc::channel::<ReactAudioRequest>();
        let (result_tx, result_rx) = mpsc::channel::<ReactAudioResult>();
        thread::Builder::new()
            .name("celesta-react-audio".to_owned())
            .spawn(move || {
                while let Ok(first) = request_rx.recv() {
                    let request = take_latest(first, &request_rx);
                    let entry_dir = request
                        .entry
                        .parent()
                        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
                    let graph = ReactBridge::spawn_with_properties(
                        &request.node,
                        &request.cli_script,
                        &request.entry,
                        &request.properties,
                    )
                    .map_err(|error| error_chain(&error))
                    .and_then(|mut bridge| {
                        bridge
                            .collect_audio_graph(
                                request.sample_rate,
                                request.master_volume,
                                &entry_dir,
                            )
                            .map_err(|error| error_chain(&error))
                    });
                    if result_tx
                        .send(ReactAudioResult {
                            generation: request.generation,
                            graph,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            })?;
        Ok(Self {
            requests: request_tx,
            results: result_rx,
        })
    }

    pub(crate) fn request(&self, request: ReactAudioRequest) -> Result<(), String> {
        self.requests
            .send(request)
            .map_err(|_| "react audio worker stopped unexpectedly".to_owned())
    }
}

/// The timeline's audio tracks for a standalone React composition: one per
/// source file, in the order the files are first heard. Clips of one file
/// that play at the same time take as many tracks as they need.
pub(crate) fn react_audio_tracks(clips: &[AudioClip]) -> Vec<TrackSummary> {
    let mut sources: Vec<(&str, Vec<&AudioClip>)> = Vec::new();
    for clip in clips {
        match sources.iter_mut().find(|(src, _)| *src == clip.asset.id) {
            Some((_, group)) => group.push(clip),
            None => sources.push((&clip.asset.id, vec![clip])),
        }
    }
    let mut tracks = Vec::new();
    for (src, mut group) in sources {
        group.sort_by(|a, b| seconds(a.range.start).total_cmp(&seconds(b.range.start)));
        let name = source_name(src);
        // Each track of this file and the second its last clip ends.
        let mut lanes: Vec<(TrackSummary, f64)> = Vec::new();
        for clip in group {
            let start = seconds(clip.range.start);
            let end = clip.range.end().map_or(start, seconds);
            let lane = match lanes.iter().position(|(_, lane_end)| *lane_end <= start) {
                Some(index) => index,
                None => {
                    lanes.push((
                        TrackSummary {
                            id: format!("react-audio-track:{}", tracks.len() + lanes.len()),
                            name: name.clone(),
                            kind: TrackKind::Audio,
                            item_count: 0,
                            clips: Vec::new(),
                            enabled: true,
                            locked: false,
                            muted: false,
                            solo: false,
                        },
                        start,
                    ));
                    lanes.len() - 1
                }
            };
            let (track, lane_end) = &mut lanes[lane];
            track.clips.push(ClipSummary {
                id: clip.id.clone(),
                name: name.clone(),
                start: clip.range.start,
                duration: clip.range.duration,
                kind: ClipKind::Audio,
                enabled: !clip.muted,
                volume: Some(clip.volume.clone()),
                component: None,
                dialogue: None,
            });
            track.item_count += 1;
            *lane_end = end;
        }
        tracks.extend(lanes.into_iter().map(|(track, _)| track));
    }
    tracks
}

fn seconds(time: celesta_composition::Time) -> f64 {
    time.as_seconds().unwrap_or(0.0)
}

/// A clip's `src` as the timeline names it: the file name, or the whole
/// `src` when it has none.
fn source_name(src: &str) -> String {
    Path::new(src).file_name().map_or_else(
        || src.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}
