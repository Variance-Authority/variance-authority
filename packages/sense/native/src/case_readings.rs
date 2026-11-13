//! One case's readings as `readings-bytes.ts` stores them, read and written
//! where `combine` folds a shard whose index holds a case's regions otherwise
//! than the combined index does: the newest reading, stored as its difference
//! from its shard's index, is laid again over the combined one, as
//! `case-readings.ts` lays it. The earlier readings stand on the newest, which
//! reads back the same, so they are kept as they are.

use std::collections::{HashMap, HashSet};

use crate::case_lines;
use crate::case_shard::{self, put, Inventory, Shard, Varints};
use crate::record_parts;
use crate::crossing_sets::{decode_set, set_slice};

const STOPPED: u64 = 1;
const STOPS: u64 = 2;
const REGIONS: u64 = 4;
const GONE: u64 = 8;
const VALUES: u64 = 16;
const ADDED: u64 = 32;

/// One region a reading crossed: `ReadRegion`'s module, name, path, lines and value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Region {
    pub module: String,
    pub name: String,
    pub path: String,
    pub start: u64,
    pub end: u64,
    pub value: Option<u64>,
}

impl Region {
    fn key(&self) -> (&str, &str, &str, u64, u64) {
        (&self.module, &self.name, &self.path, self.start, self.end)
    }
}

/// A reading as stored: `StoredReading`.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Stored {
    pub count: u64,
    pub stopped: Option<bool>,
    pub regions: Option<Vec<Region>>,
    pub gone: Option<Vec<u64>>,
    pub values: Option<Vec<(u64, Option<u64>)>>,
    pub added: Option<Vec<(u64, Region)>>,
}

/// One case's stored readings off its bytes, as `decodeCase` reads them.
pub(crate) fn decode_case(bytes: &[u8]) -> Result<Vec<Stored>, String> {
    let mut read = Varints::new(bytes);
    let count = read.take()?;
    let mut strings = Vec::new();
    for _ in 0..count {
        let length = read.take()?;
        strings.push(String::from_utf8(read.bytes(length)?.to_vec()).map_err(|error| error.to_string())?);
    }
    let string = |read: &mut Varints| -> Result<String, String> {
        strings.get(read.take()? as usize).cloned().ok_or_else(|| "a reading names a string it does not hold".to_owned())
    };
    let value = |read: &mut Varints| -> Result<Option<u64>, String> { Ok(read.take()?.checked_sub(1)) };
    let region = |read: &mut Varints| -> Result<Region, String> {
        Ok(Region { module: string(read)?, name: string(read)?, path: string(read)?, start: read.take()?, end: read.take()?, value: value(read)? })
    };
    // Every item takes a byte at least, so a count past what is left is refused before room is made for it.
    let length = |read: &mut Varints| -> Result<u64, String> {
        let count = read.take()?;
        if count as usize > read.left() { Err("a reading states more items than it holds".to_owned()) } else { Ok(count) }
    };
    let mut readings = Vec::new();
    for _ in 0..read.take()? {
        let mut reading = Stored { count: read.take()?, ..Stored::default() };
        let flags = read.take()?;
        if flags & STOPPED != 0 {
            reading.stopped = Some(flags & STOPS != 0);
        }
        if flags & REGIONS != 0 {
            reading.regions = Some((0..length(&mut read)?).map(|_| region(&mut read)).collect::<Result<_, _>>()?);
        }
        if flags & GONE != 0 {
            let mut at: i64 = -1;
            reading.gone = Some((0..length(&mut read)?).map(|_| {
                at += read.take()? as i64 + 1;
                Ok(at as u64)
            }).collect::<Result<_, String>>()?);
        }
        if flags & VALUES != 0 {
            reading.values = Some((0..length(&mut read)?).map(|_| Ok((read.take()?, value(&mut read)?))).collect::<Result<_, String>>()?);
        }
        if flags & ADDED != 0 {
            reading.added = Some((0..length(&mut read)?).map(|_| Ok((read.take()?, region(&mut read)?))).collect::<Result<_, String>>()?);
        }
        readings.push(reading);
    }
    read.end()?;
    Ok(readings)
}

/// One case's bytes, as `caseBytes` writes them: the strings in the order the
/// readings first name them, then the readings.
pub(crate) fn case_bytes(readings: &[Stored]) -> Vec<u8> {
    let mut out = Body { strings: Vec::new(), places: HashMap::new(), bytes: Vec::new() };
    put(&mut out.bytes, readings.len() as u64);
    for reading in readings {
        put(&mut out.bytes, reading.count);
        let flags = reading.stopped.map_or(0, |stops| STOPPED | if stops { STOPS } else { 0 })
            | if reading.regions.is_some() { REGIONS } else { 0 }
            | if reading.gone.is_some() { GONE } else { 0 }
            | if reading.values.is_some() { VALUES } else { 0 }
            | if reading.added.is_some() { ADDED } else { 0 };
        put(&mut out.bytes, flags);
        if let Some(regions) = &reading.regions {
            put(&mut out.bytes, regions.len() as u64);
            for region in regions {
                out.region(region);
            }
        }
        if let Some(gone) = &reading.gone {
            put(&mut out.bytes, gone.len() as u64);
            let mut before: i64 = -1;
            for at in gone {
                put(&mut out.bytes, (*at as i64 - before - 1) as u64);
                before = *at as i64;
            }
        }
        if let Some(values) = &reading.values {
            put(&mut out.bytes, values.len() as u64);
            for (at, held) in values {
                put(&mut out.bytes, *at);
                out.value(*held);
            }
        }
        if let Some(added) = &reading.added {
            put(&mut out.bytes, added.len() as u64);
            for (at, region) in added {
                put(&mut out.bytes, *at);
                out.region(region);
            }
        }
    }
    let mut bytes = Vec::new();
    put(&mut bytes, out.strings.len() as u64);
    for value in out.strings {
        put(&mut bytes, value.len() as u64);
        bytes.extend_from_slice(value.as_bytes());
    }
    bytes.extend_from_slice(&out.bytes);
    bytes
}

