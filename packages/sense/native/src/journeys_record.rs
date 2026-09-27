//! The recording as the journeys walk reads it, joined to the call graph.
//!
//! Every block of the journey file is a region, module bodies included, with
//! the cases that entered it. The recorder and the parser place a function
//! differently — the recorder opens a callback on the line of the call that
//! carries it, so its block can start up to two lines before the parser's
//! function, and end up to two lines earlier — so a block matches a parsed
//! function when both ends fall in that window, and the name decides a tie.
//! Every match the walk asks for is made once, here, before any case walks.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use rayon::prelude::*;

use crate::journey_read::Journey;
use crate::journeys_graph::Graph;
use crate::journeys_parse::{is_argument, Func};

pub(crate) const NONE: u32 = u32::MAX;

pub(crate) struct Region<'j> {
    pub file: u32,
    pub kind: &'j str,
    pub name: &'j str,
    /// The name's last `/` segment: what a member call would say.
    pub last: &'j str,
    pub start: u32,
    pub end: u32,
    pub loaded: bool,
    pub cases: u32,
}

impl Region<'_> {
    pub(crate) fn function(&self) -> bool {
        self.kind == "function"
    }
}

pub(crate) struct Record<'j> {
    pub regions: Vec<Region<'j>>,
    /// Per graph file: its regions, in block order. Only a recorded file has any.
    pub regions_of: Vec<std::ops::Range<u32>>,
    /// Per case: the regions it entered, ascending.
    pub entered: Vec<Vec<u32>>,
    /// Per case: its test file's graph id and its name.
    pub tests: Vec<(u32, &'j str)>,
    /// Per graph file, per parsed function: its region, or `NONE`.
    pub region_for: Vec<Vec<u32>>,
    /// Per region: its parsed function, or `NONE`.
    pub fn_for: Vec<u32>,
    /// Per graph file: the non-module regions around each line a call sits on,
    /// narrowest first and, at one span, the later-opening first.
    pub around: Vec<HashMap<u32, Box<[u32]>>>,
    /// `F.argK` → the functions written as argument K of a call to F, in the
    /// recorded files.
    pub handed: HashMap<String, Vec<(u32, u32)>>,
}

impl Record<'_> {
    pub(crate) fn recorded(&self, file: u32) -> bool {
        self.regions_of.get(file as usize).is_some_and(|range| !range.is_empty())
    }

    pub(crate) fn region_for(&self, file: u32, func: u32) -> Option<u32> {
        self.region_for.get(file as usize).and_then(|fns| fns.get(func as usize)).copied().filter(|&j| j != NONE)
    }
}

/// The files a journey's blocks are in, then its tests' files: the graph's seeds.
pub(crate) fn seeds(journey: &Journey) -> Result<Vec<String>, String> {
    let mut seeds: Vec<String> = journey.module_files.iter().map(|&id| journey.text(id).map(str::to_owned)).collect::<Result<_, _>>()?;
    for &id in &journey.test_files {
        seeds.push(journey.text(id)?.to_owned());
    }
    Ok(seeds)
}

fn score(func: &Func, region: &Region) -> Option<u32> {
    let starts = func.line.checked_sub(region.start).filter(|gap| *gap <= 2)?;
    let ends = func.end_line.checked_sub(region.end).filter(|gap| *gap <= 2)?;
    let named = func.hint.as_deref() == Some(region.last);
    Some(if named { 0 } else { 10 } + starts + ends)
}

