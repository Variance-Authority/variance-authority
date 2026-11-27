//! The text page and its test-file counts.

use std::collections::{BTreeSet, HashMap, HashSet};

use super::render::{case_set, files, part_name, ran, span_list, state, FileRow};
use super::{Body, Range, Request, Span, View};
use crate::help_page::Page;

pub(super) fn text(
    request: &Request<'_>,
    unheld: bool,
    body: &Body<'_>,
    view: &View<'_>,
) -> Option<String> {
    let file = &request.file;
    let mut lines = Vec::new();
    let rows = files(body, view);
    let witnesses = case_set(body);
    let mut more = None;
    match body {
        Body::File(ranges) => {
            if ranges.is_empty() {
                lines.push(format!("No line of {file} is recorded."));
            } else {
                let named = witnesses.len();
                let files = rows.len();
                let inside = if named == 0 {
                    String::new()
                } else {
                    format!(" in {files} {}", noun(files, "test file", "test files"))
                };
                let count = ranges.len();
                let loads: HashSet<_> = ranges
                    .iter()
                    .flat_map(|range| range.named.loaders.iter())
                    .filter(|row| !witnesses.contains(row))
                    .collect();
                let more_loads = if loads.is_empty() {
                    String::new()
                } else {
                    format!(", and {} more that ran it only while their file imported it", loads.len())
                };
                lines.push(format!(
                    "{file} — {count} recorded {}, {named} named {}{inside}{more_loads}",
                    noun(count, "range", "ranges"),
                    noun(named, "test", "tests")
                ));
                more = file_page(&mut lines, &rows, &witnesses, &[], request, view);
                notes(&mut lines, ranges, view)?;
            }
        }
        Body::At { target, named, unrun, outside, file_grain, grain, placed } => {
            let where_ = target.written();
            let count = named.tests.len() + named.loaders.len();
            if count == 0 {
                lines.push(format!(
                    "No named test covered {where_} of {file}{}",
                    why(if *placed { named.stopped.as_deref() } else { None }, "it")
                ));
                if let Some(stopped) = &named.stopped {
                    stopped_cases(&mut lines, view, stopped, "  stopped: ");
                }
            } else {
                let alone =
                    if named.state() == Some("alone") { ", and it is the only case that could have" } else { "" };
                lines
                    .push(format!("{count} named {} covered {where_} of {file}{alone}:", noun(count, "test", "tests")));
                more = file_page(&mut lines, &rows, &witnesses, &named.loaders, request, view);
                if !named.loaders.is_empty() {
                    lines.push("* ran only while the module evaluated (its file imports it)".into());
                }
            }
            if !unrun.is_empty() {
                let mut parts = Vec::new();
                for &row in unrun {
                    let kind = view.kind(row);
                    let mut label = part_name(view, *target, row);
                    if label == kind {
                        label.insert_str(0, "the ");
                    }
                    let part = view.region(row);
                    let place = Span::new(part.start, part.end).written();
                    parts.push(format!("{label} at {} {place}", if part.start == part.end { "line" } else { "lines" }));
                }
                let count = unrun.len();
                let amount = if count == 1 { "a part".into() } else { format!("{count} parts") };
                lines.push(format!("No case ran {amount} of it: {}.", parts.join(", ")));
            }
            if *grain {
                lines.push(format!("At file grain: an edit to {where_} charges the module's own region, so the record names the cases that loaded the file."));
            }
            if !file_grain.is_empty() {
                let (label, verb) = if single(file_grain) { ("Line", "charges") } else { ("Lines", "charge") };
                lines.push(format!("{label} {} {verb} the module's own region: for them the record names the cases that loaded the file.", span_list(file_grain)));
            }
            if !outside.is_empty() {
                let (label, verb, it) = if single(outside) { ("Line", "is", "it") } else { ("Lines", "are", "them") };
                lines.push(format!(
                    "{label} {} {verb} outside every recorded region, so no case can be said to have run {it}.",
                    span_list(outside)
                ));
            }
        }
    }
    if unheld {
        lines.push(format!("{file} is not on disk, so no text of it is held; its lines are the record's."));
    } else {
        lines.push(format!(
            "The record does not say which text of {file} its lines are numbered in, so they are given as recorded."
        ));
    }
    if let Some(ran) = ran(body, view)? {
        let who = match ran.named {
            Some("entered") => "that entered it",
            Some("read") => "read here",
            _ => "named here",
        };
        let tests =
            if ran.tests.len() == 1 { "the test file".into() } else { format!("the {} test files", ran.tests.len()) };
        lines.push(format!("Where and when {tests} {who} last ran is not known: {}.", ran.unread));
    }
    lines.extend(more);
    Some(format!("{}\n", lines.join("\n")))
}

