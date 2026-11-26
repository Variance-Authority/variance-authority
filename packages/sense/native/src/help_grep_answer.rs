//! A scoped grep result, ordered and written from the paths the walk reached, and
//! where a start point answers nothing, from the folder around it that does.

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};
use std::ops::Range;
use std::path::Path;

use crate::help_grep::{match_lines, Grepped};
use crate::help_grep_collapse::{collapsed, plural, Held, Start};
use crate::help_surface::{Surface, Value};
use crate::order::code_unit;
use crate::source_query::SourceTree;
use crate::text_cut::blank;

pub(crate) struct Scope {
    pub from: Vec<String>,
    pub to: Vec<String>,
    pub entries: usize,
    pub unresolved: usize,
    pub files: Vec<(String, u32)>,
}

/// One page of an ordered list: `limit` rows after the first `offset`.
pub(crate) struct Page {
    pub offset: usize,
    pub limit: usize,
}

impl Page {
    /// The rows of a list of `total` this page shows.
    pub(crate) fn rows(&self, total: usize) -> Range<usize> {
        let start = self.offset.min(total);
        start..start.saturating_add(self.limit).min(total)
    }

    /// What the page says above its rows when it does not start at the first: which rows it shows, or that `flag` is past the last.
    pub(crate) fn above(&self, total: usize, flag: &str) -> Option<String> {
        if self.offset == 0 {
            None
        } else if self.offset >= total {
            Some(format!("`{flag}` {} is past the last of {total} rows.", self.offset))
        } else {
            Some(format!("Rows {}–{} of {total}.", self.offset + 1, self.rows(total).end))
        }
    }

    /// What the page says below its rows when rows remain: how many, and the `flag` that shows the next page.
    pub(crate) fn below(&self, total: usize, flag: &str) -> Option<String> {
        let end = self.rows(total).end;
        let rest = total - end;
        (rest > 0).then(|| format!("{rest} more not shown; `{flag}` {end} shows the next {}.", rest.min(self.limit)))
    }
}

/// The page a question said; an answer it would not all fit is collapsed when neither is said.
pub(crate) struct Said {
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

/// Matching lines shown when no limit is said.
const SHOWN: usize = 20;

/// Of an answer past that, the lines shown above where they all are.
const FIRST: usize = 10;

/// Where the area's files are said from, which a start point said from a nested workspace is not.
pub(crate) struct Roots<'a> {
    pub workspace: &'a Path,
    pub graph: &'a Path,
}

fn scope(tree: &SourceTree, root: &str, from: Vec<String>, to: Vec<String>) -> Result<Scope, String> {
    if from.is_empty() && to.is_empty() {
        return Err("`grep` searches the files a start point reaches, and none was given. Pass `--from` or `--to` with the file or folder you are working in, or a top folder at the widest.".into());
    }
    resolve(tree, root, from, to).map_err(|why| format!("`grep` ran nothing: {why}. Say a real path from the root — `src/dispatch/read.ts` is that file, `src/dispatch/*` its folder's own files, `src/dispatch/` everything under it."))
}

pub(crate) fn resolve(tree: &SourceTree, root: &str, from: Vec<String>, to: Vec<String>) -> Result<Scope, String> {
    let (down, missed_down) = seeds(tree, root, &from);
    let (up, missed_up) = seeds(tree, root, &to);
    let unmatched: Vec<_> = missed_down.into_iter().chain(missed_up).collect();
    if !unmatched.is_empty() {
        return Err(refusal(root, &unmatched));
    }
    let entries = down.iter().chain(&up).collect::<HashSet<_>>().len();
    let mut distances = HashMap::<String, u32>::new();
    for (paths, reversed) in [(down, false), (up, true)] {
        if paths.is_empty() {
            continue;
        }
        let walk = tree.walk(paths.into_iter().collect(), reversed);
        for (file, hops) in walk.files().into_iter().zip(walk.depths()) {
            distances.entry(file).and_modify(|held| *held = (*held).min(hops)).or_insert(hops);
        }
    }
    let unresolved = tree.unknown_among(distances.keys().cloned().collect()).len();
    Ok(Scope { from, to, entries, unresolved, files: distances.into_iter().collect() })
}

