//! The three command formats over one covering read.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::Serialize;

use super::text::noun;
use super::{Body, Case, Span, Target, View, Witnesses};
use crate::order::code_unit;

pub(super) fn span_list(lines: &[Span]) -> String {
    lines.iter().map(|span| span.written()).collect::<Vec<_>>().join(", ")
}

pub(super) fn case_set(body: &Body<'_>) -> BTreeSet<u32> {
    match body {
        Body::File(ranges) => ranges.iter().flat_map(|range| range.named.tests.iter().copied()).collect(),
        Body::At { named, .. } => named.tests.iter().copied().collect(),
    }
}

struct Cases<'a> {
    rows: Vec<u32>,
    numbers: HashMap<u32, usize>,
    view: &'a View<'a>,
    starred: bool,
}

impl<'a> Cases<'a> {
    fn new(body: &Body<'_>, view: &'a View<'a>) -> Self {
        let mut rows = case_set(body);
        let mut starred = false;
        let mut include = |named: &Witnesses| {
            rows.extend(named.loaders.iter().copied());
            rows.extend(named.stopped.iter().flatten().copied());
            starred |= !named.loaders.is_empty();
        };
        match body {
            Body::File(ranges) => {
                for range in ranges {
                    include(&range.named);
                }
                if ranges.iter().any(|range| !range.unentered.is_empty()) {
                    rows.extend(view.stopped.iter().flatten().copied());
                }
            }
            Body::At { named, .. } => include(named),
        }
        let mut rows: Vec<_> = rows.into_iter().collect();
        rows.sort_by(|a, b| view.case_order(*a, *b));
        let numbers = rows.iter().enumerate().map(|(at, &row)| (row, at + 1)).collect();
        Self { rows, numbers, view, starred }
    }

    fn runs(&self, named: &[u32]) -> Vec<String> {
        let mut rows: Vec<_> = named.iter().map(|row| self.numbers[row]).collect();
        rows.sort_unstable();
        let mut runs = Vec::new();
        let mut at = 0;
        while at < rows.len() {
            let first = rows[at];
            let mut last = first;
            while rows.get(at + 1) == Some(&(last + 1)) {
                at += 1;
                last += 1;
            }
            runs.push(if first == last { first.to_string() } else { format!("{first}-{last}") });
            at += 1;
        }
        runs
    }

    fn references(&self, named: &Witnesses) -> String {
        let mut runs = self.runs(&named.tests);
        let mut loaders: Vec<_> = named.loaders.iter().map(|row| self.numbers[row]).collect();
        loaders.sort_unstable();
        runs.extend(loaders.into_iter().map(|row| format!("{row}*")));
        let mut answer = if runs.is_empty() { "none".into() } else { runs.join(",") };
        match named.stopped.as_deref() {
            Some([]) if runs.is_empty() && named.overwritten.is_empty() => {
                answer.push_str(", and every case that could have reached it finished")
            }
            Some(stopped) if !stopped.is_empty() => {
                answer.push_str(&format!("; stopped first {}", self.runs(stopped).join(",")))
            }
            _ => {}
        }
        answer
    }

    fn append(&self, lines: &mut Vec<String>) {
        if self.rows.is_empty() {
            return;
        }
        let heading = if self.starred { "cases (* inside only while the module evaluated)" } else { "cases" };
        lines.extend([String::new(), heading.into()]);
        let mut file = None;
        for row in &self.rows {
            let case = &self.view.tests[*row as usize];
            if file != Some(case.file) {
                lines.push(case.file.to_owned());
                file = Some(case.file);
            }
            lines.push(format!("  {} {}", self.numbers[row], case.label()));
        }
    }
}

