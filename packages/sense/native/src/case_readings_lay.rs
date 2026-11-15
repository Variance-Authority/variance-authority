//! A run's case readings laid over the ones the record kept, as
//! `case-readings.ts` asks for them: a rerun keeps the readings it replaces
//! while its test file ran over the same inputs and every module either
//! reading entered stands at the same text, and the section is written by
//! `record_parts::write_readings`, each case's newest against the regions the
//! landed index holds of it.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use rayon::prelude::*;

use crate::case_lines;
use crate::case_readings::{against, applied, case_bytes_of, decode_case, Region, Stored, StoredView};
use crate::case_regions::{regions_of, Walked};
use crate::case_shard::{string, strings};
use crate::journey_columns::{self, Decoded};
use crate::record_layout::LAYOUT;
use crate::record_parts::{read_readings, write_readings};


/// One recorded run of one case, and how many runs read it so.
#[derive(Clone)]
pub(crate) struct Reading {
    pub count: u64,
    pub stopped: Option<bool>,
    pub regions: Vec<Region>,
}

/// What a case's reading is, read off an index.
struct Read {
    file: String,
    stopped: Option<bool>,
    regions: Vec<Region>,
    /// The modules its regions are in, each once.
    modules: Vec<Arc<str>>,
}

/// The columns of a case index a reading is read from.
struct Index {
    strings: Vec<String>,
    /// `strings`, shared by the regions that name them.
    shared: Vec<Arc<str>>,
    ids: Vec<u32>,
    files: Vec<u32>,
    stopped: Option<Vec<u8>>,
    lines: Option<(Vec<u8>, Vec<u32>)>,
    module_files: Vec<u32>,
    module_blocks: Vec<u32>,
    called: Vec<u32>,
    names: Vec<u32>,
    paths: Vec<u32>,
    starts: Vec<u32>,
    ends: Vec<u32>,
    set_bytes: Vec<u8>,
    set_offsets: Vec<u32>,
}

/// The index in `bytes`; absent where it is written at a version this build does not read.
fn open(bytes: &[u8]) -> Result<Option<Index>, String> {
    let cases = &LAYOUT.cases;
    let wanted = [
        "strings.blob", "strings.off", "tests.id", "tests.file", "tests.stopped", cases.lines.as_str(), cases.lines_offsets.as_str(),
        "modules.file", "modules.blocks", "blocks.calledSet", "blocks.name", "blocks.path", "blocks.start", "blocks.end", "sets.blob", "sets.off",
    ];
    let (version, decoded) = journey_columns::decode_wanted(bytes, &wanted)?;
    if version != cases.format && version != cases.loaded_sets {
        return Ok(None);
    }
    let optional = |decoded: &Decoded, name: &str| if decoded.has(name) { decoded.bytes(name).map(Some) } else { Ok(None) };
    let strings = strings(&decoded)?;
    let index = Index {
        shared: strings.iter().map(|value| Arc::from(value.as_str())).collect(),
        strings,
        ids: decoded.words("tests.id")?,
        files: decoded.words("tests.file")?,
        stopped: optional(&decoded, "tests.stopped")?,
        lines: if decoded.has(&cases.lines) { Some((decoded.bytes(&cases.lines)?, decoded.words(&cases.lines_offsets)?)) } else { None },
        module_files: decoded.words("modules.file")?,
        module_blocks: decoded.words("modules.blocks")?,
        called: decoded.words("blocks.calledSet")?,
        names: decoded.words("blocks.name")?,
        paths: decoded.words("blocks.path")?,
        starts: decoded.words("blocks.start")?,
        ends: decoded.words("blocks.end")?,
        set_bytes: decoded.bytes("sets.blob")?,
        set_offsets: decoded.words("sets.off")?,
    };
    let count = index.ids.len();
    if index.files.len() != count
        || index.stopped.as_ref().is_some_and(|column| column.len() != count)
        || index.lines.as_ref().is_some_and(|(_, offsets)| offsets.len() != count + 1)
    {
        return Err("test columns disagree".to_owned());
    }
    let blocks = index.called.len();
    // Every block belongs to a module: a region left outside every range would be read as crossed by nobody.
    if index.module_blocks.len() != index.module_files.len() + 1
        || index.module_blocks.first().is_some_and(|first| *first != 0)
        || index.module_blocks.last().is_some_and(|last| *last as usize != blocks)
        || [index.names.len(), index.paths.len(), index.starts.len(), index.ends.len()].into_iter().any(|length| length != blocks)
        || index.module_blocks.windows(2).any(|bounds| bounds[1] < bounds[0] || bounds[1] as usize > blocks)
    {
        return Err("module columns disagree".to_owned());
    }
    Ok(Some(index))
}

