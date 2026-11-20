//! What a README says about a name nothing was written above, read where the
//! publish joins the documented surface.
//!
//! The one rule: the publish off the index, the walk with no index
//! (`joinWalkedHelp`) and a silent dependency's README (`readmeMention`) all
//! read a mention here, so no name crosses into JavaScript to be looked up.
//! Every offset is counted as JavaScript counts it, in UTF-16 code units, so a
//! passage's line is the one an editor opened at it shows.
//!
//! A README is read once however many names under it are asked about, and the
//! READMEs a publish needs are probed and read on every core at once.

// compass: variance-authority.report.agent-surface

use std::collections::{HashMap, HashSet};
use std::path::Path;

use napi_derive::napi;
use rayon::prelude::*;

/// How much of a passage is worth carrying before it stops being a passage.
const LONGEST: usize = 1200;
const NEWLINE: u16 = b'\n' as u16;
const TICK: u16 = b'`' as u16;
const FENCE: [u16; 3] = [TICK; 3];
const BLANK: [u16; 2] = [NEWLINE; 2];
const CUT_ABOVE: &str = "…\n";
const CUT_BELOW: &str = "\n…";

/// A passage of a README that names a symbol: the README relative to the
/// workspace root, the 1-based line the passage begins on, and the passage.
#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mention {
    pub at: String,
    pub line: u32,
    pub text: String,
}

/// One README, as JavaScript reads it: the text in UTF-16 code units, and the
/// path it is named by.
pub(crate) struct Readme {
    from: String,
    text: Vec<u16>,
}

/// The READMEs above `files`, every directory from each file's own up to the
/// root inclusive, each probed once: by the README path it is named by, `None`
/// where there is none. Only the nearest README above some file is read, once,
/// as the walk reads only the nearest; one of those that is there and does not
/// read refuses the publish, naming it, as it refuses the walk.
pub(crate) fn readmes<'a>(root: &Path, files: impl Iterator<Item = &'a str>) -> Result<HashMap<String, Option<Readme>>, String> {
    let files: Vec<&str> = files.collect();
    let mut asked: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for file in &files {
        for from in candidates(file) {
            if !seen.insert(from.clone()) {
                // A directory already asked about had its parents asked about with it.
                break;
            }
            asked.push(from);
        }
    }
    // `existsSync`: anything there, a directory included, is the README the walk then reads.
    let there: HashSet<String> = asked.into_par_iter().filter(|from| readme_path(root, from).exists()).collect();
    let mut nearest_ones: HashSet<String> = HashSet::new();
    for file in &files {
        if let Some(from) = candidates(file).find(|from| there.contains(from)) {
            nearest_ones.insert(from);
        }
    }
    let read: HashMap<String, Option<Readme>> = nearest_ones
        .into_par_iter()
        .map(|from| match std::fs::read(readme_path(root, &from)) {
            Ok(bytes) => {
                let readme = Readme { from: from.clone(), text: String::from_utf8_lossy(&bytes).encode_utf16().collect() };
                Ok((from, Some(readme)))
            }
            Err(refused) => Err(format!("{from} is there and could not be read: {refused}")),
        })
        .collect::<Result<_, String>>()?;
    let mut held = read;
    for from in seen {
        if !there.contains(&from) {
            held.insert(from, None);
        }
    }
    Ok(held)
}

/// Where the nearest README above `at`, under `root`, names `name`; `None`
/// when no README is above it or the nearest does not name it. Refused when
/// the nearest is there and does not read.
#[napi(catch_unwind)]
pub fn readme_mention(root: String, at: String, name: String) -> napi::Result<Option<Mention>> {
    let held = readmes(Path::new(&root), std::iter::once(at.as_str())).map_err(napi::Error::from_reason)?;
    Ok(nearest(&held, &at).and_then(|readme| mention(readme, &name)))
}

/// The README paths above `at`, nearest first: `nearest`'s walk.
fn candidates(at: &str) -> impl Iterator<Item = String> + '_ {
    let parts: Vec<&str> = at.split('/').collect();
    let dirs = parts.len() - 1;
    (0..=dirs).rev().map(move |depth| {
        let mut from = parts[..depth].join("/");
        if depth > 0 {
            from.push('/');
        }
        from.push_str("README.md");
        from
    })
}

/// Where the README named `from` is on disk: `path.join`'s, empty parts dropped.
fn readme_path(root: &Path, from: &str) -> std::path::PathBuf {
    from.split('/').filter(|part| !part.is_empty()).fold(root.to_path_buf(), |path, part| path.join(part))
}

/// The nearest README above `at` that exists, out of `held`.
pub(crate) fn nearest<'h>(held: &'h HashMap<String, Option<Readme>>, at: &str) -> Option<&'h Readme> {
    candidates(at).find_map(|from| held.get(&from).and_then(Option::as_ref))
}

/// Where `readme` names `name`: the paragraph of its best whole-word
/// occurrence, or the fence it falls in, windowed around it.
pub(crate) fn mention(readme: &Readme, name: &str) -> Option<Mention> {
    let name: Vec<u16> = name.encode_utf16().collect();
    let text = &readme.text;
    let spans = fences(text);
    let first = first_occurrence(text, &spans, &name)?;
    let (from, to) = passage(text, &spans, first);
    let (shown, at) = windowed(text, from, to, first);
    Some(Mention { at: readme.from.clone(), line: line_of(text, at), text: shown })
}

