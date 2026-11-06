//! The coverage rows of a test coverage record, read on this side: which test
//! files the record holds, and per module its regions and the test files whose
//! cases ran its top level.
//!
//! `format-layout.ts` writes these columns and `openTestCoverage` in
//! `format-view.ts` reads them in JavaScript. That is the twin this must agree
//! with: the same reading for a native consumer, checked the same way, refusing
//! what it refuses. One fixture, "the coverage rows the addon and
//! openTestCoverage read" in `distill-native.test.ts`, is read by both and pins
//! them to each other. Only the columns a row needs are decompressed, every bound is checked
//! against the column it indexes, and a loader set is expanded only when a
//! caller asks for one block's. The layout constants below are the encoder's,
//! and the tests that encode a record in JavaScript and read it here pin them.

// compass: variance-authority.reach.crossings

use std::ops::Range;

use crate::journey_columns::{self, Decoded};
use crate::case_shard::strings;
use crate::crossing_sets::decode_set;
use crate::record_layout::LAYOUT;
/// `BLOCK_KINDS` in `format-layout.ts`.
pub(crate) const MODULE: u32 = 0;
pub(crate) const FUNCTION: u32 = 1;
/// `NO_LINE` in `written-lines.ts`: a region that kept no lines.
pub(crate) const NO_LINE: u32 = 0;
/// What a record that holds cases and none of the coverage columns is refused
/// with: `WITHOUT_COVERAGE` in `distill-native.ts` reads it as
/// `RecordWithoutCoverage`, as `openTestCoverage` throws for the same record.
pub(crate) const WITHOUT_COVERAGE: &str = "the record holds no coverage rows";
const COLUMNS: [&str; 14] = [
    "strings.blob",
    "strings.off",
    "tests.path",
    "tests.complete",
    "modules.path",
    "modules.instrumented",
    "modules.blocks",
    "blocks.kind",
    "blocks.start",
    "blocks.end",
    "blocks.source",
    "blocks.loadedSet",
    "sets.blob",
    "sets.off",
];

/// A record's coverage rows, decoded and checked against each other.
pub(crate) struct CoverageRows {
    text: Vec<String>,
    test_path: Vec<u32>,
    complete: Vec<u32>,
    module_path: Vec<u32>,
    instrumented: Vec<u32>,
    bounds: Vec<u32>,
    kind: Vec<u32>,
    start: Vec<u32>,
    end: Vec<u32>,
    source: Vec<u32>,
    loaded_set: Vec<u32>,
    sets: Vec<u8>,
    set_offsets: Vec<u32>,
}

impl CoverageRows {
    pub fn read(bytes: &[u8]) -> Result<CoverageRows, String> {
        let (version, decoded) = journey_columns::decode_wanted(bytes, &COLUMNS)?;
        if !LAYOUT.coverage.readable(version) {
            return Err(format!("unsupported test coverage version: {version}"));
        }
        // None of the coverage is absent coverage; some of it is a broken record.
        if decoded.is_empty() {
            return Err(WITHOUT_COVERAGE.to_owned());
        }
        let rows = CoverageRows::of(&decoded)?;
        let blocks = rows.kind.len();
        if rows.complete.len() != rows.test_path.len() {
            return Err("coverage test columns disagree".to_owned());
        }
        if rows.instrumented.len() != rows.module_path.len() || rows.bounds.len() != rows.module_path.len() + 1 {
            return Err("coverage module columns disagree".to_owned());
        }
        if [rows.start.len(), rows.end.len(), rows.source.len(), rows.loaded_set.len()].iter().any(|length| *length != blocks) {
            return Err("coverage block columns disagree".to_owned());
        }
        // `presence` in `format-validation.ts`: a module has regions exactly when the build says it instrumented one.
        if (0..rows.modules()).any(|module| (rows.instrumented[module] == 1) != (rows.bounds[module + 1] > rows.bounds[module])) {
            return Err("a coverage module's regions disagree with whether it was instrumented".to_owned());
        }
        Ok(rows)
    }

    fn of(decoded: &Decoded) -> Result<CoverageRows, String> {
        Ok(CoverageRows {
            text: strings(decoded)?,
            test_path: decoded.words("tests.path")?,
            complete: decoded.values("tests.complete")?,
            module_path: decoded.words("modules.path")?,
            instrumented: decoded.values("modules.instrumented")?,
            bounds: decoded.words("modules.blocks")?,
            kind: decoded.values("blocks.kind")?,
            start: decoded.words("blocks.start")?,
            end: decoded.words("blocks.end")?,
            source: decoded.values("blocks.source")?,
            loaded_set: decoded.words("blocks.loadedSet")?,
            sets: decoded.bytes("sets.blob")?,
            set_offsets: decoded.words("sets.off")?,
        })
    }

    fn text(&self, id: u32) -> Result<&str, String> {
        self.text.get(id as usize).map(String::as_str).ok_or_else(|| format!("coverage string id {id} is out of bounds"))
    }

    /// How many test rows the record holds.
    pub fn tests(&self) -> usize {
        self.test_path.len()
    }

    /// The test file of test row `test`.
    pub fn test_file(&self, test: usize) -> Result<&str, String> {
        self.text(self.test_path[test])
    }

    /// Whether test row `test` recorded every module its file loaded.
    pub fn complete(&self, test: usize) -> bool {
        self.complete[test] == 1
    }

    pub fn modules(&self) -> usize {
        self.module_path.len()
    }

    pub fn module_file(&self, module: usize) -> Result<&str, String> {
        self.text(self.module_path[module])
    }

    pub fn instrumented(&self, module: usize) -> bool {
        self.instrumented[module] == 1
    }

    /// The blocks of `module`, as rows of the block columns.
    pub fn blocks(&self, module: usize) -> Result<Range<usize>, String> {
        let (from, to) = (self.bounds[module] as usize, self.bounds[module + 1] as usize);
        if from > to || to > self.kind.len() {
            return Err("coverage module block bounds are invalid".to_owned());
        }
        Ok(from..to)
    }

    pub fn kind(&self, block: usize) -> u32 {
        self.kind[block]
    }

    pub fn start(&self, block: usize) -> u32 {
        self.start[block]
    }

    pub fn end(&self, block: usize) -> u32 {
        self.end[block]
    }

    /// Whether the block is the project's source rather than generated or bundled code.
    pub fn source(&self, block: usize) -> bool {
        self.source[block] == 1
    }

    /// The test rows whose cases ran `block` while its module loaded.
    pub fn loaded_by(&self, block: usize) -> Result<Vec<u32>, String> {
        let set = self.loaded_set[block];
        let at = set as usize;
        match (self.set_offsets.get(at), self.set_offsets.get(at + 1)) {
            (Some(from), Some(to)) if from <= to && (*to as usize) <= self.sets.len() => {
                decode_set(&self.sets[*from as usize..*to as usize], self.tests())
            }
            _ => Err(format!("coverage set id {set} is out of bounds")),
        }
    }
}
