use crate::audio::take_latest;
use crate::problems::error_chain;
use crate::view::EditorView;
use celesta_react_bridge::runtime_paths as react_runtime_paths;
use celesta_react_bridge::{OccurrenceIndex, PropertyInputs, ReactBridge, SpawnOptions};
use std::error::Error;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;

/// Frames asked of the bridge per `collectOccurrences` request; a reload
/// abandons the running sweep at the next chunk boundary.
pub(crate) const CHUNK_FRAMES: u64 = 240;

pub(crate) struct OccurrenceRequest {
    pub(crate) generation: u64,
    pub(crate) node: PathBuf,
    pub(crate) cli_script: PathBuf,
    pub(crate) entry: PathBuf,
    pub(crate) properties: PropertyInputs,
    pub(crate) composition_id: String,
    pub(crate) duration_in_frames: u64,
}

pub(crate) struct OccurrenceResult {
    pub(crate) generation: u64,
    pub(crate) index: Result<OccurrenceIndex, String>,
}

/// Where each element of a standalone entry renders, swept over every frame
/// of the composition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum OccurrenceState {
    Scanning,
    Ready(OccurrenceIndex),
    Failed(String),
}

/// Spawns a transient `@celesta/cli` process with source locations and
/// sweeps the whole composition for where each element renders. Runs on its
/// own thread because `ReactBridge::spawn` and the sweep both block; a newer
/// request abandons the running sweep between chunks.
pub(crate) struct OccurrenceWorker {
    pub(crate) requests: mpsc::Sender<OccurrenceRequest>,
    pub(crate) results: mpsc::Receiver<OccurrenceResult>,
}

