//! The skip stream and the recorded selection's explanation.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::super::{Read, Reading, Unread};
use super::regions::{Reason, Selection};

#[derive(Serialize)]
struct Answer<'a> {
    ground: &'static str,
    skip: Vec<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    widened: Option<&'static str>,
    because: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasons: Option<Vec<Reason<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selected: Option<Vec<Cause<'a>>>,
    incomplete: Vec<&'a str>,
    notes: Vec<String>,
    journal: Journal<'a>,
    unread: [(); 0],
    stale: Vec<String>,
    readings: Vec<Reading>,
}

#[derive(Serialize)]
struct Journal<'a> {
    at: &'a str,
    commit: &'a str,
    recorded: Counts,
}

#[derive(Serialize)]
struct Counts {
    whole: usize,
    entered: usize,
}

#[derive(Serialize)]
struct Cause<'a> {
    test: &'a str,
    reasons: Vec<usize>,
}

pub(super) fn answer(
    at: &str,
    commit: &str,
    format: Option<&str>,
    mut notes: Vec<String>,
    state: Selection<'_, '_>,
    mut readings: Vec<Reading>,
    stale: Vec<String>,
) -> Option<(String, String)> {
    let (whole, incomplete, entered) = state.finish();
    let journal = Journal { at, commit, recorded: Counts { whole: whole.len(), entered: entered.len() } };
    let kept: HashSet<_> = entered.iter().map(|one| one.test).collect();
    let noun = if whole.len() == 1 { "test file" } else { "test files" };
    let skip: Vec<_> = whole.into_iter().filter(|test| !kept.contains(test)).collect();
    let widened = (journal.recorded.whole == 0).then_some("the journal holds no whole observation of any test file");
    let because = if widened.is_some() {
        "nothing recorded whole, so every test file runs".to_owned()
    } else {
        format!(
            "skipping {} of {} {noun} recorded whole: none covered a changed line; every other test file runs",
            skip.len(),
            journal.recorded.whole
        )
    };
    if !stale.is_empty() {
        let (module, was, it) = if stale.len() == 1 { ("module", "was", "it") } else { ("modules", "were", "them") };
        notes.push(format!("{} changed {module} {was} recorded from a text the journal's own commit does not hold and the cache did not keep, so every region of {it} was charged rather than read; the next run that loads {it} records {it} again", stale.len()));
        readings.extend(
            stale.iter().map(|file| Reading { file: file.clone(), reading: Read::Unread { unread: Unread::Stale } }),
        );
    }
    let mut err = widened.map_or_else(|| format!("{because}.\n"), |why| format!("skipping nothing: {why}.\n"));
    for note in &notes {
        err.push_str(&format!("{note}.\n"));
    }
    let mut said = HashSet::new();
    for reading in &readings {
        let (read, kind, gloss) = reading.reading.said();
        let gloss = if said.insert(kind) { gloss } else { "" };
        err.push_str(&format!("read {}: {read}{gloss}\n", reading.file));
    }
    let out = if format == Some("json") {
        let mut positions = HashMap::new();
        let mut reasons = Vec::new();
        let selected: Vec<_> = entered
            .into_iter()
            .map(|cause| {
                let mut seen = HashSet::new();
                let named = cause
                    .via
                    .into_iter()
                    .filter_map(|why| {
                        let id = *positions.entry(why).or_insert_with(|| {
                            let id = reasons.len();
                            reasons.push(why);
                            id
                        });
                        seen.insert(id).then_some(id)
                    })
                    .collect();
                Cause { test: cause.test, reasons: named }
            })
            .collect();
        let answer = Answer {
            ground: "read",
            skip,
            widened,
            because,
            reasons: widened.is_none().then_some(reasons),
            selected: widened.is_none().then_some(selected),
            incomplete,
            notes,
            journal,
            unread: [],
            stale,
            readings,
        };
        format!("{}\n", serde_json::to_string_pretty(&answer).ok()?)
    } else {
        skip.into_iter().map(|test| format!("{test}\n")).collect()
    };
    Some((out, err))
}

pub(super) fn unmeasured(at: &str, format: Option<&str>, case_only: bool) -> Option<(String, String)> {
    #[derive(Serialize)]
    struct Empty<'a> {
        ground: &'static str,
        skip: [(); 0],
        widened: &'a str,
        because: &'static str,
        notes: [(); 0],
        journal: Location<'a>,
        unread: [(); 0],
        stale: [(); 0],
    }

    #[derive(Serialize)]
    struct Location<'a> {
        at: &'a str,
    }

    let (ground, widened, because) = if case_only {
        (
            "no-coverage",
            format!("the record at {at} holds no coverage"),
            "the run that wrote it instrumented no module, so every test file runs",
        )
    } else {
        ("no-journal", format!("no execution journal at {at}"), "nothing to narrow by, so every test file runs")
    };
    let err = format!("skipping nothing: {widened}.\n");
    let out = if format == Some("json") {
        let answer = Empty {
            ground,
            skip: [],
            widened: &widened,
            because,
            notes: [],
            journal: Location { at },
            unread: [],
            stale: [],
        };
        format!("{}\n", serde_json::to_string_pretty(&answer).ok()?)
    } else {
        String::new()
    };
    Some((out, err))
}

pub(super) fn before(
    at: &str,
    commit: &str,
    format: Option<&str>,
    widened: &str,
    rests: &[String],
    notes: &[String],
) -> Option<(String, String)> {
    let mut err = format!("skipping nothing: {widened}.\n");
    for note in notes {
        err.push_str(&format!("{note}.\n"));
    }
    let out = if format == Some("json") {
        let answer = serde_json::json!({
            "ground": "before",
            "skip": [],
            "widened": widened,
            "because": "what a suite rests on runs before every test in it, so every test file runs",
            "rests": rests,
            "notes": notes,
            "journal": { "at": at, "commit": commit },
            "unread": [],
            "stale": [],
        });
        format!("{}\n", serde_json::to_string_pretty(&answer).ok()?)
    } else {
        String::new()
    };
    Some((out, err))
}
