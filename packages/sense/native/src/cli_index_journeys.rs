//! Prepare journeys from the records this checkout will read.

// compass: variance-authority.reach

use std::path::Path;

use crate::journey_columns::FileFrame;
use crate::journeys::{self, JourneysCommit, JourneysPrepared};
use crate::record_layout::LAYOUT;
use crate::resolve::Tsconfig;
use crate::GitTree;

pub(crate) use crate::recordings::{recordings, Record};
use crate::recordings::commit;

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