pub(super) fn refs(file: &str, body: &Body<'_>, view: &View<'_>) -> String {
    let table = Cases::new(body, view);
    let mut lines = Vec::new();
    match body {
        Body::File(ranges) => {
            lines.push(format!("{file} — {} recorded {}", ranges.len(), noun(ranges.len(), "range", "ranges")));
            for range in ranges {
                let named = &range.named;
                let mut line = format!("{}{}: {}", range.span.written(), state(named, " "), table.references(named));
                if !named.overwritten.is_empty() {
                    let other = if named.tests.is_empty() { "" } else { "other " };
                    line.push_str(&format!("; which {other}case ran it not known"));
                }
                for &row in &range.unentered {
                    let region = view.region(row);
                    let where_ = Span::new(region.start, region.end).written();
                    let reach = match view.stopped.as_deref() {
                        None => String::new(),
                        Some([]) => " unwalked".into(),
                        Some(stopped) => format!(" hole, stopped first {}", table.runs(stopped).join(",")),
                    };
                    line.push_str(&format!("; unentered {} {where_}{reach}", view.kind(row)));
                }
                lines.push(line);
            }
        }
        Body::At { target, named, unrun, outside, file_grain, grain, placed } => {
            let where_ = target.written();
            let grain = if *grain { " at file grain" } else { "" };
            let mut line = format!(
                "{file} {where_}{grain}{}: {}",
                if *placed { state(named, " ") } else { String::new() },
                table.references(named)
            );
            if !file_grain.is_empty() {
                line.push_str(&format!("; file grain at {}", span_list(file_grain)));
            }
            if !outside.is_empty() {
                line.push_str(&format!("; outside every region at {}", span_list(outside)));
            }
            if !unrun.is_empty() {
                let mut parts = Vec::new();
                for &row in unrun {
                    let block = view.region(row);
                    let label = part_name(view, *target, row);
                    let lines = Span::new(block.start, block.end).written();
                    let reach = unentered_state(view).map_or_else(String::new, |state| format!(" {state}"));
                    parts.push(format!("{lines} {label}{reach}"));
                }
                line.push_str(&format!("; no case ran {}", parts.join(", ")));
            }
            lines.push(line);
        }
    }
    table.append(&mut lines);
    format!("{}\n", lines.join("\n"))
}

fn unentered_state(view: &View<'_>) -> Option<&'static str> {
    view.stopped.as_ref().map(|rows| if rows.is_empty() { "unwalked" } else { "hole" })
}

pub(super) fn state(case: &Witnesses, prefix: &str) -> String {
    case.state().map_or_else(String::new, |state| format!("{prefix}{state}"))
}

pub(super) fn part_name(view: &View<'_>, target: Target<'_>, row: usize) -> String {
    let kind = view.kind(row);
    let name = view.journey.text(view.region(row).name).unwrap_or_default();
    if matches!(target, Target::Function { function } if function == name) {
        kind.to_owned()
    } else {
        format!("{kind} {name}")
    }
}

#[derive(Serialize)]
struct Called<'a> {
    #[serde(flatten)]
    case: Case<'a>,
    distance: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    loaded: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Part<'a> {
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<&'a str>,
    #[serde(flatten)]
    span: Span,
    #[serde(skip_serializing_if = "Option::is_none")]
    stopped: Option<Vec<Case<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<&'static str>,
}

#[derive(Serialize)]
struct ViewRange<'a> {
    #[serde(flatten)]
    span: Span,
    tests: Vec<Called<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loaded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stopped: Option<Vec<Case<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unentered: Option<Vec<Part<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    overwritten: Option<Vec<Case<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<&'static str>,
}

#[derive(Serialize)]
pub(super) struct FileRow<'a> {
    pub(super) file: &'a str,
    pub(super) cases: usize,
    pub(super) of: usize,
}

#[derive(Serialize)]
pub(super) struct Ran<'a> {
    pub(super) tests: Vec<&'a str>,
    pub(super) unread: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) named: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output<'a> {
    file: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<Target<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ranges: Option<Vec<ViewRange<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tests: Option<Vec<Called<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stopped: Option<Vec<Case<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unrun: Option<Vec<Part<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    grain: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_grain: Option<&'a [Span]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    outside: Option<&'a [Span]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unheld: Option<bool>,
    from: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    ran: Option<Ran<'a>>,
    files: Vec<FileRow<'a>>,
}

