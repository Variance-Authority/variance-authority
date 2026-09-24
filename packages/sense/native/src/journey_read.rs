//! A journey file opened once, its columns checked against each other, and
//! every question about it answered off those columns.
//!
//! The projection and the selection read the same file the same way; this is
//! that one reading. Nothing here expands a set until a caller names the region
//! it wants, because a stitched day holds its crossings as interned sets and
//! expanding all of them is exactly the cost the addon exists to avoid.

use std::collections::HashMap;
use std::fs;

use crate::journey_columns;
use crate::journey_format;
use crate::journey_stitch::{decode_set, string, strings};

pub(crate) struct Journey {
    pub strings: Vec<String>,
    pub test_ids: Vec<u32>,
    pub test_files: Vec<u32>,
    pub test_names: Vec<u32>,
    /// `tests.stopped`, absent in a file written before cases carried it.
    pub test_settled: Option<Vec<u8>>,
    pub module_files: Vec<u32>,
    module_blocks: Vec<u32>,
    pub kinds: Vec<u32>,
    pub names: Vec<u32>,
    pub paths: Vec<u32>,
    pub starts: Vec<u32>,
    pub ends: Vec<u32>,
    pub sources: Vec<u8>,
    pub called: Vec<u32>,
    pub loaded: Vec<u8>,
    set_bytes: Vec<u8>,
    set_offsets: Vec<u32>,
}

impl Journey {
    pub fn open(file: &str) -> Result<Journey, String> {
        let bytes = fs::read(file).map_err(|error| format!("cannot read {file}: {error}"))?;
        let decoded = journey_columns::decode(&bytes, journey_format::FORMAT)
            .map_err(|error| format!("cannot read journey file {file}: {error}"))?;
        let journey = Journey {
            strings: strings(&decoded)?,
            test_ids: decoded.words("tests.id")?,
            test_files: decoded.words("tests.file")?,
            test_names: decoded.words("tests.name")?,
            test_settled: decoded.bytes("tests.stopped").ok(),
            module_files: decoded.words("modules.file")?,
            module_blocks: decoded.words("modules.blocks")?,
            kinds: decoded.words("blocks.kind")?,
            names: decoded.words("blocks.name")?,
            paths: decoded.words("blocks.path")?,
            starts: decoded.words("blocks.start")?,
            ends: decoded.words("blocks.end")?,
            sources: decoded.bytes("blocks.source")?,
            called: decoded.words("blocks.calledSet")?,
            loaded: decoded.bytes("blocks.loaded")?,
            set_bytes: decoded.bytes("sets.blob")?,
            set_offsets: decoded.words("sets.off")?,
        };
        journey.check()?;
        Ok(journey)
    }

    fn check(&self) -> Result<(), String> {
        let tests = self.test_ids.len();
        if self.test_files.len() != tests
            || self.test_names.len() != tests
            || self.test_settled.as_ref().is_some_and(|column| column.len() != tests)
        {
            return Err("test columns disagree".to_owned());
        }
        if self.module_blocks.len() != self.module_files.len() + 1 {
            return Err("module columns disagree".to_owned());
        }
        let blocks = self.kinds.len();
        let lengths = [
            self.names.len(),
            self.paths.len(),
            self.starts.len(),
            self.ends.len(),
            self.sources.len(),
            self.called.len(),
            self.loaded.len(),
        ];
        if lengths.into_iter().any(|length| length != blocks) {
            return Err("block columns disagree".to_owned());
        }
        for bounds in self.module_blocks.windows(2) {
            if bounds[1] < bounds[0] || bounds[1] as usize > blocks {
                return Err("module block bounds are invalid".to_owned());
            }
        }
        Ok(())
    }

    pub fn text(&self, id: u32) -> Result<&str, String> {
        string(&self.strings, id)
    }

    pub fn tests(&self) -> usize {
        self.test_ids.len()
    }

    /// Each test's file, by test index.
    pub fn test_file_names(&self) -> Result<Vec<&str>, String> {
        self.test_files.iter().map(|id| self.text(*id)).collect()
    }

    /// The module row for each file the journey holds one for.
    pub fn by_file(&self) -> Result<HashMap<&str, usize>, String> {
        self.module_files
            .iter()
            .enumerate()
            .map(|(at, id)| Ok((self.text(*id)?, at)))
            .collect()
    }

    /// The block indices of one module.
    pub fn blocks(&self, module: usize) -> std::ops::Range<usize> {
        self.module_blocks[module] as usize..self.module_blocks[module + 1] as usize
    }

    /// The tests that entered one block.
    pub fn members(&self, block: usize) -> Result<Vec<u32>, String> {
        let set = self.called[block];
        let at = set as usize;
        let (Some(&from), Some(&to)) = (self.set_offsets.get(at), self.set_offsets.get(at + 1)) else {
            return Err(format!("journey set id {set} is out of bounds"));
        };
        let (from, to) = (from as usize, to as usize);
        if to < from || to > self.set_bytes.len() {
            return Err("journey set bounds are invalid".to_owned());
        }
        decode_set(&self.set_bytes[from..to], self.tests())
    }

    /// Whether a block is source and overlaps one of the inclusive `ranges`.
    pub fn overlaps(&self, block: usize, ranges: &[(u32, u32)]) -> bool {
        self.sources[block] == 1
            && ranges.iter().any(|(start, end)| self.starts[block] <= *end && *start <= self.ends[block])
    }

    /// The source blocks innermost at `line` among `candidates`, by the rule
    /// `innermostAt` in `reverse.ts` states: a region holding the line that holds
    /// no other region holding it, unless the two share a span.
    pub fn innermost_at(&self, candidates: &[usize], line: u32, into: &mut Vec<usize>) {
        into.clear();
        if line < 1 {
            return;
        }
        let holds = |block: usize| self.sources[block] == 1 && self.starts[block] <= line && line <= self.ends[block];
        for &block in candidates {
            if !holds(block) {
                continue;
            }
            let inner = candidates.iter().any(|&other| {
                other != block
                    && holds(other)
                    && self.starts[block] <= self.starts[other]
                    && self.ends[block] >= self.ends[other]
                    && (self.starts[block] != self.starts[other] || self.ends[block] != self.ends[other])
            });
            if !inner {
                into.push(block);
            }
        }
    }
}

/// `[start, end]` pairs out of the flat list the boundary carries.
pub(crate) fn pairs(ranges: &[u32]) -> Vec<(u32, u32)> {
    ranges.chunks_exact(2).map(|pair| (pair[0], pair[1])).collect()
}