pub(crate) fn seeds<'a>(tree: &SourceTree, root: &str, terms: &'a [String]) -> (HashSet<String>, Vec<&'a str>) {
    let mut files = HashSet::new();
    let mut unmatched = Vec::new();
    for term in terms {
        let found = under_root(term, root).and_then(|path| {
            let width = width_of(&path)?;
            Some(tree.entries(path, width.to_owned()))
        });
        match found {
            Some(entries) if !entries.is_empty() => files.extend(entries),
            _ => unmatched.push(term.as_str()),
        }
    }
    (files, unmatched)
}

fn under_root(term: &str, root: &str) -> Option<String> {
    if !Path::new(term).is_absolute() {
        return Some(term.to_owned());
    }
    let mut said = segments(term);
    for outer in segments(root) {
        if said.next() != Some(outer) {
            return None;
        }
    }
    let mut path = said.collect::<Vec<_>>().join("/");
    if term.ends_with('/') {
        path.push('/');
    }
    Some(path)
}

fn segments(path: &str) -> impl Iterator<Item = &str> {
    path.split(['/', '\\']).filter(|segment| !segment.is_empty())
}

fn width_of(path: &str) -> Option<&'static str> {
    let mut parts = segments(path).peekable();
    let mut count = 0;
    while let Some(part) = parts.next() {
        count += 1;
        if part.contains('*') {
            return (count > 1 && part == "*" && parts.peek().is_none()).then_some("own");
        }
    }
    (count > 0).then_some(if path.ends_with('/') { "under" } else { "file" })
}

pub(crate) fn refusal(root: &str, unmatched: &[&str]) -> String {
    if let Some(whole) = unmatched.iter().find(|term| under_root(term, root).is_some_and(|path| segments(&path).all(|part| part == "."))) {
        return format!("`{whole}` is the root, and a start point is a place in it: name a file or folder, or a top folder at the widest");
    }
    let named = unmatched.iter().map(|term| format!("`{term}`")).collect::<Vec<_>>().join(", ");
    format!("{named} {} not found — the source tree holds no file at that path", plural(unmatched.len(), "is", "are"))
}

/// One question: a pattern, the start points, and the page it said.
pub(crate) struct Asked<'a> {
    pub query: &'a str,
    pub from: Vec<String>,
    pub to: Vec<String>,
    pub said: Said,
}

/// The matching lines of an area, whose files stand nearest first.
struct Found {
    scope: Scope,
    area: String,
    files: Vec<String>,
    hops: Vec<u32>,
    hits: Grepped,
}

/// The answer of the area asked about, and where it holds nothing and no page was said, that of the nearest folder around it with a match.
pub(crate) fn answered(tree: &SourceTree, roots: &Roots, asked: Asked, surface: Surface) -> Result<String, String> {
    let Asked { query, from, to, said } = asked;
    let root = roots.workspace.to_str().ok_or("the workspace's path is not UTF-8")?;
    let against = from.is_empty();
    let folders = match (from.as_slice(), to.as_slice()) {
        ([only], []) | ([], [only]) if said.limit.is_none() && said.offset.is_none() => around(only, root),
        _ => Vec::new(),
    };
    let asked = from.first().or(to.first()).cloned().unwrap_or_default();
    let (first, opening) = match scope(tree, root, from, to) {
        Ok(area) => {
            let found = search(roots.graph, query, area)?;
            if folders.is_empty() || !found.hits.file.is_empty() {
                return Ok(written(roots, query, found, &said, None, surface));
            }
            let count = found.files.len();
            let opening = format!("No match in the {count} {} {} `{asked}`. ", plural(count, "file", "files"), along(against));
            (Ok(written(roots, query, found, &said, None, surface)), opening)
        }
        Err(refused) => (Err(refused), format!("`{asked}` is not found. ")),
    };
    let around = folders.iter().find_map(|folder| {
        let one = vec![folder.clone()];
        let (from, to) = if against { (Vec::new(), one) } else { (one, Vec::new()) };
        // A folder the tree holds no file under is passed over, and the one around it is looked in.
        let area = resolve(tree, root, from, to).ok()?;
        // Only a missing path meets a broken pattern here first, and it is refused as missing.
        let found = search(roots.graph, query, area).ok()?;
        if found.hits.file.is_empty() {
            return None;
        }
        let start = Start { direction: if against { "to" } else { "from" }, path: folder };
        let place = format!(" {} `{folder}`", along(against));
        Some(written(roots, query, found, &said, Some(Around { start, opening: &opening, place }), surface))
    });
    match around {
        // A missing path is still refused, with the folder's answer.
        Some(text) if first.is_err() => Err(text),
        Some(text) => Ok(text),
        None => first,
    }
}

