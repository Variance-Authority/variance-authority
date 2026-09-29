//! The map of the code around one file, drawn from the journeys of the tests
//! that entered it. The terms of a task keep some of those tests; the map is
//! what the kept journeys ran and the rest of the suite mostly did not.
//!
//! Inside the file, each function is its paths among the kept cases, so a hub
//! reads as its passage and a handful of purposes. Outside it, a function most
//! of the whole suite enters is structure and is counted, not drawn. What most
//! kept cases enter is the spine, nearest first: a place is as near as the
//! smallest kept journey that reached it, because a small journey did little
//! besides. What fewer kept cases enter is a branch, and the functions entered
//! by exactly the same cases are one branch, told by the smallest of them.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use napi_derive::napi;

use crate::journey_masks::{JourneyMasks, Shape};
use crate::journey_paths::{case_of, function_of, paths_of, JourneyCase, JourneyFunction, JourneyPath};
use crate::order;

/// A function of the file, read through the kept cases.
#[napi(object)]
pub struct JourneyMapFunction {
    pub function: JourneyFunction,
    /// Kept cases that entered it.
    pub cases: u32,
    /// Most cases first.
    pub paths: Vec<JourneyPath>,
}

/// A function beyond the file that most kept cases entered.
#[napi(object)]
pub struct JourneyMapPlace {
    pub function: JourneyFunction,
    pub cases: u32,
    /// The smallest kept journey that reached it.
    pub nearest: JourneyCase,
}

/// The functions beyond the file that exactly the same few kept cases entered.
#[napi(object)]
pub struct JourneyMapBranch {
    pub cases: u32,
    /// In file and line order.
    pub places: Vec<JourneyFunction>,
    pub smallest: JourneyCase,
}

#[napi(object)]
pub struct JourneyMap {
    /// Why the recording cannot answer; every other field is empty then.
    pub not_recorded: Option<String>,
    pub file: String,
    /// Cases in the recording: the denominator of structure.
    pub suite: u32,
    /// Cases that entered the file.
    pub entered: u32,
    /// Those the terms kept; every one of them when no term was given.
    pub kept: u32,
    /// The kept cases, smallest journey first.
    pub tests: Vec<JourneyCase>,
    /// The file's functions some kept case entered, in source order.
    pub functions: Vec<JourneyMapFunction>,
    /// Beyond the file, entered by most kept cases, nearest first.
    pub spine: Vec<JourneyMapPlace>,
    /// Beyond the file, entered by fewer, most cases first.
    pub branches: Vec<JourneyMapBranch>,
    /// Functions beyond the file the kept cases entered and at least half the suite did too.
    pub structure: u32,
}

fn refused(file: String, reason: String) -> JourneyMap {
    JourneyMap {
        not_recorded: Some(reason),
        file,
        suite: 0,
        entered: 0,
        kept: 0,
        tests: Vec::new(),
        functions: Vec::new(),
        spine: Vec::new(),
        branches: Vec::new(),
        structure: 0,
    }
}

/// The map around `file`, kept to the cases whose test file or name holds any
/// of `terms`, ignoring case, or to every case that entered it when none is given.
#[napi(catch_unwind)]
pub fn journey_map(recording: String, file: String, terms: Option<Vec<String>>) -> JourneyMap {
    let terms = terms.unwrap_or_default();
    match JourneyMasks::open(&recording).and_then(|mut masks| map(&mut masks, &file, &terms)) {
        Ok(Some(answer)) => answer,
        Ok(None) => refused(file.clone(), format!("the recording holds no {file}")),
        Err(error) => refused(file, format!("the recording did not read ({error})")),
    }
}

