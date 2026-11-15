//! A case journal's frames as `journal-format.cts` writes them, stepped through
//! row by row without decoding a row into an object: the one reader every fold
//! of case journals replays them with.

use std::fs;
use std::path::{Path, PathBuf};

use crate::journey_journal::ModuleId;

pub(crate) const MAGIC: [u8; 8] = [0x56, 0x41, 0x4a, 0x52, 0x4e, 0x00, 0x00, 0x03];
/// The moment a file's collection ended, a double after the frame's name: Jest's timing, not this fold's.
pub(crate) const TIME_BYTES: usize = 8;
/// `VAEYS`: an Eyes frame rides beside the case frames (`eyes-frame.cts`) and
/// crosses nothing; a fold that keeps what Eyes handed over reads it whole.
pub(crate) const EYES_MAGIC: [u8; 8] = [0x56, 0x41, 0x45, 0x59, 0x53, 0x00, 0x00, 0x01];
/// A module is named by its path: tag `1`, then the path. Tag `0`, a numbered
/// module, is refused as damage — nothing writes one (ADR-0056, amended).
pub(crate) const NAMED: u8 = 1;
/// A named row of a cut case (`journal-format.cts`): a fourth list after the
/// three, the test line each hit was first reached under, written plain.
pub(crate) const NAMED_LINED: u8 = 2;

pub trait Visitor {
    fn test(&mut self, packed: &str) -> Result<(), String>;
    /// An Eyes frame, whole, magic and all. Most folds step over it.
    fn eyes(&mut self, _frame: &[u8]) -> Result<(), String> {
        Ok(())
    }
    /// Whether the row of module `id` is read; `cut` where the row carries lines.
    fn wants(&mut self, id: &ModuleId, cut: bool) -> bool;
    /// A wanted row: its hits, shared and loaded ordinals, and for a cut row
    /// the test line each hit was first reached under.
    fn module(&mut self, id: &ModuleId, hits: &[u32], shared: &[u32], loaded: &[u32], reached: Option<&[u32]>);
}

pub fn replay(paths: &[PathBuf], visitor: &mut impl Visitor) -> Result<(), String> {
    for path in paths {
        let raw = fs::read(path).map_err(|error| error.to_string())?;
        frames(&raw, false, |frame| scan_journal(frame, visitor))?;
    }
    Ok(())
}

/// Read one part file. Its writer may have been killed mid-append, so a torn
/// last frame ends the file instead of failing the run.
pub fn replay_part(path: &Path, visitor: &mut impl Visitor) -> Result<(), String> {
    let raw = fs::read(path).map_err(|error| error.to_string())?;
    frames(&raw, true, |frame| scan_journal(frame, visitor))
}

fn frames(
    raw: &[u8],
    torn_tail: bool,
    mut visit: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let mut at = 0;
    while at < raw.len() {
        let torn = at + 4 > raw.len()
            || at + 4 + word(raw, at)? as usize > raw.len();
        if torn && torn_tail {
            return Ok(());
        }
        let length = word(raw, at)? as usize;
        let from = at + 4;
        let to = from.checked_add(length).ok_or_else(damaged_cases)?;
        if to > raw.len() {
            return Err(damaged_cases());
        }
        visit(&raw[from..to])?;
        at = to;
    }
    Ok(())
}

pub(crate) fn scan_journal(raw: &[u8], visitor: &mut impl Visitor) -> Result<(), String> {
    if raw.starts_with(&EYES_MAGIC) {
        return visitor.eyes(raw);
    }
    let mut read = Reader::new(raw);
    for expected in MAGIC {
        if read.byte()? != expected {
            return Err(damaged());
        }
    }
    visitor.test(&read.text()?)?;
    read.take(TIME_BYTES)?;
    let count = read.number()?;
    let mut scratch = Vec::new();
    for _ in 0..count {
        let lined = match read.byte()? {
            NAMED => false,
            NAMED_LINED => true,
            _ => return Err(damaged()),
        };
        let id = read.text()?;
        if !visitor.wants(&id, lined) {
            read.skip()?;
            read.skip()?;
            read.skip()?;
            if lined {
                read.skip()?;
            }
            continue;
        }
        scratch.clear();
        let mut starts = [0; 4];
        for start in &mut starts[..3] {
            *start = scratch.len();
            read.ordinals(&mut scratch)?;
        }
        starts[3] = scratch.len();
        if lined {
            if read.number()? as usize != starts[1] - starts[0] {
                return Err(damaged());
            }
            for _ in starts[0]..starts[1] {
                let line = read.number()?;
                scratch.push(line);
            }
        }
        visitor.module(
            &id,
            &scratch[starts[0]..starts[1]],
            &scratch[starts[1]..starts[2]],
            &scratch[starts[2]..starts[3]],
            lined.then(|| &scratch[starts[3]..]),
        );
    }
    if read.at != raw.len() {
        return Err(damaged());
    }
    Ok(())
}