impl OccurrenceWorker {
    pub(crate) fn spawn() -> Result<Self, Box<dyn Error>> {
        let (request_tx, request_rx) = mpsc::channel::<OccurrenceRequest>();
        let (result_tx, result_rx) = mpsc::channel::<OccurrenceResult>();
        thread::Builder::new()
            .name("celesta-occurrences".to_owned())
            .spawn(move || {
                // A request that arrived during a sweep, which it abandoned.
                let mut pending: Option<OccurrenceRequest> = None;
                loop {
                    let first = match pending.take() {
                        Some(request) => request,
                        None => match request_rx.recv() {
                            Ok(request) => request,
                            Err(_) => break,
                        },
                    };
                    let request = take_latest(first, &request_rx);
                    let index = match ReactBridge::spawn_with_options(
                        &request.node,
                        &request.cli_script,
                        &request.entry,
                        &request.properties,
                        SpawnOptions {
                            composition_id: Some(request.composition_id),
                            source_locations: true,
                        },
                    ) {
                        Ok(mut bridge) => {
                            bridge.set_preview(true);
                            let swept = sweep(
                                request.duration_in_frames,
                                |from, frames| {
                                    bridge
                                        .collect_occurrences(from, frames)
                                        .map_err(|error| error_chain(&error))
                                },
                                || match request_rx.try_recv() {
                                    Ok(next) => {
                                        pending = Some(next);
                                        true
                                    }
                                    Err(_) => false,
                                },
                            );
                            match swept {
                                Some(index) => index,
                                None => continue,
                            }
                        }
                        Err(error) => Err(error_chain(&error)),
                    };
                    if result_tx
                        .send(OccurrenceResult {
                            generation: request.generation,
                            index,
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

    pub(crate) fn request(&self, request: OccurrenceRequest) -> Result<(), String> {
        self.requests
            .send(request)
            .map_err(|_| "occurrence worker stopped unexpectedly".to_owned())
    }
}

/// Asks `chunk` for `[from, from + frames)` in [`CHUNK_FRAMES`] pieces over
/// `duration` frames and merges what each finds. `None` when `cancelled()`
/// turned true between chunks; the first chunk's error ends the sweep.
pub(crate) fn sweep(
    duration: u64,
    mut chunk: impl FnMut(u64, u64) -> Result<OccurrenceIndex, String>,
    mut cancelled: impl FnMut() -> bool,
) -> Option<Result<OccurrenceIndex, String>> {
    let mut index = OccurrenceIndex::default();
    let mut from = 0;
    while from < duration {
        if from > 0 && cancelled() {
            return None;
        }
        let frames = CHUNK_FRAMES.min(duration - from);
        match chunk(from, frames) {
            Ok(found) => index.merge(found),
            Err(error) => return Some(Err(error)),
        }
        from += frames;
    }
    Some(Ok(index))
}

/// Whether a sweep for reload `result` lands: it belongs to the `current`
/// reload and an index is still `wanted` (Select layers was not turned off
/// while it ran).
pub(crate) const fn accepts(current: u64, result: u64, wanted: bool) -> bool {
    wanted && current == result
}

impl EditorView {
    /// Starts sweeping the React entry for where each element renders,
    /// tagged with the current reload. Only a preview that picks layers
    /// (Select layers on) can select anything to show the impact of; any
    /// other state has nothing to sweep.
    pub(crate) fn refresh_occurrences(&mut self) {
        let react = match &self.react_preview {
            Some(react) if self.picks_layers() => react,
            _ => {
                self.occurrences = None;
                return;
            }
        };
        let generation = self.react_reload_generation;
        let (node, cli_script) = react_runtime_paths();
        let state = match self.occurrence_worker.request(OccurrenceRequest {
            generation,
            node,
            cli_script,
            entry: react.entry.clone(),
            properties: react.properties.clone(),
            composition_id: react.composition_id.clone(),
            duration_in_frames: u64::try_from(self.clock.end_frame()).unwrap_or(0),
        }) {
            Ok(()) => OccurrenceState::Scanning,
            Err(error) => OccurrenceState::Failed(error),
        };
        self.occurrences = Some((generation, state));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use celesta_react_bridge::{ElementOccurrences, InstanceOccurrences, SourcePos};

    /// An index in which one element renders over `[from, to)`.
    fn rendered(from: u64, to: u64) -> OccurrenceIndex {
        let element = SourcePos {
            file: "/a/title.tsx".into(),
            line: 3,
            column: 4,
        };
        OccurrenceIndex {
            elements: vec![ElementOccurrences {
                element: element.clone(),
                instances: vec![InstanceOccurrences {
                    chain: vec![element],
                    ranges: vec![(from, to)],
                    max_per_frame: 1,
                }],
            }],
        }
    }

    #[test]
    fn sweep_asks_for_every_chunk_and_merges() {
        let mut calls = Vec::new();
        let index = sweep(
            500,
            |from, frames| {
                calls.push((from, frames));
                Ok(rendered(from, from + frames))
            },
            || false,
        );
        assert_eq!(calls, [(0, 240), (240, 240), (480, 20)]);
        assert_eq!(index, Some(Ok(rendered(0, 500))));
    }

    #[test]
    fn sweep_stops_between_chunks_when_cancelled() {
        let mut calls = 0;
        let index = sweep(
            500,
            |from, frames| {
                calls += 1;
                Ok(rendered(from, from + frames))
            },
            || true,
        );
        assert_eq!(index, None);
        assert_eq!(calls, 1);
    }

    #[test]
    fn sweep_reports_the_first_chunk_error() {
        let index = sweep(
            500,
            |from, frames| {
                if from == 240 {
                    Err("frame 400: boom".to_owned())
                } else {
                    Ok(rendered(from, from + frames))
                }
            },
            || false,
        );
        assert_eq!(index, Some(Err("frame 400: boom".to_owned())));
    }

    #[test]
    fn a_result_for_an_older_reload_is_dropped() {
        assert!(!accepts(3, 2, true));
        assert!(accepts(3, 3, true));
    }

    #[test]
    fn a_result_after_select_layers_turned_off_is_dropped() {
        assert!(!accepts(3, 3, false));
    }
}
