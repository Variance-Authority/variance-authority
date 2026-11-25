//! Old-side coordinates and preimages from a handed Git patch.

// compass: variance-authority.reach

use crate::journey_query::JourneyChange;
use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;

static HEADER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@").expect("valid hunk header"));

pub(super) struct File<'a> {
    pub change: JourneyChange,
    pub preimage: Option<&'a str>,
    hunks: Vec<Hunk<'a>>,
    added: HashSet<(u32, u32)>,
}

struct Hunk<'a> {
    /// Offset into the old text, including the line before an insertion.
    begin: usize,
    lines: Vec<&'a str>,
}

impl File<'_> {
    pub(super) fn insertion(&self, range: (u32, u32)) -> bool {
        self.added.contains(&range)
    }

    /// Apply only when the patch's context and removals agree with the named blob.
    pub(super) fn applied(&self, before: &str) -> Option<String> {
        let old: Vec<_> = before.split('\n').collect();
        let mut cursor = 0;
        let mut after = Vec::new();
        for hunk in &self.hunks {
            after.extend(old.get(cursor..hunk.begin)?);
            cursor = hunk.begin;
            for line in &hunk.lines {
                let text = &line[1..];
                let sign = line.as_bytes()[0];
                if sign != b'+' {
                    if old.get(cursor).copied()? != text {
                        return None;
                    }
                    cursor += 1;
                }
                if sign != b'-' {
                    after.push(text);
                }
            }
        }
        after.extend(&old[cursor..]);
        Some(after.join("\n"))
    }
}

/// Read complete, same-path hunks. Other patch shapes need the whole-file
/// and rename readers.
pub(super) fn changes(patch: &str) -> Option<Vec<File<'_>>> {
    let mut changes = Vec::new();
    let mut seen = HashSet::new();
    let mut lines = patch.lines().peekable();
    while let Some(header) = lines.next() {
        let paths = header.strip_prefix("diff --git ")?;
        let line = lines.next()?;
        let (preimage, old) = if let Some(index) = line.strip_prefix("index ") {
            let (old, new) = index.split(' ').next()?.split_once("..")?;
            for oid in [old, new] {
                if !(4..=64).contains(&oid.len())
                    || !oid.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                    || oid.bytes().all(|byte| byte == b'0')
                {
                    return None;
                }
            }
            (Some(old), lines.next()?)
        } else {
            (None, line)
        };
        let file = old.strip_prefix("--- a/")?;
        if file.split('/').any(|part| part.is_empty() || part == "." || part == "..")
            || file.contains(['\t', '\\', '"', '\0'])
            || paths != format!("a/{file} b/{file}")
            || lines.next()?.strip_prefix("+++ b/")? != file
            || !seen.insert(file)
        {
            return None;
        }
        let mut ranges = Vec::new();
        let mut hunks = Vec::new();
        let mut added = HashSet::new();
        while lines.peek().is_some_and(|line| line.starts_with("@@ ")) {
            hunks.push(read_hunk(&mut lines, &mut ranges, &mut added)?);
        }
        if ranges.is_empty() {
            return None;
        }
        changes.push(File {
            change: JourneyChange { file: file.to_owned(), ranges, read: None },
            preimage,
            hunks,
            added,
        });
    }
    Some(changes)
}

fn read_hunk<'a>(
    lines: &mut std::iter::Peekable<impl Iterator<Item = &'a str>>,
    ranges: &mut Vec<u32>,
    insertions: &mut HashSet<(u32, u32)>,
) -> Option<Hunk<'a>> {
    let header = HEADER.captures(lines.next()?)?;
    let number = |at| header.get(at).map_or(Some(1), |s| s.as_str().parse::<u32>().ok());
    let (mut old_left, mut new_left) = (number(2)?, number(3)?);
    let mut old = if old_left == 0 { number(1)?.checked_add(1)? } else { number(1)? };
    let begin = old.checked_sub(1)? as usize;
    let (mut removed, mut added) = (0u32, 0u32);
    let before = ranges.len();
    let mut body = Vec::new();
    while old_left != 0 || new_left != 0 {
        let line = lines.next()?;
        match line.as_bytes().first()? {
            b'-' => {
                old_left = old_left.checked_sub(1)?;
                ranges.extend([old, old]);
                old = old.checked_add(1)?;
                removed += 1;
            }
            b'+' => {
                new_left = new_left.checked_sub(1)?;
                added += 1;
                if added > removed {
                    let gap = [(old - 1).max(1), old];
                    if ranges.len() == before || !ranges.ends_with(&gap) {
                        ranges.extend(gap);
                        insertions.insert((gap[0], gap[1]));
                    }
                }
            }
            b' ' => {
                old_left = old_left.checked_sub(1)?;
                new_left = new_left.checked_sub(1)?;
                old = old.checked_add(1)?;
                (removed, added) = (0, 0);
            }
            _ => return None,
        }
        body.push(line);
        if lines.peek() == Some(&r"\ No newline at end of file") {
            lines.next();
        }
    }
    (ranges.len() > before).then_some(Hunk { begin, lines: body })
}
