//! Covering answers from a per-case record, in recorded coordinates.

// compass: variance-authority.reach

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::journey_columns::FileFrame;
use crate::journey_journal::{FINISHED, STOPPED};
use crate::journey_read::Journey;
use crate::record_layout::LAYOUT;

#[path = "covering_view.rs"]
mod reading;
#[path = "covering_render.rs"]
mod render;
#[path = "covering_text.rs"]
mod text;

use reading::{Body, Case, Range, Span, View, Witnesses};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Text,
    Refs,
    Json,
}

pub(crate) struct Request<'a> {
    file: String,
    record: PathBuf,
    root: PathBuf,
    target: Option<Target<'a>>,
    format: Format,
    offset: usize,
    limit: usize,
    asked: Vec<&'a str>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(untagged)]
enum Target<'a> {
    Line { line: u32 },
    Lines { lines: Span },
    Function { function: &'a str },
}

impl Target<'_> {
    fn written(self) -> String {
        match self {
            Self::Line { line } => format!("line {line}"),
            Self::Lines { lines } => format!("lines {}-{}", lines.start_line, lines.end_line),
            Self::Function { function } => format!("function {function}"),
        }
    }
}

impl<'a> Request<'a> {
    pub(crate) fn parse(args: &[&'a str], cwd: &Path) -> Option<Self> {
        let mut flags = BTreeMap::new();
        let mut asked = Vec::new();
        let mut words = args.iter().copied();
        while let Some(flag) = words.next() {
            let (flag, value) = match flag.split_once('=') {
                Some(pair) => pair,
                None => (flag, words.next().filter(|value| !value.starts_with("--"))?),
            };
            if !matches!(
                flag,
                "--file"
                    | "--execution"
                    | "--suite"
                    | "--root"
                    | "--line"
                    | "--function"
                    | "--format"
                    | "--limit"
                    | "--offset"
            ) || value.is_empty()
                || flags.insert(flag, value).is_some()
            {
                return None;
            }
            if flag != "--offset" {
                asked.extend([flag, value]);
            }
        }
        let root = absolute(cwd, flags.get("--root").copied().unwrap_or("."))?;
        let file = absolute(&root, flags.get("--file")?)?;
        let file = file.strip_prefix(&root).ok()?.to_str()?.replace(std::path::MAIN_SEPARATOR, "/");
        let target = match (flags.get("--line"), flags.get("--function")) {
            (Some(_), Some(_)) => return None,
            (Some(line), None) => {
                let target = if let Some((first, last)) = line.split_once('-') {
                    let first = first.parse().ok()?;
                    let last = last.parse().ok()?;
                    if first == 0 || last < first {
                        return None;
                    }
                    if first == last {
                        Target::Line { line: first }
                    } else {
                        Target::Lines { lines: Span::new(first, last) }
                    }
                } else {
                    let line = line.parse().ok()?;
                    if line == 0 {
                        return None;
                    }
                    Target::Line { line }
                };
                Some(target)
            }
            (None, Some(function)) => Some(Target::Function { function }),
            (None, None) => None,
        };
        let format = match flags.get("--format").copied().unwrap_or("text") {
            "text" => Format::Text,
            "refs" => Format::Refs,
            "json" => Format::Json,
            _ => return None,
        };
        let record = match (flags.get("--execution"), flags.get("--suite")) {
            (Some(_), Some(_)) => return None,
            (Some(explicit), None) => absolute(cwd, explicit)?,
            (None, suite) if format == Format::Refs => local_record(&root, suite.copied())?,
            _ => return None,
        };
        if format != Format::Text && (flags.contains_key("--limit") || flags.contains_key("--offset")) {
            return None;
        }
        let limit = flags.get("--limit").copied().unwrap_or("10").parse().ok()?;
        let offset = flags.get("--offset").copied().unwrap_or("0").parse().ok()?;
        (limit > 0).then_some(Self { file, record, root, target, format, offset, limit, asked })
    }
}

fn absolute(root: &Path, value: &str) -> Option<PathBuf> {
    let mut held = PathBuf::new();
    for part in root.join(value).components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                held.pop();
            }
            _ => held.push(part.as_os_str()),
        }
    }
    held.is_absolute().then_some(held)
}