/// The readings' bytes as they are written, and the strings they name so far.
struct Body<'a> {
    strings: Vec<&'a str>,
    places: HashMap<&'a str, u64>,
    bytes: Vec<u8>,
}

impl<'a> Body<'a> {
    fn string(&mut self, value: &'a str) {
        let next = self.strings.len() as u64;
        let place = *self.places.entry(value).or_insert(next);
        if place == next {
            self.strings.push(value);
        }
        put(&mut self.bytes, place);
    }

    fn value(&mut self, held: Option<u64>) {
        put(&mut self.bytes, held.map_or(0, |held| held + 1));
    }

    fn region(&mut self, region: &'a Region) {
        self.string(&region.module);
        self.string(&region.name);
        self.string(&region.path);
        put(&mut self.bytes, region.start);
        put(&mut self.bytes, region.end);
        self.value(region.value);
    }
}

/// What `regions` crossed otherwise than `base`, as `difference` writes it:
/// regions the base names alike pair in order.
fn difference(regions: &[Region], base: &[Region]) -> Stored {
    let mut places: HashMap<(&str, &str, &str, u64, u64), std::collections::VecDeque<usize>> = HashMap::new();
    for (at, region) in base.iter().enumerate() {
        places.entry(region.key()).or_default().push_back(at);
    }
    let mut crossed = HashSet::new();
    let (mut values, mut added) = (Vec::new(), Vec::new());
    for (at, region) in regions.iter().enumerate() {
        match places.get_mut(&region.key()).and_then(std::collections::VecDeque::pop_front) {
            None => added.push((at as u64, region.clone())),
            Some(from) => {
                crossed.insert(from);
                if base[from].value != region.value {
                    values.push((from as u64, region.value));
                }
            }
        }
    }
    let gone: Vec<u64> = (0..base.len()).filter(|at| !crossed.contains(at)).map(|at| at as u64).collect();
    Stored {
        gone: (!gone.is_empty()).then_some(gone),
        values: (!values.is_empty()).then_some(values),
        added: (!added.is_empty()).then_some(added),
        ..Stored::default()
    }
}

/// The regions `stored` names over `base`, as `applied` reads them; its own where it holds them.
fn applied(stored: &Stored, base: &[Region]) -> Vec<Region> {
    if let Some(regions) = &stored.regions {
        return regions.clone();
    }
    let charged: HashMap<u64, Option<u64>> = stored.values.iter().flatten().copied().collect();
    let dropped: HashSet<u64> = stored.gone.iter().flatten().copied().collect();
    let mut own: Vec<Region> = base
        .iter()
        .enumerate()
        .filter(|(place, _)| !dropped.contains(&(*place as u64)))
        .map(|(place, region)| match charged.get(&(place as u64)) {
            Some(value) => Region { value: *value, ..region.clone() },
            None => region.clone(),
        })
        .collect();
    for (place, region) in stored.added.iter().flatten() {
        own.insert((*place as usize).min(own.len()), region.clone());
    }
    own
}

/// `regions` as their difference from `base`, or whole where the difference would not read back as them.
fn against(regions: &[Region], base: &[Region]) -> Stored {
    let held = difference(regions, base);
    if applied(&held, base) == regions { held } else { Stored { regions: Some(regions.to_vec()), ..Stored::default() } }
}

/// A case's bytes with its newest reading, stored over `from`, laid again over
/// `to`: as its difference from `to`, or whole where that costs fewer bytes,
/// as `packed` chooses. A newest stored whole stands on no index and is kept.
pub(crate) fn rebased(bytes: &[u8], from: &[Region], to: &[Region]) -> Result<Option<Vec<u8>>, String> {
    let stored = decode_case(bytes)?;
    let Some(first) = stored.first().filter(|first| first.regions.is_none()) else {
        return Ok(None);
    };
    let newest = applied(first, from);
    let head = Stored { count: first.count, stopped: first.stopped, ..Stored::default() };
    let mut whole = stored.clone();
    whole[0] = Stored { regions: Some(newest.clone()), ..head.clone() };
    let mut differing = stored;
    differing[0] = Stored { count: head.count, stopped: head.stopped, ..against(&newest, to) };
    let (whole, differing) = (case_bytes(&whole), case_bytes(&differing));
    Ok(Some(if differing.len() <= whole.len() { differing } else { whole }))
}