/// How the files of an area stand to its start point.
fn along(against: bool) -> &'static str {
    if against { "reaching" } else { "reachable from" }
}

/// The folder looked in where the start point asked about held nothing: its answer opens with why, and says the place.
struct Around<'a> {
    start: Start<'a>,
    opening: &'a str,
    place: String,
}

/// The folders around a start point, the nearest first, up to a top folder and never the root; none where a part of the path is no name the tree could hold.
fn around(term: &str, root: &str) -> Vec<String> {
    let Some(path) = under_root(term, root).filter(|path| width_of(path).is_some()) else { return Vec::new() };
    let named: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    if named.iter().any(|part| matches!(*part, "." | "..")) {
        return Vec::new();
    }
    (1..named.len()).rev().map(|depth| format!("{}/", named[..depth].join("/"))).collect()
}

fn search(graph: &Path, query: &str, mut area: Scope) -> Result<Found, String> {
    area.files.sort_unstable_by(|(left, left_hops), (right, right_hops)| {
        left_hops.cmp(right_hops).then_with(|| code_unit(left, right))
    });
    let line = area_line(&area);
    let (files, hops): (Vec<String>, Vec<u32>) = std::mem::take(&mut area.files).into_iter().unzip();
    let hits = match_lines(graph, query, &files)?;
    Ok(Found { scope: area, area: line, files, hops, hits })
}

fn written(roots: &Roots, query: &str, found: Found, said: &Said, around: Option<Around>, surface: Surface) -> String {
    let Found { scope, area, files, hops: distances, hits: found } = found;
    let error = found.errors.first().map(|first| {
        let count = found.errors.len();
        format!("ripgrep reported {count} {} reading them; the first: {first}", plural(count, "error", "errors"))
    });
    let total = found.file.len();
    if total == 0 {
        let unread = error.map_or_else(String::new, |line| format!("\n\n{line}"));
        return format!("{area}{unread}\n\nNothing in those files matches `{query}`.");
    }

    let count = 1 + found.file.windows(2).filter(|rows| rows[0] != rows[1]).count();
    let (opening, place) = around.as_ref().map_or(("", ""), |around| (around.opening, around.place.as_str()));
    let heading = format!("{opening}{total} matching {} in {count} {}{place}", plural(total, "line", "lines"), plural(count, "file", "files"));
    let mut notes: Vec<String> = match around {
        None => vec![format!("note: {area}")],
        Some(_) => unresolved_line(&scope, &format!("of the {} {} searched", files.len(), plural(files.len(), "file", "files"))).map(|line| format!("note: {line}")).into_iter().collect(),
    };
    notes.extend(error.map(|error| format!("note: {error}")));
    if total > SHOWN && said.limit.is_none() && said.offset.is_none() {
        let held = found.file.chunk_by(|left, right| left == right).map(|rows| {
            let at = rows[0] as usize;
            Held { path: &files[at], lines: rows.len(), hops: distances[at] }
        });
        let all = match &around {
            None => format!("`{}` {total}", surface.input("limit")),
            Some(Around { start, .. }) => surface.question("grep", &[("query", Value::Text(query)), (start.direction, Value::List(&[start.path])), ("limit", Value::Text(&total.to_string()))]),
        };
        let mut lines = vec![format!("{heading}, the first {FIRST}, nearest first:")];
        lines.extend(listed(&found, 0..FIRST, &files, &distances));
        lines.extend(collapsed(held.collect(), query, repeatable(roots, &scope, query), notes, &all, surface));
        return lines.join("\n");
    }

    let page = Page { offset: said.offset.unwrap_or(0), limit: said.limit.unwrap_or(SHOWN) };
    let offset_flag = surface.input("offset");
    let mut lines = vec![format!("{heading}, nearest first:")];
    lines.extend(page.above(total, &offset_flag));
    lines.extend(listed(&found, page.rows(total), &files, &distances));
    lines.extend(notes);
    lines.extend(page.below(total, &offset_flag));
    lines.join("\n")
}