pub(super) fn json(file: &str, from: &str, unheld: bool, body: &Body<'_>, view: &View<'_>) -> Option<String> {
    let mut printed = Output {
        file,
        target: None,
        ranges: None,
        tests: None,
        stopped: None,
        unrun: None,
        state: None,
        grain: None,
        outside: None,
        file_grain: None,
        unheld: unheld.then_some(true),
        from,
        ran: ran(body, view)?,
        files: files(body, view),
    };
    let cases = |rows: &[u32]| rows.iter().map(|&row| view.tests[row as usize]).collect::<Vec<_>>();
    let called = |named: &Witnesses| {
        named
            .tests
            .iter()
            .map(|&row| (row, None))
            .chain(named.loaders.iter().map(|&row| (row, Some(true))))
            .map(|(row, loaded)| Called { case: view.tests[row as usize], distance: 0, loaded })
            .collect::<Vec<_>>()
    };
    let part = |row, target: Option<Target<'_>>| {
        let held = view.region(row);
        let name = view.journey.text(held.name).ok()?;
        let whole = target.is_none();
        Some(Part {
            kind: view.kind(row),
            name: (!matches!(target, Some(Target::Function { function }) if function == name)).then_some(name),
            path: if whole { Some(view.journey.text(held.path).ok()?) } else { None },
            span: Span::new(held.start, held.end),
            stopped: if whole { view.stopped.as_deref().map(cases) } else { None },
            state: if whole { None } else { unentered_state(view) },
        })
    };
    match body {
        Body::File(ranges) => {
            printed.ranges = Some(
                ranges
                    .iter()
                    .map(|range| {
                        let named = &range.named;
                        let unentered =
                            range.unentered.iter().map(|&row| part(row, None)).collect::<Option<Vec<_>>>()?;
                        Some(ViewRange {
                            span: range.span,
                            tests: called(named),
                            loaded: named.loaded.then_some(true),
                            stopped: named.stopped.as_deref().map(cases),
                            unentered: (!unentered.is_empty()).then_some(unentered),
                            overwritten: (!named.overwritten.is_empty())
                                .then(|| named.overwritten.iter().map(|&row| view.tests[row as usize]).collect()),
                            state: named.state(),
                        })
                    })
                    .collect::<Option<_>>()?,
            );
        }
        Body::At { target, named, unrun, outside, file_grain, grain, placed } => {
            printed.target = Some(*target);
            printed.tests = Some(called(named));
            printed.stopped = named.stopped.as_deref().map(cases);
            printed.state = if *placed { named.state() } else { None };
            printed.grain = grain.then_some("file");
            printed.file_grain = (!file_grain.is_empty()).then_some(file_grain);
            printed.outside = (!outside.is_empty()).then_some(outside);
            if !unrun.is_empty() {
                printed.unrun = Some(unrun.iter().map(|&row| part(row, Some(*target))).collect::<Option<_>>()?);
            }
        }
    }
    serde_json::to_string_pretty(&printed).ok().map(|value| format!("{value}\n"))
}

pub(super) fn files<'a>(body: &Body<'_>, view: &View<'a>) -> Vec<FileRow<'a>> {
    let mut named = BTreeMap::<&str, usize>::new();
    for row in case_set(body) {
        *named.entry(view.tests[row as usize].file).or_default() += 1;
    }
    let mut totals = HashMap::<&str, usize>::new();
    for case in &view.tests {
        if named.contains_key(case.file) {
            *totals.entry(case.file).or_default() += 1;
        }
    }
    let mut rows: Vec<_> = named.into_iter().map(|(file, cases)| FileRow { file, cases, of: totals[file] }).collect();
    rows.sort_by(|a, b| b.cases.cmp(&a.cases).then_with(|| code_unit(a.file, b.file)));
    rows
}

pub(super) fn ran<'a>(body: &Body<'_>, view: &View<'a>) -> Option<Option<Ran<'a>>> {
    let mut named = None;
    let mut cases = case_set(body);
    match body {
        Body::File(ranges) => {
            for range in ranges {
                cases.extend(range.named.loaders.iter().copied());
            }
        }
        Body::At { named, .. } => {
            cases.extend(named.loaders.iter().copied());
            cases.extend(named.stopped.iter().flatten().copied());
        }
    }
    if cases.is_empty() {
        cases = view.ranges()?.iter().flat_map(|range| range.named.tests.iter().copied()).collect();
        named = Some(if cases.is_empty() { "read" } else { "entered" });
        if cases.is_empty() {
            cases = (0..view.tests.len() as u32).collect();
        }
    }
    let mut tests: Vec<_> = cases.into_iter().map(|row| view.tests[row as usize].file).collect();
    tests.sort_by(|a, b| code_unit(a, b));
    tests.dedup();
    Some((!tests.is_empty()).then_some(Ran { tests, unread: "the record names no commit", named }))
}
