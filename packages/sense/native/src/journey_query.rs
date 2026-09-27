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

use std::collections::{HashMap, HashSet};

use napi_derive::napi;

use crate::journey_journal;
use crate::journey_read::{pairs, Journey};

/// One changed file and the lines that changed, as `[start, end]` pairs.
#[napi(object)]
pub struct JourneyChange {
    pub file: String,
    /// Flat inclusive pairs; empty names the whole file.
    pub ranges: Vec<u32>,
    /// What reading the file's two texts proved: `none`, nothing at runtime
    /// moved; `bodies`, what it does as it loads did not. Absent when no
    /// reading was made, and the lines are charged as they fall.
    pub read: Option<String>,
}

#[napi(object)]
pub struct JourneyTest {
    pub id: String,
    pub file: String,
    pub name: String,
    /// `ExecutionTest.stopped`: absent when the file does not say how the case settled.
    pub stopped: Option<bool>,
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
            stopped: match journey.test_settled.as_ref().map(|column| column[at]) {
                Some(journey_journal::STOPPED) => Some(true),
                Some(journey_journal::FINISHED) => Some(false),
                _ => None,
            },
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
#[napi(catch_unwind)]
pub fn project_journeys(file: String, changed: Vec<JourneyChange>) -> napi::Result<JourneyProjection> {
    project(&file, &changed).map_err(napi::Error::from_reason)
}

/// One case, by the file that declares it and its name there.
#[napi(object)]
pub struct EnteredCase {
    pub file: String,
    pub name: String,
}

/// One asked file's row in a recording.
#[napi(object)]
pub struct CasesEntered {
    pub file: String,
    /// How many recorded cases entered the file; `undefined` when the recording
    /// holds no row for it, which is a file nobody observed rather than one no
    /// case reached.
    pub cases: Option<u32>,
    /// Whether a region of the file ran while its module evaluated. Such a
    /// region is credited to no case: the cases whose files import the module
    /// ran it, and the file graph names them, which this reading does not
    /// build. So `cases` is the ones that entered it and not every one that ran
    /// it. `undefined` with no row.
    pub loaded: Option<bool>,
    /// The first of those cases in code-unit order of file and then name.
    pub titles: Vec<EnteredCase>,
    /// How many recorded cases the file declares, when it is a test file the
    /// recording ran; `undefined` when it declares none. A test file is rarely
    /// a module anybody imports, so this is its row.
    pub declared: Option<u32>,
    /// The first of their names in code-unit order.
    pub declared_names: Vec<String>,
}

/// The cases and names of the recorded cases each of `files` declares.
fn declared<'a>(journey: &'a Journey, files: &[String]) -> Result<HashMap<&'a str, Vec<&'a str>>, String> {
    let asked: HashSet<&str> = files.iter().map(String::as_str).collect();
    let mut declared: HashMap<&str, Vec<&str>> = HashMap::new();
    for case in 0..journey.tests() {
        let file = journey.text(journey.test_files[case])?;
        if asked.contains(file) {
            declared.entry(file).or_default().push(journey.text(journey.test_names[case])?);
        }
    }
    for names in declared.values_mut() {
        names.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
    }
    Ok(declared)
}

/// Which recorded cases entered each of `files`, and the first `titles` of
/// them. The whole of a module's regions answers it, because a case that
/// entered any region of the file entered the file; the sets are expanded here
/// so a question about three files never carries a recording's cases across.
fn entered(file: &str, files: &[String], titles: usize) -> Result<Vec<CasesEntered>, String> {
    let journey = Journey::open(file)?;
    let by_file = journey.by_file()?;
    let declares = declared(&journey, files)?;
    files
        .iter()
        .map(|asked| {
            let own = declares.get(asked.as_str());
            let declared = own.map(|names| names.len() as u32);
            let declared_names =
                own.map(|names| names.iter().take(titles).map(|&name| name.to_owned()).collect()).unwrap_or_default();
            let Some(&module) = by_file.get(asked.as_str()) else {
                return Ok(CasesEntered {
                    file: asked.clone(),
                    cases: None,
                    loaded: None,
                    titles: Vec::new(),
                    declared,
                    declared_names,
                });
            };
            let mut cases: HashSet<u32> = HashSet::new();
            for block in journey.blocks(module) {
                cases.extend(journey.members(block)?);
            }
            let loaded = journey.blocks(module).any(|block| journey.loaded[block] == 1);
            let mut named = cases
                .iter()
                .map(|&case| {
                    let case = case as usize;
                    Ok((journey.text(journey.test_files[case])?, journey.text(journey.test_names[case])?))
                })
                .collect::<Result<Vec<_>, String>>()?;
            named.sort_unstable_by(|left, right| {
                crate::order::code_unit(left.0, right.0).then_with(|| crate::order::code_unit(left.1, right.1))
            });
            named.truncate(titles);
            let titles =
                named.into_iter().map(|(file, name)| EnteredCase { file: file.to_owned(), name: name.to_owned() }).collect();
            Ok(CasesEntered {
                file: asked.clone(),
                cases: Some(cases.len() as u32),
                loaded: Some(loaded),
                titles,
                declared,
                declared_names,
            })
        })
        .collect()
}

/// For each of `files`, the recorded cases in the journey file at `file` that entered it.
#[napi(catch_unwind)]
pub fn cases_entered(file: String, files: Vec<String>, titles: u32) -> napi::Result<Vec<CasesEntered>> {
    entered(&file, &files, titles as usize).map_err(napi::Error::from_reason)
}
