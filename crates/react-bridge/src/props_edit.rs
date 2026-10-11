//! Writes one property into a JSON props file, leaving the rest of the file's
//! keys exactly where they were.
//!
//! The editor's Properties section edits the file the user (or another
//! editor) also touches, so every edit re-reads the file, changes a single
//! key and writes the whole file back through a temporary file in the same
//! folder. A file that is not a JSON object is never written.

use serde::de::{MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::error::Error;
use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// A JSON object's entries in the order they appear in the text.
///
/// `serde_json::Map` sorts keys unless its `preserve_order` feature is on,
/// which would reshuffle a hand-written props file on the first edit.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OrderedObject(pub Vec<(String, Value)>);

impl<'de> Deserialize<'de> for OrderedObject {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectVisitor;

        impl<'de> Visitor<'de> for ObjectVisitor {
            type Value = OrderedObject;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON object")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut entries = Vec::with_capacity(map.size_hint().unwrap_or(0));
                while let Some(entry) = map.next_entry::<String, Value>()? {
                    entries.push(entry);
                }
                Ok(OrderedObject(entries))
            }
        }

        deserializer.deserialize_map(ObjectVisitor)
    }
}

impl Serialize for OrderedObject {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in &self.0 {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

#[derive(Debug)]
pub enum PropsEditError {
    /// The file could not be read or written.
    Io { file: PathBuf, source: io::Error },
    /// The file is not a JSON object, so it was left untouched.
    Invalid { file: PathBuf, message: String },
}

impl fmt::Display for PropsEditError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { file, source } => {
                write!(formatter, "Couldn’t write {}: {source}", file.display())
            }
            Self::Invalid { file, message } => {
                let name = file.file_name().map_or_else(
                    || file.display().to_string(),
                    |name| name.to_string_lossy().into_owned(),
                );
                write!(formatter, "Fix {name} before editing: {message}")
            }
        }
    }
}

impl Error for PropsEditError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::Invalid { .. } => None,
        }
    }
}

/// Sets `key` to `value`, or removes it for `None`. A missing file counts as
/// `{}`, so the first edit creates it. An existing key keeps its position and
/// a new key is appended; every other key is written back as read.
pub fn set_property(file: &Path, key: &str, value: Option<&Value>) -> Result<(), PropsEditError> {
    let io_error = |source| PropsEditError::Io {
        file: file.to_owned(),
        source,
    };

    let mut object = match fs::read_to_string(file) {
        Ok(text) => serde_json::from_str::<OrderedObject>(&text).map_err(|error| {
            PropsEditError::Invalid {
                file: file.to_owned(),
                message: error.to_string(),
            }
        })?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => OrderedObject::default(),
        Err(error) => return Err(io_error(error)),
    };

    let position = object.0.iter().position(|(name, _)| name == key);
    match (position, value) {
        (Some(index), Some(value)) => object.0[index].1 = value.clone(),
        (None, Some(value)) => object.0.push((key.to_owned(), value.clone())),
        (Some(index), None) => {
            object.0.remove(index);
        }
        (None, None) => {}
    }

    // Renaming over a read-only file would succeed, so refuse it explicitly.
    if fs::metadata(file).is_ok_and(|metadata| metadata.permissions().readonly()) {
        return Err(io_error(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "the file is read-only",
        )));
    }

    let mut text =
        serde_json::to_string_pretty(&object).map_err(|error| PropsEditError::Invalid {
            file: file.to_owned(),
            message: error.to_string(),
        })?;
    text.push('\n');
    replace_file(file, &text).map_err(io_error)
}

