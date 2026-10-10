use std::collections::HashMap;
use std::fs;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::case_id::{self, CaseIds};
use crate::case_preconditions;
use crate::journey_columns;
use crate::journey_format::{self, EncodedModule, Gaps, SetPool};
use crate::journey_journal::{self, Test};
use crate::journey_output;
use crate::journey_record::{self, Block, Module, NO_OWNER};
use crate::order;

#[napi(object)]
pub struct JourneyStitch {
    pub bytes: Buffer,
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    pub shards: u32,
    /// Files two shards numbered differently, read at the regions both hold.
    pub renumbered: Vec<String>,
    /// Modules a case ran that no record holds, over every shard; absent when
    /// a shard was finalized without carrying them.
    pub unrecorded: Option<Vec<String>>,
    /// Part files that ran code under no journey a case handed out, over every shard.
    pub unclaimed: Option<Vec<String>>,
    /// Heads that wrote parts in a run before and none in this one, over every shard.
    pub silent: Option<Vec<String>>,
}

#[napi(object)]
pub struct JourneyStitchResult {
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    pub shards: u32,
    /// Files two shards numbered differently, read at the regions both hold.
    pub renumbered: Vec<String>,
    /// Modules a case ran that no record holds, over every shard; absent when
    /// a shard was finalized without carrying them.
    pub unrecorded: Option<Vec<String>>,
    /// Part files that ran code under no journey a case handed out, over every shard.
    pub unclaimed: Option<Vec<String>>,
    /// Heads that wrote parts in a run before and none in this one, over every shard.
    pub silent: Option<Vec<String>>,
}

struct Shard {
    tests: Vec<Test>,
    modules: Vec<ShardModule>,
    set_bytes: Vec<u8>,
    set_offsets: Vec<u32>,
    local_to_global: Vec<u32>,
    gaps: Option<Gaps>,
}

struct ShardModule {
    file: String,
    /// Which of this file's distinct inventories the shard read its regions against.
    inventory: usize,
    called: Vec<u32>,
    loaded: Vec<bool>,
}

/// One way a file was cut, with the owners that cut named where known.
struct Inventory {
    blocks: Vec<Block>,
    owners: Option<Vec<u32>>,
}

struct Stitched {
    bytes: Vec<u8>,
    tests: u32,
    modules: u32,
    crossings: u64,
    shards: u32,
    renumbered: Vec<String>,
    gaps: Option<Gaps>,
}

