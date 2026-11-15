//! A run's case readings laid over the ones the record kept, as
//! `case-readings.ts` asks for them: a rerun keeps the readings it replaces
//! while its test file ran over the same inputs and every module either
//! reading entered stands at the same text, and the section is written in
//! `readings-bytes.ts`'s bytes, each case's newest against the regions the
//! landed index holds of it.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use rustc_hash::FxHashMap;

use napi::bindgen_prelude::Buffer;
use rayon::prelude::*;
use napi_derive::napi;

use crate::case_lines;
use crate::case_readings::{against, applied, case_bytes_of, decode_case, Region, Stored, StoredView};
use crate::case_shard::{put, string, strings};
use crate::crossing_sets::{decode_set, set_slice};
use crate::journey_columns::{self, Decoded};
use crate::order;
use crate::record_layout::LAYOUT;
use crate::record_parts::{put_digest, put_fronted, read_readings};

/// Distinct readings kept per case, newest first: `READINGS`.
const READINGS: usize = 16;
/// The version a case index wrote before regions were loaded by set, which still reads.
const LOADED_SETS_FORMAT: u8 = 2;

/// One recorded run of one case, and how many runs read it so.
#[derive(Clone)]
struct Reading {
    count: u64,
    stopped: Option<bool>,
    regions: Vec<Region>,
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
    if version != cases.format && version != LOADED_SETS_FORMAT {
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
    if index.module_blocks.len() != index.module_files.len() + 1
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

    /// The readings of the cases `wanted` names, by id, as `readsOf` reads
    /// them: each case's regions in module and region order, each with the
    /// value the case's lines give it. Each set is decoded once.
    fn reads(&self, wanted: &HashSet<&str>) -> Result<HashMap<String, Read>, String> {
        let mut reads: Vec<Read> = Vec::new();
        let mut slots: Vec<Option<usize>> = vec![None; self.ids.len()];
        let mut by_id: HashMap<String, usize> = HashMap::new();
        let mut lines = Vec::new();
        for (row, id) in self.ids.iter().enumerate() {
            let id = string(&self.strings, *id)?;
            if !wanted.contains(id) {
                continue;
            }
            let stopped = match self.stopped.as_ref().map(|column| column[row]) {
                None | Some(0) => None,
                Some(1) => Some(false),
                Some(2) => Some(true),
                Some(_) => return Err("a case's settling is not one this build reads".to_owned()),
            };
            lines.push(match &self.lines {
                None => None,
                Some((blob, offsets)) => {
                    let (from, to) = (offsets[row] as usize, offsets[row + 1] as usize);
                    if to < from || to > blob.len() {
                        return Err("case lines bounds are invalid".to_owned());
                    }
                    case_lines::decode(&blob[from..to])?
                }
            });
            slots[row] = Some(reads.len());
            by_id.insert(id.to_owned(), reads.len());
            reads.push(Read { file: string(&self.strings, self.files[row])?.to_owned(), stopped, regions: Vec::new(), modules: Vec::new() });
        }
        if !reads.is_empty() {
            let mut members: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
            // Each case's lines of the module last read for it.
            let mut module_lines: Vec<(usize, Option<case_lines::ModuleLines>)> = vec![(usize::MAX, None); reads.len()];
            for (place, file) in self.module_files.iter().enumerate() {
                let file = self.shared(*file)?;
                let first = self.module_blocks[place] as usize;
                for at in first..self.module_blocks[place + 1] as usize {
                    let set = self.called[at];
                    if !members.contains_key(&set) {
                        members.insert(set, decode_set(set_slice(&self.set_bytes, &self.set_offsets, set)?, self.ids.len())?);
                    }
                    let block = (at - first) as u32;
                    for row in &members[&set] {
                        let Some(slot) = slots.get(*row as usize).copied().flatten() else { continue };
                        let read = &mut reads[slot];
                        let (at_place, own) = &mut module_lines[slot];
                        if *at_place != place {
                            *at_place = place;
                            *own = lines[slot].as_ref().map(|lines| case_lines::module_lines(lines, place as u32));
                        }
                        read.regions.push(Region {
                            module: file.clone(),
                            name: self.shared(self.names[at])?,
                            path: self.shared(self.paths[at])?,
                            start: u64::from(self.starts[at]),
                            end: u64::from(self.ends[at]),
                            value: own.and_then(|own| own.value(block)),
                        });
                        if read.modules.last().is_none_or(|last| !Arc::ptr_eq(last, &file)) {
                            read.modules.push(file.clone());
                        }
                    }
                }
            }
        }
        // An id held twice reads as its last row, as a map keyed by id keeps it.
        let mut reads: Vec<Option<Read>> = reads.into_iter().map(Some).collect();
        Ok(by_id.into_iter().map(|(id, slot)| (id, reads[slot].take().unwrap_or_else(|| unreachable!()))).collect())
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
        || rayon::join(|| previous.map(open).transpose(), || kept.filter(|bytes| !bytes.starts_with(b"{\"")).map(read_readings).transpose().map_err(refused)),
        || rayon::join(|| run.map(|run| open(run.fresh)).transpose(), || landed.map(open).transpose()),
    );
    let (before, opened) = (before?.flatten(), opened?.flatten());
    // A section an earlier build wrote as JSON holds none.
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
        readings.truncate(READINGS);
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
    let mut ids: Vec<&String> = laid.keys().collect();
    ids.sort_by(|left, right| order::code_unit(left, right));
    let mut paths: Vec<&String> = inputs.keys().collect();
    paths.sort_by(|left, right| order::code_unit(left, right));
    let mut bytes = Vec::new();
    let mut last = Vec::new();
    put(&mut bytes, ids.len() as u64);
    let owns: Vec<Vec<u8>> = ids.par_iter().map(|id| packed(&laid[*id], there.get(*id))).collect();
    for (id, own) in ids.into_iter().zip(owns) {
        put_fronted(&mut bytes, &mut last, id);
        put(&mut bytes, own.len() as u64);
        bytes.extend_from_slice(&own);
    }
    let mut last = Vec::new();
    put(&mut bytes, paths.len() as u64);
    for file in paths {
        put_fronted(&mut bytes, &mut last, file);
        put_digest(&mut bytes, &inputs[file]);
    }
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

/// Lay a run's case readings over the record's; see `layReadings`. `same` is
/// every file the run recorded from the text the landed index holds it at,
/// and `inputs` each test file's inputs as `[file, digest]`.
#[napi(catch_unwind)]
#[allow(clippy::too_many_arguments)]
pub fn lay_readings(
    kept: Option<Buffer>,
    previous: Option<Buffer>,
    landed: Option<Buffer>,
    cases: Vec<String>,
    fresh: Option<Buffer>,
    announced: Vec<String>,
    same: Vec<String>,
    inputs: Option<Vec<Vec<String>>>,
) -> napi::Result<Option<Buffer>> {
    let inputs = inputs
        .map(|pairs| pairs.into_iter().map(|pair| match <[String; 2]>::try_from(pair) {
            Ok([file, digest]) => Ok((file, digest)),
            Err(_) => Err(napi::Error::from_reason("an input is a file and its digest")),
        }).collect::<napi::Result<HashMap<_, _>>>())
        .transpose()?;
    let run = fresh.as_deref().map(|fresh| Run { fresh, announced: announced.into_iter().collect(), same: same.into_iter().collect(), inputs });
    let cases: HashSet<String> = cases.into_iter().collect();
    lay(kept.as_deref(), previous.as_deref(), landed.as_deref(), &cases, run.as_ref()).map(|bytes| bytes.map(Buffer::from)).map_err(napi::Error::from_reason)
}
