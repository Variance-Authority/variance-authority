use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use crate::journey_journal::ModuleId;
use crate::order;

const MAGIC: [u8; 8] = [0x56, 0x41, 0x52, 0x45, 0x43, 0x00, 0x00, 0x01];
const FRAME_HEADER: usize = 8;
const RECORD_HEADER: usize = 32;
const UNNUMBERED: u32 = u32::MAX;
const KINDS: [&str; 8] = [
    "module",
    "function",
    "branch",
    "continuation",
    "resume",
    "loop",
    "case",
    "handler",
];

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct Block {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub source: bool,
}

#[derive(Clone)]
pub struct Module {
    pub id: ModuleId,
    pub file: String,
    pub digest: [u8; 16],
    pub blocks: Vec<Block>,
    /// The blocks each journal ordinal lands on, when two builds numbered this
    /// file's regions differently; empty when an ordinal is its own block.
    pub lands: Vec<Vec<u32>>,
}

/// The regions every inventory of one file holds, and where each inventory's
/// own regions land among them.
pub struct Reconciled {
    pub blocks: Vec<Block>,
    /// `lands[inventory][region]` is the reconciled block that region reads as.
    pub lands: Vec<Vec<u32>>,
}

/// Read several inventories of one source text at the regions they share.
///
/// Two transforms of one file can cut its regions apart, so an ordinal names a
/// region only against the inventory that cut it. The lines are common ground:
/// a region that only some builds hold lands on the innermost shared source
/// region that encloses it, and the whole file only when nothing does. That is
/// the region a changed line resolves to, since a shared region is in every
/// inventory and regions of one inventory nest — so every case that ran the
/// line is credited where the change will look.
// TODO: keep each build's own regions and read a case's ordinals against the build that cut them — needs the case journal to name that build.
pub fn reconcile(inventories: &[&[Block]]) -> Reconciled {
    let mut blocks: Vec<Block> = Vec::new();
    let mut at: HashMap<&Block, u32> = HashMap::new();
    // The order comes from one inventory chosen by content, so the answer is
    // the same whichever store or shard happened to be read first.
    let base = inventories.iter().copied().min_by(|left, right| inventory_order(left, right));
    if let Some(base) = base {
        let held: Vec<HashSet<&Block>> = inventories.iter().map(|blocks| blocks.iter().collect()).collect();
        for block in base {
            if !at.contains_key(block) && held.iter().all(|other| other.contains(block)) {
                at.insert(block, blocks.len() as u32);
                blocks.push(block.clone());
            }
        }
    }
    let shared = blocks.len();
    let mut whole = None;
    let mut lands = Vec::with_capacity(inventories.len());
    for inventory in inventories {
        let mut landed = Vec::with_capacity(inventory.len());
        for block in inventory.iter() {
            let target = match at.get(block).copied().or_else(|| enclosing(&blocks[..shared], block)) {
                Some(target) => target,
                None => *whole.get_or_insert_with(|| {
                    blocks.push(whole_file(inventories, base.and_then(<[Block]>::first)));
                    (blocks.len() - 1) as u32
                }),
            };
            landed.push(target);
        }
        lands.push(landed);
    }
    Reconciled { blocks, lands }
}

fn enclosing(shared: &[Block], block: &Block) -> Option<u32> {
    shared
        .iter()
        .enumerate()
        .filter(|(_, outer)| {
            outer.source && outer.start_line <= block.start_line && block.end_line <= outer.end_line
        })
        .min_by_key(|(at, outer)| (outer.end_line.saturating_sub(outer.start_line), *at))
        .map(|(at, _)| at as u32)
}

fn inventory_order(left: &[Block], right: &[Block]) -> std::cmp::Ordering {
    left.len().cmp(&right.len()).then_with(|| {
        left.iter()
            .zip(right)
            .map(|(left, right)| {
                left.start_line
                    .cmp(&right.start_line)
                    .then(left.end_line.cmp(&right.end_line))
                    .then(left.source.cmp(&right.source))
                    .then_with(|| order::code_unit(&left.kind, &right.kind))
                    .then_with(|| order::code_unit(&left.name, &right.name))
                    .then_with(|| order::code_unit(&left.path, &right.path))
            })
            .find(|ordering| ordering.is_ne())
            .unwrap_or(std::cmp::Ordering::Equal)
    })
}

fn whole_file(inventories: &[&[Block]], first: Option<&Block>) -> Block {
    let (start_line, end_line) = inventories
        .iter()
        .flat_map(|blocks| blocks.iter())
        .filter(|block| block.source)
        .fold((u32::MAX, 0), |(start, end), block| {
            (start.min(block.start_line), end.max(block.end_line))
        });
    let source = start_line <= end_line;
    Block {
        kind: "module".to_owned(),
        name: first.map_or_else(String::new, |block| block.name.clone()),
        path: first.map_or_else(String::new, |block| block.path.clone()),
        start_line: if source { start_line } else { first.map_or(0, |block| block.start_line) },
        end_line: if source { end_line } else { first.map_or(0, |block| block.end_line) },
        source,
    }
}

