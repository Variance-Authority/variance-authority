//! Which declaration of a name one line ran: the one whose cases are the
//! line's cases. A line's cases are those that entered the innermost regions
//! holding it, as `passedAt` reads "ran"; a declaration's are those that
//! entered the function written at its line. Each is scored by Ochiai, the
//! cases they share over the geometric mean of both counts, so a function every
//! case enters does not outrank one only the line's cases enter.
//!
//! The source index names the declarations; the recording only orders them.

// compass: variance-authority.reach.relations

use std::collections::HashSet;

use napi_derive::napi;

use crate::journey_forks::JourneyEnd;
use crate::journey_masks::JourneyMasks;

#[napi(object)]
pub struct Resonant {
    pub file: String,
    pub line: u32,
    /// The position of the declaration it scores among those asked.
    pub candidate: u32,
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

/// How each of `candidates`, the declarations of one name, resonates with `file:line`.
#[napi(catch_unwind)]
pub fn resonance(recording: String, file: String, line: u32, candidates: Vec<JourneyEnd>) -> Resonance {
    match JourneyMasks::open(&recording).and_then(|mut masks| resonate(&mut masks, &file, line, &candidates)) {
        Ok(answer) => answer,
        Err(error) => refused(format!("the recording did not read ({error})")),
    }
}

pub(crate) fn resonate(masks: &mut JourneyMasks, file: &str, line: u32, candidates: &[JourneyEnd]) -> Result<Resonance, String> {
    let Some(module) = masks.journey.module_of(file)? else {
        return Ok(refused(format!("no recorded test loaded {file}")));
    };
    let innermost = masks.innermost_at(module, line);
    if innermost.is_empty() {
        return Ok(refused(format!("no recorded function holds {file}:{line}")));
    }
    let mut ran: HashSet<u32> = HashSet::new();
    for at in innermost {
        ran.extend(masks.entered(at)?.iter().copied());
    }
    let mut resonant = Vec::with_capacity(candidates.len());
    for (at, candidate) in candidates.iter().enumerate() {
        let mut scored = Resonant { file: candidate.file.clone(), line: candidate.line, candidate: at as u32, recorded: false, cases: 0, shared: 0, score: 0.0 };
        if let Some(function) = written_at(masks, &candidate.file, candidate.line)? {
            score(masks, function, &ran, &mut scored)?;
        }
        resonant.push(scored);
    }
    resonant.sort_by(|a, b| b.score.total_cmp(&a.score));
    Ok(Resonance { not_recorded: None, cases: ran.len() as u32, resonant })
}

/// The outermost recorded function of `file` written from `line` that is not
/// handed to a call. The instrumenter names such a callback for the call,
/// `map.arg0`, so one written on a constant's line leaves the constant
/// unscored. Matched by line, not by the asked name: the index answers a name
/// with declarations spelled otherwise — the original of a renamed import, a
/// member asked for by its container — and one file can write two functions of
/// one name.
fn written_at(masks: &JourneyMasks, file: &str, line: u32) -> Result<Option<u32>, String> {
    let Some(module) = masks.journey.module_of(file)? else { return Ok(None) };
    let mut found = None;
    for at in masks.functions_in(module) {
        let bit = masks.bits[at as usize];
        if bit.start != line || handed_to_a_call(masks.journey.text(bit.name)?) {
            continue;
        }
        if found.is_none_or(|held: u32| bit.end > masks.bits[held as usize].end) {
            found = Some(at);
        }
    }
    Ok(found)
}

/// Whether a region's own name, the last step of its path, is the `{callee}.arg{index}` a callback is named for.
fn handed_to_a_call(path: &str) -> bool {
    let own = path.rsplit('/').next().unwrap_or(path);
    own.rsplit_once(".arg").is_some_and(|(_, index)| !index.is_empty() && index.bytes().all(|b| b.is_ascii_digit()))
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
