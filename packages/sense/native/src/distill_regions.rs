//! The regions a record keeps for one importer, read against one test file's
//! cases: what a charge asks of an import no case of the file entered.
//!
//! A charge reads the importer's regions and, for each, whether a case of the
//! test file called it, whether one ran it while the module loaded, and which
//! test files called it. Those are a handful of modules out of a whole index,
//! so the record keeps its case index as written and opens it the first time a
//! charge asks; a scope never does. The row spelling a build before the set
//! spelling wrote is read here too, whole, since its columns cannot be read in
//! part.

use std::collections::HashMap;
use std::sync::Mutex;

use napi::bindgen_prelude::Uint32Array;
use napi_derive::napi;

use crate::distill_read::{tally, Cases, Entered, Paths, FINISHED};
use crate::journey_columns;
use crate::journey_read::Journey;
use crate::journey_stitch::strings;

/// The row spelling of a case index: `EXECUTION_FORMAT`, `UNTIMED_ROWS` and
/// `UNFLAGGED_ROWS` in `execution-format.ts`.
const ROWS: [u8; 3] = [5, 4, 1];
/// `LOADED` in `execution-format.ts`: a crossing made while its module loaded.
const LOADED_CROSSING: u32 = 2;
const ROW_COLUMNS: [&str; 15] = [
    "strings.blob",
    "strings.off",
    "tests.file",
    "tests.stopped",
    "modules.file",
    "modules.blocks",
    "blocks.kind",
    "blocks.name",
    "blocks.path",
    "blocks.start",
    "blocks.end",
    "blocks.source",
    "blocks.crossings",
    "crossings.test",
    "crossings.loaded",
];

/// One region of the importer, as a charge reads it.
#[napi(object)]
pub struct DistillRegion {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub source: bool,
    /// A case of the test file called it.
    pub ran: bool,
    /// A case of the test file ran it while the module loaded.
    pub at_load: bool,
    /// The test files whose cases called it, as ids that only compare with each other.
    pub called: Uint32Array,
}

/// A record's case index as written, opened when a charge first asks.
pub(crate) struct KeptIndex {
    bytes: Vec<u8>,
    opened: Mutex<Option<Opened>>,
}

enum Opened {
    Sets(Journey),
    Rows(RowIndex),
}

/// The row spelling, decoded whole.
struct RowIndex {
    text: Vec<String>,
    test_file: Vec<u32>,
    stopped: Option<Vec<u32>>,
    module_file: Vec<u32>,
    bounds: Vec<u32>,
    kind: Vec<u32>,
    name: Vec<u32>,
    path: Vec<u32>,
    start: Vec<u32>,
    end: Vec<u32>,
    source: Vec<u32>,
    crossings: Vec<u32>,
    crossing_test: Vec<u32>,
    crossing_loaded: Vec<u32>,
}

impl RowIndex {
    fn read(index: &[u8]) -> Result<RowIndex, String> {
        let (_, decoded) = journey_columns::decode_wanted(index, &ROW_COLUMNS)?;
        let rows = RowIndex {
            text: strings(&decoded)?,
            test_file: decoded.words("tests.file")?,
            stopped: if decoded.has("tests.stopped") { Some(decoded.values("tests.stopped")?) } else { None },
            module_file: decoded.words("modules.file")?,
            bounds: decoded.words("modules.blocks")?,
            kind: decoded.words("blocks.kind")?,
            name: decoded.words("blocks.name")?,
            path: decoded.words("blocks.path")?,
            start: decoded.words("blocks.start")?,
            end: decoded.words("blocks.end")?,
            source: decoded.values("blocks.source")?,
            crossings: decoded.words("blocks.crossings")?,
            crossing_test: decoded.words("crossings.test")?,
            crossing_loaded: decoded.values("crossings.loaded")?,
        };
        let blocks = rows.kind.len();
        if rows.stopped.as_ref().is_some_and(|stopped| stopped.len() != rows.test_file.len())
            || rows.bounds.len() != rows.module_file.len() + 1
            || [rows.name.len(), rows.path.len(), rows.start.len(), rows.end.len(), rows.source.len()].iter().any(|length| *length != blocks)
            || rows.crossings.len() != blocks + 1
            || rows.crossing_loaded.len() != rows.crossing_test.len()
        {
            return Err("case index columns disagree".to_owned());
        }
        Ok(rows)
    }

    fn name(&self, id: u32) -> Result<&str, String> {
        self.text.get(id as usize).map(String::as_str).ok_or_else(|| format!("case index string id {id} is out of bounds"))
    }

    fn blocks(&self, module: usize) -> Result<std::ops::Range<usize>, String> {
        let (from, to) = (self.bounds[module] as usize, self.bounds[module + 1] as usize);
        if from > to || to > self.kind.len() {
            return Err("case index module block bounds are invalid".to_owned());
        }
        Ok(from..to)
    }

    /// The crossings of `block`, as `(test, loaded)`.
    fn crossed(&self, block: usize) -> Result<impl Iterator<Item = (u32, bool)> + '_, String> {
        let (first, last) = (self.crossings[block] as usize, self.crossings[block + 1] as usize);
        if first > last || last > self.crossing_test.len() {
            return Err("case index crossing bounds are invalid".to_owned());
        }
        Ok((first..last).map(|at| (self.crossing_test[at], self.crossing_loaded[at] == LOADED_CROSSING)))
    }
}

