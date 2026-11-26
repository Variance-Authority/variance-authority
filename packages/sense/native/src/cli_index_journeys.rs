//! Prepare journeys from the records this checkout will read.

// compass: variance-authority.reach

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::journey_columns::FileFrame;
use crate::journeys::{self, JourneysCommit, JourneysPrepared};
use crate::record_layout::LAYOUT;
use crate::resolve::Tsconfig;
use crate::GitTree;

pub(crate) struct Record {
    pub(crate) suite: Option<String>,
    pub(crate) file: PathBuf,
}

pub(crate) fn recordings(layers: &super::Layers, config: Option<&Value>) -> Option<Vec<Record>> {
    let nearest = |inside: &Path| -> Option<PathBuf> {
        let own = layers.top.join(inside);
        let base = layers.base.join(inside);
        Some(if own.try_exists().ok()? || own == base || !base.try_exists().ok()? { own } else { base })
    };
    let Some(suites) = config.and_then(|config| config.get("suites")) else {
        return Some(vec![Record { suite: None, file: nearest(Path::new("coverage.bin"))? }]);
    };
    let suites = suites.as_object()?;
    if suites.is_empty() {
        return None;
    }
    let mut names: Vec<_> = suites.keys().collect();
    names.sort_unstable();
    names
        .into_iter()
        .map(|name| {
            let suite = suites.get(name)?.as_object()?;
            if !name.bytes().next()?.is_ascii_alphanumeric()
                || !name.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
                || suite.keys().any(|key| {
                    !matches!(key.as_str(), "before" | "carry" | "ignore" | "precision" | "kind" | "relations")
                })
                || !matches!(suite.get("kind")?.as_str()?, "unit" | "integration" | "e2e" | "visual" | "job")
            {
                return None;
            }
            let inside = Path::new("suites").join(name).join("coverage.bin");
            if let Some(carry) = suite.get("carry") {
                match carry.as_str()? {
                    "share" => {
                        // An own record takes precedence. A shared cache without an
                        // own record still needs the existing mainline resolver.
                        let own = layers.top.join(&inside);
                        if !own.try_exists().ok()?
                            && layers.cache.join("share/read").join(name).join("fetched.json").try_exists().ok()?
                        {
                            return None;
                        }
                    }
                    "actions-cache" => {}
                    _ => return None,
                }
            }
            let relations = suite.get("relations").map(Value::as_bool);
            if relations == Some(None) {
                return None;
            }
            if let Some(precision) = suite.get("precision") {
                match precision.as_str()? {
                    "file" | "symbol" if relations != Some(Some(false)) => {}
                    "file-use" | "function-use" | "region-use" => {}
                    _ => return None,
                }
            }
            for key in ["before", "ignore"] {
                if let Some(paths) = suite.get(key) {
                    let paths = paths.as_array()?;
                    if paths.is_empty() || paths.iter().any(|path| path.as_str().is_none_or(str::is_empty)) {
                        return None;
                    }
                }
            }
            Some(Record { suite: Some(name.clone()), file: nearest(&inside)? })
        })
        .collect()
}

pub(super) fn prepare(
    root: &str,
    index: &str,
    tree: Option<&GitTree>,
    recordings: Vec<Record>,
    tsconfig: &Tsconfig,
) -> (Vec<String>, Vec<String>) {
    let mut lines = Vec::new();
    let mut failed = Vec::new();
    for record in recordings {
        let label =
            record.suite.as_ref().map_or_else(|| "journeys".to_owned(), |suite| format!("journeys, suite {suite}"));
        let out = match record.suite {
            Some(suite) => format!("{index}.{suite}.journeys"),
            None => format!("{index}.journeys"),
        };
        let shown = record.file.strip_prefix(root).unwrap_or(&record.file).display();
        let absent = format!("nothing is recorded at {shown}");
        let result = walk(root, index, tree, &record.file, &out, tsconfig, &absent);
        lines.push(match result {
            Ok(Some(made)) => line(&label, made),
            Ok(None) => format!("{label}: not prepared: {absent}"),
            Err(Why::Unprepared(why)) => format!("{label}: not prepared: {why}"),
            Err(Why::Failed(why)) => {
                let line = format!("{label}: not prepared: {why}");
                failed.push(why);
                line
            }
        });
    }
    (lines, failed)
}

enum Why {
    Unprepared(String),
    Failed(String),
}