/// Every block one ordinal may name, across the inventories that hold it.
fn by_ordinal(lands: &[Vec<u32>]) -> Vec<Vec<u32>> {
    let count = lands.iter().map(Vec::len).max().unwrap_or(0);
    (0..count)
        .map(|ordinal| {
            let mut targets: Vec<u32> = lands.iter().filter_map(|landed| landed.get(ordinal).copied()).collect();
            targets.sort_unstable();
            targets.dedup();
            targets
        })
        .collect()
}

struct Answer {
    raw: Arc<Vec<u8>>,
    frame: Frame,
}

#[derive(Clone, Copy)]
struct Frame {
    at: usize,
    length: usize,
    checksum: u32,
}

pub fn read_records(
    stores: &[String],
    wanted: &HashSet<ModuleId>,
    instrumentation: &str,
) -> Result<HashMap<ModuleId, Module>, String> {
    let held: Vec<HashMap<ModuleId, Module>> = stores
        .iter()
        .map(|store| read_store(Path::new(store), wanted, instrumentation))
        .collect::<Result<_, _>>()?;
    let mut found = HashMap::new();
    for id in wanted {
        let answers: Vec<&Module> = held.iter().filter_map(|store| store.get(id)).collect();
        let Some(first) = answers.first() else {
            continue;
        };
        let mut module = (*first).clone();
        if answers.iter().any(|candidate| candidate.digest != module.digest) {
            module.blocks.clear();
        } else if answers.iter().any(|candidate| candidate.blocks != module.blocks) {
            // One source text, cut apart by two transforms: the digest vouches
            // for the lines and not for the ordinals.
            let inventories: Vec<&[Block]> = answers.iter().map(|answer| answer.blocks.as_slice()).collect();
            let reconciled = reconcile(&inventories);
            module.lands = by_ordinal(&reconciled.lands);
            module.blocks = reconciled.blocks;
        }
        found.insert(id.clone(), module);
    }
    Ok(found)
}

fn read_store(
    store: &Path,
    wanted: &HashSet<ModuleId>,
    instrumentation: &str,
) -> Result<HashMap<ModuleId, Module>, String> {
    let mut files = segment_files(store)?;
    files.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| order::code_unit(&left.1.to_string_lossy(), &right.1.to_string_lossy()))
    });
    let mut answers: HashMap<ModuleId, Answer> = HashMap::new();
    for (_, file) in files {
        let raw = Arc::new(fs::read(file).map_err(|error| error.to_string())?);
        let Some(from) = segment_header(&raw, instrumentation) else {
            continue;
        };
        for frame in frames(&raw, from) {
            let payload = &raw[frame.at..frame.at + frame.length];
            let id = record_id(payload)?;
            if wanted.contains(&id) {
                answers.insert(
                    id,
                    Answer {
                        raw: Arc::clone(&raw),
                        frame,
                    },
                );
            }
        }
    }
    let mut found = HashMap::new();
    for (id, answer) in answers {
        if let Some(module) = decode_record(&answer.raw, answer.frame)? {
            found.insert(id, module);
        }
    }
    Ok(found)
}

fn segment_files(store: &Path) -> Result<Vec<(u128, PathBuf)>, String> {
    let entries = match fs::read_dir(store) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut files = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("rec") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |duration| duration.as_nanos());
        files.push((modified, path));
    }
    Ok(files)
}

fn segment_header(raw: &[u8], instrumentation: &str) -> Option<usize> {
    if raw.get(0..MAGIC.len())? != MAGIC {
        return None;
    }
    let length = word(raw, MAGIC.len()).ok()? as usize;
    let end = MAGIC.len() + 4 + length;
    let recipe = std::str::from_utf8(raw.get(MAGIC.len() + 4..end)?).ok()?;
    (recipe == instrumentation).then_some(aligned(end, 8))
}

fn frames(raw: &[u8], mut at: usize) -> Vec<Frame> {
    let mut found = Vec::new();
    while at + FRAME_HEADER + RECORD_HEADER <= raw.len() {
        let Ok(length) = word(raw, at).map(|value| value as usize) else {
            break;
        };
        let Ok(checksum) = word(raw, at + 4) else {
            break;
        };
        let payload = at + FRAME_HEADER;
        if length < RECORD_HEADER || payload + length > raw.len() {
            break;
        }
        found.push(Frame {
            at: payload,
            length,
            checksum,
        });
        at = payload + aligned(length, 8);
    }
    found
}

fn record_id(payload: &[u8]) -> Result<ModuleId, String> {
    let numbered = word(payload, 0)?;
    if numbered != UNNUMBERED {
        return Ok(ModuleId::Number(numbered));
    }
    Ok(ModuleId::Name(first_string(payload)?))
}

fn first_string(payload: &[u8]) -> Result<String, String> {
    let at = RECORD_HEADER;
    if word(payload, at)? == 0 {
        return Err(damaged());
    }
    let length = word(payload, at + 4)? as usize;
    text(payload, at + 8, length)
}

