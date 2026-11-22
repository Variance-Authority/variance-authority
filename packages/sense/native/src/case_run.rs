//! A run's case journals as the case index a reporter lays into its record:
//! read once into the cases they name, then folded a module slice at a time.
//! The caller asks what only it knows — each case's duration and limit as the
//! runner reported them, the modules the run captured — between the two.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi_derive::napi;

use super::journey_fold::{fold, CaseShape, Placed};
use crate::journey_format::{self, CaseExtras};
use crate::journey_journal::{self, CaseDetail, CaseRun, ModuleId};
use crate::journey_record::Module;
use crate::off_thread::{off_thread, OffThread};
use crate::record_layout::LAYOUT;

const DEFAULT_BUDGET: usize = 128 * 1_048_576;

/// One case the journals name, in the order the case index lays them.
#[napi(object)]
pub struct JournalCase {
    pub id: String,
    pub file: String,
    pub name: String,
    /// The id its runner gave the case.
    pub runner: String,
    /// The project that ran it; absent where the run names none.
    pub project: Option<String>,
}

/// A reading of a file other than its own, by the id its probes report under.
#[napi(object)]
pub struct CaseReading {
    pub id: String,
    /// The id of the file's record it joins.
    pub target: String,
    /// That record's ordinal for each of the reading's, `0xFFFFFFFF` where the
    /// region has no place in it.
    pub lands: Vec<u32>,
}

#[napi(object)]
pub struct EyesJournal {
    pub case: String,
    pub attempt: f64,
    /// The journal Eyes handed over, as JSON text.
    pub journal: String,
}

/// The cases that watched through Eyes, in the order they first did, and what each handed over.
#[napi(object)]
pub struct CaseEyes {
    pub watched: Vec<String>,
    pub journals: Vec<EyesJournal>,
}

#[napi(object)]
pub struct CaseIndexFold {
    pub bytes: Buffer,
    /// The number of times every journal was replayed: one per module slice.
    pub passes: u32,
    /// Logical test-to-region pairs represented by the compact sets.
    pub crossings: f64,
}

/// One run's case journals, read: the cases they name, before the fold.
#[napi]
pub struct CaseJournals {
    /// Shared with a fold in flight, which reads it off the JavaScript thread.
    run: Arc<CaseRun>,
}

/// Read the case journals in `directory`, naming files from `root`.
#[napi(catch_unwind)]
pub fn open_case_journals(directory: String, root: String) -> napi::Result<CaseJournals> {
    let run = journey_journal::inspect_cases(Path::new(&directory), Path::new(&root)).map_err(napi::Error::from_reason)?;
    Ok(CaseJournals { run: Arc::new(run) })
}

#[napi]
impl CaseJournals {
    /// Every case, in the case index's order.
    #[napi(catch_unwind)]
    pub fn cases(&self) -> Vec<JournalCase> {
        self.run
            .tests
            .iter()
            .map(|test| JournalCase {
                id: test.id.clone(),
                file: test.file.clone(),
                name: test.name.clone(),
                runner: test.runner.clone().unwrap_or_default(),
                project: test.project.clone(),
            })
            .collect()
    }

    /// What Eyes handed the cases that watched; `None` where none did.
    #[napi(catch_unwind)]
    pub fn eyes(&self) -> Option<CaseEyes> {
        let detail = detail(&self.run);
        if detail.looked.is_empty() {
            return None;
        }
        let id = |row: u32| self.run.tests[row as usize].id.clone();
        Some(CaseEyes {
            watched: detail.looked.iter().map(|(row, _)| id(*row)).collect(),
            journals: detail
                .looked
                .iter()
                .flat_map(|(row, rows)| rows.iter().map(move |(attempt, journal)| (*row, *attempt, journal)))
                .map(|(row, attempt, journal)| EyesJournal { case: id(row), attempt, journal: journal.clone() })
                .collect(),
        })
    }