pub(crate) fn map(masks: &mut JourneyMasks, file: &str, terms: &[String]) -> Result<Option<JourneyMap>, String> {
    let Some(module) = masks.journey.module_of(file)? else { return Ok(None) };
    let tests = masks.journey.tests();
    let own = masks.functions_in(module);
    let mut entered = vec![false; tests];
    for &function in &own {
        for &case in masks.entered(function)?.iter() {
            if let Some(slot) = entered.get_mut(case as usize) {
                *slot = true;
            }
        }
    }
    let terms: Vec<String> = terms.iter().map(|term| term.trim().to_lowercase()).filter(|term| !term.is_empty()).collect();
    let mut kept = vec![false; tests];
    for case in (0..tests).filter(|&case| entered[case]) {
        let named = format!("{} {}", masks.journey.test_file(case)?, masks.journey.test_name(case)?).to_lowercase();
        kept[case] = terms.is_empty() || terms.iter().any(|term| named.contains(term.as_str()));
    }
    let total = kept.iter().filter(|&&k| k).count();
    let sizes = masks.sizes()?;
    let mut answer = JourneyMap {
        not_recorded: None,
        file: file.to_owned(),
        suite: tests as u32,
        entered: entered.iter().filter(|&&e| e).count() as u32,
        kept: total as u32,
        tests: tests_of(masks, &kept, &sizes)?,
        functions: Vec::new(),
        spine: Vec::new(),
        branches: Vec::new(),
        structure: 0,
    };
    for &function in &own {
        let (cases, paths) = paths_of(masks, function, Some(&kept))?;
        if cases > 0 {
            answer.functions.push(JourneyMapFunction { function: function_of(masks, function)?, cases, paths });
        }
    }
    let mut spine = Vec::new();
    let mut branches: HashMap<Vec<u32>, Vec<u32>> = HashMap::new();
    for bit in 0..masks.bits.len() as u32 {
        let held = masks.bits[bit as usize];
        if held.shape != Shape::Function || held.module as usize == module {
            continue;
        }
        let all = masks.entered(bit)?;
        let reached: Vec<u32> = all.iter().copied().filter(|&case| kept.get(case as usize).copied().unwrap_or(false)).collect();
        if reached.is_empty() {
            continue;
        }
        if all.len() * 2 >= tests {
            answer.structure += 1;
        } else if reached.len() * 2 > total {
            let nearest = *reached.iter().min_by_key(|&&case| (sizes[case as usize], case)).unwrap_or(&reached[0]);
            spine.push((sizes[nearest as usize], bit, reached.len() as u32, nearest));
        } else {
            branches.entry(reached).or_default().push(bit);
        }
    }
    spine.sort_by(|x, y| x.0.cmp(&y.0).then(order::code_unit(masks.file(x.1).unwrap_or(""), masks.file(y.1).unwrap_or(""))).then(x.1.cmp(&y.1)));
    for (size, bit, cases, nearest) in spine {
        answer.spine.push(JourneyMapPlace { function: function_of(masks, bit)?, cases, nearest: case_of(masks, nearest, size, None)? });
    }
    let mut grouped: Vec<(Vec<u32>, Vec<u32>, u32)> = branches
        .into_iter()
        .map(|(cases, places)| {
            let smallest = *cases.iter().min_by_key(|&&case| (sizes[case as usize], case)).unwrap_or(&cases[0]);
            (cases, places, smallest)
        })
        .collect();
    grouped.sort_by(|x, y| y.0.len().cmp(&x.0.len()).then((sizes[x.2 as usize], x.2).cmp(&(sizes[y.2 as usize], y.2))).then(x.1.cmp(&y.1)));
    for (cases, mut places, smallest) in grouped {
        places.sort_by(|x, y| order::code_unit(masks.file(*x).unwrap_or(""), masks.file(*y).unwrap_or("")).then(x.cmp(y)));
        answer.branches.push(JourneyMapBranch {
            cases: cases.len() as u32,
            places: places.iter().map(|&bit| function_of(masks, bit)).collect::<Result<_, _>>()?,
            smallest: case_of(masks, smallest, sizes[smallest as usize], None)?,
        });
    }
    Ok(Some(answer))
}

/// The kept cases, smallest journey first, each with the kept cases whose journey is the same.
fn tests_of(masks: &mut JourneyMasks, kept: &[bool], sizes: &[u32]) -> Result<Vec<JourneyCase>, String> {
    let journeys = masks.masks(kept)?;
    let mut alike: HashMap<&Vec<u32>, u32> = HashMap::new();
    for mask in journeys.values() {
        *alike.entry(mask).or_default() += 1;
    }
    let mut cases: Vec<u32> = (0..kept.len() as u32).filter(|&case| kept[case as usize]).collect();
    cases.sort_by_key(|&case| (sizes[case as usize], case));
    cases
        .into_iter()
        .map(|case| {
            let same = journeys.get(&case).and_then(|mask| alike.get(mask)).map_or(0, |n| n - 1);
            case_of(masks, case, sizes[case as usize], Some(same))
        })
        .collect()
}
