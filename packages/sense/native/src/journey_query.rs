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
use crate::journey_read::{overlaps, pairs, Journey};

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
    /// `ExecutionTest.preconditions` as `tests.casePreconditions` spells them:
    /// absent for a case nobody listened to.
    pub preconditions: Option<String>,
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
            id: journey.test_id(at)?.to_owned(),
            file: journey.test_file(at)?.to_owned(),
            name: journey.test_name(at)?.to_owned(),
            stopped: match journey.test_settled(at)? {
                Some(journey_journal::STOPPED) => Some(true),
                Some(journey_journal::FINISHED) => Some(false),
                _ => None,
            },
            preconditions: journey.test_said(at)?.map(str::to_owned),
        }))
        .collect::<Result<Vec<_>, String>>()?;

    let mut modules = Vec::new();
    for change in changed {
        let Some(module) = journey.module_of(&change.file)? else { continue };
        let ranges = pairs(&change.ranges);
        let regions = journey.regions(module)?;
        let every = ranges.is_empty() || regions.iter().any(|region| overlaps(region, &ranges) && region.loaded);
        let blocks = regions
            .iter()
            .map(|region| Ok(JourneyRegion {
                kind: journey.text(region.kind)?.to_owned(),
                name: journey.text(region.name)?.to_owned(),
                path: journey.text(region.path)?.to_owned(),
                start_line: region.start,
                end_line: region.end,
                source: region.source,
                loaded: region.loaded,
                tests: if every || overlaps(region, &ranges) { journey.members(region.called)? } else { Vec::new() },
            }))
            .collect::<Result<_, String>>()?;
        modules.push(JourneyModule { file: change.file.clone(), blocks });
    }
    let files = journey.files()?.into_iter().map(str::to_owned).collect();
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
    /// ran it. `undefined` with no row.
    pub loaded: Option<bool>,
    /// How many of `cases` are there because their test file imports this one,
    /// directly or through others, over the source index. Only a file that ran
    /// while its module evaluated has any; `undefined` for one that did not, and
    /// also for one that did whose importers could not be read, when `cases`
    /// is only the cases that entered it.
    pub loaders: Option<u32>,
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
        let file = journey.test_file(case)?;
        if asked.contains(file) {
            declared.entry(file).or_default().push(journey.test_name(case)?);
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
///
/// A file that ran while its module evaluated also has the cases whose test
/// files import it, when `index` holds the source index they are read from.
fn entered(file: &str, files: &[String], titles: usize, index: Option<&str>) -> Result<Vec<CasesEntered>, String> {
    let journey = Journey::open(file)?;
    let declares = declared(&journey, files)?;
    let mut loading: Vec<&str> = Vec::new();
    for asked in files {
        if let Some(module) = journey.module_of(asked)? {
            if journey.regions(module)?.iter().any(|region| region.loaded) {
                loading.push(asked);
            }
        }
    }
    let importing = match index {
        Some(index) if !loading.is_empty() => crate::journey_loaders::importers(index, &loading)?,
        _ => None,
    };
    files
        .iter()
        .map(|asked| {
            let own = declares.get(asked.as_str());
            let declared = own.map(|names| names.len() as u32);
            let declared_names =
                own.map(|names| names.iter().take(titles).map(|&name| name.to_owned()).collect()).unwrap_or_default();
            let Some(module) = journey.module_of(asked)? else {
                return Ok(CasesEntered {
                    file: asked.clone(),
                    cases: None,
                    loaded: None,
                    loaders: None,
                    titles: Vec::new(),
                    declared,
                    declared_names,
                });
            };
            let regions = journey.regions(module)?;
            let mut cases: HashSet<u32> = HashSet::new();
            let mut sets = HashSet::new();
            for region in &regions {
                if sets.insert(region.called) {
                    cases.extend(journey.members(region.called)?);
                }
            }
            let loaded = regions.iter().any(|region| region.loaded);
            let mut loaders = None;
            if let Some(importers) = importing.as_ref().and_then(|found| found.get(asked.as_str())) {
                let before = cases.len();
                for case in 0..journey.tests() {
                    if importers.contains(journey.test_file(case)?) {
                        cases.insert(case as u32);
                    }
                }
                loaders = Some((cases.len() - before) as u32);
            }
            let mut named = cases
                .iter()
                .map(|&case| {
                    let case = case as usize;
                    Ok((journey.test_file(case)?, journey.test_name(case)?))
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
                loaders,
                titles,
                declared,
                declared_names,
            })
        })
        .collect()
}

/// For each of `files`, the recorded cases in the journey file at `file` that entered it.
#[napi(catch_unwind)]
pub fn cases_entered(
    file: String,
    files: Vec<String>,
    titles: u32,
    index: Option<String>,
) -> napi::Result<Vec<CasesEntered>> {
    entered(&file, &files, titles as usize, index.as_deref()).map_err(napi::Error::from_reason)
}
