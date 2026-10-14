use crate::component_schema::ComponentSchemaRequest;
use crate::helpers::format_time;
use crate::media_probe::{MediaProbeRequest, ProbeAsset};
use crate::preview::{
    KeptSchema, PreviewRequest, ReactPreview, ReactPreviewContext, ReactPreviewMode,
};
use crate::problems::{Source, error_chain};
use crate::source::{REACT_PREVIEW_SAMPLE_RATE, watched_mtime};
use crate::timecode::format_timecode;
use crate::view::EditorView;
use celesta_composition::Time;
use celesta_editor_core::{EditorDocument, TimelineClock};
use celesta_gpu_renderer::RenderQuality;
use celesta_project::AssetKind;
use celesta_react_bridge::{
    PropertyInputs, PropertyIssue, ReactBridge, ReactBridgeError, ReactCompositionMetadata,
    runtime_paths as react_runtime_paths,
};
use gpui_kit::Context;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

/// What one background reload of a React entry produced.
pub(crate) struct ReactReload {
    pub(crate) watched: Option<SystemTime>,
    /// Inputs read from disk this time, even when the spawn then failed.
    pub(crate) properties: Option<PropertyInputs>,
    pub(crate) result: Result<(PathBuf, ReactCompositionMetadata), PreviewLoadError>,
}

/// Why a reload failed: the text shown to the user, and the per-property
/// issues when the entry rejected the values.
#[derive(Debug, Clone)]
pub(crate) struct PreviewLoadError {
    pub(crate) message: String,
    pub(crate) property_issues: Vec<PropertyIssue>,
}

impl PreviewLoadError {
    pub(crate) fn from_bridge(error: ReactBridgeError) -> Self {
        let message = error_chain(&error);
        let property_issues = match error {
            ReactBridgeError::InvalidProperties(issues) => issues,
            _ => Vec::new(),
        };
        Self {
            message,
            property_issues,
        }
    }
}

impl From<String> for PreviewLoadError {
    fn from(message: String) -> Self {
        Self {
            message,
            property_issues: Vec::new(),
        }
    }
}

/// Orders the React entry's reloads. Each reload gets a sequence number when
/// it is requested; a result is applied only when it is newer than every
/// result applied so far, so a slow older reload cannot undo a newer one.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ReloadOrder {
    requested: u64,
    applied: u64,
    running: u32,
}

impl ReloadOrder {
    /// Numbers a new reload.
    pub(crate) fn request(&mut self) -> u64 {
        self.requested += 1;
        self.running += 1;
        self.requested
    }

    /// The number the next requested reload will get: a reload with this
    /// number or higher starts after everything done so far.
    pub(crate) fn next(&self) -> u64 {
        self.requested + 1
    }

    /// The newest reload whose result was applied.
    pub(crate) fn applied(&self) -> u64 {
        self.applied
    }

    pub(crate) fn is_running(&self) -> bool {
        self.running > 0
    }

    /// Reload `sequence` finished; true when its result should be applied.
    pub(crate) fn finish(&mut self, sequence: u64) -> bool {
        self.running = self.running.saturating_sub(1);
        if sequence <= self.applied {
            return false;
        }
        self.applied = sequence;
        true
    }
}

/// Whether reload `sequence`'s mtime sample may replace the watched mtime,
/// which was last sampled with `watched_since` as the next reload number. An
/// older reload sampled before that, so its sample would move the watched
/// mtime back and make the watcher reload again.
pub(crate) fn reload_sample_applies(sequence: u64, watched_since: u64) -> bool {
    sequence >= watched_since
}

