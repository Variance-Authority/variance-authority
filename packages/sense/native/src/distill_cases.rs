//! A record's case index as `distill` reads it: the cases of each test file,
//! how many of them entered each module, and the regions a charge asks of one
//! importer.
//!
//! The index is opened once, from one copy of its bytes, and kept open: a
//! scope asks every module how many cases of each test file entered it, one
//! test file asks only the modules it loaded, and a charge asks a handful of
//! importers' regions, all off the same reading. A crossing made while its
//! module loaded is not a call: the set spelling keeps it as the region's load
//! flag, which names no case. A region answers that flag as `loaded`, and a
//! charge reads a reference in it as run at load, whichever test file's case
//! loaded the module: the index cannot say, and a region run at load is never
//! one to mock. A record whose index is in the row spelling is
//! converted to the set spelling before it reaches here (`distill-native.ts`).

use std::collections::HashMap;
use std::sync::Mutex;

use napi::bindgen_prelude::Uint32Array;
use napi_derive::napi;

use crate::distill_read::Paths;
use crate::journey_columns;
use crate::journey_journal::FINISHED;
use crate::journey_read::Journey;

/// The row spelling of a case index: `EXECUTION_FORMAT`, `UNTIMED_ROWS` and
/// `UNFLAGGED_ROWS` in `execution-format.ts`.
const ROWS: [u8; 3] = [5, 4, 1];

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
    /// The test files whose cases called it, as ids that only compare with each other.
    pub called: Uint32Array,
    /// Some case ran it while its module loaded; the index names no case for that.
    pub loaded: bool,
}

/// A test file's cases, as the case index keeps them.
#[derive(Clone, Copy, Default)]
pub(crate) struct Cases {
    pub count: u32,
    /// Cases that stopped, or did not say whether they finished.
    pub unsettled: u32,
}

/// Per module file, `(test file, cases of it that entered the module)`, by test file.
type Entered = HashMap<u32, Vec<(u32, u32)>>;

pub(crate) struct CaseIndex {
    journey: Mutex<Journey>,
    cases: HashMap<u32, Cases>,
    /// Each case's test file, by its place in the case index.
    file_of: Vec<u32>,
    /// Every module's entries, once a scope has asked for them.
    entered: Option<Entered>,
}

impl CaseIndex {
    /// The case index a coverage record carries, its cases read by test file.
    pub fn read(record: &[u8], paths: &mut Paths) -> Result<CaseIndex, String> {
        let index = journey_columns::recorded_cases_in(record);
        if journey_columns::version_of(index).is_some_and(|version| ROWS.contains(&version)) {
            return Err("the record's case index is in the row spelling, which the addon does not read: convert it to the set spelling first".to_owned());
        }
        let journey = Journey::of("the record's case index", index.to_vec())?;
        let mut file_of = Vec::with_capacity(journey.tests());
        let mut cases: HashMap<u32, Cases> = HashMap::new();
        for test in 0..journey.tests() {
            let file = paths.intern(journey.test_file(test)?);
            file_of.push(file);
            let held = cases.entry(file).or_default();
            held.count += 1;
            if journey.test_settled(test)? != Some(FINISHED) {
                held.unsettled += 1;
            }
        }
        Ok(CaseIndex { journey: Mutex::new(journey), cases, file_of, entered: None })
    }

    pub fn cases(&self, file: u32) -> Cases {
        self.cases.get(&file).copied().unwrap_or_default()
    }

    pub fn modules(&self) -> Result<usize, String> {
        Ok(self.journey()?.modules())
    }

    fn journey(&self) -> Result<std::sync::MutexGuard<'_, Journey>, String> {
        self.journey.lock().map_err(|_| "the case index was poisoned".to_owned())
    }

    fn file_of(&self, test: u32) -> Result<u32, String> {
        self.file_of.get(test as usize).copied().ok_or_else(|| format!("the record is damaged: its case index names case {test}, which it does not hold"))
    }

    /// The cases that crossed a region of `module` below its top level, each once.
    fn crossed(&self, journey: &Journey, module: usize) -> Result<Vec<u32>, String> {
        let mut crossed = Vec::new();
        for region in journey.regions(module)? {
            if journey.text(region.kind)? != "module" {
                crossed.extend(journey.members(region.called)?);
            }
        }
        crossed.sort_unstable();
        crossed.dedup();
        Ok(crossed)
    }

    /// Every module's entries, for a scope that will ask all of them. A module
    /// the coverage rows do not name is never asked, so it is not kept.
    pub fn enter_all(&mut self, paths: &Paths) -> Result<(), String> {
        if self.entered.is_some() {
            return Ok(());
        }
        let journey = self.journey()?;
        let mut entered = HashMap::with_capacity(journey.modules());
        for module in 0..journey.modules() {
            let Some(file) = paths.id(journey.module_file(module)?) else { continue };
            let counts = self.crossed(&journey, module)?.iter().map(|test| Ok((self.file_of(*test)?, 1))).collect::<Result<_, String>>()?;
            // A later row for the same file is the one a lookup by file answers.
            entered.insert(file, tally(counts));
        }
        drop(journey);
        self.entered = Some(entered);
        Ok(())
    }

    /// How many cases of `test` entered `module` below its top level.
    pub fn entered(&self, paths: &Paths, module: u32, test: u32) -> Result<u32, String> {
        if let Some(entered) = &self.entered {
            let Some(found) = entered.get(&module) else { return Ok(0) };
            return Ok(found.binary_search_by_key(&test, |(file, _)| *file).map_or(0, |at| found[at].1));
        }
        let journey = self.journey()?;
        let Some(at) = journey.module_of(paths.name(module))? else { return Ok(0) };
        let mut count = 0;
        for case in self.crossed(&journey, at)? {
            if self.file_of(case)? == test {
                count += 1;
            }
        }
        Ok(count)
    }

    /// The regions the index keeps for `importer`, read against the cases of
    /// the test file `mine`, in row order; none when it keeps no module for it.
    pub fn regions(&self, importer: &str, mine: u32) -> Result<Vec<DistillRegion>, String> {
        let journey = self.journey()?;
        let Some(module) = journey.module_of(importer)? else { return Ok(Vec::new()) };
        let mut found = Vec::new();
        for at in journey.regions(module)? {
            let mut files = journey.members(at.called)?.iter().map(|test| self.file_of(*test)).collect::<Result<Vec<_>, _>>()?;
            files.sort_unstable();
            files.dedup();
            found.push(DistillRegion {
                kind: journey.text(at.kind)?.to_owned(),
                name: journey.text(at.name)?.to_owned(),
                path: journey.text(at.path)?.to_owned(),
                start_line: at.start,
                end_line: at.end,
                source: at.source,
                ran: files.binary_search(&mine).is_ok(),
                called: Uint32Array::new(files),
                loaded: at.loaded,
            });
        }
        Ok(found)
    }
}

/// `(test file, 1)` per case, as `(test file, cases)` by test file.
fn tally(mut counts: Vec<(u32, u32)>) -> Vec<(u32, u32)> {
    counts.sort_unstable_by_key(|(file, _)| *file);
    counts.dedup_by(|next, held| {
        let same = next.0 == held.0;
        if same {
            held.1 += 1;
        }
        same
    });
    counts
}