pub(crate) fn record<'j>(journey: &'j Journey, graph: &Graph) -> Result<Record<'j>, String> {
    let files = graph.files.len();
    let mut regions: Vec<Region> = Vec::with_capacity(journey.kinds.len());
    let mut regions_of = vec![0..0; files];
    for (module, &id) in journey.module_files.iter().enumerate() {
        let file = graph.ids[journey.text(id)?];
        let from = regions.len() as u32;
        for block in journey.blocks(module) {
            let name = journey.text(journey.names[block])?;
            regions.push(Region {
                file,
                kind: journey.text(journey.kinds[block])?,
                name,
                last: name.rsplit('/').next().unwrap_or(name),
                start: journey.starts[block],
                end: journey.ends[block],
                loaded: journey.loaded[block] == 1,
                cases: 0,
            });
        }
        regions_of[file as usize] = from..regions.len() as u32;
    }
    let members: Vec<Vec<u32>> = (0..regions.len()).into_par_iter().map(|block| journey.members(block)).collect::<Result<_, _>>()?;
    let mut entered: Vec<Vec<u32>> = vec![Vec::new(); journey.tests()];
    for (j, cases) in members.iter().enumerate() {
        regions[j].cases = cases.len() as u32;
        for &case in cases {
            entered[case as usize].push(j as u32);
        }
    }
    let tests = journey
        .test_files
        .iter()
        .zip(&journey.test_names)
        .map(|(&file, &name)| Ok((graph.ids[journey.text(file)?], journey.text(name)?)))
        .collect::<Result<_, String>>()?;

    // Both directions of the match, from one pass over each file's pairs.
    let matched: Vec<(Vec<u32>, Vec<(u32, u32, u32)>)> = (0..files)
        .into_par_iter()
        .map(|file| {
            let range = regions_of[file].clone();
            let Some(parsed) = graph.parsed[file].as_ref().filter(|_| !range.is_empty()) else { return (Vec::new(), Vec::new()) };
            let functions: Vec<u32> = range.filter(|&j| regions[j as usize].function()).collect();
            let mut best_region = vec![NONE; parsed.fns.len()];
            let mut best_fn: Vec<(u32, u32, u32)> = Vec::new();
            let mut by_region: HashMap<u32, (u32, u32)> = HashMap::new();
            for (at, func) in parsed.fns.iter().enumerate() {
                let mut best = (u32::MAX, NONE);
                for &j in &functions {
                    let Some(score) = score(func, &regions[j as usize]) else { continue };
                    if score < best.0 {
                        best = (score, j);
                    }
                    let held = by_region.entry(j).or_insert((u32::MAX, NONE));
                    if score < held.0 {
                        *held = (score, at as u32);
                    }
                }
                best_region[at] = best.1;
            }
            best_fn.extend(by_region.into_iter().map(|(j, (_, at))| (j, at, 0)));
            (best_region, best_fn)
        })
        .collect();
    let mut region_for = Vec::with_capacity(files);
    let mut fn_for = vec![NONE; regions.len()];
    for (fns, regions_matched) in matched {
        region_for.push(fns);
        for (j, at, _) in regions_matched {
            fn_for[j as usize] = at;
        }
    }

    let around: Vec<HashMap<u32, Box<[u32]>>> = (0..files)
        .into_par_iter()
        .map(|file| {
            let range = regions_of[file].clone();
            let Some(parsed) = graph.parsed[file].as_ref().filter(|_| !range.is_empty()) else { return HashMap::new() };
            let blocks: Vec<u32> = range.filter(|&j| regions[j as usize].kind != "module").collect();
            let mut lines: Vec<u32> = parsed.calls.iter().map(|call| call.line).collect();
            lines.sort_unstable();
            lines.dedup();
            lines
                .into_iter()
                .map(|line| {
                    let mut holding: Vec<u32> = blocks
                        .iter()
                        .copied()
                        .filter(|&j| regions[j as usize].start <= line && line <= regions[j as usize].end)
                        .collect();
                    holding.sort_by(|&a, &b| {
                        let (x, y) = (&regions[a as usize], &regions[b as usize]);
                        (x.end - x.start).cmp(&(y.end - y.start)).then(y.start.cmp(&x.start))
                    });
                    (line, holding.into_boxed_slice())
                })
                .collect()
        })
        .collect();

    let mut handed: HashMap<String, Vec<(u32, u32)>> = HashMap::new();
    for (file, range) in regions_of.iter().enumerate() {
        let Some(parsed) = graph.parsed[file].as_ref().filter(|_| !range.is_empty()) else { continue };
        for (at, func) in parsed.fns.iter().enumerate() {
            if let Some(hint) = func.hint.as_deref().filter(|hint| is_argument(hint)) {
                handed.entry(hint.to_owned()).or_default().push((file as u32, at as u32));
            }
        }
    }
    // The recording's module order, which is the order the walk tries them in.
    let order: HashMap<u32, usize> = journey
        .module_files
        .iter()
        .enumerate()
        .filter_map(|(at, &id)| Some((*graph.ids.get(journey.text(id).ok()?)?, at)))
        .collect();
    for list in handed.values_mut() {
        list.sort_by_key(|&(file, at)| (order.get(&file).copied().unwrap_or(usize::MAX), at));
    }
    Ok(Record { regions, regions_of, entered, tests, region_for, fn_for, around, handed })
}