pub(crate) fn answer(request: Request<'_>) -> Option<(i32, String)> {
    let from = request.record.to_str()?;
    let mut record = FileFrame::open(&request.record).ok()??;
    let cases = record.frame(LAYOUT.coverage.part("index")).ok()?;
    let nested = cases.is_some();
    let mut cases = if let Some(cases) = cases {
        if request.format != Format::Refs || !recorded_frame(&mut record, &request) {
            return None;
        }
        cases
    } else {
        record
    };
    if cases.version != LAYOUT.cases.format || !cases.columns.iter().any(|column| column.name == "blocks.calledSet") {
        return None;
    }
    if cases.columns.iter().any(|column| {
        crate::case_said::SECTIONS.contains(&column.name.as_str())
            || (request.format == Format::Json && column.name == LAYOUT.cases.times)
    }) {
        // Preserve the extra evidence until both renderers speak it.
        return None;
    }
    let journey = Journey::of(from, cases.whole().ok()?).ok()?;
    let Some(module) = journey.module_of(&request.file).ok()? else {
        if nested {
            return None;
        }
        let count = journey.modules();
        let noun = if count == 1 { "file" } else { "files" };
        return Some((2, format!("`{}` is not in the index at `{from}`, which holds {count} {noun}, each named from the repository root. A file the run never loaded has no answer here, and that is a different statement from no test covering it.\n", request.file)));
    };
    let regions = journey.regions(module).ok()?;
    let kinds = regions.iter().map(|region| journey.text(region.kind)).collect::<Result<Vec<_>, _>>().ok()?;
    let mut tests = Vec::with_capacity(journey.tests());
    let mut complete = true;
    let mut any_stopped = false;
    let duration = journey.test_words(&LAYOUT.cases.duration).ok()?;
    let limits = journey.test_words(&LAYOUT.cases.limit).ok()?;
    let timed = |column: &Option<Vec<u32>>, row: usize| {
        column.as_ref().map(|column| column[row]).filter(|&value| value != LAYOUT.coverage.no_duration)
    };
    for row in 0..journey.tests() {
        let stopped = match journey.test_settled(row).ok()? {
            Some(STOPPED) => {
                complete = false;
                any_stopped = true;
                Some(true)
            }
            Some(FINISHED) => Some(false),
            _ => {
                complete = false;
                None
            }
        };
        tests.push(Case {
            id: journey.test_id(row).ok()?,
            file: journey.test_file(row).ok()?,
            name: journey.test_name(row).ok()?,
            stopped,
            duration: timed(&duration, row),
            limit: timed(&limits, row),
        });
    }
    let mut view = View {
        journey: &journey,
        regions: &regions,
        kinds: &kinds,
        tests,
        stopped: complete.then(Vec::new),
        loaders: Vec::new(),
        owns_load: true,
    };
    let has_loads = view.has_loads(request.target);
    if has_loads || any_stopped {
        let tree = crate::cli::runtime_tree(&request.root)?;
        if let Some(walk) = tree.importers(&request.file) {
            let mut by_file = std::collections::HashMap::new();
            let mut loaders: Vec<_> = view
                .tests
                .iter()
                .enumerate()
                .filter(|(_, test)| *by_file.entry(test.file).or_insert_with(|| walk.includes(test.file)))
                .map(|(row, _)| row as u32)
                .collect();
            view.owns_load = walk.owns_load(by_file.keys().copied());
            if !complete && !loaders.is_empty() {
                let mut reachable: BTreeSet<_> = loaders.iter().copied().collect();
                for region in &regions {
                    reachable.extend(journey.members(region.called).ok()?);
                    reachable.extend(journey.overwritten(region).ok()?);
                }
                let mut stopped = Vec::new();
                let mut known = true;
                for row in reachable {
                    match view.tests.get(row as usize)?.stopped {
                        Some(true) => stopped.push(row),
                        Some(false) => {}
                        None => {
                            known = false;
                            break;
                        }
                    }
                }
                view.stopped = known.then_some(stopped);
            }
            loaders.sort_by(|a, b| view.case_order(*a, *b));
            view.loaders = loaders;
        }
    }
    let body = view.read(request.target)?;
    let unheld = !request.root.join(&request.file).is_file();
    let output = match request.format {
        Format::Refs => render::refs(&request.file, &body, &view),
        Format::Json => render::json(&request.file, from, unheld, &body, &view)?,
        Format::Text => text::text(&request, unheld, &body, &view)?,
    };
    Some((0, output))
}