/// The rows `shown` of what was found, which is in the order of `files`.
fn listed(found: &Grepped, shown: Range<usize>, files: &[String], distances: &[u32]) -> Vec<String> {
    let mut lines = Vec::new();
    let mut row = shown.start;
    let mut previous_hops = None;
    while row < shown.end {
        let file = found.file[row];
        let at = file as usize;
        let hops = distances[at];
        if previous_hops != Some(hops) {
            lines.push(format!("{hops} {} away:", if hops == 1 { "import" } else { "imports" }));
            previous_hops = Some(hops);
        }
        let group = found.file[row..shown.end].partition_point(|other| *other == file);
        if group == 1 {
            lines.push(format!("{}:{}: {}", files[at], found.line[row], found.text[row].trim_start_matches(blank)));
        } else {
            lines.push(files[at].clone());
            for index in row..row + group {
                lines.push(format!("  {}: {}", found.line[index], found.text[index].trim_start_matches(blank)));
            }
        }
        row += group;
    }
    lines
}

/// The scope as one start point `discover` reads as this did. It intersects two start points, splits a comma, drops a blank text and reads a `#` after `to` as a name the file exports; and where the graph's root is not the workspace's it opens the graph's names under the workspace.
fn repeatable<'a>(roots: &Roots, scope: &'a Scope, query: &str) -> Option<Start<'a>> {
    let (direction, path) = match (scope.from.as_slice(), scope.to.as_slice()) {
        ([only], []) => ("from", only),
        ([], [only]) => ("to", only),
        _ => return None,
    };
    let read_alike = !path.contains(',') && !(direction == "to" && path.contains('#'));
    (roots.workspace == roots.graph && read_alike && !query.trim().is_empty()).then_some(Start { direction, path })
}

pub(crate) fn area_line(scope: &Scope) -> String {
    let directions = [("reachable from", &scope.from), ("reaching", &scope.to)]
        .into_iter()
        .filter(|(_, paths)| !paths.is_empty())
        .map(|(direction, paths)| {
            let places = paths.iter().map(|path| format!("`{path}`")).collect::<Vec<_>>().join(" and ");
            format!("{direction} {places}")
        })
        .collect::<Vec<_>>()
        .join(" or ");
    let mut line = format!("In {} file(s) {directions} along the imports, at any depth — {} named by the path itself.", scope.files.len(), scope.entries);
    if let Some(unresolved) = unresolved_line(scope, "file(s) in it") {
        line.push_str(&format!(" {unresolved}"));
    }
    line
}

fn unresolved_line(scope: &Scope, area: &str) -> Option<String> {
    (scope.unresolved != 0).then(|| format!("{} {area} import something the scan could not resolve, so what lies behind those is not enumerated.", scope.unresolved))
}

#[cfg(test)]
mod tests {
    use super::segments;

    #[test]
    fn a_windows_separator_splits_a_path_like_a_slash() {
        assert_eq!(segments(r"C:\repo\src/a.ts").collect::<Vec<_>>(), ["C:", "repo", "src", "a.ts"]);
    }
}