fn walk(
    root: &str,
    index: &str,
    tree: Option<&GitTree>,
    path: &Path,
    out: &str,
    tsconfig: &Tsconfig,
    absent: &str,
) -> Result<Option<JourneysPrepared>, Why> {
    let shown = path.strip_prefix(root).unwrap_or(path).display();
    let unreadable = |why: String| Why::Failed(format!("the recording at {shown} does not read ({why})"));
    let path_str = path.to_str().ok_or_else(|| unreadable("its path is not UTF-8".to_owned()))?;
    let Some(mut file) = FileFrame::open(path).map_err(unreadable)? else { return Ok(None) };
    let layout = &LAYOUT.coverage;
    let cases = file.columns.iter().any(|section| section.name == layout.part("index"));
    if cases {
        if let Some(kept) = journeys::journeys_kept(index.to_owned(), path_str.to_owned(), out.to_owned()) {
            return Ok(Some(kept));
        }
    }
    if !layout.readable(file.version) {
        return Err(unreadable(format!("unrecognized record version {}", file.version)));
    }
    let commit = commit(&mut file).map_err(unreadable)?;
    if !cases {
        return Err(Why::Unprepared(absent.to_owned()));
    }
    let Some(commit) = commit else { return Err(Why::Unprepared("the recording names no commit".to_owned())) };
    let at = JourneysCommit { commit: Some(commit), unread: None };
    journeys::prepare_listed(root, index, path_str, at, out, tree, tsconfig.clone())
        .map_err(|error| Why::Failed(error.reason))?
        .map(Some)
        .ok_or_else(|| Why::Unprepared("there is no source index".to_owned()))
}

pub(crate) fn commit(file: &mut FileFrame) -> Result<Option<String>, String> {
    if !file.columns.iter().any(|section| section.name == "snapshot.commit") {
        if file.columns.iter().all(|section| LAYOUT.coverage.parts.iter().any(|(_, name)| *name == section.name)) {
            return Err("the record holds cases but no coverage".to_owned());
        }
        return Err("the record has no snapshot.commit section".to_owned());
    }
    let mut columns = file.selected(&["strings.blob", "strings.off", "snapshot.commit"])?;
    let commit = columns.take_words("snapshot.commit")?;
    let id = match commit.as_slice() {
        [] => return Ok(None),
        [id] => *id as usize,
        _ => return Err("the record names more than one commit".to_owned()),
    };
    let offsets = columns.take_words("strings.off")?;
    let blob = columns.held("strings.blob")?;
    let text = offsets
        .get(id)
        .zip(offsets.get(id + 1))
        .and_then(|(&start, &end)| blob.get(start as usize..end as usize))
        .ok_or("the record's commit string is out of bounds")?;
    let commit = std::str::from_utf8(text).map_err(|error| error.to_string())?;
    Ok(Some(commit.to_owned()))
}

fn line(label: &str, made: JourneysPrepared) -> String {
    let JourneysPrepared { kept, cases, functions_entered, placed, calls, flows, fell_back, .. } = made;
    let count = |n: u32, unit: &str| format!("{n} {unit}{}", if n == 1 { "" } else { "s" });
    let percentage = if functions_entered == 0.0 {
        String::new()
    } else {
        let share = placed / functions_entered * 100.0;
        if share > 0.0 && share < 0.5 {
            " (<1%)".to_owned()
        } else {
            format!(" ({}%)", share.round())
        }
    };
    let mut notes = vec![format!(
        "{label}: {} walked; a caller is placed for {placed} of the {functions_entered} functions the cases entered, counted once per case that entered each{percentage}; {}, {}",
        count(cases, "case"), count(calls, "distinct call"), count(flows, "distinct package flow")
    )];
    if kept {
        notes.push("kept, because the recording, the index and the walk are the ones they were made from".to_owned());
    }
    if fell_back > 0 {
        notes.push(format!(
            "{} the index did not resolve were resolved by the walk",
            count(fell_back, "import specifier")
        ));
    }
    notes.join("; ")
}

/// The recordings `symbol --line` orders declarations by: each of
/// [`recordings`] that keeps its cases, with the commit it ran at or why it does not read.
pub(crate) fn recorded(layers: &super::Layers, config: Option<&Value>) -> Option<Vec<crate::help_symbol_line::Recorded>> {
    let mut kept = Vec::new();
    for record in recordings(layers, config)? {
        let Ok(Some(mut file)) = FileFrame::open(&record.file) else { continue };
        if !file.columns.iter().any(|section| section.name == LAYOUT.coverage.part("index")) { continue }
        let (commit, unread) = match commit(&mut file) {
            Ok(commit) => (commit, None),
            Err(why) => (None, Some(format!("the recording does not read ({why})"))),
        };
        kept.push(crate::help_symbol_line::Recorded { suite: record.suite, recording: record.file.to_str()?.to_owned(), commit, unread });
    }
    Some(kept)
}
