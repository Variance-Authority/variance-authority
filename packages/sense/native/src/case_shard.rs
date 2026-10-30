//! One shard's case index, read for a fold: its cases, the regions it read
//! them against, and its pool of sets. `case_fold` joins any number of them.

use std::collections::HashMap;

use crate::case_id;
use crate::case_said;
use crate::crossing_sets::{decode_set, set_slice};
use crate::journey_columns::{self, Decoded};
use crate::journey_format::{self, Gaps};
use crate::journey_journal::Test;
use crate::journey_record::{Block, NO_OWNER};
use crate::record_layout::LAYOUT;

pub(crate) struct Shard {
    /// The name a refusal calls the shard by; empty until its reader names it.
    pub name: String,
    pub tests: Vec<Test>,
    /// Each case's duration in whole milliseconds, where its runner reported one.
    pub durations: Vec<Option<u32>>,
    /// Each case's lines as stored, its modules named by their row in this
    /// shard; empty where the case recorded none.
    pub lines: Vec<Vec<u8>>,
    pub modules: Vec<ShardModule>,
    pub set_bytes: Vec<u8>,
    pub set_offsets: Vec<u32>,
    pub local_to_global: Vec<u32>,
    pub gaps: Option<Gaps>,
}

pub(crate) struct ShardModule {
    pub file: String,
    /// Which of this file's distinct inventories the shard read its regions against.
    pub inventory: usize,
    pub called: Vec<u32>,
    pub loaded: Vec<bool>,
    /// Each region's overwritten set, empty where the shard has no
    /// `journey_format::OVERWRITTEN` column.
    pub overwritten: Vec<u32>,
}

/// One way a file was cut, with the owners that cut named where known.
pub(crate) struct Inventory {
    pub blocks: Vec<Block>,
    pub owners: Option<Vec<u32>>,
}