impl Index {
    fn shared(&self, id: u32) -> Result<Arc<str>, String> {
        self.shared.get(id as usize).cloned().ok_or_else(|| format!("journey string id {id} is out of bounds"))
    }

    fn modules(&self) -> Result<Vec<&str>, String> {
        self.module_files.iter().map(|file| string(&self.strings, *file)).collect()
    }

    fn test_files(&self) -> Result<HashSet<&str>, String> {
        self.files.iter().map(|file| string(&self.strings, *file)).collect()
    }

    /// The readings of the cases `wanted` names, by id, their regions as
    /// `regions_of` lays them out. An id held twice reads as its last row, as
    /// a map keyed by id keeps it.
    fn reads(&self, wanted: &HashSet<&str>) -> Result<HashMap<String, Read>, String> {
        let mut by_id: HashMap<&str, u32> = HashMap::new();
        for (row, id) in self.ids.iter().enumerate() {
            let id = string(&self.strings, *id)?;
            if wanted.contains(id) {
                by_id.insert(id, row as u32);
            }
        }
        let rows: Vec<u32> = by_id.values().copied().collect();
        let regions = regions_of(self, &rows)?;
        rows.into_iter()
            .zip(regions)
            .map(|(row, regions)| {
                let stopped = match self.stopped.as_ref().map(|column| column[row as usize]) {
                    None | Some(0) => None,
                    Some(1) => Some(false),
                    Some(2) => Some(true),
                    Some(_) => return Err("a case's settling is not one this build reads".to_owned()),
                };
                let mut modules: Vec<Arc<str>> = Vec::new();
                for region in &regions {
                    if modules.last().is_none_or(|last| !Arc::ptr_eq(last, &region.module)) {
                        modules.push(region.module.clone());
                    }
                }
                let read = Read { file: string(&self.strings, self.files[row as usize])?.to_owned(), stopped, regions, modules };
                Ok((string(&self.strings, self.ids[row as usize])?.to_owned(), read))
            })
            .collect()
    }
}

impl Walked for Index {
    fn cases(&self) -> usize {
        self.ids.len()
    }

    fn modules(&self) -> usize {
        self.module_files.len()
    }

    fn module(&self, place: usize) -> Result<Arc<str>, String> {
        self.shared(self.module_files[place])
    }

    fn called(&self, place: usize) -> &[u32] {
        &self.called[self.module_blocks[place] as usize..self.module_blocks[place + 1] as usize]
    }

    fn region(&self, place: usize, block: usize) -> Result<(Arc<str>, Arc<str>, u64, u64), String> {
        let at = self.module_blocks[place] as usize + block;
        Ok((self.shared(self.names[at])?, self.shared(self.paths[at])?, u64::from(self.starts[at]), u64::from(self.ends[at])))
    }

    fn sets(&self) -> (&[u8], &[u32]) {
        (&self.set_bytes, &self.set_offsets)
    }

    fn lines(&self, row: u32) -> Result<Option<case_lines::Lines>, String> {
        let Some((blob, offsets)) = &self.lines else { return Ok(None) };
        let (from, to) = (offsets[row as usize] as usize, offsets[row as usize + 1] as usize);
        if to < from || to > blob.len() {
            return Err("case lines bounds are invalid".to_owned());
        }
        case_lines::decode(&blob[from..to])
    }
}

/// What a run tells the readings of the cases it ran: `ReadingsRun`.
pub(crate) struct Run<'a> {
    pub fresh: &'a [u8],
    pub announced: HashSet<String>,
    pub same: HashSet<String>,
    pub inputs: Option<HashMap<String, String>>,
}