fn stitch(files: &[String]) -> Result<Stitched, String> {
    if files.is_empty() {
        return Err("no journey artifacts were named".to_owned());
    }
    let mut shards = Vec::with_capacity(files.len());
    let mut inventories: HashMap<String, Vec<Inventory>> = HashMap::new();
    for file in files {
        let bytes = fs::read(file).map_err(|error| format!("cannot read {file}: {error}"))?;
        let shard = read_shard(&bytes, &mut inventories)
            .map_err(|error| format!("cannot read journey artifact {file}: {error}"))?;
        shards.push(shard);
    }
    // A case id numbers a case among the cases its own shard ran, so a shard
    // that ran only the second of two cases sharing a name calls it by the
    // first one's id. Where every shard carries the runner's ids, a case is
    // joined by its own and the union is numbered again, as one fold over every
    // shard's frames numbers it; otherwise it is joined by case id.
    let by_runner = shards.iter().all(|shard| shard.tests.iter().all(|test| test.runner.is_some()));
    let key = |test: &Test| -> (String, String, String, Option<String>) {
        match &test.runner {
            Some(runner) if by_runner => (test.file.clone(), test.name.clone(), runner.clone(), test.project.clone()),
            _ => (test.id.clone(), String::new(), String::new(), None),
        }
    };
    let mut tests_by_key: HashMap<(String, String, String, Option<String>), Test> = HashMap::new();
    for test in shards.iter().flat_map(|shard| &shard.tests) {
        if let Some(before) = tests_by_key.get_mut(&key(test)) {
            if before.file != test.file || before.name != test.name {
                return Err(format!(
                    "cannot stitch journey artifacts: test id {:?} names two tests",
                    test.id
                ));
            }
            before.settled = journey_journal::settled_across(before.settled, test.settled);
            before.preconditions = case_preconditions::across(before.preconditions.take(), test.preconditions.clone());
        } else {
            tests_by_key.insert(key(test), test.clone());
        }
    }

    let mut tests: Vec<Test> = tests_by_key.into_values().collect();
    if by_runner {
        tests.sort_by(|left, right| {
            let runner = |test: &Test| test.runner.clone().unwrap_or_default();
            case_id::order((&left.file, &left.name, left.project.as_deref(), &runner(left)),
                (&right.file, &right.name, right.project.as_deref(), &runner(right)))
        });
        let mut ids = CaseIds::default();
        for test in &mut tests {
            test.id = ids.next(&test.file, &test.name, test.project.as_deref())?;
        }
    }
    tests.sort_by(|left, right| {
        order::code_unit(&left.id, &right.id)
            .then_with(|| order::code_unit(&left.file, &right.file))
            .then_with(|| order::code_unit(&left.name, &right.name))
    });
    let test_at: HashMap<(String, String, String, Option<String>), u32> = tests
        .iter()
        .enumerate()
        .map(|(at, test)| (key(test), at as u32))
        .collect();
    for shard in &mut shards {
        shard.local_to_global = shard.tests.iter().map(|test| test_at[&key(test)]).collect();
    }

    let mut shapes: Vec<(String, Vec<Inventory>)> = inventories.into_iter().collect();
    shapes.sort_by(|left, right| order::code_unit(&left.0, &right.0));
    let mut modules = Vec::with_capacity(shapes.len());
    let mut landings: Vec<Vec<Vec<u32>>> = Vec::with_capacity(shapes.len());
    let mut renumbered = Vec::new();
    for (file, mut held) in shapes {
        // Owners are positions among the module's own regions, so one cut
        // carries them as they are and a reconciled one reads them again.
        let (blocks, owners, lands) = match held.pop() {
            Some(only) if held.is_empty() => (only.blocks, only.owners, Vec::new()),
            last => {
                held.extend(last);
                let cut: Vec<&[Block]> = held.iter().map(|inventory| inventory.blocks.as_slice()).collect();
                let owned: Vec<Option<&[u32]>> = held.iter().map(|inventory| inventory.owners.as_deref()).collect();
                let reconciled = journey_record::reconcile(&cut, &owned);
                renumbered.push(file.clone());
                (reconciled.blocks, reconciled.owners, reconciled.lands)
            }
        };
        modules.push(Module {
            id: file.clone(),
            file,
            blocks,
            owners,
        });
        landings.push(lands);
    }
    for shard in &mut shards {
        shard.modules.sort_by(|left, right| order::code_unit(&left.file, &right.file));
    }
    let mut called_by_module = Vec::with_capacity(modules.len());
    let mut loaded_by_module = Vec::with_capacity(modules.len());
    let mut sets = SetPool::new(tests.len());
    let mut crossings = 0_u64;
    for (module, lands) in modules.iter().zip(&landings) {
        let mut called_by_block = vec![Vec::new(); module.blocks.len()];
        let mut loaded = vec![false; module.blocks.len()];
        for shard in &shards {
            let Ok(at) = shard
                .modules
                .binary_search_by(|candidate| order::code_unit(&candidate.file, &module.file))
            else {
                continue;
            };
            let held = &shard.modules[at];
            let landed = lands.get(held.inventory);
            for own in 0..held.called.len() {
                let block = landed.map_or(own, |landed| landed[own] as usize);
                append_members(shard, held.called[own], &mut called_by_block[block])?;
                loaded[block] |= held.loaded[own];
            }
        }
        let mut called_ids = Vec::with_capacity(module.blocks.len());
        for mut called in called_by_block {
            called.sort_unstable();
            called.dedup();
            crossings += called.len() as u64;
            called_ids.push(sets.intern(&called));
        }
        called_by_module.push(called_ids);
        loaded_by_module.push(loaded);
    }
    let encoded: Vec<EncodedModule<'_>> = modules
        .iter()
        .enumerate()
        .map(|(at, module)| EncodedModule {
            module,
            called: &called_by_module[at],
            loaded: &loaded_by_module[at],
        })
        .collect();
    let gaps = union_gaps(&shards);
    let bytes = journey_format::encode(&tests, &encoded, &sets, gaps.as_ref())?;
    Ok(Stitched {
        bytes,
        tests: tests.len() as u32,
        modules: modules.len() as u32,
        crossings,
        shards: files.len() as u32,
        renumbered,
        gaps,
    })
}