/// Whether a case's newest reading is stored as its difference from the index, so it stands on the index's regions.
pub(crate) fn stands_on_index(bytes: &[u8]) -> Result<bool, String> {
    Ok(decode_case(bytes)?.first().is_some_and(|first| first.regions.is_none()))
}

/// The regions `shard`, its cuts in `inventories`, holds of each case `wanted`
/// names, as `readsOf` reads them: in module and region order, each with the
/// value the case's lines give it.
pub(crate) fn regions_of(shard: &Shard, inventories: &HashMap<String, Vec<Inventory>>, wanted: &HashSet<String>) -> Result<HashMap<String, Vec<Region>>, String> {
    let rows: HashMap<u32, (&str, Option<case_lines::Lines>)> = shard
        .tests
        .iter()
        .enumerate()
        .filter(|(_, test)| wanted.contains(&test.id))
        .map(|(row, test)| Ok((row as u32, (test.id.as_str(), case_lines::decode(&shard.lines[row])?))))
        .collect::<Result<_, String>>()?;
    let mut read: HashMap<String, Vec<Region>> = rows.values().map(|(id, _)| ((*id).to_owned(), Vec::new())).collect();
    if rows.is_empty() {
        return Ok(read);
    }
    for (place, module) in shard.modules.iter().enumerate() {
        let blocks = &inventories
            .get(&module.file)
            .and_then(|cuts| cuts.get(module.inventory))
            .ok_or_else(|| format!("the case index names a cut of `{}` it does not hold", module.file))?
            .blocks;
        for (block, set) in module.called.iter().enumerate() {
            for row in decode_set(set_slice(&shard.set_bytes, &shard.set_offsets, *set)?, shard.tests.len())? {
                let Some((id, lines)) = rows.get(&row) else { continue };
                let region = blocks.get(block).ok_or_else(|| format!("the case index names a region of `{}` its cut does not hold", module.file))?;
                read.get_mut(*id).expect("every wanted row is held").push(Region {
                    module: module.file.clone(),
                    name: region.name.clone(),
                    path: region.path.clone(),
                    start: u64::from(region.start_line),
                    end: u64::from(region.end_line),
                    value: lines.as_ref().and_then(|lines| case_lines::value_at(lines, place as u32, block as u32)),
                });
            }
        }
    }
    Ok(read)
}

/// The cases of one shard's readings `section` whose newest stands on the
/// shard's index, each with its bytes and the regions that index holds of it.
pub(crate) fn owed(shard: &Shard, inventories: &HashMap<String, Vec<Inventory>>, section: &[u8]) -> Result<Vec<(String, Vec<u8>, Vec<Region>)>, String> {
    // An earlier build's JSON holds no readings; bytes this build cannot read are the fold's to refuse.
    if section.starts_with(b"{\"") {
        return Ok(Vec::new());
    }
    let Ok(read) = record_parts::read_readings(section) else { return Ok(Vec::new()) };
    let mut standing = Vec::new();
    for (id, bytes) in read.cases {
        if stands_on_index(bytes)? {
            standing.push((id, bytes.to_vec()));
        }
    }
    let wanted = standing.iter().map(|(id, _)| id.clone()).collect();
    let mut regions = regions_of(shard, inventories, &wanted)?;
    Ok(standing.into_iter().map(|(id, bytes)| {
        let from = regions.remove(&id).unwrap_or_default();
        (id, bytes, from)
    }).collect())
}

/// Each owed case, by its shard and its own id, laid again over the combined
/// index in `combined` where that index holds its regions otherwise than the
/// shard's did; a case it holds alike is left to be copied as it is.
pub(crate) fn laid_again(
    owed: Vec<(String, Vec<(String, Vec<u8>, Vec<Region>)>)>,
    combined: &[u8],
    renamed: &HashMap<String, HashMap<String, String>>,
) -> Result<HashMap<(String, String), Vec<u8>>, String> {
    let mut laid = HashMap::new();
    if owed.iter().all(|(_, cases)| cases.is_empty()) {
        return Ok(laid);
    }
    let mut inventories = HashMap::new();
    let index = case_shard::read_shard(combined, &mut inventories)?;
    let unrenamed = HashMap::new();
    let name = |shard: &str, id: &str| renamed.get(shard).unwrap_or(&unrenamed).get(id).cloned().unwrap_or_else(|| id.to_owned());
    let wanted = owed.iter().flat_map(|(shard, cases)| cases.iter().map(|(id, _, _)| name(shard, id))).collect();
    let there = regions_of(&index, &inventories, &wanted)?;
    for (shard, cases) in owed {
        for (id, bytes, from) in cases {
            let to = there.get(&name(&shard, &id)).map_or(&[][..], Vec::as_slice);
            if from != to {
                if let Some(again) = rebased(&bytes, &from, to)? {
                    laid.insert((shard.clone(), id), again);
                }
            }
        }
    }
    Ok(laid)
}

#[cfg(test)]
#[path = "case_readings_tests.rs"]
mod tests;