/// The readings section once `run` is laid over `previous` into `landed`, as
/// `layReadings` documents it; absent when no case holds a reading the index
/// does not, and no file has inputs to name.
pub(crate) fn lay(kept: Option<&[u8]>, previous: Option<&[u8]>, landed: Option<&[u8]>, cases: &HashSet<String>, run: Option<&Run>) -> Result<Option<Vec<u8>>, String> {
    // The three indexes are independent until the readings meet, so each is opened and read on its own thread.
    let ((before, kept), (fresh, opened)) = rayon::join(
        || rayon::join(|| previous.map(open).transpose(), || kept.map(read_readings).transpose().map_err(refused)),
        || rayon::join(|| run.map(|run| open(run.fresh)).transpose(), || landed.map(open).transpose()),
    );
    let (before, opened) = (before?.flatten(), opened?.flatten());
    let (stored, held) = kept?.map_or_else(|| (Vec::new(), HashMap::new()), |section| (section.cases, section.inputs.into_iter().collect::<HashMap<_, _>>()));
    let fresh = match fresh? {
        None => None,
        Some(index) => Some(index.ok_or_else(|| "a case fold wrote an index it cannot open".to_owned())?),
    };
    let recorded = fresh.as_ref().map(Index::modules).transpose()?.unwrap_or_default();
    let nothing = HashSet::new();
    let ran = run.map_or(&nothing, |run| &run.announced);
    let same = |file: &str| run.is_none_or(|run| run.same.contains(file));
    // The landed index is read for every case the record holds, a superset of
    // those still holding readings, so it need not wait on them.
    let known: HashSet<&str> = ran.iter().map(String::as_str).chain(stored.iter().map(|(id, _)| id.as_str())).collect();
    let reads = |index: &Option<Index>, wanted: &HashSet<&str>| index.as_ref().map_or_else(|| Ok(HashMap::new()), |index| index.reads(wanted));
    let (held_back, (now, there)) = rayon::join(
        || -> Result<_, String> {
            let earlier = reads(&before, &known)?;
            let mut holding: HashMap<&str, Vec<Reading>> = HashMap::new();
            for (id, bytes) in &stored {
                match expanded(&decode_case(bytes).map_err(refused)?, earlier.get(id).map(|read| read.regions.as_slice())) {
                    Some(readings) if !readings.is_empty() => holding.insert(id, readings),
                    _ => holding.remove(id.as_str()),
                };
            }
            Ok((earlier, holding))
        },
        || rayon::join(|| reads(&fresh, &ran.iter().map(String::as_str).collect()), || reads(&opened, &known)),
    );
    let ((earlier, mut holding), now, there) = (held_back?, now?, there?);
    let mut laid: HashMap<String, Vec<Reading>> = HashMap::new();
    for (id, reading) in &now {
        let prior = match (holding.remove(id.as_str()), earlier.get(id)) {
            (Some(readings), _) => readings,
            (None, Some(was)) => vec![Reading { count: 1, stopped: was.stopped, regions: was.regions.clone() }],
            (None, None) => Vec::new(),
        };
        let inputs = run.and_then(|run| run.inputs.as_ref()).and_then(|inputs| inputs.get(&reading.file));
        let stands = inputs == held.get(&reading.file) && entered(earlier.get(id), &prior).chain(&reading.modules).all(|module| same(module));
        let mut readings = if prior.is_empty() || !stands { Vec::new() } else { prior };
        let found = readings.iter().position(|one| alike(one, Some(reading))).map(|at| readings.remove(at));
        let first = match found {
            None => Reading { count: 1, stopped: reading.stopped, regions: reading.regions.clone() },
            Some(found) => Reading { count: found.count + 1, ..found },
        };
        readings.insert(0, first);
        readings.truncate(LAYOUT.cases.readings);
        laid.insert(id.clone(), readings);
    }
    // A case the run did not record keeps its readings while the code they
    // read stands: a module the run recorded at another text drops them.
    let moved: HashSet<&str> = recorded.iter().copied().filter(|file| !same(file)).collect();
    for (id, readings) in holding {
        if ran.contains(id) || !cases.contains(id) {
            continue;
        }
        if !moved.is_empty() && entered(earlier.get(id), &readings).any(|module| moved.contains(&**module)) {
            continue;
        }
        laid.insert(id.to_owned(), readings);
    }
    // One run, as the index holds it, is what the index already says.
    laid.retain(|id, readings| !(readings.len() == 1 && readings[0].count == 1 && alike(&readings[0], there.get(id))));
    let files = opened.as_ref().map(Index::test_files).transpose()?.unwrap_or_default();
    // A file the run carried keeps what it ran over when it last ran.
    let read: HashSet<&str> = now.values().map(|reading| reading.file.as_str()).collect();
    let mut inputs = held.clone();
    for (file, digest) in run.and_then(|run| run.inputs.as_ref()).into_iter().flatten() {
        if read.contains(file.as_str()) {
            inputs.insert(file.clone(), digest.clone());
        }
    }
    inputs.retain(|file, _| files.contains(file.as_str()));
    if laid.is_empty() && inputs.is_empty() {
        return Ok(None);
    }
    let cases: Vec<(&str, Vec<u8>)> = laid.par_iter().map(|(id, readings)| (id.as_str(), packed(readings, there.get(id)))).collect();
    let bytes = write_readings(cases, &inputs);
    Ok(Some(bytes))
}