/// Every shard's gaps together, or none when one shard carries none: a shard
/// that was not asked cannot be read as one that found nothing.
fn union_gaps(shards: &[Shard]) -> Option<Gaps> {
    let every: Vec<&Gaps> = shards.iter().map(|shard| shard.gaps.as_ref()).collect::<Option<_>>()?;
    let joined = |pick: fn(&Gaps) -> Option<&Vec<String>>| -> Option<Vec<String>> {
        let mut names: Vec<String> = every.iter().map(|gaps| pick(gaps)).collect::<Option<Vec<_>>>()?.into_iter().flatten().cloned().collect();
        names.sort_unstable_by(|left, right| order::code_unit(left, right));
        names.dedup();
        Some(names)
    };
    Some(Gaps {
        unrecorded: joined(|gaps| Some(&gaps.unrecorded))?,
        unclaimed: joined(|gaps| Some(&gaps.unclaimed))?,
        heads: joined(|gaps| Some(&gaps.heads))?,
        silent: joined(|gaps| gaps.silent.as_ref()),
    })
}

/// Union journey-only execution artifacts without materializing one object per crossing.
#[napi(catch_unwind)]
pub fn stitch_journeys(files: Vec<String>) -> napi::Result<JourneyStitch> {
    let answered = stitch(&files).map_err(napi::Error::from_reason)?;
    Ok(JourneyStitch {
        bytes: answered.bytes.into(),
        tests: answered.tests,
        modules: answered.modules,
        crossings: answered.crossings as f64,
        shards: answered.shards,
        renumbered: answered.renumbered,
        unrecorded: answered.gaps.as_ref().map(|gaps| gaps.unrecorded.clone()),
        unclaimed: answered.gaps.as_ref().map(|gaps| gaps.unclaimed.clone()),
        silent: answered.gaps.and_then(|gaps| gaps.silent),
    })
}

/// Stitch and write the compressed artifact without transferring it through V8.
#[napi(catch_unwind)]
pub fn stitch_journeys_to(files: Vec<String>, output: String) -> napi::Result<JourneyStitchResult> {
    let answered = stitch(&files).map_err(napi::Error::from_reason)?;
    journey_output::replace(&output, &answered.bytes).map_err(napi::Error::from_reason)?;
    Ok(JourneyStitchResult {
        tests: answered.tests,
        modules: answered.modules,
        crossings: answered.crossings as f64,
        shards: answered.shards,
        renumbered: answered.renumbered,
        unrecorded: answered.gaps.as_ref().map(|gaps| gaps.unrecorded.clone()),
        unclaimed: answered.gaps.as_ref().map(|gaps| gaps.unclaimed.clone()),
        silent: answered.gaps.and_then(|gaps| gaps.silent),
    })
}