    /// Fold the journals over `modules` into the case index's bytes, off the
    /// JavaScript thread, so the run's own work goes on while the fold does.
    ///
    /// `ordinals` holds each module's region ordinals, one row a module;
    /// `durations` and `limits` are what the runner reported of each case in
    /// [`Self::cases`]'s order, `NaN` where it reported none; `budget_bytes`
    /// bounds the test-by-region relation one slice holds.
    #[napi(ts_return_type = "Promise<CaseIndexFold>")]
    pub fn fold(
        &self,
        modules: Vec<Module>,
        ordinals: Vec<Vec<u32>>,
        readings: Vec<CaseReading>,
        durations: Vec<f64>,
        limits: Vec<f64>,
        budget_bytes: Option<u32>,
    ) -> AsyncTask<OffThread<CaseIndexFold>> {
        let run = Arc::clone(&self.run);
        off_thread(move || folded(&run, modules, ordinals, readings, &durations, &limits, budget_bytes).map_err(napi::Error::from_reason))
    }
}

fn detail(run: &CaseRun) -> &CaseDetail {
    run.detail.as_ref().expect("case journals are read with their detail")
}

fn folded(
    run: &CaseRun,
    modules: Vec<Module>,
    ordinals: Vec<Vec<u32>>,
    readings: Vec<CaseReading>,
    durations: &[f64],
    limits: &[f64],
    budget_bytes: Option<u32>,
) -> Result<CaseIndexFold, String> {
    let detail = detail(run);
    let count = run.tests.len();
    if modules.len() != ordinals.len() || durations.len() != count || limits.len() != count {
        return Err("case fold arguments disagree with the cases".to_owned());
    }
    let mut placed = Vec::with_capacity(modules.len());
    for (module, ordinals) in modules.into_iter().zip(ordinals) {
        if ordinals.len() != module.blocks.len() {
            return Err(format!("{} names {} ordinals for {} regions", module.file, ordinals.len(), module.blocks.len()));
        }
        placed.push(Placed { module, ordinals: Some(ordinals) });
    }
    let readings: HashMap<ModuleId, (ModuleId, Vec<u32>)> =
        readings.into_iter().map(|reading| (reading.id, (reading.target, reading.lands))).collect();
    let shape = CaseShape { readings: &readings, lined: detail.lined.as_deref() };
    // The runner's report names neither a case's runner id nor its project
    // beside its row: the record's case index carries neither column.
    let tests: Vec<_> = run.tests.iter().map(|test| journey_journal::Test { runner: None, project: None, ..test.clone() }).collect();
    let limits = detail
        .limits
        .iter()
        .zip(limits)
        .map(|(held, given)| match journey_journal::limit_across(*held, (!given.is_nan()).then_some(*given)) {
            Some(limit) if limit == 0.0 => None,
            limit => duration_word(limit),
        })
        .collect();
    let durations = durations.iter().map(|duration| duration_word(Some(*duration))).collect();
    let budget = budget_bytes.map_or(DEFAULT_BUDGET, |value| value as usize);
    let folded = fold(run, placed, budget, Some(&shape), |modules, lines, sets| {
        let extras = CaseExtras { durations, limits, times: detail.times.clone(), lines, always_timed: true };
        journey_format::encode(&tests, &extras, modules, sets, None)
    })?;
    Ok(CaseIndexFold { bytes: folded.bytes.into(), passes: folded.passes, crossings: folded.crossings as f64 })
}

/// `durationWord`: whole milliseconds, `None` for a value no runner could have meant.
fn duration_word(duration: Option<f64>) -> Option<u32> {
    let duration = duration.filter(|value| value.is_finite() && *value >= 0.0)?;
    let whole = (duration + 0.5).floor();
    (whole < f64::from(LAYOUT.coverage.no_duration)).then_some(whole as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_duration_is_whole_milliseconds_rounded_half_up_and_none_where_no_runner_meant_it() {
        assert_eq!(duration_word(Some(12.4)), Some(12));
        assert_eq!(duration_word(Some(12.5)), Some(13));
        assert_eq!(duration_word(Some(0.0)), Some(0));
        for meaningless in [None, Some(f64::NAN), Some(-1.0), Some(f64::INFINITY), Some(f64::from(LAYOUT.coverage.no_duration))] {
            assert_eq!(duration_word(meaningless), None);
        }
    }
}

