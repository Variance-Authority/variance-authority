//! A run's case readings laid over the ones the record kept, as
//! `case-readings.ts` asks for them: a rerun keeps the readings it replaces
//! while its test file ran over the same inputs and every module either
//! reading entered stands at the same text, and the section is written by
//! `record_parts::write_readings`, each case's newest against the regions the
//! landed index holds of it.

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;

use crate::case_lines;
use crate::case_readings::{against, applied, case_bytes_of, decode_case, Region, Stored, StoredView};
use crate::case_regions::{regions_of, Walked};
use crate::case_shard::{string, strings};
use crate::journey_columns::{self, Decoded};
use crate::record_layout::LAYOUT;
use crate::record_parts::{read_readings, write_readings};

mod napi;

/// One recorded run of one case, and how many runs read it so.
#[derive(Clone)]
pub(crate) struct Reading<'a> {
    pub count: u64,
    pub stopped: Option<bool>,
    pub regions: Vec<Region<'a>>,
}

/// What a case's reading is, read off an index.
struct Read<'a> {
    file: String,
    stopped: Option<bool>,
    regions: Vec<Region<'a>>,
    /// The modules its regions are in, each once.
    modules: Vec<&'a str>,
}

/// The columns of a case index a reading is read from.
struct Index {
    strings: Vec<String>,
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
    fn modules(&self) -> Result<Vec<&str>, String> {
        self.module_files.iter().map(|file| string(&self.strings, *file)).collect()
    }

    fn test_files(&self) -> Result<HashSet<&str>, String> {
        self.files.iter().map(|file| string(&self.strings, *file)).collect()
    }