fn decode_record(raw: &[u8], frame: Frame) -> Result<Option<Module>, String> {
    let payload = &raw[frame.at..frame.at + frame.length];
    if checksum(payload) != frame.checksum {
        return Ok(None);
    }
    let count = word(payload, 8)? as usize;
    let dictionary = word(payload, 12)? as usize;
    let mut digest = [0; 16];
    digest.copy_from_slice(payload.get(16..32).ok_or_else(damaged)?);
    let mut strings = Vec::new();
    let mut at = RECORD_HEADER;
    let entries = word(payload, at)? as usize;
    at += 4;
    for _ in 0..entries {
        let length = word(payload, at)? as usize;
        strings.push(text(payload, at + 4, length)?);
        at += aligned(4 + length, 4);
    }

    at = RECORD_HEADER + dictionary;
    let bits = (count + 7) >> 3;
    let kind = take(&mut at, aligned(count, 4));
    let _owner = take(&mut at, count * 4);
    let name = take(&mut at, count * 4);
    let path = take(&mut at, count * 4);
    let start = take(&mut at, count * 4);
    let end = take(&mut at, count * 4);
    let source = take(&mut at, aligned(bits, 4));
    let _digest = take(&mut at, count * 16);
    if at > payload.len() {
        return Ok(None);
    }

    let mut blocks = Vec::with_capacity(count);
    for index in 0..count {
        let kind_id = *payload.get(kind + index).ok_or_else(damaged)? as usize;
        let name_id = word(payload, name + index * 4)? as usize;
        let path_id = word(payload, path + index * 4)? as usize;
        blocks.push(Block {
            kind: KINDS.get(kind_id).unwrap_or(&"continuation").to_string(),
            name: strings.get(name_id).cloned().unwrap_or_default(),
            path: strings.get(path_id).cloned().unwrap_or_default(),
            start_line: word(payload, start + index * 4)?,
            end_line: word(payload, end + index * 4)?,
            source: payload
                .get(source + (index >> 3))
                .is_some_and(|value| value & (1 << (index & 7)) != 0),
        });
    }
    let file = strings.first().cloned().ok_or_else(damaged)?;
    let numbered = word(payload, 0)?;
    Ok(Some(Module {
        id: if numbered == UNNUMBERED {
            ModuleId::Name(file.clone())
        } else {
            ModuleId::Number(numbered)
        },
        file,
        digest,
        blocks,
        lands: Vec::new(),
    }))
}

fn take(at: &mut usize, width: usize) -> usize {
    let start = *at;
    *at += width;
    start
}

fn checksum(payload: &[u8]) -> u32 {
    payload
        .iter()
        .fold(2_166_136_261_u32, |hash, byte| (hash ^ u32::from(*byte)).wrapping_mul(16_777_619))
}

fn text(raw: &[u8], at: usize, length: usize) -> Result<String, String> {
    std::str::from_utf8(raw.get(at..at + length).ok_or_else(damaged)?)
        .map(str::to_owned)
        .map_err(|_| damaged())
}

fn word(raw: &[u8], at: usize) -> Result<u32, String> {
    let bytes: [u8; 4] = raw
        .get(at..at + 4)
        .ok_or_else(damaged)?
        .try_into()
        .map_err(|_| damaged())?;
    Ok(u32::from_le_bytes(bytes))
}

fn aligned(value: usize, to: usize) -> usize {
    (value + to - 1) & !(to - 1)
}

fn damaged() -> String {
    "not a variance-authority instrument record".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(kind: &str, name: &str, start_line: u32, end_line: u32) -> Block {
        Block {
            kind: kind.to_owned(),
            name: name.to_owned(),
            path: String::new(),
            start_line,
            end_line,
            source: true,
        }
    }

    #[test]
    fn a_region_one_build_cut_lands_on_the_innermost_region_both_hold() {
        let module = block("module", "", 1, 20);
        let outer = block("function", "outer", 2, 10);
        let inner = block("function", "inner", 12, 15);
        let branch = block("branch", "", 4, 6);
        let one = [module.clone(), outer.clone(), inner.clone()];
        let two = [module.clone(), outer.clone(), branch, inner.clone()];
        let reconciled = reconcile(&[&one, &two]);
        assert!(reconciled.blocks == [module, outer, inner]);
        assert_eq!(reconciled.lands, [vec![0, 1, 2], vec![0, 1, 1, 2]]);
        assert_eq!(by_ordinal(&reconciled.lands), [vec![0], vec![1], vec![1, 2], vec![2]]);
    }

    #[test]
    fn a_region_nothing_shared_encloses_lands_on_the_whole_file() {
        let shared = block("function", "shared", 2, 4);
        let one = [block("module", "a", 1, 10), shared.clone()];
        let two = [block("module", "b", 1, 12), shared.clone()];
        let reconciled = reconcile(&[&one, &two]);
        assert_eq!(reconciled.blocks.len(), 2);
        let whole = &reconciled.blocks[1];
        assert_eq!((whole.start_line, whole.end_line, whole.source), (1, 12, true));
        assert_eq!(reconciled.lands, [vec![1, 0], vec![1, 0]]);
    }
}
