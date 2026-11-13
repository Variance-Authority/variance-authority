//! One case's readings as `readings-bytes.ts` stores them, read and written
//! where `combine` folds a shard whose index holds a case's regions otherwise
//! than the combined index does: the newest reading, stored as its difference
//! from its shard's index, is laid again over the combined one, as
//! `case-readings.ts` lays it. The earlier readings stand on the newest, which
//! reads back the same, so they are kept as they are.

use std::collections::{HashMap, HashSet};

use crate::case_lines;
use crate::order;
use crate::case_shard::{self, put, Inventory, Shard, Varints};
use crate::crossing_sets::{set_holds, set_slice};

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

/// Whether a case's newest reading is stored as a difference from the index
/// that names some change, read off its first flags alone: a newest stored
/// whole stands on no index, and one stored as its count alone reads as the
/// index holds the case, as it does on `main`.
fn newest_differs(bytes: &[u8]) -> Result<bool, String> {
    let mut read = Varints::new(bytes);
    for _ in 0..read.take()? {
        let length = read.take()?;
        read.bytes(length)?;
    }
    if read.take()? == 0 {
        return Ok(false);
    }
    read.take()?;
    let flags = read.take()?;
    Ok(flags & REGIONS == 0 && flags & (GONE | VALUES | ADDED) != 0)
}

#[cfg(test)]
thread_local! {
    /// How many cases' regions were laid out, so a test can see a fold that needed none lay out none.
    pub(crate) static EXPANDED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// The regions `shard`, its cuts in `inventories`, holds of the case at `row`,
/// as `readsOf` reads them: in module and region order, each with the value
/// the case's lines give it. Only this case's regions are laid out.
fn case_regions(shard: &Shard, inventories: &HashMap<String, Vec<Inventory>>, row: u32) -> Result<Vec<Region>, String> {
    #[cfg(test)]
    EXPANDED.with(|expanded| expanded.set(expanded.get() + 1));
    let lines = case_lines::decode(&shard.lines[row as usize])?;
    let mut read = Vec::new();
    for (place, module) in shard.modules.iter().enumerate() {
        let blocks = &cut_of(inventories, &module.file, module.inventory)?.blocks;
        for (block, set) in module.called.iter().enumerate() {
            if !set_holds(set_slice(&shard.set_bytes, &shard.set_offsets, *set)?, shard.tests.len(), row)? {
                continue;
            }
            let region = blocks.get(block).ok_or_else(|| format!("the case index names a region of `{}` its cut does not hold", module.file))?;
            read.push(Region {
                module: module.file.clone(),
                name: region.name.clone(),
                path: region.path.clone(),
                start: u64::from(region.start_line),
                end: u64::from(region.end_line),
                value: lines.as_ref().and_then(|lines| case_lines::value_at(lines, place as u32, block as u32)),
            });
        }
    }
    Ok(read)
}

fn cut_of<'a>(inventories: &'a HashMap<String, Vec<Inventory>>, file: &str, at: usize) -> Result<&'a Inventory, String> {
    inventories.get(file).and_then(|cuts| cuts.get(at)).ok_or_else(|| format!("the case index names a cut of `{file}` it does not hold"))
}

/// A case of one shard whose newest the combined index may read otherwise:
/// its own id, and its bytes with the newest written whole.
pub(crate) struct Owed {
    pub id: String,
    pub whole: Vec<u8>,
}

/// The cases of one shard's readings whose newest a fold may read otherwise
/// than the shard did: stored as a difference from the shard's index, and
/// crossing a file the shards cut more than one way, the only file whose
/// regions the fold reconciles (or any file, where the shard did not lay its
/// modules in the fold's order). Each is read over the shard's index one at a
/// time and kept as the bytes `main` keeps it in, its newest whole. A shard
/// whose cases cross no such file lays out no case's regions.
pub(crate) fn owed(shard: &Shard, inventories: &HashMap<String, Vec<Inventory>>, cases: &[(String, &[u8])]) -> Result<Vec<Owed>, String> {
    let mut differing: HashMap<&str, &[u8]> = HashMap::new();
    for (id, bytes) in cases {
        if newest_differs(bytes)? {
            differing.insert(id.as_str(), *bytes);
        }
    }
    // The fold lays modules in file order; a shard that laid them otherwise would read every case's regions in another order.
    let ordered = shard.modules.windows(2).all(|pair| order::code_unit(&pair[0].file, &pair[1].file).is_lt());
    let recut: Vec<&case_shard::ShardModule> =
        shard.modules.iter().filter(|module| !ordered || inventories.get(&module.file).is_some_and(|cuts| cuts.len() > 1)).collect();
    if differing.is_empty() || recut.is_empty() {
        return Ok(Vec::new());
    }
    let mut owed = Vec::new();
    for (row, test) in shard.tests.iter().enumerate() {
        let Some(bytes) = differing.get(test.id.as_str()) else { continue };
        let row = row as u32;
        let mut crosses = false;
        'modules: for module in &recut {
            for set in &module.called {
                if set_holds(set_slice(&shard.set_bytes, &shard.set_offsets, *set)?, shard.tests.len(), row)? {
                    crosses = true;
                    break 'modules;
                }
            }
        }
        if !crosses {
            continue;
        }
        let mut stored = decode_case(bytes)?;
        let newest = applied(&stored[0], &case_regions(shard, inventories, row)?);
        stored[0] = Stored { count: stored[0].count, stopped: stored[0].stopped, regions: Some(newest), ..Stored::default() };
        owed.push(Owed { id: test.id.clone(), whole: case_bytes(&stored) });
    }
    Ok(owed)
}

/// Each owed case, by its shard and its own id, laid over the combined index
/// in `combined` as `packed` lays a newest: as its difference from the
/// regions that index holds of the case, or whole where that costs fewer
/// bytes. Cases are laid one at a time; with none owed, nothing is read.
pub(crate) fn laid_again(
    owed: Vec<(String, Vec<Owed>)>,
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
    let wanted: HashSet<String> = owed.iter().flat_map(|(shard, cases)| cases.iter().map(|case| name(shard, &case.id))).collect();
    let rows: HashMap<&str, u32> = index.tests.iter().enumerate().filter(|(_, test)| wanted.contains(&test.id)).map(|(row, test)| (test.id.as_str(), row as u32)).collect();
    for (shard, cases) in owed {
        for case in cases {
            let row = *rows.get(name(&shard, &case.id).as_str()).ok_or_else(|| format!("{shard}: the combined index does not record `{}`", case.id))?;
            let to = case_regions(&index, &inventories, row)?;
            let whole = decode_case(&case.whole)?;
            let newest = whole[0].regions.as_deref().unwrap_or_default();
            let mut differing = whole.clone();
            differing[0] = Stored { count: whole[0].count, stopped: whole[0].stopped, ..against(newest, &to) };
            let differing = case_bytes(&differing);
            laid.insert((shard.clone(), case.id), if differing.len() <= case.whole.len() { differing } else { case.whole });
        }
    }
    Ok(laid)
}

#[cfg(test)]
#[path = "case_readings_tests.rs"]
mod tests;
