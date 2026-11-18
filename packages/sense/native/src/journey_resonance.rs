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

/// How each of `candidates`, the declarations of `name`, resonates with `file:line`.
#[napi(catch_unwind)]
pub fn resonance(recording: String, name: String, file: String, line: u32, candidates: Vec<JourneyEnd>) -> Resonance {
    match JourneyMasks::open(&recording).and_then(|mut masks| resonate(&mut masks, &name, &file, line, &candidates)) {
        Ok(answer) => answer,
        Err(error) => refused(format!("the recording did not read ({error})")),
    }
}

pub(crate) fn resonate(masks: &mut JourneyMasks, name: &str, file: &str, line: u32, candidates: &[JourneyEnd]) -> Result<Resonance, String> {
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
        if let Some(function) = written_at(masks, name, &candidate.file, candidate.line)? {
            score(masks, function, &ran, &mut scored)?;
        }
        resonant.push(scored);
    }
    resonant.sort_by(|a, b| b.score.total_cmp(&a.score));
    Ok(Resonance { not_recorded: None, cases: ran.len() as u32, resonant })
}

/// The recorded function of `file` that the declaration at `line` writes: of
/// those starting at `line` that are not handed to a call, the outermost bearing
/// `name`, or the outermost when none does; or else the first after the line,
/// when it bears `name`.
///
/// The instrumenter names a callback for the call, `map.arg0`, so one written
/// on a constant's line leaves the constant unscored. The line is matched first,
/// not the name: the index answers a name with declarations spelled otherwise —
/// the original of a renamed import, a member asked for by its container — and
/// one file can write two functions of one name. Among functions sharing the
/// line, the name tells the declaration from its neighbour. A function's region opens at
/// its parameters, below the declaration's line when `const name =` or a long
/// type parameter list ends a line; the instrumenter names that function for
/// the constant, so the first function opening below the line is taken when it
/// bears the name. A namesake further down, nested in another function, belongs
/// to that function and not to the declaration above it.
fn written_at(masks: &JourneyMasks, name: &str, file: &str, line: u32) -> Result<Option<u32>, String> {
    let Some(module) = masks.journey.module_of(file)? else { return Ok(None) };
    let (mut at_line, mut below): (Option<(u32, bool)>, Option<u32>) = (None, None);
    for at in masks.functions_in(module) {
        let bit = masks.bits[at as usize];
        if bit.start < line {
            continue;
        }
        let own = own_name(masks.journey.text(bit.name)?);
        let outer = |held: (u32, bool)| (own == name, bit.end) > (held.1, masks.bits[held.0 as usize].end);
        if bit.start == line && !handed_to_a_call(own) && at_line.is_none_or(outer) {
            at_line = Some((at, own == name));
        }
        let first = |held: u32| (bit.start, std::cmp::Reverse(bit.end)) < (masks.bits[held as usize].start, std::cmp::Reverse(masks.bits[held as usize].end));
        if bit.start > line && below.is_none_or(first) {
            below = Some(at);
        }
    }
    let at_line = at_line.map(|(at, _)| at);
    let Some(below) = below.filter(|_| at_line.is_none()) else { return Ok(at_line) };
    Ok((own_name(masks.journey.text(masks.bits[below as usize].name)?) == name).then_some(below))
}

/// A region's own name: the last step of its path.
fn own_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Whether `own` is the `{callee}.arg{index}` a callback is named for.
fn handed_to_a_call(own: &str) -> bool {
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
