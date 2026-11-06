//! The crossing-set pool: hash-consed sets of test (or case) ids, each distinct
//! set stored once and named by its id, which is what regions, items and
//! coverage rows refer to. A set is stored in whichever of the containers
//! `record-layout.json` names under `sets` — LIST of members, BITS over every
//! id, or RUNS of consecutive ids — is smallest, at the id width the pool's test
//! count needs. The TypeScript writer and reader of the same bytes are
//! `packages/sense/src/test-selection/crossing-sets.ts` and `crossing-sets-read.ts`.

use std::collections::HashMap;

use crate::record_layout::LAYOUT;

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

    /// A pool another writer laid, ready to intern more sets into: its ids keep
    /// their meaning, and an equal set is found rather than laid twice.
    pub fn from_pool(bytes: Vec<u8>, offsets: Vec<u32>, test_count: usize) -> Result<Self, String> {
        let sound = offsets.first() == Some(&0)
            && offsets.windows(2).all(|pair| pair[0] <= pair[1])
            && offsets.last().is_some_and(|end| *end as usize == bytes.len());
        if !sound {
            return Err("the crossing-set pool is damaged".to_owned());
        }
        let mut hashes: HashMap<u32, Vec<u32>> = HashMap::new();
        for (id, pair) in offsets.windows(2).enumerate() {
            hashes.entry(hash_of(&bytes[pair[0] as usize..pair[1] as usize])).or_default().push(id as u32);
        }
        Ok(Self { test_count, bytes, offsets, hashes })
    }

    /// The cases in set `id`.
    pub fn members(&self, id: u32) -> Result<Vec<u32>, String> {
        let (from, to) = (self.offsets.get(id as usize), self.offsets.get(id as usize + 1));
        let (Some(from), Some(to)) = (from, to) else {
            return Err(format!("no crossing set {id}"));
        };
        decode_set(&self.bytes[*from as usize..*to as usize], self.test_count)
    }

    pub fn intern(&mut self, members: &[u32]) -> u32 {
        let encoded = encode_set(members, self.test_count);
        let hash = hash_of(&encoded);
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

fn hash_of(encoded: &[u8]) -> u32 {
    encoded.iter().fold(2_166_136_261_u32, |held, byte| (held ^ u32::from(*byte)).wrapping_mul(16_777_619))
}

fn encode_set(members: &[u32], test_count: usize) -> Vec<u8> {
    let sets = &LAYOUT.sets;
    let width = sets.width(test_count);
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
        out[0] = sets.bits;
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
        out.push(sets.runs);
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
    out.push(sets.list);
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

/// The stored bytes of set `set` in a pool.
pub(crate) fn set_slice<'a>(bytes: &'a [u8], offsets: &[u32], set: u32) -> Result<&'a [u8], String> {
    let at = set as usize;
    let missing = || format!("journey set id {set} is out of bounds");
    let from = *offsets.get(at).ok_or_else(missing)? as usize;
    let to = *offsets.get(at + 1).ok_or_else(missing)? as usize;
    if to < from || to > bytes.len() {
        return Err("journey set bounds are invalid".to_owned());
    }
    Ok(&bytes[from..to])
}

/// The members of one stored set over `tests` tests, in the order stored.
/// Every member is checked against `tests` before it is held, so a set costs
/// what its bytes cost whatever it states.
pub(crate) fn decode_set(bytes: &[u8], tests: usize) -> Result<Vec<u32>, String> {
    let (&kind, body) = bytes
        .split_first()
        .ok_or_else(|| "journey set is empty".to_owned())?;
    let sets = &LAYOUT.sets;
    let width = sets.width(tests);
    let number = |bytes: &[u8]| -> u32 {
        if width == 2 {
            u32::from(u16::from_le_bytes([bytes[0], bytes[1]]))
        } else {
            u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        }
    };
    let missing = || "journey set names a missing test".to_owned();
    if kind == sets.list && body.len() % width == 0 {
        let members: Vec<u32> = body.chunks_exact(width).map(number).collect();
        if members.iter().any(|member| *member as usize >= tests) {
            return Err(missing());
        }
        return Ok(members);
    }
    if kind == sets.bits && body.len() == tests.div_ceil(32) * 4 {
        let mut found = Vec::new();
        for (word_at, bytes) in body.chunks_exact(4).enumerate() {
            let mut word = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            while word != 0 {
                let member = (word_at as u32) * 32 + word.trailing_zeros();
                if member as usize >= tests {
                    return Err(missing());
                }
                found.push(member);
                word &= word - 1;
            }
        }
        return Ok(found);
    }
    if kind == sets.runs && body.len() % (width * 2) == 0 {
        let mut found = Vec::new();
        for run in body.chunks_exact(width * 2) {
            let first = u64::from(number(run));
            let length = u64::from(number(&run[width..]));
            if first + length > tests as u64 {
                return Err(missing());
            }
            found.extend(first as u32..(first + length) as u32);
        }
        return Ok(found);
    }
    Err("journey set has an invalid encoding".to_owned())
}

#[cfg(test)]
#[path = "crossing_sets_tests.rs"]
mod tests;