/// `indexOf`: the first offset at or after `from` that `needle` starts at.
fn index_of(text: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    let from = from.min(text.len());
    if needle.is_empty() {
        return Some(from);
    }
    text.get(from..)?.windows(needle.len()).position(|held| held == needle).map(|at| at + from)
}

/// `lastIndexOf`: the last offset at or before `from` that `needle` starts at.
fn last_index_of(text: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    let last = text.len().checked_sub(needle.len())?;
    (0..=from.min(last)).rev().find(|&at| text[at..at + needle.len()] == *needle)
}

/// Whether a code unit may be part of a name.
fn word(unit: Option<&u16>) -> bool {
    unit.is_some_and(|&unit| unit < 128 && (unit as u8 == b'_' || unit as u8 == b'$' || (unit as u8).is_ascii_alphanumeric()))
}

/// Every fenced block, as the offsets it opens and closes at; a last fence
/// that never closes runs to the end.
fn fences(text: &[u16]) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut at = index_of(text, &FENCE, 0);
    while let Some(open) = at {
        let Some(closed) = index_of(text, &FENCE, open + 3) else {
            spans.push((open, text.len()));
            break;
        };
        spans.push((open, closed + 3));
        at = index_of(text, &FENCE, closed + 3);
    }
    spans
}

fn fencing(spans: &[(usize, usize)], at: usize) -> Option<(usize, usize)> {
    spans.iter().copied().find(|&(open, close)| at >= open && at < close)
}

/// The best whole-word occurrence of `name`: the first backticked one in
/// prose, else the first bare one, else the first in a fence. An empty name
/// names nothing.
fn first_occurrence(text: &[u16], spans: &[(usize, usize)], name: &[u16]) -> Option<usize> {
    if name.is_empty() {
        return None;
    }
    let (mut bare, mut coded) = (None, None);
    let mut found = index_of(text, name, 0);
    while let Some(at) = found {
        let after = text.get(at + name.len());
        if !word(at.checked_sub(1).and_then(|before| text.get(before))) && !word(after) {
            if fencing(spans, at).is_some() {
                coded = coded.or(Some(at));
            } else if at.checked_sub(1).and_then(|before| text.get(before)) == Some(&TICK) || after == Some(&TICK) {
                return Some(at);
            } else {
                bare = bare.or(Some(at));
            }
        }
        found = index_of(text, name, at + 1);
    }
    bare.or(coded)
}

/// The paragraph an offset falls in, or the whole fence when it falls in one.
fn passage(text: &[u16], spans: &[(usize, usize)], at: usize) -> (usize, usize) {
    if let Some((open, close)) = fencing(spans, at) {
        return (last_index_of(text, &[NEWLINE], open).map_or(0, |found| found + 1), close);
    }
    let from = last_index_of(text, &BLANK, at).map_or(0, |blank| blank + 2);
    let to = index_of(text, &BLANK, at).unwrap_or(text.len());
    (from, to)
}

/// Which 1-based line an offset falls on.
fn line_of(text: &[u16], at: usize) -> u32 {
    1 + text[..at.min(text.len())].iter().filter(|&&unit| unit == NEWLINE).count() as u32
}

/// `slice`, with a negative end counted from the end.
fn slice(text: &[u16], from: usize, to: isize) -> &[u16] {
    let to = if to < 0 { text.len().saturating_sub(to.unsigned_abs()) } else { (to as usize).min(text.len()) };
    text.get(from.min(to)..to).unwrap_or(&[])
}

/// As much of a passage as is worth carrying, centred on the hit, snapped to
/// lines, and saying on each side it cut that it cut; with where it begins.
fn windowed(text: &[u16], from: usize, to: usize, hit: usize) -> (String, usize) {
    if to - from <= LONGEST {
        return (String::from_utf16_lossy(trim(slice(text, from, to as isize))), from);
    }
    let half = LONGEST / 2;
    let opened = (from as isize).max((hit as isize - half as isize).min((to - LONGEST) as isize)) as usize;
    let closed = to.min(opened + LONGEST);
    let head = if opened == from { from } else { index_of(text, &[NEWLINE], opened).map_or(0, |found| found + 1) };
    let tail: isize = if closed == to { to as isize } else { last_index_of(text, &[NEWLINE], closed).map_or(-1, |found| found as isize) };
    let mut shown = String::new();
    if head > from {
        shown.push_str(CUT_ABOVE);
    }
    shown.push_str(&String::from_utf16_lossy(trim(slice(text, head, tail))));
    if tail < to as isize {
        shown.push_str(CUT_BELOW);
    }
    (shown, head)
}

/// `String.prototype.trim`: white space and line terminators off both ends.
fn trim(text: &[u16]) -> &[u16] {
    let start = text.iter().position(|&unit| !space(unit)).unwrap_or(text.len());
    let end = text.iter().rposition(|&unit| !space(unit)).map_or(start, |at| at + 1);
    &text[start..end]
}

/// ECMAScript's WhiteSpace and LineTerminator, which `trim` removes.
fn space(unit: u16) -> bool {
    matches!(unit, 0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}

#[cfg(test)]
#[path = "help_mention_tests.rs"]
mod tests;