fn refused(error: String) -> String {
    format!("the record's readings section is not one this build reads: {error}")
}

/// A case's readings in its bytes, as `packed` lays them: each earlier one
/// against the newest, and the newest against the regions the landed index
/// holds of the case, or whole where the index holds none of it or where its
/// regions cost no more bytes.
fn packed(readings: &[Reading], there: Option<&Read>) -> Vec<u8> {
    let (newest, rest) = readings.split_first().unwrap_or_else(|| unreachable!());
    let earlier: Vec<Stored> = rest.iter().map(|reading| Stored { count: reading.count, stopped: reading.stopped, ..against(&reading.regions, &newest.regions) }).collect();
    let whole = StoredView { count: newest.count, stopped: newest.stopped, regions: Some(&newest.regions), ..StoredView::default() };
    let whole = case_bytes_of(readings.len(), std::iter::once(whole).chain(earlier.iter().map(Stored::view)));
    let Some(there) = there else { return whole };
    let differing = Stored { count: newest.count, stopped: newest.stopped, ..against(&newest.regions, &there.regions) };
    let differing = case_bytes_of(readings.len(), std::iter::once(differing.view()).chain(earlier.iter().map(Stored::view)));
    if differing.len() <= whole.len() { differing } else { whole }
}

/// A case's stored readings in full, as `expanded` reads them: the newest
/// over `base`, each earlier one over the newest; absent where the newest
/// holds no regions and `base` is absent.
fn expanded(stored: &[Stored], base: Option<&[Region]>) -> Option<Vec<Reading>> {
    let first = stored.first()?;
    if first.regions.is_none() && base.is_none() {
        return None;
    }
    let newest = applied(first, base.unwrap_or_default());
    Some(stored.iter().enumerate().map(|(at, reading)| Reading {
        count: reading.count,
        stopped: reading.stopped,
        regions: if at == 0 { newest.clone() } else { applied(reading, &newest) },
    }).collect())
}

/// Every module a case's readings entered, as often as its regions name it in a row.
fn entered<'a>(read: Option<&'a Read>, readings: &'a [Reading]) -> impl Iterator<Item = &'a Arc<str>> {
    let mut last: Option<&Arc<str>> = None;
    let regions = readings.iter().flat_map(|reading| reading.regions.iter().map(|region| &region.module)).filter(move |module| {
        let again = last.is_some_and(|last| Arc::ptr_eq(last, module));
        last = Some(module);
        !again
    });
    read.into_iter().flat_map(|read| read.modules.iter()).chain(regions)
}

fn alike(reading: &Reading, read: Option<&Read>) -> bool {
    read.is_some_and(|read| reading.stopped == read.stopped && reading.regions == read.regions)
}

/// Every reading `section` keeps of case `id`, newest first, the newest read
/// off `index` where it is stored as its difference from it; absent when the
/// section keeps none of the case.
pub(crate) fn readings_of(section: &[u8], index: Option<&[u8]>, id: &str) -> Result<Option<Vec<Reading>>, String> {
    let section = read_readings(section).map_err(refused)?;
    let Some((_, bytes)) = section.cases.iter().find(|(case, _)| case == id) else { return Ok(None) };
    let stored = decode_case(bytes).map_err(refused)?;
    let base = match (stored.first(), index) {
        (Some(first), Some(index)) if first.regions.is_none() => match open(index)? {
            Some(index) => index.reads(&HashSet::from([id]))?.remove(id).map(|read| read.regions),
            None => None,
        },
        _ => None,
    };
    Ok(expanded(&stored, Some(base.as_deref().unwrap_or_default())))
}

#[cfg(test)]
#[path = "case_readings_lay_tests.rs"]
mod tests;
