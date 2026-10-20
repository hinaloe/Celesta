//! OpenType features (`fontFeatures`), shaped under families of their own.

use crate::fonts::TextRasterizer;
use celesta_composition::FontFeatures;
use cosmic_text::{Family, FeatureTag, fontdb};
use std::sync::Arc;

impl TextRasterizer {
    /// A family with `family`'s faces, for text shaped with `features`.
    /// cosmic-text shapes neighboring ranges as one piece unless their
    /// family, weight, style, or stretch differ, ignoring their features,
    /// so a `<Span>` that only changes features inside a word (`a===b`)
    /// would take the word's first features throughout. Each family and
    /// feature set therefore gets a family of its own. Its faces also keep
    /// `family`'s names, so code that tells a glyph's family by its face's
    /// names sees `family`. `None` is the default sans-serif family.
    pub(crate) fn feature_family(
        &mut self,
        family: Option<&str>,
        features: &FontFeatures,
    ) -> Arc<str> {
        let family = family.map_or_else(
            || {
                self.font_system
                    .db()
                    .family_name(&Family::SansSerif)
                    .to_owned()
            },
            str::to_owned,
        );
        let key = (family, features.clone());
        if let Some(alias) = self.feature_families.get(&key) {
            return Arc::clone(alias);
        }
        let settings: Vec<String> = features
            .iter()
            .map(|(tag, value)| format!("{tag}={value}"))
            .collect();
        let alias: Arc<str> = format!("{} [celesta-features {}]", key.0, settings.join(",")).into();
        let faces: Vec<fontdb::FaceInfo> = self
            .font_system
            .db()
            .faces()
            .filter(|face| face.families.iter().any(|(name, _)| *name == key.0))
            .cloned()
            .collect();
        if !faces.is_empty() {
            let database = self.font_system.db_mut();
            for mut face in faces {
                face.families
                    .push((alias.to_string(), fontdb::Language::English_UnitedStates));
                self.feature_faces.push(database.push_face_info(face));
            }
            // Other locales' systems are copies of the database without
            // these faces.
            self.locale_systems.clear();
        }
        self.feature_families.insert(key, Arc::clone(&alias));
        alias
    }

    /// Removes the faces [`Self::feature_family`] added, so the next one
    /// made for a family has the faces loaded since.
    pub(crate) fn drop_feature_families(&mut self) {
        // A family made before its font loaded has no faces at all.
        self.feature_families.clear();
        if self.feature_faces.is_empty() {
            return;
        }
        let database = self.font_system.db_mut();
        for id in self.feature_faces.drain(..) {
            database.remove_face(id);
        }
    }
}

/// `features` as cosmic-text takes them.
pub(crate) fn cosmic_features(features: &FontFeatures) -> cosmic_text::FontFeatures {
    let mut settings = cosmic_text::FontFeatures::new();
    for (tag, value) in features.iter() {
        // `FontFeatures` only holds four-character ASCII tags.
        let tag: [u8; 4] = tag.as_bytes().try_into().expect("a four-byte feature tag");
        settings.set(FeatureTag::new(&tag), value);
    }
    settings
}
