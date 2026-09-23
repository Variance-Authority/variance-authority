//! A journey file projected onto a change, so the reading stays on this side.
//!
//! A stitched day of shards holds hundreds of millions of crossings in tens of
//! megabytes, because a region's cases are one interned set and not one row
//! each. Expanding that relation into JavaScript objects is what a question
//! about four changed lines must never cost, and it is what the heap limit
//! refused. So the question is asked here: the file is opened, the sets of the
//! regions the change lands on are expanded, and the answer is the tests plus
//! the changed modules, in the shape `decodeExecutionIndex` returns, holding only
//! what a reader of that change could look at.
//!
//! A region's cases are expanded when a changed range overlaps it. Every region
//! in the module is expanded when the file is named with no lines, or when an
//! overlapped region ran while its module evaluated: both are answered by
//! everyone who entered the module, when the file graph cannot answer them. Any
//! other region keeps its place and position, so the innermost one is still
//! found, and carries no cases.

use napi_derive::napi;

use crate::journey_read::{pairs, Journey};

/// One changed file and the lines that changed, as `[start, end]` pairs.
#[napi(object)]
pub struct JourneyChange {
    pub file: String,
    /// Flat inclusive pairs; empty names the whole file.
    pub ranges: Vec<u32>,
}

#[napi(object)]
pub struct JourneyTest {
    pub id: String,
    pub file: String,
    pub name: String,
}

#[napi(object)]
pub struct JourneyRegion {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub source: bool,
    pub loaded: bool,
    /// Indices into `tests`, and nothing for a region the change did not ask about.
    pub tests: Vec<u32>,
}

#[napi(object)]
pub struct JourneyModule {
    pub file: String,
    pub blocks: Vec<JourneyRegion>,
}

#[napi(object)]
pub struct JourneyProjection {
    pub tests: Vec<JourneyTest>,
    /// The changed files the journey holds a row for, in the order they were asked.
    pub modules: Vec<JourneyModule>,
    /// Every file the journey holds a row for, so a miss can say what it holds instead.
    pub files: Vec<String>,
}

fn project(file: &str, changed: &[JourneyChange]) -> Result<JourneyProjection, String> {
    let journey = Journey::open(file)?;
    let tests = (0..journey.tests())
        .map(|at| Ok(JourneyTest {
            id: journey.text(journey.test_ids[at])?.to_owned(),
            file: journey.text(journey.test_files[at])?.to_owned(),
            name: journey.text(journey.test_names[at])?.to_owned(),
        }))
        .collect::<Result<Vec<_>, String>>()?;
    let by_file = journey.by_file()?;

    let mut modules = Vec::new();
    for change in changed {
        let Some(&module) = by_file.get(change.file.as_str()) else { continue };
        let ranges = pairs(&change.ranges);
        let every = ranges.is_empty()
            || journey.blocks(module).any(|block| journey.overlaps(block, &ranges) && journey.loaded[block] == 1);
        let blocks = journey
            .blocks(module)
            .map(|block| Ok(JourneyRegion {
                kind: journey.text(journey.kinds[block])?.to_owned(),
                name: journey.text(journey.names[block])?.to_owned(),
                path: journey.text(journey.paths[block])?.to_owned(),
                start_line: journey.starts[block],
                end_line: journey.ends[block],
                source: journey.sources[block] == 1,
                loaded: journey.loaded[block] == 1,
                tests: if every || journey.overlaps(block, &ranges) { journey.members(block)? } else { Vec::new() },
            }))
            .collect::<Result<_, String>>()?;
        modules.push(JourneyModule { file: change.file.clone(), blocks });
    }
    let files = by_file.keys().map(|file| (*file).to_owned()).collect();
    Ok(JourneyProjection { tests, modules, files })
}

/// The journey file at `file`, holding only what a reader of `changed` could look at.
#[napi]
pub fn project_journeys(file: String, changed: Vec<JourneyChange>) -> napi::Result<JourneyProjection> {
    project(&file, &changed).map_err(napi::Error::from_reason)
}
