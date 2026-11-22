//! The case layering, as the Node side calls it: whole indexes in, whole
//! indexes out, so no row crosses into V8 (spec 0100).

use std::path::PathBuf;

use std::collections::{HashMap, HashSet};

use napi::bindgen_prelude::{AsyncTask, Buffer, Function};
use napi_derive::napi;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::case_readings_lay::{self, Announced, Run};
use crate::off_thread::{off_thread, OffThread};

use crate::journey_record::Block;

use super::case_layer::{follow_cuts, layer, layer_before, Edits, Files, Present, RowCut};
use super::case_layer_landing::{cut_apart, Edit, Hunk};

#[napi(object)]
pub struct CaseHunk {
    pub old_start: i64,
    pub old_count: i64,
    pub new_start: i64,
    pub new_count: i64,
}

#[napi(object)]
pub struct CaseEdit {
    pub hunks: Vec<CaseHunk>,
    /// The selector's reading of the two texts; absent where no module reader claims the file.
    pub reading: Option<String>,
}

#[napi(object)]
pub struct CaseRunFiles {
    /// Every test file the run announced, finished or not.
    pub ran: Vec<String>,
    /// The files that ran to the end.
    pub finished: Vec<String>,
    /// The test files the checkout holds are the ones on disk under this root.
    pub present_under: Option<String>,
    /// The test files the checkout holds are these.
    pub present_among: Option<Vec<String>>,
    pub same_text: Option<Vec<String>>,
    pub same_before_text: Option<Vec<String>>,
    /// The index the before layer is cut from, when it is not the one the run is laid over.
    pub base: Option<Buffer>,
    /// Whether to cut the before layer.
    pub before: bool,
}

#[napi(object)]
pub struct CaseLayers {
    pub merged: Buffer,
    pub cases: Vec<String>,
    pub last: Vec<String>,
    pub announced: Vec<String>,
    pub before: Option<Buffer>,
    /// The file of every module `before` holds, in its order; empty without one.
    pub before_modules: Vec<String>,
    pub unlined: Vec<String>,
}

#[napi(object)]
pub struct CaseCut {
    pub file: String,
    pub blocks: Vec<Block>,
    pub owners: Vec<u32>,
}

fn edit_of(edit: CaseEdit) -> Edit {
    Edit {
        hunks: edit.hunks.into_iter().map(|hunk| Hunk { old_start: hunk.old_start, old_count: hunk.old_count, new_start: hunk.new_start, new_count: hunk.new_count }).collect(),
        reading: edit.reading,
    }
}

/// `edit`'s answer for `file`; `undefined` is an edit that could not be read.
fn asked(edit: &Function<String, Option<CaseEdit>>, file: &str) -> Result<Option<Edit>, String> {
    edit.call(file.to_owned()).map(|found| found.map(edit_of)).map_err(|error| error.reason.clone())
}

fn present_of(under: Option<String>, among: Option<Vec<String>>) -> Present {
    match (under, among) {
        (_, Some(among)) => Present::Among(among.into_iter().collect()),
        (Some(root), None) => Present::Under(PathBuf::from(root)),
        (None, None) => Present::All,
    }
}

fn layers_of(layers: super::case_layer::Layers) -> CaseLayers {
    CaseLayers {
        merged: layers.merged.into(),
        cases: layers.cases,
        last: layers.last,
        announced: layers.announced,
        before: layers.before.map(Buffer::from),
        before_modules: layers.before_modules,
        unlined: layers.unlined,
    }
}

/// One run's case index laid over the one it replaces. `edit` answers a
/// module's edit from the text the index cut it at to the text the run
/// recorded, `undefined` where it could not be read; it is asked only of a
/// module both indexes hold. Without it, every module reads as the one text.
#[napi(catch_unwind)]
pub fn layer_case_index(previous: Option<Buffer>, fresh: Buffer, files: CaseRunFiles, edit: Option<Function<String, Option<CaseEdit>>>) -> napi::Result<CaseLayers> {
    let ask = |file: &str| asked(edit.as_ref().expect("asked only with an edit"), file);
    let laid = Files {
        ran: files.ran.into_iter().collect(),
        finished: files.finished.into_iter().collect(),
        present: present_of(files.present_under, files.present_among),
        edits: if edit.is_some() { Edits::Asked(&ask) } else { Edits::One },
        same_text: files.same_text.map(|files| files.into_iter().collect::<FxHashSet<_>>()),
        same_before_text: files.same_before_text.map(|files| files.into_iter().collect::<FxHashSet<_>>()),
    };
    let layers = layer(previous.as_deref(), &fresh, &laid, files.base.as_deref(), files.before).map_err(napi::Error::from_reason)?;
    Ok(layers_of(layers))
}

/// One module's edit, read before the layering; `edit` absent where it could
/// not be read, and `error` why reading it failed, raised only if the layer asks for it.
#[napi(object)]
pub struct CaseGivenEdit {
    pub file: String,
    pub edit: Option<CaseEdit>,
    pub error: Option<String>,
}

