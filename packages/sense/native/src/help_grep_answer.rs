//! A scoped grep result, ordered and written from the paths the walk reached.

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::help_grep::match_lines;
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

pub(crate) struct Page {
    pub offset: usize,
    pub limit: usize,
}

pub(crate) fn scope(tree: &SourceTree, root: &str, from: Vec<String>, to: Vec<String>) -> Result<Scope, String> {
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

pub(crate) fn answer(
    root: &Path,
    query: &str,
    mut scope: Scope,
    page: Page,
    offset_flag: &str,
) -> Result<String, String> {
    scope.files.sort_unstable_by(|(left, left_hops), (right, right_hops)| {
        left_hops.cmp(right_hops).then_with(|| code_unit(left, right))
    });
    let area = area_line(&scope);
    let (files, distances): (Vec<_>, Vec<_>) = scope.files.into_iter().unzip();
    let found = match_lines(root, query, &files)?;
    let error = found.errors.first().map(|first| {
        let count = found.errors.len();
        format!("ripgrep reported {count} {} reading them; the first: {first}", plural(count, "error", "errors"))
    });
    let total = found.file.len();
    if total == 0 {
        let unread = error.map_or_else(String::new, |line| format!("\n\n{line}"));
        return Ok(format!("{area}{unread}\n\nNothing in those files matches `{query}`."));
    }

    let count = 1 + found.file.windows(2).filter(|rows| rows[0] != rows[1]).count();
    let mut lines = vec![format!("{total} matching {} in {count} {}, nearest first:", plural(total, "line", "lines"), plural(count, "file", "files"))];
    let start = page.offset.min(total);
    let end = start.saturating_add(page.limit).min(total);
    if page.offset >= total {
        lines.push(format!("`{offset_flag}` {} is past the last of {total} rows.", page.offset));
    } else if page.offset != 0 {
        lines.push(format!("Rows {}–{end} of {total}.", start + 1));
    }
    let mut row = start;
    let mut previous_hops = None;
    while row < end {
        let file = found.file[row];
        let at = file as usize;
        let hops = distances[at];
        if previous_hops != Some(hops) {
            lines.push(format!("{hops} {} away:", if hops == 1 { "import" } else { "imports" }));
            previous_hops = Some(hops);
        }
        let group = found.file[row..end].partition_point(|other| *other == file);
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
    lines.push(format!("note: {area}"));
    if let Some(error) = error {
        lines.push(format!("note: {error}"));
    }
    if end < total {
        let rest = total - end;
        lines.push(format!("{rest} more not shown; `{offset_flag}` {end} shows the next {}.", rest.min(page.limit)));
    }
    Ok(lines.join("\n"))
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
    if scope.unresolved != 0 {
        line.push_str(&format!(" {} file(s) in it import something the scan could not resolve, so what lies behind those is not enumerated.", scope.unresolved));
    }
    line
}

fn plural<'a>(count: usize, one: &'a str, many: &'a str) -> &'a str {
    if count == 1 { one } else { many }
}

#[cfg(test)]
mod tests {
    use super::segments;

    #[test]
    fn a_windows_separator_splits_a_path_like_a_slash() {
        assert_eq!(segments(r"C:\repo\src/a.ts").collect::<Vec<_>>(), ["C:", "repo", "src", "a.ts"]);
    }
}
