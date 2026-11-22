//! The cases a case index's last-run layer names, resolved against the index
//! in the addon: a layer names most cases by their row, and resolving a row
//! reads two columns and the strings they name, not the whole index.

use napi_derive::napi;

use crate::journey_columns::{self, Decoded};
use crate::record_parts;

/// The rows' ids and test files of an index, read on demand: only the strings asked are spelled.
struct Rows {
    blob: Vec<u8>,
    offsets: Vec<u32>,
    ids: Vec<u32>,
    files: Vec<u32>,
}

impl Rows {
    fn open(index: &[u8]) -> Result<Self, String> {
        let (_, decoded): (u8, Decoded) = journey_columns::decode_wanted(index, &["strings.blob", "strings.off", "tests.id", "tests.file"])?;
        let rows = Self { blob: decoded.held("strings.blob")?.to_vec(), offsets: decoded.words("strings.off")?, ids: decoded.words("tests.id")?, files: decoded.words("tests.file")? };
        if rows.files.len() != rows.ids.len() {
            return Err("test columns disagree".to_owned());
        }
        Ok(rows)
    }

    fn string(&self, id: u32) -> Result<String, String> {
        let at = id as usize;
        let (Some(from), Some(to)) = (self.offsets.get(at), self.offsets.get(at + 1)) else { return Err("string bounds are invalid".to_owned()) };
        let (from, to) = (*from as usize, *to as usize);
        if to < from || to > self.blob.len() {
            return Err("string bounds are invalid".to_owned());
        }
        std::str::from_utf8(&self.blob[from..to]).map(str::to_owned).map_err(|_| "journey string is not UTF-8".to_owned())
    }

    fn id(&self, row: usize) -> Result<String, String> {
        self.string(self.ids[row])
    }
}

/// The id of each of `rows` in `index`, absent for a row the index does not hold.
#[napi(catch_unwind)]
pub fn case_row_ids(index: napi::bindgen_prelude::Buffer, rows: Vec<u32>) -> napi::Result<Vec<Option<String>>> {
    let held = Rows::open(&index).map_err(napi::Error::from_reason)?;
    rows.into_iter()
        .map(|row| if (row as usize) < held.ids.len() { held.id(row as usize).map(Some) } else { Ok(None) })
        .collect::<Result<_, _>>()
        .map_err(napi::Error::from_reason)
}

/// One test file and the cases of it a run executed.
#[napi(object)]
pub struct CasesOfFile {
    pub file: String,
    pub cases: Vec<String>,
}

/// The cases the last-run layer `last` names, by test file in the order
/// `index` first holds each, each file's cases in index order.
#[napi(catch_unwind)]
pub fn cases_ran_of(last: napi::bindgen_prelude::Buffer, index: napi::bindgen_prelude::Buffer) -> napi::Result<Vec<CasesOfFile>> {
    ran(&last, &index).map_err(napi::Error::from_reason)
}

fn ran(last: &[u8], index: &[u8]) -> Result<Vec<CasesOfFile>, String> {
    let held = Rows::open(index)?;
    let ids = (0..held.ids.len()).map(|row| held.id(row)).collect::<Result<Vec<_>, _>>()?;
    let named: std::collections::HashSet<String> = record_parts::last_cases(last, Some(&ids))?.into_iter().collect();
    let mut out: Vec<CasesOfFile> = Vec::new();
    let mut at_file: rustc_hash::FxHashMap<u32, usize> = rustc_hash::FxHashMap::default();
    for (row, id) in ids.into_iter().enumerate() {
        if !named.contains(&id) {
            continue;
        }
        let file = held.files[row];
        let slot = match at_file.get(&file) {
            Some(slot) => *slot,
            None => {
                out.push(CasesOfFile { file: held.string(file)?, cases: Vec::new() });
                at_file.insert(file, out.len() - 1);
                out.len() - 1
            }
        };
        out[slot].cases.push(id);
    }
    Ok(out)
}
