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

/// A declaration the source index names: where it is written, and every name
/// its file spells it, which a renamed import or a re-export may not share with
/// the name asked.
#[napi(object)]
pub struct Declaration {
    pub file: String,
    pub line: u32,
    /// The last line of its head, as the source index cuts it; none when the index kept no head.
    pub through: Option<u32>,
    pub spelled: Vec<String>,
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
pub fn resonance(recording: String, file: String, line: u32, candidates: Vec<Declaration>) -> Resonance {
    match JourneyMasks::open(&recording).and_then(|mut masks| resonate(&mut masks, &file, line, &candidates)) {
        Ok(answer) => answer,
        Err(error) => refused(format!("the recording did not read ({error})")),
    }
}

pub(crate) fn resonate(masks: &mut JourneyMasks, file: &str, line: u32, candidates: &[Declaration]) -> Result<Resonance, String> {
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
        if let Some(function) = written_at(masks, &candidate.spelled, &candidate.file, candidate.line, candidate.through)? {
            score(masks, function, &ran, &mut scored)?;
        }
        resonant.push(scored);
    }
    resonant.sort_by(|a, b| b.score.total_cmp(&a.score));
    Ok(Resonance { not_recorded: None, cases: ran.len() as u32, resonant })
}

/// The recorded function of `file` that the declaration at `line` writes: of
/// those starting at `line` that it names, the outermost; or else the first
/// after the line, when the declaration names it and its head reaches it.
///
/// A declaration names a function by the path the instrumenter gives it, a
/// method by its class (`Store/useSessionId`), and from inside a recorded
/// function by that path under the function's (`wrapper/useSessionId`). So a
/// constant leaves unscored the callback written on its line, named for the
/// call (`map.arg0`) or by itself (`function onValue`), any function written
/// beside it, and a method of its name on its line or below it. A function's
/// region opens at its parameters, below the declaration's line when `const
/// name =` or a long type parameter list ends a line, so the first function
/// opening below is taken when the declaration names it and opens within its
/// head, `through`: a block below a constant may declare a function of its
/// name. A declaration whose head the index did not keep takes none.
fn written_at(masks: &JourneyMasks, spelled: &[String], file: &str, line: u32, through: Option<u32>) -> Result<Option<u32>, String> {
    let Some(module) = masks.journey.module_of(file)? else { return Ok(None) };
    let mut enclosing: Vec<&str> = Vec::new();
    for at in masks.functions_in(module) {
        let bit = masks.bits[at as usize];
        if bit.start <= line && line <= bit.end {
            enclosing.push(masks.journey.text(bit.name)?);
        }
    }
    let named = |path: &str| {
        spelled.iter().any(|name| {
            path == name || path.strip_suffix(name.as_str()).and_then(|scope| scope.strip_suffix('/')).is_some_and(|scope| enclosing.contains(&scope))
        })
    };
    let (mut at_line, mut below): (Option<u32>, Option<u32>) = (None, None);
    for at in masks.functions_in(module) {
        let bit = masks.bits[at as usize];
        if bit.start < line {
            continue;
        }
        if bit.start == line && named(masks.journey.text(bit.name)?) && at_line.is_none_or(|held| bit.end > masks.bits[held as usize].end) {
            at_line = Some(at);
        }
        let first = |held: u32| (bit.start, std::cmp::Reverse(bit.end)) < (masks.bits[held as usize].start, std::cmp::Reverse(masks.bits[held as usize].end));
        if bit.start > line && below.is_none_or(first) {
            below = Some(at);
        }
    }
    let Some(below) = below.filter(|&at| at_line.is_none() && through.is_some_and(|through| masks.bits[at as usize].start <= through)) else { return Ok(at_line) };
    Ok(named(masks.journey.text(masks.bits[below as usize].name)?).then_some(below))
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