pub(super) fn noun<'a>(count: usize, one: &'a str, many: &'a str) -> &'a str {
    if count == 1 {
        one
    } else {
        many
    }
}

fn single(spans: &[Span]) -> bool {
    matches!(spans, [one] if one.start_line == one.end_line)
}

fn why(stopped: Option<&[u32]>, it: &str) -> String {
    match stopped {
        None => ".".into(),
        Some([]) => format!(", and every case that could have reached {it} finished: unwalked."),
        Some(rows) => {
            let who = if rows.len() == 1 { "a case".into() } else { format!("{} cases", rows.len()) };
            format!(" — a hole: {who} that could have reached it stopped first, so the record cannot see it.")
        }
    }
}

fn stopped_cases(lines: &mut Vec<String>, view: &View<'_>, rows: &[u32], prefix: &str) {
    lines.extend(rows.iter().map(|&row| {
        let case = &view.tests[row as usize];
        format!("{prefix}{} > {}", case.file, case.label())
    }));
}

fn file_page(
    lines: &mut Vec<String>,
    files: &[FileRow<'_>],
    witnesses: &BTreeSet<u32>,
    loaders: &[u32],
    request: &Request<'_>,
    view: &View<'_>,
) -> Option<String> {
    let mut by_file = HashMap::<&str, Vec<(u32, bool)>>::new();
    let mut rows: Vec<_> = files.iter().map(|row| (row.file, Some(row))).collect();
    for &row in witnesses {
        by_file.entry(view.tests[row as usize].file).or_default().push((row, false));
    }
    for values in by_file.values_mut() {
        values.sort_by(|a, b| view.case_order(a.0, b.0));
    }
    for &row in loaders {
        let file = view.tests[row as usize].file;
        let cases = by_file.entry(file).or_insert_with(|| {
            rows.push((file, None));
            Vec::new()
        });
        cases.push((row, true));
    }
    let page = Page { offset: request.offset, limit: request.limit };
    let std::ops::Range { start, end } = page.rows(rows.len());
    lines.extend(page.above(rows.len(), "--offset"));
    let mut cut = end - start < rows.len();
    for (file, counts) in &rows[start..end] {
        let suffix = counts.map_or_else(String::new, |row| format!(" — {}/{}", row.cases, row.of));
        lines.push(format!("  {file}{suffix}"));
        let named = &by_file[file];
        lines.extend(named.iter().take(3).map(|&(row, loaded)| {
            let star = if loaded { "*" } else { "" };
            format!("    {}{star}", view.tests[row as usize].label())
        }));
        if named.len() > 3 {
            cut = true;
            lines.push(format!("    and {} more", named.len() - 3));
        }
    }
    if cut {
        lines.push("`--format json` names every case.".into());
    }
    (end < rows.len()).then(|| {
        let asked: Vec<_> = request.asked.iter().map(|word| quoted(word)).collect();
        let rest = rows.len() - end;
        let next = rest.min(request.limit);
        format!("{rest} more not shown; the next {next}: `variance covering {} --offset {end}`.", asked.join(" "))
    })
}

fn quoted(word: &str) -> String {
    if !word.is_empty() && word.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"_@%+=:,./-".contains(&byte)) {
        word.to_owned()
    } else {
        format!("'{}'", word.replace('\'', "'\\''"))
    }
}

