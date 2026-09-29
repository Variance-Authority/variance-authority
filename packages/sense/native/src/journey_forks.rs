//! How one function is connected to another, read off the cases alone.
//!
//! The cases are clustered by identical mask and matched against both ends.
//! The smallest journey that holds both is the connection. A journey that
//! reached one end only and shares at least half of some connecting journey
//! nearly connected. A fork is a region whose function most of both groups ran:
//! the ones that separate the groups by at least half are the condition — the
//! connecting journeys take it (*when*) or the near misses do (*unless*) — and
//! whatever else differs is downstream of them. Too few connecting journeys
//! cannot separate anything, and the answer says so rather than ranking noise.

// compass: variance-authority.reach.relations

use std::collections::HashMap;

use napi_derive::napi;

use crate::journey_masks::{overlap, JourneyMasks, Shape};
use crate::journey_paths::{block, case_of, function_of, JourneyBlock, JourneyCase, JourneyFunction};
use crate::order;

/// Fewer connecting cases, or near misses on a side, than this are too thin to separate.
const THIN: usize = 3;
/// A near miss shares at least this much of a connecting journey.
const NEAR: f64 = 0.5;
/// A fork's function is run by at least this share of each group.
const RUN: f64 = 0.5;
/// A fork separates the groups by at least this much.
const SEPARATES: f64 = 0.5;

/// One end, by a line its innermost function spans.
#[napi(object)]
pub struct JourneyEnd {
    pub file: String,
    pub line: u32,
}

#[napi(object)]
pub struct JourneyFork {
    pub block: JourneyBlock,
    /// The connecting cases' share that entered it less the near misses'
    /// share: positive when it is the way through, negative when it turns away.
    pub separation: f64,
}

/// The journeys that reached one end and not the other.
#[napi(object)]
pub struct JourneySide {
    /// `a` or `b`.
    pub end: String,
    /// Cases that reached this end and not the other.
    pub only: u32,
    /// Those of them that nearly connected.
    pub near: u32,
    /// The most any of them shares with a connecting journey, when none nearly connected.
    pub best: Option<f64>,
    /// Strongest first; absent when nothing nearly connected, or when the
    /// connecting cases or this side's near misses are too few to separate.
    pub forks: Option<Vec<JourneyFork>>,
    /// The smallest near miss, one the strongest turning fork turned away when there is one.
    pub nearly: Option<JourneyCase>,
}

#[napi(object)]
pub struct ForksBetween {
    /// Why the recording cannot answer; every other field is empty then.
    pub not_recorded: Option<String>,
    pub a: Option<JourneyFunction>,
    pub b: Option<JourneyFunction>,
    pub reached_a: u32,
    pub reached_b: u32,
    /// Cases whose journey reached both.
    pub both: u32,
    /// Distinct journeys among the cases that reached either.
    pub journeys: u32,
    /// The smallest journey that reached both; absent when none did.
    pub connection: Option<JourneyCase>,
    /// Whether too few cases connect to separate them from the near misses.
    pub thin: bool,
    /// One per end whose cases did not all reach the other; absent when none connected.
    pub sides: Option<Vec<JourneySide>>,
}

fn refused(reason: String) -> ForksBetween {
    ForksBetween {
        not_recorded: Some(reason),
        a: None,
        b: None,
        reached_a: 0,
        reached_b: 0,
        both: 0,
        journeys: 0,
        connection: None,
        thin: false,
        sides: None,
    }
}

/// How the function at `a` is connected to the one at `b`.
#[napi(catch_unwind)]
pub fn forks_between(recording: String, a: JourneyEnd, b: JourneyEnd) -> ForksBetween {
    match JourneyMasks::open(&recording).and_then(|mut masks| between(&mut masks, &a, &b)) {
        Ok(answer) => answer,
        Err(error) => refused(format!("the recording did not read ({error})")),
    }
}

struct Cluster {
    mask: Vec<u32>,
    cases: Vec<u32>,
    a: bool,
    b: bool,
}

