use std::collections::HashMap;
use std::fs;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::journey_columns;
use crate::journey_format::{self, EncodedModule, SetPool};
use crate::journey_journal::{ModuleId, Test};
use crate::journey_output;
use crate::journey_record::{self, Block, Module};
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
}

#[napi(object)]
pub struct JourneyStitchResult {
    pub tests: u32,
    pub modules: u32,
    pub crossings: f64,
    pub shards: u32,
    /// Files two shards numbered differently, read at the regions both hold.
    pub renumbered: Vec<String>,
}

struct Shard {
    tests: Vec<Test>,
    modules: Vec<ShardModule>,
    set_bytes: Vec<u8>,
    set_offsets: Vec<u32>,
    local_to_global: Vec<u32>,
}

struct ShardModule {
    file: String,
    /// Which of this file's distinct inventories the shard read its regions against.
    inventory: usize,
    called: Vec<u32>,
    loaded: Vec<bool>,
}

struct Stitched {
    bytes: Vec<u8>,
    tests: u32,
    modules: u32,
    crossings: u64,
    shards: u32,
    renumbered: Vec<String>,
}

fn stitch(files: &[String]) -> Result<Stitched, String> {
    if files.is_empty() {
        return Err("no journey artifacts were named".to_owned());
    }
    let mut shards = Vec::with_capacity(files.len());
    let mut tests_by_id: HashMap<String, Test> = HashMap::new();
    let mut inventories: HashMap<String, Vec<Vec<Block>>> = HashMap::new();
    for file in files {
        let bytes = fs::read(file).map_err(|error| format!("cannot read {file}: {error}"))?;
        let shard = read_shard(&bytes, &mut inventories)
            .map_err(|error| format!("cannot read journey artifact {file}: {error}"))?;
        for test in &shard.tests {
            if let Some(before) = tests_by_id.get(&test.id) {
                if before.file != test.file || before.name != test.name {
                    return Err(format!(
                        "cannot stitch journey artifacts: test id {:?} names two tests",
                        test.id
                    ));
                }
            } else {
                tests_by_id.insert(test.id.clone(), test.clone());
            }
        }
        shards.push(shard);
    }

    let mut tests: Vec<Test> = tests_by_id.into_values().collect();
    tests.sort_by(|left, right| {
        order::code_unit(&left.id, &right.id)
            .then_with(|| order::code_unit(&left.file, &right.file))
            .then_with(|| order::code_unit(&left.name, &right.name))
    });
    let test_at: HashMap<&str, u32> = tests
        .iter()
        .enumerate()
        .map(|(at, test)| (test.id.as_str(), at as u32))
        .collect();
    for shard in &mut shards {
        shard.local_to_global = shard.tests.iter().map(|test| test_at[&*test.id]).collect();
    }

    let mut shapes: Vec<(String, Vec<Vec<Block>>)> = inventories.into_iter().collect();
    shapes.sort_by(|left, right| order::code_unit(&left.0, &right.0));
    let mut modules = Vec::with_capacity(shapes.len());
    let mut landings: Vec<Vec<Vec<u32>>> = Vec::with_capacity(shapes.len());
    let mut renumbered = Vec::new();
    for (file, mut held) in shapes {
        let (blocks, lands) = if held.len() == 1 {
            (held.pop().unwrap_or_default(), Vec::new())
        } else {
            let cut: Vec<&[Block]> = held.iter().map(Vec::as_slice).collect();
            let reconciled = journey_record::reconcile(&cut);
            renumbered.push(file.clone());
            (reconciled.blocks, reconciled.lands)
        };
        modules.push(Module {
            id: ModuleId::Name(file.clone()),
            file,
            digest: [0; 16],
            blocks,
            lands: Vec::new(),
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
    let bytes = journey_format::encode(&tests, &encoded, &sets)?;
    Ok(Stitched {
        bytes,
        tests: tests.len() as u32,
        modules: modules.len() as u32,
        crossings,
        shards: files.len() as u32,
        renumbered,
    })
}

/// Union journey-only execution artifacts without materializing one object per crossing.
#[napi]
pub fn stitch_journeys(files: Vec<String>) -> napi::Result<JourneyStitch> {
    let answered = stitch(&files).map_err(napi::Error::from_reason)?;
    Ok(JourneyStitch {
        bytes: answered.bytes.into(),
        tests: answered.tests,
        modules: answered.modules,
        crossings: answered.crossings as f64,
        shards: answered.shards,
        renumbered: answered.renumbered,
    })
}

/// Stitch and write the compressed artifact without transferring it through V8.
#[napi]
pub fn stitch_journeys_to(files: Vec<String>, output: String) -> napi::Result<JourneyStitchResult> {
    let answered = stitch(&files).map_err(napi::Error::from_reason)?;
    journey_output::replace(&output, &answered.bytes).map_err(napi::Error::from_reason)?;
    Ok(JourneyStitchResult {
        tests: answered.tests,
        modules: answered.modules,
        crossings: answered.crossings as f64,
        shards: answered.shards,
        renumbered: answered.renumbered,
    })
}

fn read_shard(bytes: &[u8], inventories: &mut HashMap<String, Vec<Vec<Block>>>) -> Result<Shard, String> {
    let decoded = journey_columns::decode(bytes, journey_format::FORMAT)?;
    let strings = strings(&decoded)?;
    let ids = decoded.words("tests.id")?;
    let files = decoded.words("tests.file")?;
    let names = decoded.words("tests.name")?;
    if files.len() != ids.len() || names.len() != ids.len() {
        return Err("test columns disagree".to_owned());
    }
    let tests = (0..ids.len())
        .map(|at| Ok(Test {
            id: string(&strings, ids[at])?.to_owned(),
            file: string(&strings, files[at])?.to_owned(),
            name: string(&strings, names[at])?.to_owned(),
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
    if module_blocks.len() != module_files.len() + 1 || called.len() != loaded.len() {
        return Err("module columns disagree".to_owned());
    }
    if [block_names.len(), paths.len(), starts.len(), ends.len(), sources.len(), called.len()]
        .into_iter()
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
        let held = inventories.entry(file.clone()).or_default();
        let inventory = match held.iter().position(|known| *known == blocks) {
            Some(inventory) => inventory,
            None => {
                held.push(blocks);
                held.len() - 1
            }
        };
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
    })
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
