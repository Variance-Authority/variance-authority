use std::collections::HashMap;

use crate::journey_columns::{self, Column};
use crate::journey_journal::Test;
use crate::journey_record::Module;
use crate::order;

/// Version 3 carries load time as one flag per region rather than as the set of
/// tests that loaded it. A region that ran while its module evaluated ran for
/// whoever imported the module first, so the set named an import order and
/// not a test; the import graph answers that question, and the flag says when
/// to ask it.
pub const FORMAT: u8 = 3;

pub struct SetPool {
    test_count: usize,
    bytes: Vec<u8>,
    offsets: Vec<u32>,
    hashes: HashMap<u32, Vec<u32>>,
}

impl SetPool {
    pub fn new(test_count: usize) -> Self {
        Self {
            test_count,
            bytes: Vec::new(),
            offsets: vec![0],
            hashes: HashMap::new(),
        }
    }

    pub fn intern(&mut self, members: &[u32]) -> u32 {
        let encoded = encode_set(members, self.test_count);
        let hash = encoded.iter().fold(2_166_136_261_u32, |held, byte| {
            (held ^ u32::from(*byte)).wrapping_mul(16_777_619)
        });
        if let Some(candidates) = self.hashes.get(&hash) {
            for id in candidates {
                let from = self.offsets[*id as usize] as usize;
                let to = self.offsets[*id as usize + 1] as usize;
                if self.bytes[from..to] == encoded {
                    return *id;
                }
            }
        }
        let id = self.offsets.len() as u32 - 1;
        self.bytes.extend_from_slice(&encoded);
        self.offsets.push(self.bytes.len() as u32);
        self.hashes.entry(hash).or_default().push(id);
        id
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn offsets(&self) -> &[u32] {
        &self.offsets
    }
}

fn encode_set(members: &[u32], test_count: usize) -> Vec<u8> {
    let width = if test_count < 0x1_0000 { 2 } else { 4 };
    let words = (test_count + 31) >> 5;
    let mut runs = 0;
    for at in 0..members.len() {
        if at == 0 || members[at] != members[at - 1] + 1 {
            runs += 1;
        }
    }
    let list_size = 1 + members.len() * width;
    let bits_size = 1 + words * 4;
    let runs_size = 1 + runs * width * 2;
    let smallest = list_size.min(bits_size).min(runs_size);
    if smallest == bits_size {
        let mut out = vec![0; bits_size];
        out[0] = 1;
        for test in members {
            let at = 1 + ((*test as usize >> 5) * 4);
            let mut word = u32::from_le_bytes(out[at..at + 4].try_into().unwrap_or_default());
            word |= 1 << (*test & 31);
            out[at..at + 4].copy_from_slice(&word.to_le_bytes());
        }
        return out;
    }
    if smallest == runs_size {
        let mut out = Vec::with_capacity(runs_size);
        out.push(2);
        let mut at = 0;
        while at < members.len() {
            let first = members[at];
            let mut end = at + 1;
            while end < members.len() && members[end] == members[end - 1] + 1 {
                end += 1;
            }
            number(&mut out, first, width);
            number(&mut out, (end - at) as u32, width);
            at = end;
        }
        return out;
    }
    let mut out = Vec::with_capacity(list_size);
    out.push(0);
    for member in members {
        number(&mut out, *member, width);
    }
    out
}

fn number(out: &mut Vec<u8>, value: u32, width: usize) {
    if width == 2 {
        out.extend_from_slice(&(value as u16).to_le_bytes());
    } else {
        out.extend_from_slice(&value.to_le_bytes());
    }
}

pub struct EncodedModule<'a> {
    pub module: &'a Module,
    pub called: &'a [u32],
    /// Whether the region ran while its module evaluated, in any test file.
    pub loaded: &'a [bool],
}

pub fn encode(
    tests: &[Test],
    modules: &[EncodedModule<'_>],
    sets: &SetPool,
) -> Result<Vec<u8>, String> {
    let mut strings = Vec::new();
    for test in tests {
        strings.extend([test.id.clone(), test.file.clone(), test.name.clone()]);
    }
    for held in modules {
        strings.push(held.module.file.clone());
        for block in &held.module.blocks {
            strings.extend([block.kind.clone(), block.name.clone(), block.path.clone()]);
        }
    }
    strings.sort_unstable_by(|left, right| order::code_unit(left, right));
    strings.dedup();
    let ids: HashMap<&str, u32> = strings
        .iter()
        .enumerate()
        .map(|(at, value)| (value.as_str(), at as u32))
        .collect();
    let id = |value: &str| ids[value];

    let mut string_blob = Vec::new();
    let mut string_off = vec![0];
    for value in &strings {
        string_blob.extend_from_slice(value.as_bytes());
        string_off.push(string_blob.len() as u32);
    }
    let mut module_file = Vec::with_capacity(modules.len());
    let mut module_blocks = Vec::with_capacity(modules.len() + 1);
    let mut block_kind = Vec::new();
    let mut block_name = Vec::new();
    let mut block_path = Vec::new();
    let mut block_start = Vec::new();
    let mut block_end = Vec::new();
    let mut block_source = Vec::new();
    let mut block_called = Vec::new();
    let mut block_loaded = Vec::new();
    for held in modules {
        module_file.push(id(&held.module.file));
        module_blocks.push(block_kind.len() as u32);
        for (at, block) in held.module.blocks.iter().enumerate() {
            block_kind.push(id(&block.kind));
            block_name.push(id(&block.name));
            block_path.push(id(&block.path));
            block_start.push(block.start_line);
            block_end.push(block.end_line);
            block_source.push(u8::from(block.source));
            block_called.push(held.called[at]);
            block_loaded.push(u8::from(held.loaded[at]));
        }
    }
    module_blocks.push(block_kind.len() as u32);

    journey_columns::encode(vec![
        Column::Blob("strings.blob", string_blob, string_off.clone()),
        Column::Words("strings.off", string_off),
        Column::Words("tests.id", tests.iter().map(|test| id(&test.id)).collect()),
        Column::Words("tests.file", tests.iter().map(|test| id(&test.file)).collect()),
        Column::Words("tests.name", tests.iter().map(|test| id(&test.name)).collect()),
        Column::Words("modules.file", module_file),
        Column::Words("modules.blocks", module_blocks),
        Column::Words("blocks.kind", block_kind),
        Column::Words("blocks.name", block_name),
        Column::Words("blocks.path", block_path),
        Column::Words("blocks.start", block_start),
        Column::Words("blocks.end", block_end),
        Column::Bytes("blocks.source", block_source),
        Column::Words("blocks.calledSet", block_called),
        Column::Bytes("blocks.loaded", block_loaded),
        Column::Blob("sets.blob", sets.bytes().to_vec(), sets.offsets().to_vec()),
        Column::Words("sets.off", sets.offsets().to_vec()),
    ], FORMAT)
}
