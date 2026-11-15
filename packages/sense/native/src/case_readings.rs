//! One case's readings as the readings section stores them, read and written
//! where `combine` folds a shard whose index holds a case's regions otherwise
//! than the combined index does: the newest reading, stored as its difference
//! from its shard's index, is laid again over the combined one, as
//! `case_readings_lay.rs` lays it. The earlier readings stand on the newest, which
//! reads back the same, so they are kept as they are.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use rustc_hash::{FxHashMap, FxHashSet};

use crate::order;
use crate::case_shard::{self, put, Inventory, Shard, Varints};
use crate::case_regions::{regions_of, Cuts};
use crate::crossing_sets::{set_holds, set_slice};

const STOPPED: u64 = 1;
const STOPS: u64 = 2;
const REGIONS: u64 = 4;
const GONE: u64 = 8;
const VALUES: u64 = 16;
const ADDED: u64 = 32;

/// One region a reading crossed: `ReadRegion`'s module, name, path, lines and
/// value. Its strings are shared, since every reading of a case repeats them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Region {
    pub module: Arc<str>,
    pub name: Arc<str>,
    pub path: Arc<str>,
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
        strings.push(Arc::<str>::from(std::str::from_utf8(read.bytes(length)?).map_err(|error| error.to_string())?));
    }
    let string = |read: &mut Varints| -> Result<Arc<str>, String> {
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

/// One case's bytes, as `decodeCase` reads them: the strings in the order the
/// readings first name them, then the readings.
pub(crate) fn case_bytes(readings: &[Stored]) -> Vec<u8> {
    case_bytes_of(readings.len(), readings.iter().map(Stored::view))
}

/// A reading as stored, borrowed: what `case_bytes` writes.
#[derive(Clone, Copy, Default)]
pub(crate) struct StoredView<'a> {
    pub count: u64,
    pub stopped: Option<bool>,
    pub regions: Option<&'a [Region]>,
    pub gone: Option<&'a [u64]>,
    pub values: Option<&'a [(u64, Option<u64>)]>,
    pub added: Option<&'a [(u64, Region)]>,
}

impl Stored {
    pub(crate) fn view(&self) -> StoredView<'_> {
        StoredView {
            count: self.count,
            stopped: self.stopped,
            regions: self.regions.as_deref(),
            gone: self.gone.as_deref(),
            values: self.values.as_deref(),
            added: self.added.as_deref(),
        }
    }
}

