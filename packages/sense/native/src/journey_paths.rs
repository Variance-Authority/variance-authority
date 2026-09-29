//! The paths through one function: its cases, partitioned by which of the
//! regions written in it they entered. A hub a thousand cases pass collapses to
//! a handful of paths. The path most of them take is passage — the cases that
//! only run the code on their way elsewhere — and every other path is a
//! purpose, told by the smallest case that takes it.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};

use napi_derive::napi;

use crate::journey_masks::JourneyMasks;

/// A recorded function.
#[napi(object)]
pub struct JourneyFunction {
    pub name: String,
    pub file: String,
    pub line: u32,
    pub end: u32,
}

/// A region written in a function.
#[napi(object)]
pub struct JourneyBlock {
    pub kind: String,
    pub file: String,
    pub line: u32,
    pub end: u32,
    /// The name of the function it is written in, when one is recorded.
    pub function: Option<String>,
}

/// One case, numbered by its position in the recording.
#[napi(object)]
pub struct JourneyCase {
    pub case: u32,
    pub file: String,
    pub name: String,
    /// The regions its journey entered.
    pub blocks: u32,
    /// Other cases whose journey entered exactly the same regions.
    pub alike: u32,
}

#[napi(object)]
pub struct JourneyPath {
    /// Cases that take it.
    pub cases: u32,
    /// Test files those cases are written in.
    pub files: u32,
    /// The regions of the function it enters, in source order.
    pub entered: Vec<JourneyBlock>,
    /// The median journey size of its cases.
    pub median: u32,
    pub smallest: JourneyCase,
    /// Whether more than half the function's cases take it.
    pub passage: bool,
}

#[napi(object)]
pub struct PathsThrough {
    /// Why the recording cannot answer; every other field is empty then.
    pub not_recorded: Option<String>,
    pub function: Option<JourneyFunction>,
    /// Cases that entered the function.
    pub cases: u32,
    /// Most cases first.
    pub paths: Vec<JourneyPath>,
}

fn refused(reason: String) -> PathsThrough {
    PathsThrough { not_recorded: Some(reason), function: None, cases: 0, paths: Vec::new() }
}

/// Every path through the innermost function recorded at `file:line`.
#[napi(catch_unwind)]
pub fn paths_through(recording: String, file: String, line: u32) -> PathsThrough {
    let answered = JourneyMasks::open(&recording).and_then(|mut masks| through(&mut masks, &file, line));
    match answered {
        Ok(Some(answer)) => answer,
        Ok(None) => refused(format!("no function the recording holds spans {file}:{line}")),
        Err(error) => refused(format!("the recording did not read ({error})")),
    }
}

pub(crate) fn through(masks: &mut JourneyMasks, file: &str, line: u32) -> Result<Option<PathsThrough>, String> {
    let Some(function) = masks.function_at(file, line)? else { return Ok(None) };
    let inner = masks.inside(function);
    let cases = masks.entered(function)?;
    let mut taken: HashMap<u32, Vec<u32>> = cases.iter().map(|&case| (case, Vec::new())).collect();
    for &bit in &inner {
        for &case in masks.entered(bit)?.iter() {
            if let Some(took) = taken.get_mut(&case) {
                took.push(bit);
            }
        }
    }
    let mut by_path: HashMap<Vec<u32>, Vec<u32>> = HashMap::new();
    for &case in cases.iter() {
        by_path.entry(taken.remove(&case).unwrap_or_default()).or_default().push(case);
    }
    let mut paths: Vec<(Vec<u32>, Vec<u32>)> = by_path.into_iter().collect();
    paths.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)));
    let sizes = masks.sizes()?;
    let total = cases.len();
    let mut answered = Vec::with_capacity(paths.len());
    for (took, mut members) in paths {
        members.sort_by_key(|&case| (sizes[case as usize], case));
        let smallest = members[0];
        let mut by_size: Vec<u32> = members.iter().map(|&case| sizes[case as usize]).collect();
        by_size.sort_unstable();
        let mut files = HashSet::new();
        for &case in &members {
            files.insert(masks.journey.test_file(case as usize)?);
        }
        answered.push(JourneyPath {
            cases: members.len() as u32,
            files: files.len() as u32,
            entered: took.iter().map(|&bit| block(masks, bit)).collect::<Result<_, _>>()?,
            median: by_size[by_size.len() / 2],
            smallest: case_of(masks, smallest, sizes[smallest as usize], 0)?,
            passage: members.len() * 2 > total,
        });
    }
    Ok(Some(PathsThrough { not_recorded: None, function: Some(function_of(masks, function)?), cases: total as u32, paths: answered }))
}

pub(crate) fn function_of(masks: &JourneyMasks, bit: u32) -> Result<JourneyFunction, String> {
    let held = masks.bits[bit as usize];
    Ok(JourneyFunction { name: masks.journey.text(held.name)?.to_owned(), file: masks.file(bit)?.to_owned(), line: held.start, end: held.end })
}

pub(crate) fn block(masks: &JourneyMasks, bit: u32) -> Result<JourneyBlock, String> {
    let held = masks.bits[bit as usize];
    let function = held.function.map(|function| masks.journey.text(masks.bits[function as usize].name).map(str::to_owned)).transpose()?;
    Ok(JourneyBlock { kind: masks.journey.text(held.kind)?.to_owned(), file: masks.file(bit)?.to_owned(), line: held.start, end: held.end, function })
}

pub(crate) fn case_of(masks: &JourneyMasks, case: u32, blocks: u32, alike: u32) -> Result<JourneyCase, String> {
    Ok(JourneyCase {
        case,
        file: masks.journey.test_file(case as usize)?.to_owned(),
        name: masks.journey.test_name(case as usize)?.to_owned(),
        blocks,
        alike,
    })
}