/// What a record's case index says for distillation: the cases of each test
/// file, per module how many of them entered it, each case's test file, and
/// the index kept for the charge.
pub(crate) type ReadCases = (HashMap<u32, Cases>, Entered, Vec<u32>, KeptIndex);

/// `read_cases` over a case index in the row spelling, which a build before
/// the set spelling wrote; nothing for one in the set spelling. A crossing
/// carries its depth there, which a distillation does not ask: a case entered
/// a module or did not.
pub(crate) fn read_row_cases(index: Vec<u8>, paths: &mut Paths) -> Result<Result<ReadCases, Vec<u8>>, String> {
    if !journey_columns::version_of(&index).is_some_and(|version| ROWS.contains(&version)) {
        return Ok(Err(index));
    }
    let rows = RowIndex::read(&index)?;
    let mut file_of = Vec::with_capacity(rows.test_file.len());
    let mut cases: HashMap<u32, Cases> = HashMap::new();
    for (test, id) in rows.test_file.iter().enumerate() {
        let file = paths.intern(rows.name(*id)?);
        file_of.push(file);
        let held = cases.entry(file).or_default();
        held.count += 1;
        if rows.stopped.as_ref().map(|stopped| stopped[test]) != Some(u32::from(FINISHED)) {
            held.unsettled += 1;
        }
    }
    let mut entered = HashMap::with_capacity(rows.module_file.len());
    let mut crossed: Vec<u32> = Vec::new();
    for module in 0..rows.module_file.len() {
        crossed.clear();
        for block in rows.blocks(module)? {
            if rows.name(rows.kind[block])? == "module" {
                continue;
            }
            crossed.extend(rows.crossed(block)?.filter(|(_, loaded)| !loaded).map(|(test, _)| test));
        }
        crossed.sort_unstable();
        crossed.dedup();
        let mut counts = Vec::with_capacity(crossed.len());
        for test in &crossed {
            counts.push((*file_of.get(*test as usize).ok_or_else(|| format!("case index test {test} is out of bounds"))?, 1));
        }
        entered.insert(paths.intern(rows.name(rows.module_file[module])?), tally(counts));
    }
    Ok(Ok((cases, entered, file_of, KeptIndex::new(index))))
}

impl KeptIndex {
    pub fn new(bytes: Vec<u8>) -> KeptIndex {
        KeptIndex { bytes, opened: Mutex::new(None) }
    }

    /// The regions the index keeps for `importer`, read against the cases of
    /// the test file `mine`, in row order; none when it keeps no module for it.
    /// `file_of` is each case's test file. A crossing made while the module
    /// loaded is not a call; the set spelling keeps it as the region's load
    /// flag, which names no case.
    pub fn regions(&self, importer: &str, mine: u32, file_of: &[u32]) -> Result<Vec<DistillRegion>, String> {
        let mut opened = self.opened.lock().map_err(|_| "the case index was poisoned".to_owned())?;
        if opened.is_none() {
            let rows = journey_columns::version_of(&self.bytes).is_some_and(|version| ROWS.contains(&version));
            *opened = Some(if rows {
                Opened::Rows(RowIndex::read(&self.bytes)?)
            } else {
                Opened::Sets(Journey::of("the record's case index", self.bytes.clone())?)
            });
        }
        let file = |test: u32| file_of.get(test as usize).copied().ok_or_else(|| format!("case index test {test} is out of bounds"));
        let region = |kind: &str, name: &str, path: &str, (start, end, source): (u32, u32, bool), called: Vec<u32>, at_load: bool| {
            let mut files = called.iter().map(|test| file(*test)).collect::<Result<Vec<_>, _>>()?;
            files.sort_unstable();
            files.dedup();
            Ok::<_, String>(DistillRegion {
                kind: kind.to_owned(),
                name: name.to_owned(),
                path: path.to_owned(),
                start_line: start,
                end_line: end,
                source,
                ran: files.binary_search(&mine).is_ok(),
                at_load,
                called: Uint32Array::new(files),
            })
        };
        match opened.as_ref() {
            Some(Opened::Sets(journey)) => {
                let Some(module) = journey.module_of(importer)? else { return Ok(Vec::new()) };
                let mut found = Vec::new();
                for at in journey.regions(module)? {
                    let lines = (at.start, at.end, at.source);
                    let called = journey.members(at.called)?;
                    found.push(region(journey.text(at.kind)?, journey.text(at.name)?, journey.text(at.path)?, lines, called, false)?);
                }
                Ok(found)
            }
            Some(Opened::Rows(rows)) => {
                // A later row for the same file is the one a lookup by file answers.
                let mut module = None;
                for at in 0..rows.module_file.len() {
                    if rows.name(rows.module_file[at])? == importer {
                        module = Some(at);
                    }
                }
                let Some(module) = module else { return Ok(Vec::new()) };
                let mut found = Vec::new();
                for block in rows.blocks(module)? {
                    let (mut called, mut at_load) = (Vec::new(), false);
                    for (test, loaded) in rows.crossed(block)? {
                        if !loaded {
                            called.push(test);
                        } else if file(test)? == mine {
                            at_load = true;
                        }
                    }
                    let lines = (rows.start[block], rows.end[block], rows.source[block] == 1);
                    let (kind, name, path) = (rows.name(rows.kind[block])?, rows.name(rows.name[block])?, rows.name(rows.path[block])?);
                    found.push(region(kind, name, path, lines, called, at_load)?);
                }
                Ok(found)
            }
            None => Ok(Vec::new()),
        }
    }
}
