//! The case layering, as the Node side calls it: whole indexes in, whole
//! indexes out, so no row crosses into V8 (spec 0100).

use std::path::PathBuf;

use napi::bindgen_prelude::{Buffer, Function};
use napi_derive::napi;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::journey_record::Block;

use super::case_layer::{follow_cuts, layer, layer_before, Edits, Files, Present, RowCut};
use super::case_layer_landing::{Edit, Hunk};

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

/// One module's edit; an absent `edit` is one that could not be read.
#[napi(object)]
pub struct CaseFileEdit {
    pub file: String,
    pub edit: Option<CaseEdit>,
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

fn edits_of(edits: Vec<CaseFileEdit>) -> FxHashMap<String, Option<Edit>> {
    edits.into_iter().map(|each| (each.file, each.edit.map(edit_of))).collect()
}

/// One run's case index laid over the one it replaces. `edit` answers a
/// module's edit from the text the index cut it at to the text the run
/// recorded, `undefined` where it could not be read; it is asked only of a
/// module both indexes hold. Without it, every module reads as the one text.
#[napi(catch_unwind)]
pub fn layer_case_index(previous: Option<Buffer>, fresh: Buffer, files: CaseRunFiles, edit: Option<Function<String, Option<CaseEdit>>>) -> napi::Result<CaseLayers> {
    let ask = |file: &str| -> Result<Option<Edit>, String> {
        let asked = edit.as_ref().expect("asked only with an edit");
        asked.call(file.to_owned()).map(|found| found.map(edit_of)).map_err(|error| error.reason.clone())
    };
    let present = match (files.present_under, files.present_among) {
        (_, Some(among)) => Present::Among(among.into_iter().collect()),
        (Some(root), None) => Present::Under(PathBuf::from(root)),
        (None, None) => Present::All,
    };
    let laid = Files {
        ran: files.ran.into_iter().collect(),
        finished: files.finished.into_iter().collect(),
        present,
        edits: if edit.is_some() { Edits::Asked(&ask) } else { Edits::One },
        same_text: files.same_text.map(|files| files.into_iter().collect::<FxHashSet<_>>()),
        same_before_text: files.same_before_text.map(|files| files.into_iter().collect::<FxHashSet<_>>()),
    };
    let layers = layer(previous.as_deref(), &fresh, &laid, files.base.as_deref(), files.before).map_err(napi::Error::from_reason)?;
    Ok(CaseLayers {
        merged: layers.merged.into(),
        cases: layers.cases,
        last: layers.last,
        announced: layers.announced,
        before: layers.before.map(Buffer::from),
        unlined: layers.unlined,
    })
}

/// What the runs at one commit retired, as one before: `retired` laid over `kept`.
#[napi(catch_unwind)]
pub fn layer_case_before(kept: Option<Buffer>, retired: Option<Buffer>, ran: Vec<String>) -> napi::Result<Option<Buffer>> {
    let laid = layer_before(kept.as_deref(), retired.as_deref(), ran.into_iter().collect()).map_err(napi::Error::from_reason)?;
    Ok(laid.map(Buffer::from))
}

/// The index with each module `cuts` names laid onto that cut, or absent when nothing moved.
#[napi(catch_unwind)]
pub fn follow_case_cuts(index: Buffer, cuts: Vec<CaseCut>, edits: Vec<CaseFileEdit>) -> napi::Result<Option<Buffer>> {
    let cuts: Vec<RowCut> = cuts.into_iter().map(|cut| RowCut { file: cut.file, blocks: cut.blocks, owners: cut.owners }).collect();
    let followed = follow_cuts(&index, &cuts, &edits_of(edits)).map_err(napi::Error::from_reason)?;
    Ok(followed.map(Buffer::from))
}