/// Writes `text` to a temporary file beside `file` and renames it over `file`,
/// so a reader never sees a half-written props file.
fn replace_file(file: &Path, text: &str) -> io::Result<()> {
    let name = file
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "not a file path"))?
        .to_string_lossy();
    let temporary = file.with_file_name(format!(".{name}.tmp-{}", std::process::id()));

    let written = fs::File::create(&temporary).and_then(|mut handle| {
        handle.write_all(text.as_bytes())?;
        handle.sync_all()
    });
    let result = written.and_then(|()| fs::rename(&temporary, file));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_types::tests::{Scratch, write};
    use serde_json::json;
    use std::fs;

    fn text(path: &std::path::Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    #[test]
    fn keeps_key_order_and_appends_new_keys() {
        let scratch = Scratch::new("props-order");
        let file = scratch.0.join("props.json");
        write(&file, "{\"b\":1,\"a\":2}");

        set_property(&file, "c", Some(&json!(3))).unwrap();

        assert_eq!(text(&file), "{\n  \"b\": 1,\n  \"a\": 2,\n  \"c\": 3\n}\n");
    }

    #[test]
    fn replaces_a_value_in_place() {
        let scratch = Scratch::new("props-replace");
        let file = scratch.0.join("props.json");
        write(&file, "{\"b\":1,\"a\":2}");

        set_property(&file, "a", Some(&json!(5))).unwrap();

        assert_eq!(text(&file), "{\n  \"b\": 1,\n  \"a\": 5\n}\n");
    }

    #[test]
    fn removes_a_key_and_keeps_an_empty_object() {
        let scratch = Scratch::new("props-remove");
        let file = scratch.0.join("props.json");
        write(&file, "{\"a\":1}");

        set_property(&file, "a", None).unwrap();

        assert_eq!(text(&file), "{}\n");
        assert!(file.is_file());
    }

    #[test]
    fn creates_a_missing_file() {
        let scratch = Scratch::new("props-create");
        let folder = scratch.0.join("日本語 project");
        fs::create_dir_all(&folder).unwrap();
        let file = folder.join("props.json");

        set_property(&file, "title", Some(&json!("こんにちは"))).unwrap();

        assert_eq!(text(&file), "{\n  \"title\": \"こんにちは\"\n}\n");
    }

    #[test]
    fn keeps_keys_written_by_another_editor() {
        let scratch = Scratch::new("props-external");
        let file = scratch.0.join("props.json");
        set_property(&file, "a", Some(&json!(1))).unwrap();
        fs::write(&file, "{\"a\":1,\"z\":9}").unwrap();

        set_property(&file, "b", Some(&json!(2))).unwrap();

        assert_eq!(text(&file), "{\n  \"a\": 1,\n  \"z\": 9,\n  \"b\": 2\n}\n");
    }

    #[test]
    fn refuses_to_write_a_broken_file() {
        let scratch = Scratch::new("props-broken");
        let file = scratch.0.join("props.json");
        write(&file, "{\"a\":");

        let error = set_property(&file, "b", Some(&json!(1))).unwrap_err();

        assert!(matches!(error, PropsEditError::Invalid { .. }));
        assert!(
            error
                .to_string()
                .starts_with("Fix props.json before editing: "),
            "{error}"
        );
        assert_eq!(text(&file), "{\"a\":");
    }

    #[test]
    fn refuses_a_non_object() {
        let scratch = Scratch::new("props-array");
        let file = scratch.0.join("props.json");
        write(&file, "[1]");

        let error = set_property(&file, "b", Some(&json!(1))).unwrap_err();

        assert!(matches!(error, PropsEditError::Invalid { .. }));
        assert_eq!(text(&file), "[1]");
    }

    #[test]
    fn leaves_no_temporary_file() {
        let scratch = Scratch::new("props-temp");
        let file = scratch.0.join("props.json");
        write(&file, "{}");

        set_property(&file, "a", Some(&json!(1))).unwrap();

        let names: Vec<_> = fs::read_dir(&scratch.0)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("props.json")]);
    }

    #[test]
    fn reports_a_read_only_file() {
        let scratch = Scratch::new("props-readonly");
        let file = scratch.0.join("props.json");
        write(&file, "{\"a\":1}");
        let mut permissions = fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&file, permissions).unwrap();

        let result = set_property(&file, "b", Some(&json!(2)));

        let mut permissions = fs::metadata(&file).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        fs::set_permissions(&file, permissions).unwrap();
        assert!(
            matches!(result, Err(PropsEditError::Io { .. })),
            "{result:?}"
        );
        assert_eq!(text(&file), "{\"a\":1}");
        let names: Vec<_> = fs::read_dir(&scratch.0)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("props.json")]);
    }
}