/// What a run's case lay writes: the layered index and the readings section laid with it.
#[napi(object)]
pub struct CaseRunLaid {
    pub layers: CaseLayers,
    pub readings: Option<Buffer>,
}

/// One run's case index laid over the one it replaces, and its readings over
/// the record's, off the JavaScript thread, so the caller lays the coverage
/// meanwhile. `edits` holds every module the run recorded from another text
/// than `same_text` names, read before; `kept` is the record's readings
/// section and `inputs` each test file's inputs as `[file, digest]`.
#[napi(ts_return_type = "Promise<CaseRunLaid>")]
pub fn lay_case_run(previous: Option<Buffer>, fresh: Buffer, files: CaseRunFiles, edits: Vec<CaseGivenEdit>, kept: Option<Buffer>, inputs: Option<Vec<Vec<String>>>) -> napi::Result<AsyncTask<OffThread<CaseRunLaid>>> {
    let inputs = inputs
        .map(|pairs| pairs.into_iter().map(|pair| match <[String; 2]>::try_from(pair) {
            Ok([file, digest]) => Ok((file, digest)),
            Err(_) => Err(napi::Error::from_reason("an input is a file and its digest")),
        }).collect::<napi::Result<HashMap<_, _>>>())
        .transpose()?;
    let edits: FxHashMap<String, Result<Option<Edit>, String>> = edits.into_iter().map(|given| (given.file, match given.error { Some(error) => Err(error), None => Ok(given.edit.map(edit_of)) })).collect();
    let (previous, fresh, base, kept) = (previous.map(|bytes| bytes.to_vec()), fresh.to_vec(), files.base.map(|bytes| bytes.to_vec()), kept.map(|bytes| bytes.to_vec()));
    let same: Vec<String> = files.same_text.unwrap_or_default();
    let (ran, finished, present, same_before_text) = (files.ran, files.finished, present_of(files.present_under, files.present_among), files.same_before_text);
    let before = files.before;
    Ok(off_thread(move || {
        let laid = Files {
            ran: ran.into_iter().collect(),
            finished: finished.into_iter().collect(),
            present,
            edits: Edits::Given(edits),
            same_text: Some(same.iter().cloned().collect()),
            same_before_text: same_before_text.map(|files| files.into_iter().collect::<FxHashSet<_>>()),
        };
        // The readings read the record's and the run's indexes while the run is laid, and the landed one once it is.
        let run = Run { fresh: &fresh, announced: Announced::OfFiles(laid.ran.iter().cloned().collect()), same: same.into_iter().collect(), inputs };
        let ((layers, _), readings) = case_readings_lay::lay_while(
            kept.as_deref(),
            previous.as_deref(),
            Some(&run),
            || {
                let layers = layer(previous.as_deref(), &fresh, &laid, base.as_deref(), before)?;
                let cases: HashSet<String> = layers.cases.iter().cloned().collect();
                Ok((layers, cases))
            },
            |(layers, cases)| (Some(layers.merged.as_slice()), cases),
        )
        .map_err(napi::Error::from_reason)?;
        Ok(CaseRunLaid { layers: layers_of(layers), readings: readings.map(Buffer::from) })
    }))
}

/// What the runs at one commit retired, as one before: `retired` laid over `kept`.
#[napi(catch_unwind)]
pub fn layer_case_before(kept: Option<Buffer>, retired: Option<Buffer>, ran: Vec<String>) -> napi::Result<Option<Buffer>> {
    let laid = layer_before(kept.as_deref(), retired.as_deref(), ran.into_iter().collect()).map_err(napi::Error::from_reason)?;
    Ok(laid.map(Buffer::from))
}

/// The index with each module `cuts` names laid onto that cut, or absent when
/// nothing moved. `edit` is asked only of a held module laid onto another cut.
#[napi(catch_unwind)]
pub fn follow_case_cuts(index: Buffer, cuts: Vec<CaseCut>, edit: Function<String, Option<CaseEdit>>) -> napi::Result<Option<Buffer>> {
    let cuts: Vec<RowCut> = cuts.into_iter().map(|cut| RowCut { file: cut.file, blocks: cut.blocks, owners: cut.owners }).collect();
    let followed = follow_cuts(&index, &cuts, &|file| asked(&edit, file)).map_err(napi::Error::from_reason)?;
    Ok(followed.map(Buffer::from))
}

/// One region of a cut, as the comparison of two cuts reads it.
#[napi(object)]
pub struct CaseRegion {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
}

fn blocks_of(regions: Vec<CaseRegion>) -> Vec<Block> {
    regions.into_iter().map(|region| Block { kind: region.kind, name: region.name, path: region.path, start_line: region.start_line, end_line: region.end_line, source: false }).collect()
}

/// Whether a case index's cut of a module stands at other text than a snapshot row's cut of it.
#[napi]
pub fn case_cut_apart(index: Vec<CaseRegion>, snapshot: Vec<CaseRegion>) -> bool {
    cut_apart(&blocks_of(index), &blocks_of(snapshot))
}
