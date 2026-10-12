//! The `<Static>` subtrees the Node runtime has sent, kept so a frame can
//! refer to one by key instead of sending its layers again.

use std::collections::HashMap;

use celesta_composition::{Layer, LayerContent, Scene};

use crate::error::ReactBridgeError;

#[derive(Default)]
pub(crate) struct StaticCache {
    layers: HashMap<u32, Vec<Layer>>,
    /// The `seq` of the last frame decoded, which frame requests report so
    /// Node knows which definitions arrived; 0 before any.
    decoded: u64,
}

impl StaticCache {
    pub(crate) const fn decoded(&self) -> u64 {
        self.decoded
    }

    /// Takes in a frame's definitions, replaces every `StaticRef` in
    /// `scene` with a `Group` of the layers it refers to, then forgets the
    /// `dropped` keys. A reference to a key this cache does not have empties
    /// the cache and resets `decoded`, so Node sends every definition again.
    pub(crate) fn apply(
        &mut self,
        seq: Option<u64>,
        defined: HashMap<u32, Vec<Layer>>,
        dropped: Vec<u32>,
        scene: &mut Scene,
    ) -> Result<(), ReactBridgeError> {
        self.layers.extend(defined);
        if let Err(error) = expand(&self.layers, &mut scene.layers) {
            self.layers.clear();
            self.decoded = 0;
            return Err(error);
        }
        for key in dropped {
            self.layers.remove(&key);
        }
        if let Some(seq) = seq {
            self.decoded = seq;
        }
        Ok(())
    }
}

fn expand(
    statics: &HashMap<u32, Vec<Layer>>,
    layers: &mut [Layer],
) -> Result<(), ReactBridgeError> {
    for layer in layers {
        match &mut layer.content {
            LayerContent::StaticRef { key } => {
                let children = statics
                    .get(key)
                    .ok_or(ReactBridgeError::MissingStatic(*key))?;
                layer.content = LayerContent::Group {
                    layers: children.clone(),
                    clip: None,
                    mask: None,
                };
            }
            LayerContent::Group { layers, mask, .. } => {
                expand(statics, layers)?;
                if let Some(mask) = mask {
                    expand(statics, &mut mask.layers)?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}