/// Folds a reload into the entry's property state: the inputs read from disk
/// are kept even when the spawn failed (`disk_properties`), but the inputs the
/// preview renders with (`properties`) only change on success. A failed load
/// keeps the last schema so the panel can still show (and fix) the wrong value.
/// A reload that could not read the props file keeps its message for the
/// section, since no property key owns it.
pub(crate) fn apply_property_outcome(preview: &mut ReactPreview, reload: &ReactReload) {
    preview.property_load_error = match (&reload.properties, &reload.result) {
        (None, Err(error)) => Some(error.message.clone()),
        _ => None,
    };
    if let Some(properties) = &reload.properties {
        preview.disk_properties = properties.clone();
    }
    match &reload.result {
        Ok((_, metadata)) => {
            // Only a load the entry accepted becomes what the preview renders with.
            if let Some(properties) = &reload.properties {
                preview.properties = properties.clone();
            }
            preview.property_schema = KeptSchema::from_metadata(metadata);
            preview.property_issues.clear();
        }
        Err(error) => preview.property_issues = error.property_issues.clone(),
    }
}

impl EditorView {
    /// `HH:MM:SS:FF` for a composition time, rounded to the nearest frame.
    pub(crate) fn timecode_for(&self, time: Time) -> String {
        self.clock.frame_for_time(time).map_or_else(
            |_| format_time(time),
            |frame| format_timecode(frame, self.frame_rate_value),
        )
    }

    pub(crate) fn is_react_preview(&self) -> bool {
        self.react_preview.is_some()
    }

    pub(crate) fn current_time(&self) -> Time {
        self.clock.time().unwrap_or(Time::ZERO)
    }

    pub(crate) fn refresh_preview(&mut self) {
        self.preview_generation = self.preview_generation.wrapping_add(1);
        let generation = self.preview_generation;
        // Component clips resolve against the project's React entry when one
        // is set; without it the preview still renders everything else and
        // surfaces a warning instead of failing outright.
        let react = self.document.react_entry_absolute_path().map(|entry| {
            let (node, cli_script) = react_runtime_paths();
            ReactPreviewContext {
                node,
                cli_script,
                entry,
                // A JSON project's components read its own `properties`, as
                // `celesta-exporter --react … --project …` passes them.
                properties: match &self.react_preview {
                    Some(react) => react.properties.clone(),
                    None => PropertyInputs::default().with_project(
                        self.document.project_properties(),
                        self.document.path(),
                        self.document.asset_root(),
                    ),
                },
            }
        });
        let react_mode = if self.is_react_preview() {
            ReactPreviewMode::WholeScene
        } else {
            ReactPreviewMode::ResolveComponents
        };
        match self.document.scene_at(self.current_time()) {
            // The warnings stay until the result replaces them, so their
            // counts don't flicker while frames are in flight.
            Ok(scene) => {
                self.preview_pending = true;
                if let Err(error) = self.preview_worker.request(PreviewRequest {
                    generation,
                    scene,
                    asset_root: self.document.asset_root().to_owned(),
                    react,
                    react_mode,
                    react_reload: self.react_reload_generation,
                    render_quality: if self.playing {
                        RenderQuality::Draft
                    } else {
                        RenderQuality::Final
                    },
                }) {
                    self.preview_pending = false;
                    self.problems.set_preview_warnings(Vec::new());
                    self.problems.fail(Source::Preview, error);
                }
            }
            Err(error) => {
                self.preview_pending = false;
                self.problems.set_preview_warnings(Vec::new());
                self.problems.fail(Source::Preview, error_chain(&error));
            }
        }
    }