/// The case index in `bytes`, its cuts added to `inventories`. Every shard of a
/// combine was written by one build, so an index at another version is refused.
pub(crate) fn read_shard(bytes: &[u8], inventories: &mut HashMap<String, Vec<Inventory>>) -> Result<Shard, String> {
    let (version, decoded) = journey_columns::decode_any(bytes)?;
    let cases = &LAYOUT.cases;
    if version != cases.format {
        return Err(format!("it is written at version {version}, and this build reads version {}", cases.format));
    }
    let strings = strings(&decoded)?;
    let ids = decoded.words("tests.id")?;
    let files = decoded.words("tests.file")?;
    let names = decoded.words("tests.name")?;
    let count = ids.len();
    let optional_words = |name: &str| if decoded.has(name) { decoded.words(name).map(Some) } else { Ok(None) };
    let settled = decoded.bytes("tests.stopped")?;
    let runners = optional_words(case_id::COLUMN)?;
    let projects = optional_words(case_id::PROJECT_COLUMN)?;
    let durations = optional_words(&cases.duration)?;
    let lines = if decoded.has(&cases.lines) { Some((decoded.bytes(&cases.lines)?, decoded.words(&cases.lines_offsets)?)) } else { None };
    if files.len() != count
        || names.len() != count
        || settled.len() != count
        || [&runners, &projects, &durations].into_iter().flatten().any(|column| column.len() != count)
        || lines.as_ref().is_some_and(|(_, offsets)| offsets.len() != count + 1)
    {
        return Err("test columns disagree".to_owned());
    }
    let mut tests: Vec<Test> = (0..count)
        .map(|at| Ok(Test {
            id: string(&strings, ids[at])?.to_owned(),
            file: string(&strings, files[at])?.to_owned(),
            name: string(&strings, names[at])?.to_owned(),
            // No column, or `UNNAMED` in it, is a case no named project ran.
            project: projects.as_ref().map(|column| column[at]).filter(|word| *word != case_id::UNNAMED).map(|word| string(&strings, word).map(str::to_owned)).transpose()?,
            runner: runners.as_ref().map(|column| string(&strings, column[at]).map(str::to_owned)).transpose()?,
            settled: settled[at],
            heard: None,
        }))
        .collect::<Result<_, String>>()?;
    let no_duration = LAYOUT.coverage.no_duration;
    let durations = (0..count).map(|at| durations.as_ref().map(|column| column[at]).filter(|word| *word != no_duration)).collect();
    let lines = match &lines {
        None => vec![Vec::new(); count],
        Some((blob, offsets)) => offsets
            .windows(2)
            .map(|bounds| {
                let (from, to) = (bounds[0] as usize, bounds[1] as usize);
                if to < from || to > blob.len() {
                    return Err("case lines bounds are invalid".to_owned());
                }
                Ok(blob[from..to].to_vec())
            })
            .collect::<Result<_, String>>()?,
    };
    let set_bytes = decoded.bytes("sets.blob")?;
    let set_offsets = decoded.words("sets.off")?;
    let section = |name: &str| if decoded.has(name) { decoded.bytes(name).map(Some) } else { Ok(None) };
    let [said, read, misused] = case_said::SECTIONS.map(section);
    let [said, read, misused] = [said?, read?, misused?];
    if said.is_some() || read.is_some() || misused.is_some() {
        let members = |set| decode_set(set_slice(&set_bytes, &set_offsets, set)?, count);
        let sections = [said.as_deref(), read.as_deref(), misused.as_deref()];
        for (test, heard) in tests.iter_mut().zip(case_said::read(sections, count, members)?) {
            test.heard = heard;
        }
    }
    let module_files = decoded.words("modules.file")?;
    let module_blocks = decoded.words("modules.blocks")?;
    let called = decoded.words("blocks.calledSet")?;
    let loaded: Vec<bool> = decoded.held("blocks.loaded")?.iter().map(|flag| *flag == 1).collect();
    let kinds = decoded.words("blocks.kind")?;
    let block_names = decoded.words("blocks.name")?;
    let paths = decoded.words("blocks.path")?;
    let starts = decoded.words("blocks.start")?;
    let ends = decoded.words("blocks.end")?;
    let sources = decoded.held("blocks.source")?;
    // A shard written before regions named their owners has no owner column.
    let owners = optional_words(journey_format::OWNER)?;
    // A shard no layering cut to another text holds no overwritten column.
    let overwritten = optional_words(journey_format::OVERWRITTEN)?;
    if module_blocks.len() != module_files.len() + 1 || called.len() != loaded.len() {
        return Err("module columns disagree".to_owned());
    }
    if [block_names.len(), paths.len(), starts.len(), ends.len(), sources.len(), called.len()]
        .into_iter()
        .chain(owners.as_ref().map(Vec::len))
        .chain(overwritten.as_ref().map(Vec::len))
        .any(|length| length != kinds.len())
    {
        return Err("block columns disagree".to_owned());
    }
    let mut modules = Vec::with_capacity(module_files.len());
    for at in 0..module_files.len() {
        let first = module_blocks[at] as usize;
        let last = module_blocks[at + 1] as usize;
        if last < first || last > called.len() {
            return Err("module block bounds are invalid".to_owned());
        }
        let file = string(&strings, module_files[at])?.to_owned();
        let blocks: Vec<Block> = (first..last)
            .map(|block| Ok(Block {
                kind: string(&strings, kinds[block])?.to_owned(),
                name: string(&strings, block_names[block])?.to_owned(),
                path: string(&strings, paths[block])?.to_owned(),
                start_line: starts[block],
                end_line: ends[block],
                source: sources[block] == 1,
            }))
            .collect::<Result<_, String>>()?;
        let owned = owners.as_ref().map(|column| column[first..last].to_vec());
        let inventory = held_inventory(inventories.entry(file.clone()).or_default(), &file, blocks, owned)?;
        modules.push(ShardModule {
            file,
            inventory,
            called: called[first..last].to_vec(),
            loaded: loaded[first..last].to_vec(),
            overwritten: overwritten.as_ref().map_or_else(Vec::new, |column| column[first..last].to_vec()),
        });
    }
    Ok(Shard {
        name: String::new(),
        tests,
        durations,
        lines,
        modules,
        set_bytes,
        set_offsets,
        local_to_global: Vec::new(),
        gaps: journey_format::read_gaps(&decoded, &strings)?,
    })
}

/// Where `blocks` stands among the cuts of `file` read so far, with the owners
/// a shard named for it. An owner is a region before its own, so one that is
/// not is refused before a walk up the owners could follow it. One cut names
/// one set of owners: a shard that carries them fills in for one written
/// before they were, and two shards naming different owners for one cut are
/// refused rather than one picked.
pub(crate) fn held_inventory(held: &mut Vec<Inventory>, file: &str, blocks: Vec<Block>, owned: Option<Vec<u32>>) -> Result<usize, String> {
    if owned.as_ref().is_some_and(|owners| owners.iter().enumerate().any(|(at, owner)| *owner != NO_OWNER && *owner as usize >= at)) {
        return Err(format!("{file} names an owner after its region in {}", journey_format::OWNER));
    }
    match held.iter().position(|known| known.blocks == blocks) {
        Some(inventory) => {
            match (&held[inventory].owners, &owned) {
                (Some(known), Some(named)) if known != named => {
                    return Err(format!("two shards name different owners for one cut of {file} in {}", journey_format::OWNER));
                }
                (None, Some(_)) => held[inventory].owners = owned,
                _ => {}
            }
            Ok(inventory)
        }
        None => {
            held.push(Inventory { blocks, owners: owned });
            Ok(held.len() - 1)
        }
    }
}