fn local_record(root: &Path, requested: Option<&str>) -> Option<PathBuf> {
    let index = crate::cli::source_index(root)?;
    let layer = index.parent()?;
    let value = match std::fs::read(root.join("variance.config.json")) {
        Ok(bytes) => Some(serde_json::from_slice::<serde_json::Value>(&bytes).ok()?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return None,
    };
    let suites = value.as_ref().and_then(|value| value.get("suites"));
    if let Some(suites) = suites {
        let suites = suites.as_object()?;
        let name = match requested {
            Some(name) => name,
            None if suites.len() == 1 => suites.keys().next()?,
            None => return None,
        };
        if !name.bytes().next()?.is_ascii_alphanumeric()
            || !name.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        {
            return None;
        }
        let suite = suites.get(name)?;
        if !matches!(suite.get("kind")?.as_str()?, "unit" | "integration" | "e2e" | "visual" | "job")
            || !matches!(suite.get("carry").and_then(serde_json::Value::as_str), None | Some("actions-cache"))
        {
            return None;
        }
        Some(layer.join("suites").join(name).join("coverage.bin"))
    } else {
        requested.is_none().then(|| layer.join("coverage.bin"))
    }
}

fn recorded_frame(record: &mut FileFrame, request: &Request<'_>) -> bool {
    fn checked(record: &mut FileFrame, request: &Request<'_>) -> Option<bool> {
        if !LAYOUT.coverage.readable(record.version) {
            return None;
        }
        let mut columns = record
            .selected(&[
                "strings.blob",
                "strings.off",
                "snapshot.instrumentation",
                "modules.path",
                "modules.source",
                "modules.instrumented",
            ])
            .ok()?;
        // A case-only record has no probes or source digest to frame against.
        if columns.is_empty() {
            return Some(true);
        }
        let recipe = columns.take_words("snapshot.instrumentation").ok()?;
        let paths = columns.take_words("modules.path").ok()?;
        let sources = columns.take_words("modules.source").ok()?;
        let instrumented = columns.take_bytes("modules.instrumented").ok()?;
        let offsets = columns.take_words("strings.off").ok()?;
        let strings = std::str::from_utf8(columns.held("strings.blob").ok()?).ok()?;
        let word = |id: u32| strings.get(*offsets.get(id as usize)? as usize..*offsets.get(id as usize + 1)? as usize);
        let [recipe] = recipe.as_slice() else { return None };
        let recipe = word(*recipe)?;
        use variance_sense_instrument::Mode;
        if recipe != Mode::Presence.instrumentation()
            && recipe != Mode::Entries.instrumentation()
            && recipe != "sense:instrument/loads-v1"
        {
            return Some(false);
        }
        if sources.len() != paths.len() || instrumented.len() != paths.len() {
            return None;
        }
        let Ok(text) = std::fs::read(request.root.join(&request.file)) else { return Some(true) };
        let text = String::from_utf8_lossy(&text);
        let hash = crate::digest::of_string(&text);
        for ((path, source), cut) in paths.into_iter().zip(sources).zip(instrumented) {
            if cut == 1 && word(path)? == request.file && word(source)? != hash {
                return Some(false);
            }
        }
        Some(true)
    }
    checked(record, request).unwrap_or(false)
}
