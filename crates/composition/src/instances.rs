//! The shapes and columns of a `LayerContent::Instances` layer.

use std::ops::Deref;
use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};

use crate::model::ResolvedAsset;
use crate::tagged::TypeTagged;

/// What every particle of an `Instances` layer draws.
// Deserialized through `InstanceShapeDef`, which keeps the same serde field attributes.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "codegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "codegen", ts(export))]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum InstanceShape {
    /// A rect of the particle's size, rounded by `corner_radius`.
    Rect { corner_radius: f64 },
    /// A rect rounded by half its shorter side.
    Circle,
    /// The image at the particle's size, its natural size by default.
    Image { asset: ResolvedAsset },
}

impl<'de> Deserialize<'de> for InstanceShape {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        InstanceShapeDef::deserialize(TypeTagged(deserializer))
    }
}

/// `InstanceShape` without the `type` tag, which [`TypeTagged`] reads instead.
#[derive(Deserialize)]
#[serde(
    remote = "InstanceShape",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum InstanceShapeDef {
    Rect { corner_radius: f64 },
    Circle,
    Image { asset: ResolvedAsset },
}

/// One `f32` per particle, sent as base64 of its little-endian bytes so
/// neither side formats or parses a number per particle.
#[derive(Clone, Debug, PartialEq)]
pub struct F32Column(pub Arc<[f32]>);

/// Bytes per particle (straight RGBA for colours), sent as base64.
#[derive(Clone, Debug, PartialEq)]
pub struct U8Column(pub Arc<[u8]>);

impl Deref for F32Column {
    type Target = [f32];

    fn deref(&self) -> &[f32] {
        &self.0
    }
}

impl Deref for U8Column {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        &self.0
    }
}

impl From<Vec<f32>> for F32Column {
    fn from(values: Vec<f32>) -> Self {
        Self(values.into())
    }
}

impl From<Vec<u8>> for U8Column {
    fn from(values: Vec<u8>) -> Self {
        Self(values.into())
    }
}

impl Serialize for F32Column {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let bytes: Vec<u8> = self.iter().flat_map(|value| value.to_le_bytes()).collect();
        serializer.serialize_str(&STANDARD.encode(bytes))
    }
}

impl Serialize for U8Column {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(&self.0))
    }
}

fn decode<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
    struct Base64;

    impl de::Visitor<'_> for Base64 {
        type Value = Vec<u8>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a base64 string")
        }

        fn visit_str<E: de::Error>(self, value: &str) -> Result<Vec<u8>, E> {
            STANDARD.decode(value).map_err(E::custom)
        }
    }

    deserializer.deserialize_str(Base64)
}

impl<'de> Deserialize<'de> for F32Column {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let bytes = decode(deserializer)?;
        if bytes.len() % 4 != 0 {
            return Err(de::Error::custom(format!(
                "a column of f32s has {} bytes, not a multiple of 4",
                bytes.len()
            )));
        }
        Ok(Self(
            bytes
                .as_chunks::<4>()
                .0
                .iter()
                .map(|&chunk| f32::from_le_bytes(chunk))
                .collect(),
        ))
    }
}

impl<'de> Deserialize<'de> for U8Column {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        decode(deserializer).map(|bytes| Self(bytes.into()))
    }
}