pub(crate) fn between(masks: &mut JourneyMasks, a: &JourneyEnd, b: &JourneyEnd) -> Result<ForksBetween, String> {
    let mut ends = Vec::with_capacity(2);
    for end in [a, b] {
        match masks.function_at(&end.file, end.line)? {
            Some(function) => ends.push(function),
            None => return Ok(refused(format!("no function the recording holds spans {}:{}", end.file, end.line))),
        }
    }
    let tests = masks.journey.tests();
    let mut reached = [vec![false; tests], vec![false; tests]];
    for (side, &function) in ends.iter().enumerate() {
        for bit in masks.within(function) {
            for &case in masks.entered(bit)?.iter() {
                if let Some(slot) = reached[side].get_mut(case as usize) {
                    *slot = true;
                }
            }
        }
    }
    let either: Vec<bool> = (0..tests).map(|case| reached[0][case] || reached[1][case]).collect();
    let mut by_mask: HashMap<Vec<u32>, Cluster> = HashMap::new();
    let mut held: Vec<(u32, Vec<u32>)> = masks.masks(&either)?.into_iter().collect();
    held.sort_unstable_by_key(|(case, _)| *case);
    for (case, mask) in held {
        let cluster = by_mask.entry(mask.clone()).or_insert_with(|| Cluster {
            mask,
            cases: Vec::new(),
            a: reached[0][case as usize],
            b: reached[1][case as usize],
        });
        cluster.cases.push(case);
    }
    let mut clusters: Vec<Cluster> = by_mask.into_values().collect();
    clusters.sort_by(|x, y| x.mask.len().cmp(&y.mask.len()).then(x.cases[0].cmp(&y.cases[0])));
    let count = |test: &dyn Fn(&Cluster) -> bool| clusters.iter().filter(|c| test(c)).map(|c| c.cases.len()).sum::<usize>() as u32;
    let mut answer = ForksBetween {
        not_recorded: None,
        a: Some(function_of(masks, ends[0])?),
        b: Some(function_of(masks, ends[1])?),
        reached_a: count(&|c| c.a),
        reached_b: count(&|c| c.b),
        both: count(&|c| c.a && c.b),
        journeys: clusters.len() as u32,
        connection: None,
        thin: false,
        sides: None,
    };
    let both: Vec<&Cluster> = clusters.iter().filter(|c| c.a && c.b).collect();
    let Some(core) = both.first() else { return Ok(answer) };
    answer.connection = Some(case_of(masks, core.cases[0], core.mask.len() as u32, Some(core.cases.len() as u32 - 1))?);
    answer.thin = (answer.both as usize) < THIN;
    let mut sides = Vec::new();
    for (end, at_a) in [("a", true), ("b", false)] {
        let alone: Vec<(&Cluster, f64)> = clusters
            .iter()
            .filter(|c| c.a != c.b && c.a == at_a)
            .map(|c| (c, both.iter().map(|k| overlap(&c.mask, &k.mask)).fold(0.0, f64::max)))
            .collect();
        if alone.is_empty() {
            continue;
        }
        sides.push(side(masks, end, &both, &alone, answer.thin)?);
    }
    answer.sides = Some(sides);
    Ok(answer)
}

fn side(masks: &JourneyMasks, end: &str, both: &[&Cluster], alone: &[(&Cluster, f64)], thin: bool) -> Result<JourneySide, String> {
    let near: Vec<&Cluster> = alone.iter().filter(|(_, o)| *o >= NEAR).map(|(c, _)| *c).collect();
    let mut answer = JourneySide {
        end: end.to_owned(),
        only: alone.iter().map(|(c, _)| c.cases.len() as u32).sum(),
        near: near.iter().map(|c| c.cases.len() as u32).sum(),
        best: None,
        forks: None,
        nearly: None,
    };
    if near.is_empty() {
        answer.best = Some(alone.iter().map(|(_, o)| *o).fold(0.0, f64::max));
        return Ok(answer);
    }
    let thin = thin || (answer.near as usize) < THIN;
    let forks = if thin { Vec::new() } else { forks(masks, both, &near)? };
    let turn = forks.iter().find(|(_, separation)| *separation < 0.0).or(forks.first());
    let story = near
        .iter()
        .filter(|c| turn.is_none_or(|(bit, separation)| c.mask.binary_search(bit).is_ok() == (*separation < 0.0)))
        .min_by_key(|c| (c.mask.len(), c.cases[0]));
    if let Some(c) = story {
        answer.nearly = Some(case_of(masks, c.cases[0], c.mask.len() as u32, Some(c.cases.len() as u32 - 1))?);
    }
    if !thin {
        answer.forks = Some(
            forks
                .into_iter()
                .map(|(bit, separation)| Ok(JourneyFork { block: block(masks, bit)?, separation }))
                .collect::<Result<_, String>>()?,
        );
    }
    Ok(answer)
}

/// The regions that separate the connecting journeys from the near misses, strongest first.
fn forks(masks: &JourneyMasks, both: &[&Cluster], near: &[&Cluster]) -> Result<Vec<(u32, f64)>, String> {
    let share = |group: &[&Cluster]| {
        let total: usize = group.iter().map(|c| c.cases.len()).sum();
        let mut counted: HashMap<u32, usize> = HashMap::new();
        for c in group {
            for &bit in &c.mask {
                *counted.entry(bit).or_default() += c.cases.len();
            }
        }
        move |bit: u32| counted.get(&bit).copied().unwrap_or(0) as f64 / total as f64
    };
    let (in_both, in_near) = (share(both), share(near));
    let mut candidates: Vec<u32> = both.iter().chain(near).flat_map(|c| c.mask.iter().copied()).collect();
    candidates.sort_unstable();
    candidates.dedup();
    let mut found = Vec::new();
    for bit in candidates {
        let held = masks.bits[bit as usize];
        let Some(function) = held.function else { continue };
        if held.shape != Shape::Inner || in_both(function) < RUN || in_near(function) < RUN {
            continue;
        }
        let separation = in_both(bit) - in_near(bit);
        if separation.abs() >= SEPARATES {
            found.push((bit, separation, masks.file(bit)?, held.start));
        }
    }
    found.sort_by(|x, y| y.1.abs().total_cmp(&x.1.abs()).then(order::code_unit(x.2, y.2)).then(x.3.cmp(&y.3)).then(x.0.cmp(&y.0)));
    Ok(found.into_iter().map(|(bit, separation, _, _)| (bit, separation)).collect())
}
