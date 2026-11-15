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

/// `file` named from `root` as node's `path.relative` names it, in `/`: both
/// resolved, then `..` for each part of `root` the file does not share, so a
/// file outside the root is `../shared/a.test.ts` — the spelling the runner's
/// report and the JavaScript `projectPath` join a case on. A file on another
/// drive or prefix keeps its whole resolved path, as `path.relative` does.
pub fn project_path(root: &Path, file: &str) -> String {
    let case = if cfg!(windows) { PartCase::Folded } else { PartCase::Kept };
    named_from(&resolved(root), &resolved(Path::new(file)), case)
}

/// Whether two spellings of a path part name one part: on Windows
/// `path.relative` compares them without case, elsewhere case is part of the name.
#[derive(Clone, Copy)]
enum PartCase {
    Kept,
    Folded,
}

/// `file` named from `root`, both as resolved parts: `..` for each part of the
/// root past the prefix they share, then the file's own parts in its own
/// spelling; the file whole when they share nothing.
fn named_from(root: &[String], file: &[String], case: PartCase) -> String {
    let same = |a: &String, b: &String| match case {
        PartCase::Kept => a == b,
        PartCase::Folded => a.to_lowercase() == b.to_lowercase(),
    };
    let shared = root.iter().zip(file).take_while(|(a, b)| same(a, b)).count();
    if shared == 0 {
        return file.join("/");
    }
    std::iter::repeat("..").take(root.len() - shared).chain(file[shared..].iter().map(String::as_str)).collect::<Vec<_>>().join("/")
}

/// `path` made absolute against the working directory and with `.` and `..`
/// resolved by its spelling, as `path.resolve` does, one part per entry: the
/// first is the prefix (`C:`), or empty for the root, so a join spells `/`.
fn resolved(path: &Path) -> Vec<String> {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut parts: Vec<String> = Vec::new();
    for part in absolute.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                // `..` never climbs past the root or the prefix.
                if parts.len() > 1 {
                    parts.pop();
                }
            }
            std::path::Component::Prefix(prefix) => parts.push(prefix.as_os_str().to_string_lossy().into_owned()),
            std::path::Component::RootDir if parts.is_empty() => parts.push(String::new()),
            std::path::Component::RootDir => {}
            std::path::Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
        }
    }
    parts
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
    fn a_file_is_named_from_the_root_as_path_relative_names_it() {
        let root = Path::new("/repo");
        assert_eq!(project_path(root, "/repo/test/a.test.ts"), "test/a.test.ts");
        assert_eq!(project_path(root, "/shared/a.test.ts"), "../shared/a.test.ts");
        assert_eq!(project_path(root, "/repo-two/a.test.ts"), "../repo-two/a.test.ts");
        assert_eq!(project_path(root, "/repo/test/../a.test.ts"), "a.test.ts");
        assert_eq!(project_path(root, "/repo"), "");
        assert_eq!(project_path(Path::new("/repo/packages/app"), "/repo/test/a.test.ts"), "../../test/a.test.ts");
        assert_eq!(project_path(Path::new("/"), "/a.test.ts"), "a.test.ts");
    }

    #[test]
    fn a_windows_root_is_shared_whatever_the_case_of_its_parts_and_the_file_keeps_its_spelling() {
        let parts = |spelled: &[&str]| spelled.iter().map(|part| (*part).to_owned()).collect::<Vec<_>>();
        let root = parts(&["C:", "Repo"]);
        let file = parts(&["c:", "repo", "Test", "a.test.ts"]);
        assert_eq!(named_from(&root, &file, PartCase::Folded), "Test/a.test.ts");
        assert_eq!(named_from(&root, &parts(&["C:", "Shared", "a.test.ts"]), PartCase::Folded), "../Shared/a.test.ts");
        assert_eq!(named_from(&root, &parts(&["D:", "repo", "a.test.ts"]), PartCase::Folded), "D:/repo/a.test.ts");
        // Elsewhere a part's case is part of its name.
        assert_eq!(named_from(&parts(&["", "Repo"]), &parts(&["", "repo", "a.test.ts"]), PartCase::Kept), "../repo/a.test.ts");
    }

    #[test]
    fn times_are_laid_as_a_row_and_refused_where_they_are_not_whole_numbers() {
        assert_eq!(crate::case_times::decode(&times_of(&owner("", "4 30 9 10")).unwrap()).unwrap(), vec![(4, 30), (9, 10)]);
        assert!(times_of(&owner("", "")).unwrap().is_empty());
        assert!(times_of(&owner("", "4 3.5")).is_err());
        assert!(times_of(&owner("", "-4 30")).is_err());
    }
}