    /// Reloads the standalone React composition: re-reads its `<Composition>`
    /// facts on a background thread (dimensions/fps/duration may have changed),
    /// then bumps the preview worker's reload generation so it respawns Node
    /// against the freshly re-bundled code. Used by the reload watcher and the
    /// manual Reload button.
    pub(crate) fn request_react_reload(&mut self, cx: &mut Context<Self>) {
        let Some(react) = self.react_preview.as_ref() else {
            return;
        };
        let entry = react.entry.clone();
        let property_args = react.property_args.clone();
        let (node, cli_script) = react_runtime_paths();
        let frame = self.clock.frame();
        let session = self.session;
        let sequence = self.react_reloads.request();
        cx.spawn(async move |view, cx| {
            let reload = cx
                .background_executor()
                .spawn(async move {
                    // Sampled before reading, so an edit made while Node starts
                    // still differs from it and triggers another reload.
                    let watched = watched_mtime(&entry, &property_args);
                    // Re-read --props-file so edits to a variant show up too.
                    match property_args.load(&entry) {
                        Ok(properties) => {
                            let result = ReactBridge::spawn_with_properties(
                                &node,
                                &cli_script,
                                &entry,
                                &properties,
                            )
                            .map(|bridge| (entry, bridge.metadata().clone()))
                            .map_err(PreviewLoadError::from_bridge);
                            ReactReload {
                                watched,
                                properties: Some(properties),
                                result,
                            }
                        }
                        Err(message) => ReactReload {
                            watched,
                            properties: None,
                            result: Err(message.into()),
                        },
                    }
                })
                .await;
            view.update(cx, |this, cx| {
                // Another file opened meanwhile; this result belongs to the old one.
                if this.session == session {
                    this.apply_react_reload(reload, sequence, frame, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn apply_react_reload(
        &mut self,
        reload: ReactReload,
        sequence: u64,
        frame: i64,
        cx: &mut Context<Self>,
    ) {
        // A newer reload already applied; this one read older files.
        if !self.react_reloads.finish(sequence) {
            cx.notify();
            return;
        }
        if let Some(react) = self.react_preview.as_mut() {
            if reload_sample_applies(sequence, self.watched_since) {
                react.watched_mtime = reload.watched;
            }
            apply_property_outcome(react, &reload);
            if reload.properties.is_some() {
                react.properties_read_reload = sequence;
            }
        }
        match reload.result {
            Ok((entry, metadata)) => {
                if let Ok(document) = EditorDocument::react_preview(
                    &entry,
                    metadata.width,
                    metadata.height,
                    metadata.frame_rate,
                    REACT_PREVIEW_SAMPLE_RATE,
                    metadata.duration_in_frames,
                ) {
                    self.document = document;
                    self.frame_rate_value = metadata.frame_rate;
                    if let Ok(mut clock) =
                        TimelineClock::new(self.document.duration(), self.frame_rate_value)
                    {
                        clock.seek(frame);
                        self.clock = clock;
                    }
                    self.dimensions = format!("{} x {}", metadata.width, metadata.height).into();
                    self.frame_rate_label = format!(
                        "{:.2} fps",
                        f64::from(metadata.frame_rate.numerator)
                            / f64::from(metadata.frame_rate.denominator)
                    )
                    .into();
                }
                self.react_reload_generation = self.react_reload_generation.wrapping_add(1);
                self.problems.clear(Source::Preview);
                self.refresh_preview();
                self.refresh_audio_preview();
            }
            Err(error) => {
                self.problems.report(
                    Source::Preview,
                    "React reload failed",
                    error.message.clone(),
                );
            }
        }
        cx.notify();
    }

    /// The periodic task (started once for a React-preview document) that
    /// notices source-file edits under the entry's directory and triggers a
    /// reload. Runs off the render loop so it fires even while the editor is
    /// idle.
    pub(crate) fn watch_react_entry(&self, cx: &mut Context<Self>) {
        let session = self.session;
        cx.spawn(async move |view, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(800))
                    .await;
                let Ok(Some((entry, property_args))) = view.update(cx, |this, _| {
                    this.react_preview
                        .as_ref()
                        .filter(|_| this.session == session)
                        .map(|react| (react.entry.clone(), react.property_args.clone()))
                }) else {
                    break;
                };
                let latest = cx
                    .background_executor()
                    .spawn(async move { watched_mtime(&entry, &property_args) })
                    .await;
                let changed = view
                    .update(cx, |this, _| match this.react_preview.as_ref() {
                        Some(react) => latest.is_some() && latest != react.watched_mtime,
                        None => false,
                    })
                    .unwrap_or(false);
                if changed
                    && view
                        .update(cx, |this, cx| {
                            if let Some(react) = this.react_preview.as_mut() {
                                react.watched_mtime = latest;
                            }
                            this.watched_since = this.react_reloads.next();
                            this.request_react_reload(cx);
                        })
                        .is_err()
                {
                    break;
                }
            }
        })
        .detach();
    }

    pub(crate) fn refresh_media_cache(&mut self) {
        self.media_generation = self.media_generation.wrapping_add(1);
        let generation = self.media_generation;
        let assets = self
            .assets
            .iter()
            .filter(|asset| matches!(asset.kind, AssetKind::Video | AssetKind::Audio))
            .filter_map(|asset| {
                Some(ProbeAsset {
                    id: asset.id.clone(),
                    path: asset.path.clone()?,
                })
            })
            .collect::<Vec<_>>();
        self.media_cache
            .retain(|id, _| assets.iter().any(|asset| asset.id == *id));
        if assets.is_empty() {
            self.media_pending = false;
            return;
        }
        self.media_pending = true;
        if let Err(error) = self
            .media_probe_worker
            .request(MediaProbeRequest { generation, assets })
        {
            self.media_pending = false;
            self.problems.fail(Source::Media, error);
        }
    }

    /// Queries the project's `react_entry` for its registered components'
    /// property schemas, which the inspector uses to label component props
    /// and project properties. Runs once per opened project rather than on
    /// every clip selection, since spawning Node is comparatively slow;
    /// File > Reload picks up entry edits.
    pub(crate) fn refresh_component_schemas(&mut self) {
        self.component_schema_generation = self.component_schema_generation.wrapping_add(1);
        let generation = self.component_schema_generation;
        let Some(entry) = self.document.react_entry_absolute_path() else {
            self.component_schema_pending = false;
            self.problems.clear(Source::Schemas);
            self.component_schemas.clear();
            self.project_property_schema = None;
            return;
        };
        self.component_schema_pending = true;
        let (node, cli_script) = react_runtime_paths();
        if let Err(error) = self
            .component_schema_worker
            .request(ComponentSchemaRequest {
                generation,
                node,
                cli_script,
                entry,
            })
        {
            self.component_schema_pending = false;
            self.problems.fail(Source::Schemas, error);
        }
    }
}

#[cfg(test)]
mod property_outcome {
    use super::*;
    use crate::source::PropertyArgs;
    use celesta_composition::Rational;
    use celesta_react_bridge::ComponentPropertyField;
    use std::collections::BTreeMap;

    fn field() -> ComponentPropertyField {
        ComponentPropertyField::Boolean {
            label: None,
            default_value: false,
        }
    }

    fn kept(keys: &[&str]) -> KeptSchema {
        KeptSchema {
            fields: keys
                .iter()
                .map(|key| ((*key).to_owned(), field()))
                .collect(),
            order: keys.iter().map(|key| (*key).to_owned()).collect(),
        }
    }

    fn preview(schema: Option<KeptSchema>) -> ReactPreview {
        ReactPreview {
            entry: PathBuf::from("film.tsx"),
            watched_mtime: None,
            property_args: PropertyArgs::default(),
            properties: PropertyInputs::default(),
            disk_properties: PropertyInputs::default(),
            property_schema: schema,
            property_issues: Vec::new(),
            property_load_error: None,
            properties_read_reload: 0,
        }
    }

    fn inputs(json: &str) -> PropertyInputs {
        PropertyInputs::load(None, Some(json)).unwrap()
    }

    fn metadata(keys: &[&str]) -> ReactCompositionMetadata {
        let declared = kept(keys);
        ReactCompositionMetadata {
            width: 1920,
            height: 1080,
            frame_rate: Rational {
                numerator: 30,
                denominator: 1,
            },
            duration_in_frames: 30,
            component_schemas: BTreeMap::new(),
            project_property_schema: (!keys.is_empty()).then_some(declared.fields),
            project_property_order: keys.iter().map(|key| (*key).to_owned()).collect(),
        }
    }

    fn issue(key: &str) -> PropertyIssue {
        PropertyIssue {
            key: key.to_owned(),
            source: "--props".to_owned(),
            message: "must be a boolean".to_owned(),
        }
    }

    #[test]
    fn a_failed_load_keeps_the_schema_and_records_issues() {
        let mut preview = preview(Some(kept(&["b", "a"])));
        let reload = ReactReload {
            watched: None,
            properties: None,
            result: Err(PreviewLoadError {
                message: "invalid project properties".to_owned(),
                property_issues: vec![issue("a")],
            }),
        };

        apply_property_outcome(&mut preview, &reload);

        assert_eq!(preview.property_schema, Some(kept(&["b", "a"])));
        assert_eq!(preview.property_issues, vec![issue("a")]);
    }

    #[test]
    fn a_reload_that_cannot_read_the_props_file_keeps_its_message() {
        let mut preview = preview(Some(kept(&["a"])));
        let unreadable = ReactReload {
            watched: None,
            properties: None,
            result: Err(PreviewLoadError::from(
                "Couldn’t read props.json".to_owned(),
            )),
        };

        apply_property_outcome(&mut preview, &unreadable);
        assert_eq!(
            preview.property_load_error.as_deref(),
            Some("Couldn’t read props.json")
        );
        // The last schema stays, so the section can still show the message.
        assert_eq!(preview.property_schema, Some(kept(&["a"])));

        // A reload that read the file, even one the entry then rejected, clears it.
        let rejected = ReactReload {
            watched: None,
            properties: Some(inputs(r#"{"a": 1}"#)),
            result: Err(PreviewLoadError::from("node exited".to_owned())),
        };
        apply_property_outcome(&mut preview, &rejected);
        assert_eq!(preview.property_load_error, None);
    }

    #[test]
    fn a_failed_load_still_updates_the_read_inputs() {
        let mut preview = preview(Some(kept(&["a"])));
        let fresh = inputs(r#"{"a": 1}"#);
        let reload = ReactReload {
            watched: None,
            properties: Some(fresh.clone()),
            result: Err(PreviewLoadError::from("node exited".to_owned())),
        };

        apply_property_outcome(&mut preview, &reload);

        assert_eq!(preview.disk_properties, fresh);
        assert_eq!(preview.properties, PropertyInputs::default());
        assert!(preview.property_issues.is_empty());
        assert_eq!(preview.property_schema, Some(kept(&["a"])));
    }

    #[test]
    fn a_successful_load_replaces_the_schema_and_clears_issues() {
        let mut preview = preview(Some(kept(&["old"])));
        preview.property_issues = vec![issue("old")];
        let reload = ReactReload {
            watched: None,
            properties: Some(inputs(r#"{"b": true}"#)),
            result: Ok((PathBuf::from("film.tsx"), metadata(&["b", "a"]))),
        };

        apply_property_outcome(&mut preview, &reload);

        assert_eq!(preview.property_schema, Some(kept(&["b", "a"])));
        assert!(preview.property_issues.is_empty());
        assert_eq!(preview.properties, inputs(r#"{"b": true}"#));
        assert_eq!(preview.disk_properties, inputs(r#"{"b": true}"#));
    }

    #[test]
    fn an_entry_without_properties_has_no_schema() {
        let mut preview = preview(Some(kept(&["a"])));
        let reload = ReactReload {
            watched: None,
            properties: Some(PropertyInputs::default()),
            result: Ok((PathBuf::from("film.tsx"), metadata(&[]))),
        };

        apply_property_outcome(&mut preview, &reload);

        assert_eq!(preview.property_schema, None);
    }

    #[test]
    fn a_reload_older_than_the_applied_one_is_dropped() {
        let mut order = ReloadOrder::default();
        let first = order.request();
        let second = order.request();
        assert!(order.is_running());
        assert_eq!(order.next(), second + 1);

        assert!(order.finish(second));
        assert_eq!(order.applied(), second);
        assert!(!order.finish(first));
        assert_eq!(order.applied(), second);
        assert!(!order.is_running());
    }

    #[test]
    fn the_watched_mtime_never_goes_back_to_an_older_sample() {
        let mut order = ReloadOrder::default();
        // R1 starts and samples, then a write samples a newer mtime.
        let first = order.request();
        let watched_since = order.next();
        let second = order.request();

        assert!(!reload_sample_applies(first, watched_since));
        assert!(reload_sample_applies(second, watched_since));
    }
}