struct Reader<'a> {
    raw: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn new(raw: &'a [u8]) -> Self {
        Self { raw, at: 0 }
    }

    fn byte(&mut self) -> Result<u8, String> {
        let value = self.raw.get(self.at).copied().ok_or_else(damaged)?;
        self.at += 1;
        Ok(value)
    }

    fn number(&mut self) -> Result<u32, String> {
        let mut value = 0_u32;
        let mut shift = 0;
        loop {
            let byte = self.byte()?;
            value = value
                .checked_add(((byte & 0x7f) as u32) << shift)
                .ok_or_else(damaged)?;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
            shift += 7;
            if shift > 28 {
                return Err(damaged());
            }
        }
    }

    fn take(&mut self, bytes: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(bytes).ok_or_else(damaged)?;
        let taken = self.raw.get(self.at..end).ok_or_else(damaged)?;
        self.at = end;
        Ok(taken)
    }

    fn text(&mut self) -> Result<String, String> {
        let length = self.number()? as usize;
        std::str::from_utf8(self.take(length)?).map(str::to_owned).map_err(|_| damaged())
    }

    fn skip(&mut self) -> Result<(), String> {
        let mut count = self.number()?;
        while count > 0 {
            if self.byte()? & 0x80 == 0 {
                count -= 1;
            }
        }
        Ok(())
    }

    fn ordinals(&mut self, out: &mut Vec<u32>) -> Result<(), String> {
        let count = self.number()?;
        let mut last = 0_u32;
        for _ in 0..count {
            last = last.checked_add(self.number()?).ok_or_else(damaged)?;
            out.push(last);
        }
        Ok(())
    }
}

/// An Eyes frame's case, attempt and journal text, as `decodeEyesFrame` in
/// `eyes-frame.cts` reads them; the journal stays text, its keys in the order
/// written, for the caller to parse.
pub(crate) fn eyes_of(frame: &[u8]) -> Result<(String, f64, Option<String>), String> {
    let refused = || "not a variance-authority eyes frame".to_owned();
    let body = std::str::from_utf8(&frame[EYES_MAGIC.len()..]).map_err(|_| refused())?;
    let fields: std::collections::HashMap<String, &serde_json::value::RawValue> =
        serde_json::from_str(body).map_err(|_| refused())?;
    let case: String = fields.get("case").and_then(|raw| serde_json::from_str(raw.get()).ok()).ok_or_else(refused)?;
    let attempt: f64 = fields.get("attempt").and_then(|raw| serde_json::from_str(raw.get()).ok()).ok_or_else(refused)?;
    let journal = match fields.get("journal") {
        None => None,
        Some(raw) if raw.get().trim_start().starts_with('{') => Some(raw.get().to_owned()),
        Some(_) => return Err(refused()),
    };
    Ok((case, attempt, journal))
}

fn word(raw: &[u8], at: usize) -> Result<u32, String> {
    let bytes: [u8; 4] = raw
        .get(at..at + 4)
        .ok_or_else(damaged_cases)?
        .try_into()
        .map_err(|_| damaged_cases())?;
    Ok(u32::from_le_bytes(bytes))
}

fn damaged() -> String {
    "not a variance-authority journal".to_owned()
}

fn damaged_cases() -> String {
    "not a variance-authority case journal".to_owned()
}

#[cfg(test)]
#[path = "journal_scan_tests.rs"]
mod tests;
