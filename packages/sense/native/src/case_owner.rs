//! A case frame's owner, as `case-owner.cts` packs it: file, name, runner
//! id and settling, then the journey, what the case said and the project that ran it.
use std::path::Path;

use crate::journey_journal::{FINISHED, STOPPED, UNSETTLED};

/// A case frame's name: `packCase` and `settledCase` in `case-owner.cts`.
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
/// `case-owner.cts`. A sixth field, what the case said it arranged, is
/// [`crate::case_said::of_frame`]'s.
pub fn journey_of(packed: &str) -> &str {
    packed.split('\0').nth(4).unwrap_or("")
}

/// The project that ran a frame's case: the seventh field of its owner, `None`
/// when the run named none. `packCase` in `case-owner.cts`.
pub fn project_of(packed: &str) -> Option<&str> {
    packed.split('\0').nth(6).filter(|project| !project.is_empty())
}

/// The limit a frame's case ran under: the eighth field, as `Number` reads it,
/// so a field that is no number is `NaN`; `None` where the field is empty.
pub fn limit_of(packed: &str) -> Option<f64> {
    let field = packed.split('\0').nth(7).filter(|limit| !limit.is_empty())?;
    let trimmed = field.trim();
    Some(if trimmed.is_empty() { 0.0 } else { trimmed.parse().unwrap_or(f64::NAN) })
}

/// The statement times a frame's case took: the ninth field's `<line> <time>`
/// pairs, laid as `case_times` stores a row; empty where the field is.
pub fn times_of(packed: &str) -> Result<Vec<u8>, String> {
    let Some(field) = packed.split('\0').nth(8).filter(|times| !times.is_empty()) else {
        return Ok(Vec::new());
    };
    let words: Vec<&str> = field.split(' ').collect();
    let refused = || format!("a case frame's times are not lines and whole microseconds: {field}");
    let mut times = Vec::with_capacity(words.len() / 2);
    for pair in words.chunks_exact(2) {
        let line = pair[0].parse::<u32>().map_err(|_| refused())?;
        times.push((line, pair[1].parse::<u64>().map_err(|_| refused())?));
    }
    Ok(crate::case_times::encode(&times))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// An owner whose eighth field is `limit` and ninth `times`.
    fn owner(limit: &str, times: &str) -> String {
        ["/repo/a.test.ts", "case", "1", "finished", "", "", "", limit, times].join("\0")
    }

    #[test]
    fn a_limit_reads_as_number_reads_it() {
        assert_eq!(limit_of(&owner("5000", "")), Some(5000.0));
        assert_eq!(limit_of(&owner(" ", "")), Some(0.0));
        assert!(limit_of(&owner("soon", "")).unwrap().is_nan());
        assert_eq!(limit_of(&owner("", "")), None);
        assert_eq!(limit_of("/repo/a.test.ts\0case\x001"), None);
    }

    #[test]
    fn times_are_laid_as_a_row_and_refused_where_they_are_not_whole_numbers() {
        assert_eq!(crate::case_times::decode(&times_of(&owner("", "4 30 9 10")).unwrap()).unwrap(), vec![(4, 30), (9, 10)]);
        assert!(times_of(&owner("", "")).unwrap().is_empty());
        assert!(times_of(&owner("", "4 3.5")).is_err());
        assert!(times_of(&owner("", "-4 30")).is_err());
    }
}
