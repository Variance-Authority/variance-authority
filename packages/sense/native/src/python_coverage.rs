//! `pythonCoverage`: which regions of the Python reader's cut each test's lines
//! entered.
//!
//! The recorder is CPython's own probe (`sys.monitoring`), so what reaches the
//! addon is the lines each test executed, by file. A line is charged to the
//! innermost function `python_cut` declares around it, and a file is named by
//! the id a module journal carries, `path@digest`, so sense's fold cuts it
//! again exactly as it cuts a JavaScript module.
//!
//! A module body runs at import, once, under whichever test imported the file
//! first: a test that entered any function of a file is charged the file's
//! root too, so an edit to the body selects every test that ran the file, not
//! the one that imported it.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use napi::bindgen_prelude::Uint32Array;
use napi_derive::napi;
use variance_sense_instrument::native::Cut;

use crate::python_cut::{cut, Lines};

/// The lines one test executed in one file, 1-based.
#[napi(object)]
pub struct PythonLines {
    pub file: String,
    pub lines: Uint32Array,
}

/// One file a test entered: its module id and the ordinals of the regions entered.
#[napi(object)]
pub struct PythonEntered {
    pub id: String,
    pub ordinals: Uint32Array,
}

/// For each test, in order, the files under `root` its lines entered.
///
/// A file outside `root`, or one that is gone, is left out, since it is not the
/// checkout's; one the cut cannot parse is entered at its root alone, as a
/// module the reader cannot parse is, so an edit to it selects every test that
/// entered it.
/// bound: the tests of one test file and the files they entered
#[napi(js_name = "pythonCoverage", catch_unwind)]
pub fn python_coverage(cases: Vec<Vec<PythonLines>>, root: String) -> Vec<Vec<PythonEntered>> {
    let root = Path::new(&root);
    let mut files: HashMap<String, Option<Read>> = HashMap::new();
    cases
        .iter()
        .map(|case| {
            case.iter()
                .filter_map(|entered| {
                    let read = files.entry(entered.file.clone()).or_insert_with(|| Read::new(Path::new(&entered.file), root)).as_ref()?;
                    let mut ordinals = BTreeSet::new();
                    for line in entered.lines.iter() {
                        if let Some(ordinal) = read.charged(*line as usize) {
                            ordinals.insert(ordinal);
                        }
                    }
                    if ordinals.is_empty() {
                        return None;
                    }
                    ordinals.insert(0);
                    Some(PythonEntered { id: read.id.clone(), ordinals: Uint32Array::new(ordinals.into_iter().collect()) })
                })
                .collect()
        })
        .collect()
}

/// A Python file of the checkout, cut once for every test that entered it.
struct Read {
    id: String,
    cut: Option<Cut>,
    lines: Lines,
}

impl Read {
    fn new(path: &Path, root: &Path) -> Option<Read> {
        let relative = path.strip_prefix(root).ok()?;
        let source = std::fs::read_to_string(path).ok()?;
        let id = variance_sense_instrument::module_id(&relative.to_string_lossy().replace('\\', "/"), &source);
        Some(Read { id, cut: cut(&source), lines: Lines::new(source) })
    }

    /// The block a 1-based line is charged to; the root alone in a file the cut refuses.
    fn charged(&self, line: usize) -> Option<u32> {
        match &self.cut {
            Some(cut) => self.lines.charged(cut, line),
            None => Some(0),
        }
    }
}

#[cfg(test)]
#[path = "python_coverage_tests.rs"]
mod tests;