fn read_shard(bytes: &[u8], inventories: &mut HashMap<String, Vec<Inventory>>) -> Result<Shard, String> {
    let decoded = journey_columns::decode(bytes, journey_format::FORMAT)?;
    let strings = strings(&decoded)?;
    let ids = decoded.words("tests.id")?;
    let files = decoded.words("tests.file")?;
    let names = decoded.words("tests.name")?;
    // A shard written before cases carried how they settled says nothing.
    let settled = decoded.bytes("tests.stopped").ok();
    // A shard whose producer never listened to a case has no precondition column.
    let said = if decoded.has(case_preconditions::COLUMN) { Some(decoded.words(case_preconditions::COLUMN)?) } else { None };
    // A shard written before cases carried their runner's id is joined by case id.
    let runners = if decoded.has(case_id::COLUMN) { Some(decoded.words(case_id::COLUMN)?) } else { None };
    let projects = if decoded.has(case_id::PROJECT_COLUMN) { Some(decoded.words(case_id::PROJECT_COLUMN)?) } else { None };
    if files.len() != ids.len()
        || names.len() != ids.len()
        || settled.as_ref().is_some_and(|column| column.len() != ids.len())
        || said.as_ref().is_some_and(|column| column.len() != ids.len())
        || runners.as_ref().is_some_and(|column| column.len() != ids.len())
        || projects.as_ref().is_some_and(|column| column.len() != ids.len())
    {
        return Err("test columns disagree".to_owned());
    }
    let tests = (0..ids.len())
        .map(|at| Ok(Test {
            id: string(&strings, ids[at])?.to_owned(),
            file: string(&strings, files[at])?.to_owned(),
            name: string(&strings, names[at])?.to_owned(),
            // No column, or `UNNAMED` in it, is a case no named project ran.
            project: projects.as_ref().map(|column| column[at]).filter(|word| *word != case_id::UNNAMED).map(|word| string(&strings, word).map(str::to_owned)).transpose()?,
            runner: runners.as_ref().map(|column| string(&strings, column[at]).map(str::to_owned)).transpose()?,
            settled: settled.as_ref().map_or(journey_journal::UNSETTLED, |column| column[at]),
            preconditions: match said.as_ref().map(|column| column[at]) {
                None | Some(case_preconditions::UNHEARD) => None,
                Some(word) => Some(case_preconditions::unspelled(string(&strings, word)?)?),
            },
        }))
        .collect::<Result<_, String>>()?;
    let module_files = decoded.words("modules.file")?;
    let module_blocks = decoded.words("modules.blocks")?;
    let called = decoded.words("blocks.calledSet")?;
    let loaded = decoded.bytes("blocks.loaded")?;
    let kinds = decoded.words("blocks.kind")?;
    let block_names = decoded.words("blocks.name")?;
    let paths = decoded.words("blocks.path")?;
    let starts = decoded.words("blocks.start")?;
    let ends = decoded.words("blocks.end")?;
    let sources = decoded.bytes("blocks.source")?;
    // A shard written before regions named their owners has no owner column.
    let owners = if decoded.has(journey_format::OWNER) { Some(decoded.words(journey_format::OWNER)?) } else { None };
    if module_blocks.len() != module_files.len() + 1 || called.len() != loaded.len() {
        return Err("module columns disagree".to_owned());
    }
    if [block_names.len(), paths.len(), starts.len(), ends.len(), sources.len(), called.len()]
        .into_iter()
        .chain(owners.as_ref().map(Vec::len))
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
            loaded: loaded[first..last].iter().map(|flag| *flag == 1).collect(),
        });
    }
    Ok(Shard {
        tests,
        modules,
        set_bytes: decoded.bytes("sets.blob")?,
        set_offsets: decoded.words("sets.off")?,
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
fn held_inventory(held: &mut Vec<Inventory>, file: &str, blocks: Vec<Block>, owned: Option<Vec<u32>>) -> Result<usize, String> {
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

pub(crate) fn strings(decoded: &journey_columns::Decoded) -> Result<Vec<String>, String> {
    let bytes = decoded.bytes("strings.blob")?;
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

fn append_members(shard: &Shard, set: u32, out: &mut Vec<u32>) -> Result<(), String> {
    let at = set as usize;
    let from = *shard
        .set_offsets
        .get(at)
        .ok_or_else(|| format!("journey set id {set} is out of bounds"))? as usize;
    let to = *shard
        .set_offsets
        .get(at + 1)
        .ok_or_else(|| format!("journey set id {set} is out of bounds"))? as usize;
    if to < from || to > shard.set_bytes.len() {
        return Err("journey set bounds are invalid".to_owned());
    }
    for local in decode_set(&shard.set_bytes[from..to], shard.tests.len())? {
        out.push(shard.local_to_global[local as usize]);
    }
    Ok(())
}

pub(crate) fn decode_set(bytes: &[u8], tests: usize) -> Result<Vec<u32>, String> {
    let (&kind, body) = bytes
        .split_first()
        .ok_or_else(|| "journey set is empty".to_owned())?;
    let width = if tests < 0x1_0000 { 2 } else { 4 };
    let number = |bytes: &[u8]| -> Result<u32, String> {
        match width {
            2 if bytes.len() >= 2 => Ok(u32::from(u16::from_le_bytes(bytes[..2].try_into().unwrap_or_default()))),
            4 if bytes.len() >= 4 => Ok(u32::from_le_bytes(bytes[..4].try_into().unwrap_or_default())),
            _ => Err("journey set is truncated".to_owned()),
        }
    };
    let members = match kind {
        0 if body.len() % width == 0 => body.chunks_exact(width).map(number).collect::<Result<Vec<_>, _>>()?,
        1 if body.len() == tests.div_ceil(32) * 4 => {
            let mut found = Vec::new();
            for (word_at, bytes) in body.chunks_exact(4).enumerate() {
                let mut word = u32::from_le_bytes(bytes.try_into().unwrap_or_default());
                while word != 0 {
                    let bit = word.trailing_zeros();
                    found.push((word_at as u32) * 32 + bit);
                    word &= word - 1;
                }
            }
            found
        }
        2 if body.len() % (width * 2) == 0 => {
            let mut found = Vec::new();
            for run in body.chunks_exact(width * 2) {
                let first = number(run)?;
                let length = number(&run[width..])?;
                found.extend(first..first + length);
            }
            found
        }
        _ => return Err("journey set has an invalid encoding".to_owned()),
    };
    if members.iter().any(|member| *member as usize >= tests) {
        return Err("journey set names a missing test".to_owned());
    }
    Ok(members)
}

#[cfg(test)]
#[path = "journey_stitch_tests.rs"]
mod tests;
