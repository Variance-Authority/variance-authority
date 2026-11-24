//! The standalone selection from an explicit journey file.

// compass: variance-authority.reach

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use super::root_config;
use crate::journey_columns::FileFrame;
use crate::journey_query::JourneyChange;
use crate::journey_select::{self, JourneySelection};
use crate::module_verdict::classified;
use crate::read_any::{language_of, Language};

#[path = "select_patch.rs"]
mod patch;
#[path = "select_record.rs"]
mod record;
#[path = "select_source.rs"]
mod source;

pub(super) fn answer(args: &[&str], root: &Path, waiting: &mut impl FnMut(&str)) -> Option<(String, String)> {
    let (mut execution, mut diff, mut since, mut format, mut suite) = (None, None, None, None, None);
    let mut no_git = false;
    let mut args = args.iter().copied();
    while let Some(flag) = args.next() {
        if flag == "--no-git" && !no_git {
            no_git = true;
            continue;
        }
        let (flag, value) = match flag.split_once('=') {
            Some(pair) => pair,
            None => (flag, args.next().filter(|value| !value.starts_with("--"))?),
        };
        match flag {
            "--execution" if execution.is_none() => execution = Some(value),
            "--suite" if suite.is_none() && !value.is_empty() => suite = Some(value),
            "--diff" if diff.is_none() && value != "-" => diff = Some(value),
            "--since" if since.is_none() && !value.starts_with('-') => since = Some(value),
            "--format" if format.is_none() && matches!(value, "plain" | "json") => format = Some(value),
            _ => return None,
        }
    }

    if (execution.is_some() && suite.is_some()) || (diff.is_some() && (execution.is_none() || since.is_some())) {
        return None;
    }
    let recorded = record::Request { suite, execution, diff, format, no_git };
    if let Some(answer) = record::answer(root, recorded, waiting) {
        return Some(answer);
    }

    if suite.is_some() || root_config(root)?.is_some() || !root.join(".git").exists() {
        return None;
    }
    let execution = root.join(execution?);
    if execution.components().any(|component| component == std::path::Component::ParentDir) {
        return None;
    }
    let at = std::path::absolute(execution).ok()?;
    let mut record = FileFrame::open(&at).ok()??;
    if record.version != crate::record_layout::LAYOUT.cases.format
        || !record.columns.iter().any(|column| column.name == "tests.id")
    {
        return None;
    }
    let at = at.to_str()?;
    let patch = match (diff, since) {
        (Some(path), None) => std::fs::read_to_string(root.join(path)).ok()?,
        (None, Some(since)) => source::diff_since(root, since)?,
        _ => return None,
    };
    let files = patch::changes(&patch)?;
    if files.is_empty() || files.iter().any(|file| language_of(&file.change.file) != Some(Language::Module)) {
        return None;
    }
    let (changes, readings) = read_patch(root.to_str()?, files)?;
    super::follow_ups::source_readied(&super::source_index(root)?, waiting)?;
    let tree = source::refresh(root, no_git, crate::resolve::Tsconfig::Auto)?;
    let declared = tree.declared_readers(changes.iter().map(|change| change.file.as_str()));
    let selected = journey_select::select_lines(at, record.whole().ok()?, &changes, &tree, &declared).ok()?;
    if !selected.unread.is_empty() {
        return None;
    }
    render(at, format, selected, readings)
}

fn read_patch(root: &str, files: Vec<patch::File<'_>>) -> Option<(Vec<JourneyChange>, Vec<Reading>)> {
    let ids: Vec<_> = files.iter().filter_map(|file| file.preimage).collect();
    let blobs = if ids.is_empty() { Vec::new() } else { crate::commit_text::objects(root, &ids).ok()? };
    let mut blobs = blobs.into_iter();
    let mut changes = Vec::with_capacity(files.len());
    let mut readings = Vec::with_capacity(files.len());
    for mut file in files {
        let preimage = file.preimage.and_then(|_| blobs.next()?.ok());
        let (reading, read) = match preimage {
            None => (Read::Unread { unread: Unread::Source }, None),
            Some(bytes) => {
                let before = String::from_utf8_lossy(&bytes);
                match file.applied(&before) {
                    None => (Read::Unread { unread: Unread::Hunk }, None),
                    Some(after) => match classified(&file.change.file, &before, &after) {
                        None => (Read::Unread { unread: Unread::Parse }, None),
                        // A new binding import can trigger package-declared side effects.
                        Some(change) if change.kind == "bodies" && !change.imported.is_empty() => return None,
                        Some(change) => {
                            let read = matches!(change.kind.as_str(), "none" | "bodies").then(|| change.kind.clone());
                            (Read::Compared { verdict: change.kind, names: change.names }, read)
                        }
                    },
                }
            }
        };
        file.change.read = read;
        readings.push(Reading { file: file.change.file.clone(), reading });
        changes.push(file.change);
    }
    Some((changes, readings))
}