pub(crate) fn strings(decoded: &Decoded) -> Result<Vec<String>, String> {
    let bytes = decoded.held("strings.blob")?;
    let offsets = decoded.words("strings.off")?;
    offsets
        .windows(2)
        .map(|bounds| {
            let from = bounds[0] as usize;
            let to = bounds[1] as usize;
            if to < from || to > bytes.len() {
                return Err("string bounds are invalid".to_owned());
            }
            std::str::from_utf8(&bytes[from..to])
                .map(str::to_owned)
                .map_err(|_| "journey string is not UTF-8".to_owned())
        })
        .collect()
}

pub(crate) fn string(strings: &[String], id: u32) -> Result<&str, String> {
    strings
        .get(id as usize)
        .map(String::as_str)
        .ok_or_else(|| format!("journey string id {id} is out of bounds"))
}

/// One case's lines with its modules named by `rows[module]`, their rows in
/// the fold, re-sorted by row. A module `rows` holds a file for instead is
/// refused by that file: the fold renumbered its regions, and the lines name
/// regions by their order.
/// The bytes are read as `case-lines.ts` writes them; every count is checked
/// against the bytes left before anything is held.
pub(crate) fn remap_lines(bytes: &[u8], rows: &[Result<u32, &str>]) -> Result<Vec<u8>, String> {
    let mut reader = Varints { bytes, at: 0 };
    let count = reader.take()?;
    if count > bytes.len() as u64 {
        return Err("case lines state more values than they hold".to_owned());
    }
    let mut head = Vec::new();
    put(&mut head, count);
    for _ in 0..count {
        put(&mut head, reader.take()?);
    }
    if count <= 1 {
        return reader.end().map(|()| head);
    }
    put(&mut head, reader.take()?);
    let segments = reader.take()?;
    if segments > bytes.len() as u64 {
        return Err("case lines state more segments than they hold".to_owned());
    }
    let mut module = -1_i64;
    let mut moved: Vec<(u32, Vec<u8>)> = Vec::new();
    for _ in 0..segments {
        module += reader.take()? as i64 + 1;
        let row = usize::try_from(module).ok()
            .and_then(|module| rows.get(module))
            .ok_or_else(|| "case lines name a missing module".to_owned())?
            .map_err(|file| format!("its lines stand on `{file}`, which two shards cut into different regions"))?;
        let runs = reader.take()?;
        if runs == 0 || runs > bytes.len() as u64 {
            return Err("case lines hold an invalid segment".to_owned());
        }
        let mut segment = Vec::new();
        put(&mut segment, runs);
        for _ in 0..(runs * 2 - 1) {
            put(&mut segment, reader.take()?);
        }
        moved.push((row, segment));
    }
    reader.end()?;
    moved.sort_unstable_by_key(|(row, _)| *row);
    if moved.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err("case lines name one module twice".to_owned());
    }
    put(&mut head, segments);
    let mut previous = -1_i64;
    for (row, segment) in moved {
        put(&mut head, (i64::from(row) - previous - 1) as u64);
        previous = i64::from(row);
        head.extend_from_slice(&segment);
    }
    Ok(head)
}

pub(crate) struct Varints<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Varints<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Varints { bytes, at: 0 }
    }

    /// The next number, at most five bytes long as `case-lines.ts` reads them.
    pub(crate) fn take(&mut self) -> Result<u64, String> {
        let mut value = 0_u64;
        for shift in (0..=28).step_by(7) {
            let byte = *self.bytes.get(self.at).ok_or_else(|| "case lines end early".to_owned())?;
            self.at += 1;
            value |= u64::from(byte & 0x7f) << shift;
            if byte < 0x80 {
                return Ok(value);
            }
        }
        Err("case lines hold a number too long".to_owned())
    }

    pub(crate) fn end(&self) -> Result<(), String> {
        if self.at == self.bytes.len() { Ok(()) } else { Err("case lines run past their values".to_owned()) }
    }
}

pub(crate) fn put(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

#[cfg(test)]
#[path = "case_shard_tests.rs"]
mod tests;
