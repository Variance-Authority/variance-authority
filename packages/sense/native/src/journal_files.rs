//! The files a run's journal directory holds, and the head a part file came from.

use std::fs;
use std::path::{Path, PathBuf};

use crate::order;

/// The head a part file came from: its name without the `-<uuid>.vac` every
/// writer appends, which is what makes two processes' files distinct.
pub(crate) fn head_of(path: &Path) -> String {
    let stem = path.file_stem().map_or_else(|| path.to_string_lossy(), |stem| stem.to_string_lossy());
    let at = stem.len().saturating_sub(37);
    match (stem.get(..at), stem.get(at..)) {
        (Some(head), Some(tail)) if tail.starts_with('-') && is_uuid(&tail[1..]) => head.to_owned(),
        _ => stem.into_owned(),
    }
}

fn is_uuid(text: &str) -> bool {
    text.len() == 36
        && text.char_indices().all(|(at, character)| match at {
            8 | 13 | 18 | 23 => character == '-',
            _ => character.is_ascii_hexdigit(),
        })
}

pub(crate) fn listed(directory: &Path, extension: Option<&str>) -> Result<Vec<PathBuf>, String> {
    let mut paths: Vec<PathBuf> = match fs::read_dir(directory) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                extension.is_none_or(|wanted| path.extension().and_then(|value| value.to_str()) == Some(wanted))
            })
            .collect(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error.to_string()),
    };
    paths.sort_unstable_by(|left, right| {
        order::code_unit(&left.to_string_lossy(), &right.to_string_lossy())
    });
    Ok(paths)
}