#[derive(Serialize)]
struct Reading {
    file: String,
    #[serde(flatten)]
    reading: Read,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Read {
    Unread { unread: Unread },
    Compared { verdict: String, names: Vec<String> },
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum Unread {
    Source,
    Hunk,
    Parse,
    Stale,
    Answered,
}

impl Read {
    fn said(&self) -> (String, &str, &'static str) {
        match self {
            Self::Compared { verdict, names } => match verdict.as_str() {
                "none" => (verdict.clone(), verdict, " — the runtime text is equal"),
                "bodies" => (verdict.clone(), verdict, " — the changed regions are charged, not the whole module"),
                "load" => (verdict.clone(), verdict, " — every test that loaded it is charged"),
                _ => {
                    let said =
                        if names.is_empty() { verdict.clone() } else { format!("{verdict} ({})", names.join(", ")) };
                    (said, verdict, " — the readers of the changed values and the changed regions are charged")
                }
            },
            Self::Unread { unread } => {
                let reason = match unread {
                    Unread::Source => "no recorded text to read it against",
                    Unread::Hunk => "the diff does not apply to the recorded text",
                    Unread::Parse => "one side does not parse",
                    Unread::Answered => return (
                        "unread (its rows, its preconditions, its importers or the install comparison answer for it)"
                            .to_owned(),
                        "answered",
                        "",
                    ),
                    Unread::Stale => {
                        return (
                            "unread (recorded from a text nobody kept)".to_owned(),
                            "stale",
                            " — every region of it is charged",
                        )
                    }
                };
                (format!("unread ({reason})"), "unread", " — its changed lines are charged")
            }
        }
    }
}

#[derive(Serialize)]
struct Recorded {
    whole: usize,
    entered: usize,
}

#[derive(Serialize)]
struct Journal<'a> {
    at: &'a str,
    recorded: Recorded,
}

#[derive(Serialize)]
struct Answer<'a> {
    ground: &'static str,
    skip: Vec<String>,
    because: String,
    notes: [&'static str; 1],
    journal: Journal<'a>,
    unread: [(); 0],
    stale: [(); 0],
    readings: Vec<Reading>,
}

fn render(
    at: &str,
    format: Option<&str>,
    selected: JourneySelection,
    readings: Vec<Reading>,
) -> Option<(String, String)> {
    let JourneySelection { mut whole, entered, .. } = selected;
    if whole.is_empty() {
        return None;
    }
    let recorded = Recorded { whole: whole.len(), entered: entered.len() };
    let noun = if whole.len() == 1 { "test file" } else { "test files" };
    let entered: HashSet<_> = entered.into_iter().collect();
    whole.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
    let skip: Vec<_> = whole.into_iter().filter(|test| !entered.contains(test)).collect();
    let because = format!(
        "skipping {} of {} {noun} recorded whole: none covered a changed line; every other test file runs",
        skip.len(),
        recorded.whole
    );
    let note = concat!(
        "this repository declares nothing before reach, so a change to its runner config or the setup it loads ",
        "is read like any other file; name them in `before` in variance.config.json to run the whole suite when they change"
    );
    let mut err = format!("{because}.\n{note}.\n");
    let mut seen = HashSet::new();
    for reading in &readings {
        let (said, key, gloss) = reading.reading.said();
        let gloss = if seen.insert(key) { gloss } else { "" };
        err.push_str(&format!("read {}: {said}{gloss}\n", reading.file));
    }
    let out = match format {
        Some("json") => {
            let answer = Answer {
                ground: "read",
                skip,
                because,
                notes: [note],
                journal: Journal { at, recorded },
                unread: [],
                stale: [],
                readings,
            };
            format!("{}\n", serde_json::to_string_pretty(&answer).ok()?)
        }
        _ => skip.into_iter().map(|test| format!("{test}\n")).collect(),
    };
    Some((out, err))
}
