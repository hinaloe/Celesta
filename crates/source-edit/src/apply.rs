use std::fmt;

/// A single span edit on the original text.
#[derive(Debug, Clone, PartialEq)]
pub enum Edit {
    /// Replaces the bytes `start..end` with `value`.
    Replace { start: u32, end: u32, value: f64 },
    /// Inserts ` name={value}` at byte offset `at`.
    Insert { at: u32, name: String, value: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyError {
    /// Two edits touch the same bytes.
    Overlap,
    /// An edit lies outside the text or off a character boundary.
    OutOfRange,
}

impl fmt::Display for ApplyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Overlap => f.write_str("edits overlap"),
            Self::OutOfRange => f.write_str("edit is outside the source text"),
        }
    }
}

impl std::error::Error for ApplyError {}

impl Edit {
    fn span(&self) -> (u32, u32) {
        match self {
            Self::Replace { start, end, .. } => (*start, *end),
            Self::Insert { at, .. } => (*at, *at),
        }
    }
}

/// Applies all `edits` to `text` in one pass.
pub fn apply(text: &str, edits: &[Edit]) -> Result<String, ApplyError> {
    let mut sorted: Vec<&Edit> = edits.iter().collect();
    sorted.sort_by_key(|e| e.span());

    let mut out = String::with_capacity(text.len() + 16 * edits.len());
    let mut cursor = 0usize;
    for edit in sorted {
        let (start, end) = edit.span();
        let (start, end) = (start as usize, end as usize);
        if start < cursor {
            return Err(ApplyError::Overlap);
        }
        if start > end
            || end > text.len()
            || !text.is_char_boundary(start)
            || !text.is_char_boundary(end)
        {
            return Err(ApplyError::OutOfRange);
        }
        out.push_str(&text[cursor..start]);
        match edit {
            Edit::Replace { value, .. } => out.push_str(&format_number(*value)),
            Edit::Insert { name, value, .. } => {
                out.push_str(&format!(" {name}={{{}}}", format_number(*value)));
            }
        }
        cursor = end;
    }
    out.push_str(&text[cursor..]);
    Ok(out)
}

/// Integer when within 0.005 of one, else up to 2 decimals with trailing zeros
/// trimmed; negative zero is written `0`.
pub fn format_number(value: f64) -> String {
    let rounded = value.round();
    if (value - rounded).abs() < 0.005 {
        return format!("{}", rounded as i64);
    }
    // Round half away from zero ourselves; `{:.2}` would give 0.12 for 0.125.
    let s = format!("{:.2}", (value * 100.0).round() / 100.0);
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}
