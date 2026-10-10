//! A case frame's owner, as `journal-format.cts` packs it: file, name, runner
//! id and settling, then the journey, what the case said and the project that ran it.
use std::path::Path;

use crate::journey_journal::{FINISHED, STOPPED, UNSETTLED};

/// A case frame's name: `packCase` and `settledCase` in `journal-format.cts`.
pub fn unpack_case(packed: &str) -> (&str, &str, &str, u8) {
    let mut parts = packed.split('\0');
    (
        parts.next().unwrap_or(packed),
        parts.next().unwrap_or(""),
        parts.next().unwrap_or(""),
        match parts.next() {
            Some("stopped") => STOPPED,
            Some("finished") => FINISHED,
            _ => UNSETTLED,
        },
    )
}

/// The journey a frame belongs to: the fifth field of its owner, after the
/// settling, empty when the case never handed one out. `packJourney` in
/// `journal-format.cts`. A sixth field, what the case said it arranged, is
/// [`case_preconditions::said_of`]'s.
pub fn journey_of(packed: &str) -> &str {
    packed.split('\0').nth(4).unwrap_or("")
}

/// The project that ran a frame's case: the seventh field of its owner, `None`
/// when the run named none. `packCase` in `journal-format.cts`.
pub fn project_of(packed: &str) -> Option<&str> {
    packed.split('\0').nth(6).filter(|project| !project.is_empty())
}

pub fn project_path(root: &Path, file: &str) -> String {
    let path = Path::new(file);
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}
