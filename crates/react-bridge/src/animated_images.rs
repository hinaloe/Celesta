use celesta_composition::{AssetLocation, Layer, LayerContent};
use celesta_remote::resolve_asset_path;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

/// Which image assets are animated. Every React `<Image>` carries the time
/// an animated image would be drawn at, since the runtime cannot tell; an
/// image that is not animated loses it here, so its layer stays the same
/// from frame to frame (for loop checks and caches) as it was before images
/// could animate.
pub(crate) struct AnimatedImages {
    /// What relative paths resolve against: the entry's directory.
    asset_root: PathBuf,
    known: HashMap<AssetLocation, bool>,
}

impl AnimatedImages {
    pub(crate) fn new(asset_root: PathBuf) -> Self {
        Self {
            asset_root,
            known: HashMap::new(),
        }
    }

    /// Drops the animation time from every image in `layers` that is not
    /// animated.
    pub(crate) fn apply(&mut self, layers: &mut [Layer]) {
        for layer in layers {
            match &mut layer.content {
                LayerContent::Image {
                    asset, animation, ..
                } if animation.is_some() => {
                    if !self.is_animated(&asset.location) {
                        *animation = None;
                    }
                }
                LayerContent::Group { layers, mask, .. } => {
                    self.apply(layers);
                    if let Some(mask) = mask {
                        self.apply(&mut mask.layers);
                    }
                }
                _ => {}
            }
        }
    }

    /// Whether the image at `location` is animated. One that cannot be read
    /// keeps its time, and is looked at again on a later frame: the
    /// renderer reports why it cannot be drawn.
    fn is_animated(&mut self, location: &AssetLocation) -> bool {
        if let Some(&animated) = self.known.get(location) {
            return animated;
        }
        let Some(data) = read(&self.asset_root, location) else {
            return true;
        };
        let animated = celesta_renderer::image_source::is_animated(&data);
        self.known.insert(location.clone(), animated);
        animated
    }
}

fn read(asset_root: &Path, location: &AssetLocation) -> Option<Vec<u8>> {
    std::fs::read(resolve_asset_path(asset_root, location).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use celesta_composition::ImageAnimation;

    fn image(path: &str) -> Layer {
        serde_json::from_value(serde_json::json!({
            "id": path,
            "transform": {
                "position": { "x": 0.0, "y": 0.0 },
                "anchor": { "x": 0.0, "y": 0.0 },
                "scale": { "x": 1.0, "y": 1.0 },
                "rotation": 0.0,
            },
            "content": {
                "type": "image",
                "asset": { "id": path, "location": { "type": "file", "path": path } },
                "animation": { "sourceTimeSeconds": 0.5, "loop": true },
            },
        }))
        .unwrap()
    }

    fn animation(layer: &Layer) -> Option<ImageAnimation> {
        match &layer.content {
            LayerContent::Image { animation, .. } => *animation,
            LayerContent::Group { layers, .. } => animation(&layers[0]),
            _ => unreachable!(),
        }
    }

    #[test]
    fn keeps_the_time_of_animated_images_only() {
        let mut group = image("assets/checker.ppm");
        group.content = LayerContent::Group {
            layers: vec![image("assets/checker.ppm")],
            clip: None,
            mask: None,
            motion_blur: false,
        };
        let mut layers = vec![
            image("fixtures/two-frames.webp"),
            group,
            image("missing.gif"),
        ];
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../renderer/tests");
        AnimatedImages::new(root).apply(&mut layers);
        assert!(animation(&layers[0]).is_some());
        assert_eq!(animation(&layers[1]), None);
        // Unreadable: the renderer reports it.
        assert!(animation(&layers[2]).is_some());
    }
}
