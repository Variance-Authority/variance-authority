//! A grep answer too wide to list, said as where its lines are.

// compass: variance-authority.report.agent-surface

use crate::help_grep_answer::plural;
use crate::help_surface::{Surface, Value};
use crate::order::code_unit;

/// The most rows that say where the lines are.
const ROWS: usize = 10;

/// One matched file: its path, how many of its lines matched, and its import distance.
pub(crate) struct Held<'a> {
    pub path: &'a str,
    pub lines: usize,
    pub hops: u32,
}

/// The one start point a follow-up question repeats, with the direction it was said in.
pub(crate) struct Start<'a> {
    pub direction: &'a str,
    pub path: &'a str,
}

/// A place and what of the answer is in it; `rest` is what its folder has past the parts that have rows.
struct Row<'a, 'b> {
    path: &'a str,
    rest: bool,
    files: usize,
    lines: usize,
    hops: u32,
    /// The files a split divides, sorted by path; none for a rest.
    held: &'b [Held<'a>],
}

/// The rows over every line, then `notes`, then what answers less and what answers all of it.
pub(crate) fn collapsed(mut held: Vec<Held>, query: &str, start: Option<Start>, notes: Vec<String>, surface: Surface) -> Vec<String> {
    held.sort_unstable_by(|left, right| left.path.cmp(right.path));
    let total: usize = held.iter().map(|file| file.lines).sum();
    let near = held.iter().map(|file| file.hops).min();
    let apart = held.iter().any(|file| Some(file.hops) != near);
    let rows = rows_of(&held);

    let mut lines = vec![format!("All {total}, by path, most lines first:")];
    lines.extend(rows.iter().map(|row| said(row, apart)));
    lines.extend(notes);
    if let (Some(start), Some(first)) = (start, rows.iter().find(|row| !row.rest)) {
        let pattern = format!("^{}{}", literal(first.path), if first.files == 1 { "$" } else { "" });
        let question = surface.question("discover", &[(start.direction, Value::List(&[start.path])), ("path", Value::Text(&pattern)), ("text", Value::Text(query))]);
        let place = if first.files == 1 { "matching file" } else { "matching files under" };
        lines.push(format!("{question}: the {} {place} `{}`", first.files, first.path));
    }
    lines.push(format!("`{}` {total}: every line, nearest first", surface.input("limit")));
    lines
}

fn said(row: &Row, apart: bool) -> String {
    let place = match (row.rest, row.path) {
        (false, path) => path.to_owned(),
        (true, "") => "the rest".to_owned(),
        (true, folder) => format!("the rest of {folder}"),
    };
    let mut line = format!("{place} — {} {}", row.lines, plural(row.lines, "line", "lines"));
    if row.files > 1 {
        line.push_str(&format!(" in {} files", row.files));
    }
    if apart {
        let nearest = if row.files > 1 { "nearest " } else { "" };
        line.push_str(&format!(", {nearest}{} {} away", row.hops, plural(row.hops as usize, "import", "imports")));
    }
    line
}

/// At most [`ROWS`] rows over `files`, which are sorted by path: the widest folder is split while
/// its parts fit. One that holds most of the lines is split anyway, its parts past the room one row.
fn rows_of<'a, 'b>(files: &'b [Held<'a>]) -> Vec<Row<'a, 'b>> {
    let mut open = vec![row(files)];
    let most = open[0].lines / 2;
    let mut at = 0;
    while at < open.len() {
        let room = ROWS + 1 - open.len();
        let mut parts = if open[at].held.len() > 1 { children(&open[at]) } else { Vec::new() };
        if parts.is_empty() || (parts.len() > room && (room < 3 || open[at].lines <= most)) {
            at += 1;
            continue;
        }
        let folder = open.remove(at).path;
        if parts.len() > room {
            parts.sort_unstable_by(widest_first);
            let left = parts.split_off(room - 1);
            parts.push(Row { path: folder, rest: true, held: &[], ..sums(left.iter().map(|part| (part.files, part.lines, part.hops))) });
        }
        open.extend(parts);
        open.sort_unstable_by(widest_first);
        at = 0;
    }
    open
}

fn widest_first(left: &Row, right: &Row) -> std::cmp::Ordering {
    right.lines.cmp(&left.lines).then_with(|| code_unit(left.path, right.path))
}

/// The row of `files`: the file itself when it is one, else the deepest folder that holds them all.
fn row<'a, 'b>(files: &'b [Held<'a>]) -> Row<'a, 'b> {
    let path = match files {
        [only] => only.path,
        [first, .., last] => {
            let common = first.path.bytes().zip(last.path.bytes()).take_while(|(left, right)| left == right).count();
            let end = first.path.as_bytes()[..common].iter().rposition(|byte| *byte == b'/').map_or(0, |slash| slash + 1);
            &first.path[..end]
        }
        [] => "",
    };
    Row { path, held: files, ..sums(files.iter().map(|file| (1, file.lines, file.hops))) }
}

/// The files and lines of `parts` together, and the least distance among them.
fn sums<'a, 'b>(parts: impl Iterator<Item = (usize, usize, u32)>) -> Row<'a, 'b> {
    let none = Row { path: "", rest: false, files: 0, lines: 0, hops: u32::MAX, held: &[] };
    parts.fold(none, |sum, (files, lines, hops)| Row { files: sum.files + files, lines: sum.lines + lines, hops: sum.hops.min(hops), ..sum })
}

/// What a folder's row splits into: one row for each file and folder directly in it.
fn children<'a, 'b>(folder: &Row<'a, 'b>) -> Vec<Row<'a, 'b>> {
    let depth = folder.path.len();
    let entry = |file: &Held<'a>| file.path[depth..].split_inclusive('/').next().unwrap_or("");
    folder.held.chunk_by(|left, right| entry(left) == entry(right)).map(row).collect()
}

/// `path` as a regular expression that matches only it, in the letters JavaScript's `RegExp` reads as operators.
fn literal(path: &str) -> String {
    let mut written = String::with_capacity(path.len());
    for letter in path.chars() {
        if r"\.+*?()|[]{}^$".contains(letter) {
            written.push('\\');
        }
        written.push(letter);
    }
    written
}

#[cfg(test)]
#[path = "help_grep_collapse_tests.rs"]
mod tests;