fn notes(lines: &mut Vec<String>, ranges: &[Range], view: &View<'_>) -> Option<()> {
    let lost = "in a text a case ran over, but a run over another text has landed there since";
    let mut quiet: Vec<(&str, Vec<Span>)> = Vec::new();
    let mut unseen = BTreeSet::new();
    for range in ranges {
        unseen.extend(range.unentered.iter().copied());
        let named = &range.named;
        let state_word = named.state();
        let where_ = if single(&[range.span]) { "line" } else { "lines" };
        let location = range.span.written();
        if named.tests.is_empty() && named.loaders.is_empty() && named.overwritten.is_empty() {
            if let Some(word) = state_word.filter(|word| matches!(*word, "unwalked" | "loaded")) {
                if let Some((_, spans)) = quiet.iter_mut().find(|(at, _)| *at == word) {
                    spans.push(range.span);
                } else {
                    quiet.push((word, vec![range.span]));
                }
                continue;
            }
            lines.push(format!("{where_} {location}{}", state(named, " — ")));
            if state_word == Some("hole") {
                stopped_cases(lines, view, named.stopped.as_deref().unwrap_or_default(), "  stopped first: ");
            } else {
                lines.push("  no named test covered this range.".into());
            }
            continue;
        }
        if named.tests.is_empty() && !named.loaders.is_empty() {
            let cases = named.loaders.len();
            let files: HashSet<_> = named.loaders.iter().map(|&row| view.tests[row as usize].file).collect();
            let files = files.len();
            lines.extend([
                format!("{where_} {location}{}", state(named, " — ")),
                format!(
                    "  {cases} {} in {files} test {} ran it only while their file imported the module",
                    noun(cases, "case", "cases"),
                    noun(files, "file", "files")
                ),
            ]);
        }
        if !named.overwritten.is_empty() {
            let witnessed = !named.tests.is_empty() || !named.loaders.is_empty();
            let other = if witnessed { "other " } else { "" };
            let begin = if witnessed { "it is also" } else { "this range is" };
            if !named.tests.is_empty() || named.loaders.is_empty() {
                lines.push(format!("{where_} {location}{}", state(named, " — ")));
            }
            lines.push(format!("  {begin} {lost}, so which {other}case ran it is not known"));
        }
    }
    for (word, spans) in quiet {
        let where_ = if single(&spans) { "line" } else { "lines" };
        lines.push(format!("No case called into {where_} {}: {word}.", span_list(&spans)));
    }
    if unseen.is_empty() {
        return Some(());
    }
    let mut unseen: Vec<_> = unseen.into_iter().collect();
    unseen.sort_by_key(|&row| (view.region(row).start, view.region(row).end));
    if let Some(stopped) = view.stopped.as_deref().filter(|rows| !rows.is_empty()) {
        for row in unseen {
            let region = view.region(row);
            let span = Span::new(region.start, region.end);
            let where_ = if single(&[span]) { "line" } else { "lines" };
            lines.push(format!(
                "No case entered the {} on {where_} {}{}",
                view.kind(row),
                span.written(),
                why(Some(stopped), "it")
            ));
            stopped_cases(lines, view, stopped, "  stopped: ");
        }
        return Some(());
    }
    let total = unseen.len();
    let mut kinds: Vec<(&str, Vec<Span>)> = Vec::new();
    for row in unseen {
        let kind = view.kind(row);
        let region = view.region(row);
        let span = Span::new(region.start, region.end);
        if let Some((_, spans)) = kinds.iter_mut().find(|(name, _)| *name == kind) {
            spans.push(span);
        } else {
            kinds.push((kind, vec![span]));
        }
    }
    let names = kinds
        .iter()
        .map(|(kind, spans)| {
            let label = if single(spans) { "line" } else { "lines" };
            let noun = if spans.len() == 1 {
                kind.to_string()
            } else {
                let suffix =
                    if ["s", "x", "ch", "sh"].iter().any(|suffix| kind.ends_with(suffix)) { "es" } else { "s" };
                format!("{kind}{suffix}")
            };
            let places = spans.iter().map(|span| span.written()).collect::<Vec<_>>();
            format!("the {noun} on {label} {}", joined(&places, "and", ""))
        })
        .collect::<Vec<_>>();
    lines.push(format!(
        "No case entered {}{}",
        joined(&names, "or", ","),
        why(view.stopped.as_deref(), if total == 1 { "it" } else { "them" })
    ));
    Some(())
}

fn joined(items: &[String], last: &str, before_last: &str) -> String {
    let Some((end, before)) = items.split_last() else { return String::new() };
    if before.is_empty() {
        end.to_owned()
    } else {
        format!("{}{before_last} {last} {end}", before.join(", "))
    }
}