/// `case_bytes` over `count` borrowed readings.
pub(crate) fn case_bytes_of<'a>(count: usize, readings: impl Iterator<Item = StoredView<'a>>) -> Vec<u8> {
    let mut out = Body { strings: Vec::new(), places: FxHashMap::default(), shared: FxHashMap::default(), bytes: Vec::new() };
    put(&mut out.bytes, count as u64);
    for reading in readings {
        put(&mut out.bytes, reading.count);
        let flags = reading.stopped.map_or(0, |stops| STOPPED | if stops { STOPS } else { 0 })
            | if reading.regions.is_some() { REGIONS } else { 0 }
            | if reading.gone.is_some() { GONE } else { 0 }
            | if reading.values.is_some() { VALUES } else { 0 }
            | if reading.added.is_some() { ADDED } else { 0 };
        put(&mut out.bytes, flags);
        if let Some(regions) = reading.regions {
            put(&mut out.bytes, regions.len() as u64);
            for region in regions {
                out.region(region);
            }
        }
        if let Some(gone) = reading.gone {
            put(&mut out.bytes, gone.len() as u64);
            let mut before: i64 = -1;
            for at in gone {
                put(&mut out.bytes, (*at as i64 - before - 1) as u64);
                before = *at as i64;
            }
        }
        if let Some(values) = reading.values {
            put(&mut out.bytes, values.len() as u64);
            for (at, held) in values {
                put(&mut out.bytes, *at);
                out.value(*held);
            }
        }
        if let Some(added) = reading.added {
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
    places: FxHashMap<&'a str, u64>,
    /// `places` by the address of a shared string, which most strings repeat.
    shared: FxHashMap<usize, u64>,
    bytes: Vec<u8>,
}

impl<'a> Body<'a> {
    fn string(&mut self, value: &'a Arc<str>) {
        let address = Arc::as_ptr(value).cast::<u8>() as usize;
        let place = match self.shared.get(&address) {
            Some(place) => *place,
            None => {
                let next = self.strings.len() as u64;
                let place = *self.places.entry(value).or_insert(next);
                if place == next {
                    self.strings.push(value);
                }
                self.shared.insert(address, place);
                place
            }
        };
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
/// regions the base names alike pair in order. Also whether it reads back as
/// `regions` without being applied: every region paired, in the base's order.
fn difference(regions: &[Region], base: &[Region]) -> (Stored, bool) {
    let held = |gone: Vec<u64>, values: Vec<(u64, Option<u64>)>, added: Vec<(u64, Region)>| Stored {
        gone: (!gone.is_empty()).then_some(gone),
        values: (!values.is_empty()).then_some(values),
        added: (!added.is_empty()).then_some(added),
        ..Stored::default()
    };
    // Regions alike at every place pair by place, as the queues would pair them.
    if regions.len() == base.len() && regions.iter().zip(base).all(|(region, was)| region.key() == was.key()) {
        let values = regions.iter().zip(base).enumerate().filter(|(_, (region, was))| region.value != was.value).map(|(at, (region, _))| (at as u64, region.value)).collect();
        return (held(Vec::new(), values, Vec::new()), true);
    }
    let mut places: FxHashMap<(&str, &str, &str, u64, u64), std::collections::VecDeque<usize>> = FxHashMap::default();
    for (at, region) in base.iter().enumerate() {
        places.entry(region.key()).or_default().push_back(at);
    }
    let mut crossed = vec![false; base.len()];
    let (mut values, mut added) = (Vec::new(), Vec::new());
    let (mut ordered, mut last) = (true, None);
    for (at, region) in regions.iter().enumerate() {
        match places.get_mut(&region.key()).and_then(std::collections::VecDeque::pop_front) {
            None => added.push((at as u64, region.clone())),
            Some(from) => {
                crossed[from] = true;
                ordered &= last.is_none_or(|last| last < from);
                last = Some(from);
                if base[from].value != region.value {
                    values.push((from as u64, region.value));
                }
            }
        }
    }
    let gone = crossed.iter().enumerate().filter(|(_, crossed)| !**crossed).map(|(at, _)| at as u64).collect();
    let reads = ordered && added.is_empty();
    (held(gone, values, added), reads)
}

/// The regions `stored` names over `base`, as `applied` reads them; its own where it holds them.
pub(crate) fn applied(stored: &Stored, base: &[Region]) -> Vec<Region> {
    if let Some(regions) = &stored.regions {
        return regions.clone();
    }
    let charged: FxHashMap<u64, Option<u64>> = stored.values.iter().flatten().copied().collect();
    let dropped: FxHashSet<u64> = stored.gone.iter().flatten().copied().collect();
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
pub(crate) fn against(regions: &[Region], base: &[Region]) -> Stored {
    let (held, reads) = difference(regions, base);
    if reads || applied(&held, base) == regions { held } else { Stored { regions: Some(regions.to_vec()), ..Stored::default() } }
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
/// modules in the fold's order). Each is read over the shard's index, all of
/// them in one walk, and kept as the bytes `main` keeps it in, its newest whole. A shard
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
    let mut rows = Vec::new();
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
        if crosses {
            rows.push((row, &test.id, *bytes));
        }
    }
    let regions = regions_of(&Cuts::new(shard, inventories)?, &rows.iter().map(|(row, _, _)| *row).collect::<Vec<_>>())?;
    let mut owed = Vec::new();
    for ((_, id, bytes), regions) in rows.into_iter().zip(regions) {
        let mut stored = decode_case(bytes)?;
        let newest = applied(&stored[0], &regions);
        stored[0] = Stored { count: stored[0].count, stopped: stored[0].stopped, regions: Some(newest), ..Stored::default() };
        owed.push(Owed { id: id.clone(), whole: case_bytes(&stored) });
    }
    Ok(owed)
}

/// Each owed case, by its shard and its own id, laid over the combined index
/// in `combined` as `packed` lays a newest: as its difference from the
/// regions that index holds of the case, or whole where that costs fewer
/// bytes. Their regions are laid out in one walk; with none owed, nothing is read.
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
    let owed: Vec<(String, Owed, u32)> = owed
        .into_iter()
        .flat_map(|(shard, cases)| cases.into_iter().map(move |case| (shard.clone(), case)))
        .map(|(shard, case)| {
            let row = *rows.get(name(&shard, &case.id).as_str()).ok_or_else(|| format!("{shard}: the combined index does not record `{}`", case.id))?;
            Ok((shard, case, row))
        })
        .collect::<Result<_, String>>()?;
    // Two shards may owe one case, which is laid out once.
    let mut distinct: Vec<u32> = owed.iter().map(|(_, _, row)| *row).collect();
    distinct.sort_unstable();
    distinct.dedup();
    let regions = regions_of(&Cuts::new(&index, &inventories)?, &distinct)?;
    for (shard, case, row) in owed {
        let to = &regions[distinct.binary_search(&row).unwrap_or_else(|_| unreachable!())];
        let whole = decode_case(&case.whole)?;
        let newest = whole[0].regions.as_deref().unwrap_or_default();
        let mut differing = whole.clone();
        differing[0] = Stored { count: whole[0].count, stopped: whole[0].stopped, ..against(newest, to) };
        let differing = case_bytes(&differing);
        laid.insert((shard, case.id), if differing.len() <= case.whole.len() { differing } else { case.whole });
    }
    Ok(laid)
}

#[cfg(test)]
#[path = "case_readings_tests.rs"]
mod tests;
