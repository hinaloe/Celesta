//! Selecting a layer in the React preview: mapping a click on the viewer to
//! scene pixels, and what the Layer section shows for the selection.

use celesta_composition::Point;
use celesta_react_bridge::LayerSource;
use gpui_kit::{Bounds, Pixels};
use std::path::Path;

/// What looking up a layer's source returned: `Ok(None)` when the frame has
/// no layer with that id, `Ok(Some(chain))` with the JSX chain otherwise.
pub(crate) type LookupResult = Result<Option<Vec<LayerSource>>, String>;

/// Where the selected layer's source lookup stands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SourceLookup {
    Pending,
    NotInFrame,
    NoPosition,
    Found(Vec<LayerSource>),
    Failed(String),
}

/// Where the frame sits when it is fitted, aspect kept, into `bounds`:
/// `(left, top, scale)`, the left and top in the same space as `bounds`.
/// `None` for a frame or an area without size.
pub(crate) fn letterbox(
    bounds: Bounds<Pixels>,
    (frame_width, frame_height): (f32, f32),
) -> Option<(f32, f32, f32)> {
    let area_width = f32::from(bounds.size.width);
    let area_height = f32::from(bounds.size.height);
    if frame_width <= 0.0 || frame_height <= 0.0 || area_width <= 0.0 || area_height <= 0.0 {
        return None;
    }
    let scale = (area_width / frame_width).min(area_height / frame_height);
    let left = f32::from(bounds.origin.x) + (area_width - frame_width * scale) / 2.0;
    let top = f32::from(bounds.origin.y) + (area_height - frame_height * scale) / 2.0;
    Some((left, top, scale))
}

/// The scene pixel under `position` in the frame fitted into `bounds`, or
/// `None` when `position` is outside the frame (on a letterbox bar).
pub(crate) fn scene_point(
    bounds: Bounds<Pixels>,
    frame: (f32, f32),
    position: gpui_kit::Point<Pixels>,
) -> Option<Point> {
    let (left, top, scale) = letterbox(bounds, frame)?;
    let x = f64::from((f32::from(position.x) - left) / scale);
    let y = f64::from((f32::from(position.y) - top) / scale);
    ((0.0..=f64::from(frame.0)).contains(&x) && (0.0..=f64::from(frame.1)).contains(&y))
        .then_some(Point { x, y })
}

/// What the Layer section shows for a lookup's outcome.
pub(crate) fn source_lookup(result: LookupResult) -> SourceLookup {
    match result {
        Ok(None) => SourceLookup::NotInFrame,
        Ok(Some(chain)) if chain.is_empty() => SourceLookup::NoPosition,
        Ok(Some(chain)) => SourceLookup::Found(chain),
        Err(error) => SourceLookup::Failed(error),
    }
}

/// `file` relative to the entry's directory when it is inside it, and in
/// full otherwise.
pub(crate) fn display_path(file: &Path, entry_dir: &Path) -> String {
    file.strip_prefix(entry_dir)
        .unwrap_or(file)
        .display()
        .to_string()
}

/// `file:line:column` for `source`, the file as [`display_path`] shows it.
pub(crate) fn source_position(source: &LayerSource, entry_dir: &Path) -> String {
    format!(
        "{}:{}:{}",
        display_path(&source.file, entry_dir),
        source.line,
        source.column
    )
}
