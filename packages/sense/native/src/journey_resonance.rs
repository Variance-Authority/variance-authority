//! Which declaration of a name one line ran: the one whose cases are the
//! line's cases. A line's cases are those that entered the smallest regions
//! holding it; a declaration's are those that entered the function written at
//! its line. Each is scored by Ochiai, the cases they share over the geometric
//! mean of both counts, so a function every case enters does not outrank one
//! only the line's cases enter.
//!
//! A function the recording names like the declarations and none of them
//! stands for is scored beside them when it shares a case with the line: a
//! mock's factory is one, named by the property that holds it.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use napi_derive::napi;

use crate::journey_forks::JourneyEnd;
use crate::journey_masks::{JourneyMasks, Shape};

#[napi(object)]
pub struct Resonant {
    pub file: String,
    pub line: u32,
    /// The position of the declaration it scores among those asked; absent
    /// for a function found by its recorded name alone.
    pub candidate: Option<u32>,
    /// Whether the recording holds a function written at its line; every
    /// count is zero when it does not.
    pub recorded: bool,
    /// Cases that entered it.
    pub cases: u32,
    /// Of those, cases that ran the line.
    pub shared: u32,
    /// `shared / sqrt(line's cases * cases)`, zero when either is empty.
    pub score: f64,
}

#[napi(object)]
pub struct Resonance {
    /// Why the recording cannot answer; every other field is empty then.
    pub not_recorded: Option<String>,
    /// Cases that ran the line.
    pub cases: u32,
    /// Highest score first, then in the order asked.
    pub resonant: Vec<Resonant>,
}

fn refused(reason: String) -> Resonance {
    Resonance { not_recorded: Some(reason), cases: 0, resonant: Vec::new() }
}

/// How each of `candidates`, the declarations of `name`, resonates with `file:line`.
#[napi(catch_unwind)]
pub fn resonance(recording: String, file: String, line: u32, name: String, candidates: Vec<JourneyEnd>) -> Resonance {
    match JourneyMasks::open(&recording).and_then(|mut masks| resonate(&mut masks, &file, line, &name, &candidates)) {
        Ok(answer) => answer,
        Err(error) => refused(format!("the recording did not read ({error})")),
    }
}

pub(crate) fn resonate(masks: &mut JourneyMasks, file: &str, line: u32, name: &str, candidates: &[JourneyEnd]) -> Result<Resonance, String> {
    let Some(module) = masks.journey.module_of(file)? else {
        return Ok(refused(format!("the recording holds no module {file}")));
    };
    let span = |masks: &JourneyMasks, at: u32| masks.bits[at as usize].end - masks.bits[at as usize].start;
    let holding: Vec<u32> = masks
        .rows_of(module)
        .filter(|&at| {
            let bit = &masks.bits[at as usize];
            bit.shape != Shape::Module && bit.source && bit.start <= line && line <= bit.end
        })
        .collect();
    let Some(smallest) = holding.iter().map(|&at| span(masks, at)).min() else {
        return Ok(refused(format!("no recorded function holds {file}:{line}")));
    };
    // Regions of one span holding a line sit side by side on it, so the line
    // ran when any of them was entered.
    let mut ran: HashSet<u32> = HashSet::new();
    for at in holding.into_iter().filter(|&at| span(masks, at) == smallest).collect::<Vec<_>>() {
        ran.extend(masks.entered(at)?.iter().copied());
    }
    let mut seen: HashSet<u32> = HashSet::new();
    let mut resonant = Vec::with_capacity(candidates.len());
    for (at, candidate) in candidates.iter().enumerate() {
        let function = written_at(masks, &candidate.file, candidate.line)?;
        let mut scored = Resonant { file: candidate.file.clone(), line: candidate.line, candidate: Some(at as u32), recorded: false, cases: 0, shared: 0, score: 0.0 };
        if let Some(function) = function {
            seen.insert(function);
            score(masks, function, &ran, &mut scored)?;
        }
        resonant.push(scored);
    }
    for at in 0..masks.bits.len() as u32 {
        let bit = masks.bits[at as usize];
        if bit.shape != Shape::Function || seen.contains(&at) || masks.journey.text(bit.name)? != name {
            continue;
        }
        let mut scored = Resonant { file: masks.file(at)?.to_owned(), line: bit.start, candidate: None, recorded: false, cases: 0, shared: 0, score: 0.0 };
        score(masks, at, &ran, &mut scored)?;
        if scored.shared > 0 {
            resonant.push(scored);
        }
    }
    resonant.sort_by(|a, b| b.score.total_cmp(&a.score));
    Ok(Resonance { not_recorded: None, cases: ran.len() as u32, resonant })
}

/// The outermost recorded function of `file` written from `line`.
fn written_at(masks: &JourneyMasks, file: &str, line: u32) -> Result<Option<u32>, String> {
    let Some(module) = masks.journey.module_of(file)? else { return Ok(None) };
    Ok(masks
        .functions_in(module)
        .into_iter()
        .filter(|&at| masks.bits[at as usize].start == line)
        .max_by_key(|&at| (masks.bits[at as usize].end, std::cmp::Reverse(at))))
}

fn score(masks: &mut JourneyMasks, function: u32, ran: &HashSet<u32>, scored: &mut Resonant) -> Result<(), String> {
    let entered = masks.entered(function)?;
    let shared = entered.iter().filter(|case| ran.contains(case)).count();
    scored.recorded = true;
    scored.cases = entered.len() as u32;
    scored.shared = shared as u32;
    scored.score = if shared == 0 { 0.0 } else { shared as f64 / ((ran.len() * entered.len()) as f64).sqrt() };
    Ok(())
}

#[cfg(test)]
#[path = "journey_resonance_tests.rs"]
mod tests;