    /// The readings of the cases `wanted` names, by id, their regions as
    /// `regions_of` lays them out. An id held twice reads as its last row, as
    /// a map keyed by id keeps it.
    fn reads(&self, wanted: &HashSet<&str>) -> Result<HashMap<String, Read<'_>>, String> {
        let mut by_id: HashMap<&str, u32> = HashMap::new();
        for (row, id) in self.ids.iter().enumerate() {
            let id = string(&self.strings, *id)?;
            if wanted.contains(id) {
                by_id.insert(id, row as u32);
            }
        }
        let rows: Vec<u32> = by_id.values().copied().collect();
        let regions = regions_of(self, &rows)?;
        rows.into_par_iter()
            .zip(regions)
            .map(|(row, regions)| {
                let stopped = match self.stopped.as_ref().map(|column| column[row as usize]) {
                    None | Some(0) => None,
                    Some(1) => Some(false),
                    Some(2) => Some(true),
                    Some(_) => return Err("a case's settling is not one this build reads".to_owned()),
                };
                let mut modules: Vec<&str> = Vec::new();
                for region in &regions {
                    if modules.last().is_none_or(|last| !same_str(last, region.module)) {
                        modules.push(region.module);
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

    fn module(&self, place: usize) -> Result<&str, String> {
        string(&self.strings, self.module_files[place])
    }

    fn called(&self, place: usize) -> &[u32] {
        &self.called[self.module_blocks[place] as usize..self.module_blocks[place + 1] as usize]
    }

    fn region(&self, place: usize, block: usize) -> Result<(&str, &str, u64, u64), String> {
        let at = self.module_blocks[place] as usize + block;
        Ok((string(&self.strings, self.names[at])?, string(&self.strings, self.paths[at])?, u64::from(self.starts[at]), u64::from(self.ends[at])))
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
    fn reads<'i>(index: &'i Option<Index>, wanted: &HashSet<&str>) -> Result<HashMap<String, Read<'i>>, String> {
        index.as_ref().map_or_else(|| Ok(HashMap::new()), |index| index.reads(wanted))
    }
    let (held_back, (now, there)) = rayon::join(
        || -> Result<_, String> {
            let earlier = reads(&before, &known)?;
            // Each case decodes on its own thread; the rows are then applied in
            // order, so an id stored twice reads as its last row.
            let decoded = stored
                .par_iter()
                .map(|(id, bytes)| Ok((id.as_str(), expanded(&decode_case(bytes).map_err(refused)?, earlier.get(id).map(|read| read.regions.as_slice())))))
                .collect::<Result<Vec<_>, String>>()?;
            let mut holding: HashMap<&str, Vec<Reading>> = HashMap::new();
            for (id, readings) in decoded {
                match readings {
                    Some(readings) if !readings.is_empty() => holding.insert(id, readings),
                    _ => holding.remove(id),
                };
            }
            Ok((earlier, holding))
        },
        || rayon::join(|| reads(&fresh, &ran.iter().map(String::as_str).collect()), || reads(&opened, &known)),
    );
    let ((mut earlier, mut holding), now, there) = (held_back?, now?, there?);
    // A file the run carried keeps what it ran over when it last ran.
    let read: HashSet<String> = now.values().map(|reading| reading.file.clone()).collect();
    // Each recorded case takes what was held of it out first, so the cases lay
    // on their own threads and move their regions rather than copy them. Nothing
    // below reads a recorded case's earlier readings again.
    let taken: Vec<(String, Read, Option<Vec<Reading>>, Option<Read>)> =
        now.into_iter().map(|(id, reading)| (holding.remove(id.as_str()), earlier.remove(&id), id, reading)).map(|(prior, was, id, reading)| (id, reading, prior, was)).collect();
    let mut laid: HashMap<String, Vec<Reading>> = taken
        .into_par_iter()
        .map(|(id, reading, prior, mut was)| {
            // Held readings stand in for the case's earlier read; without them,
            // the read itself is the one reading, its regions moved, not copied.
            let prior = match prior {
                Some(readings) => readings,
                None => was.as_mut().map(|was| vec![Reading { count: 1, stopped: was.stopped, regions: std::mem::take(&mut was.regions) }]).unwrap_or_default(),
            };
            let inputs = run.and_then(|run| run.inputs.as_ref()).and_then(|inputs| inputs.get(&reading.file));
            let stands = inputs == held.get(&reading.file) && entered(was.as_ref(), &prior).chain(reading.modules.iter().copied()).all(&same);
            let mut readings = if prior.is_empty() || !stands { Vec::new() } else { prior };
            let Read { stopped, regions, .. } = reading;
            let found = readings.iter().position(|one| one.stopped == stopped && one.regions == regions).map(|at| readings.remove(at));
            let first = match found {
                None => Reading { count: 1, stopped, regions },
                Some(found) => Reading { count: found.count + 1, ..found },
            };
            readings.insert(0, first);
            readings.truncate(LAYOUT.cases.readings);
            (id, readings)
        })
        .collect();
    // A case the run did not record keeps its readings while the code they
    // read stands: a module the run recorded at another text drops them.
    let moved: HashSet<&str> = recorded.iter().copied().filter(|file| !same(file)).collect();
    for (id, readings) in holding {
        if ran.contains(id) || !cases.contains(id) {
            continue;
        }
        if !moved.is_empty() && entered(earlier.get(id), &readings).any(|module| moved.contains(module)) {
            continue;
        }
        laid.insert(id.to_owned(), readings);
    }
    // One run, as the index holds it, is what the index already says.
    laid.retain(|id, readings| !(readings.len() == 1 && readings[0].count == 1 && alike(&readings[0], there.get(id))));
    let files = opened.as_ref().map(Index::test_files).transpose()?.unwrap_or_default();
    let mut inputs = held.clone();
    for (file, digest) in run.and_then(|run| run.inputs.as_ref()).into_iter().flatten() {
        if read.contains(file) {
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
fn packed(readings: &[Reading<'_>], there: Option<&Read<'_>>) -> Vec<u8> {
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
fn expanded<'a>(stored: &[Stored<'a>], base: Option<&[Region<'a>]>) -> Option<Vec<Reading<'a>>> {
    let first = stored.first()?;
    if first.regions.is_none() && base.is_none() {
        return None;
    }
    let newest = applied(first, base.unwrap_or_default());
    // The older readings are applied over the newest first, so the newest is moved in last rather than copied.
    let rest: Vec<Reading> = stored[1..].iter().map(|reading| Reading { count: reading.count, stopped: reading.stopped, regions: applied(reading, &newest) }).collect();
    Some(std::iter::once(Reading { count: first.count, stopped: first.stopped, regions: newest }).chain(rest).collect())
}

/// Every module a case's readings entered, as often as its regions name it in a row.
fn entered<'a, 's>(read: Option<&'a Read<'s>>, readings: &'a [Reading<'s>]) -> impl Iterator<Item = &'s str> + 'a {
    let mut last: Option<&str> = None;
    let regions = readings.iter().flat_map(|reading| reading.regions.iter().map(|region| region.module)).filter(move |module| {
        let again = last.is_some_and(|last| same_str(last, module));
        last = Some(module);
        !again
    });
    read.into_iter().flat_map(|read| read.modules.iter().copied()).chain(regions)
}

/// Whether two strings are the one string of one table: the same bytes at the same place.
fn same_str(one: &str, other: &str) -> bool {
    std::ptr::eq(one, other)
}

fn alike(reading: &Reading<'_>, read: Option<&Read<'_>>) -> bool {
    read.is_some_and(|read| reading.stopped == read.stopped && reading.regions == read.regions)
}

/// Every reading `section` keeps of case `id`, newest first, the newest read
/// off `index` where it is stored as its difference from it; absent when the
/// section keeps none of the case. Each reading is handed to `each`, since
/// its strings are borrowed from what this reads.
pub(crate) fn readings_of<T>(section: &[u8], index: Option<&[u8]>, id: &str, each: impl Fn(Reading<'_>) -> T) -> Result<Option<Vec<T>>, String> {
    let section = read_readings(section).map_err(refused)?;
    let Some((_, bytes)) = section.cases.iter().find(|(case, _)| case == id) else { return Ok(None) };
    let stored = decode_case(bytes).map_err(refused)?;
    let opened = match (stored.first(), index) {
        (Some(first), Some(index)) if first.regions.is_none() => open(index)?,
        _ => None,
    };
    let base = opened.as_ref().map(|index| index.reads(&HashSet::from([id]))).transpose()?.and_then(|mut reads| reads.remove(id)).map(|read| read.regions);
    Ok(expanded(&stored, Some(base.as_deref().unwrap_or_default())).map(|readings| readings.into_iter().map(each).collect()))
}

#[cfg(test)]
#[path = "case_readings_lay_tests.rs"]
mod tests;
