//! A run's crossings as TypeScript reaches them: the journals' bytes in, the
//! fold as columns out, and the work in [`crate::run_crossings`].

use std::collections::{HashMap, HashSet};

use napi::bindgen_prelude::{Buffer, Float64Array, Uint32Array};
use napi_derive::napi;

use crate::journey::case_run::CaseReading;
use crate::run_crossings::{self, Carried, CarriedRow, Options, Reading};

/// A journal a page handed over, as `ReadJournal` holds it.
#[napi(object)]
pub struct CarriedJournal {
    pub test_file: String,
    pub modules: Vec<CarriedModule>,
}

#[napi(object)]
pub struct CarriedModule {
    pub id: String,
    pub hits: Vec<u32>,
    pub shared: Vec<u32>,
    pub loaded: Vec<u32>,
}

/// [`run_crossings::Folded`], column by column.
#[napi(object)]
pub struct RunCrossings {
    pub tests: Vec<String>,
    pub ids: Vec<String>,
    pub hits: Uint32Array,
    pub loaded: Uint32Array,
    pub journals: Uint32Array,
    pub collected: Float64Array,
    pub unplaced: Uint32Array,
}

fn carried(journals: Vec<CarriedJournal>) -> Vec<Carried> {
    journals
        .into_iter()
        .map(|journal| Carried {
            test_file: journal.test_file,
            rows: journal
                .modules
                .into_iter()
                .map(|row| CarriedRow { id: row.id, hits: row.hits, shared: row.shared, loaded: row.loaded })
                .collect(),
        })
        .collect()
}

/// Every module id the journals name, each once.
#[napi(catch_unwind)]
pub fn run_module_ids(journals: Vec<Buffer>, pages: Vec<CarriedJournal>) -> napi::Result<Vec<String>> {
    let frames: Vec<&[u8]> = journals.iter().map(|bytes| bytes.as_ref()).collect();
    run_crossings::named_modules(&frames, &carried(pages)).map_err(napi::Error::from_reason)
}

/// The run's journals — the workers' frames, then the pages' — folded into
/// crossings under the checkout at `root`. `placed`, when given, is every module
/// the run could place.
#[napi(catch_unwind)]
pub fn run_crossings(
    journals: Vec<Buffer>,
    pages: Vec<CarriedJournal>,
    root: String,
    readings: Vec<CaseReading>,
    placed: Option<Vec<String>>,
) -> napi::Result<RunCrossings> {
    let frames: Vec<&[u8]> = journals.iter().map(|bytes| bytes.as_ref()).collect();
    let readings: HashMap<String, Reading> = readings
        .into_iter()
        .map(|reading| {
            let lands = reading.lands.iter().map(|&land| (land != u32::MAX).then_some(land)).collect();
            (reading.id, Reading { id: reading.target, lands })
        })
        .collect();
    let placed: Option<HashSet<String>> = placed.map(|ids| ids.into_iter().collect());
    let options = Options { root: &root, readings: &readings, placed: placed.as_ref() };
    let folded = run_crossings::fold(&frames, &carried(pages), &options).map_err(napi::Error::from_reason)?;
    Ok(RunCrossings {
        tests: folded.tests,
        ids: folded.ids,
        hits: folded.hits.into(),
        loaded: folded.loaded.into(),
        journals: folded.journals.into(),
        collected: folded.collected.into(),
        unplaced: folded.unplaced.into(),
    })
}
