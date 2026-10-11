//! A journey file opened once, its columns checked against each other, and
//! every question about it answered off those columns.
//!
//! The projection and the selection read the same file the same way; this is
//! that one reading. Nothing is decompressed until a question reaches it
//! ([`journey_lazy`](crate::journey_lazy)), and nothing here expands a set until
//! a caller names the region it wants, because a stitched day holds its
//! crossings as interned sets and expanding all of them is exactly the cost the
//! addon exists to avoid. A module is found by its path with a binary search:
//! both encoders sort the string table by code unit and write module rows in
//! that order, so ascending module ids are ascending paths. A file whose ids do
//! not ascend — one written before rows were sorted, or holding a path twice —
//! is answered through a table of every path instead, built the first time it
//! is asked.

use std::cell::OnceCell;
use std::collections::HashMap;
use std::fs;

use crate::case_preconditions;
use crate::journey_format;
use crate::journey_lazy::{Handle, Lazy};
use crate::journey_stitch::decode_set;
use crate::order;

/// One region of a module, as the columns spell it.
#[derive(Clone, Copy)]
pub(crate) struct Region {
    /// The region's row in the file, which is its identity within this reading.
    pub at: usize,
    pub kind: u32,
    pub name: u32,
    pub path: u32,
    pub start: u32,
    pub end: u32,
    pub source: bool,
    pub loaded: bool,
    pub called: u32,
}

struct Columns {
    strings: Handle,
    string_offsets: Handle,
    test_ids: Handle,
    test_files: Handle,
    test_names: Handle,
    /// `tests.stopped`, absent in a file written before cases carried it.
    test_settled: Option<Handle>,
    /// `tests.casePreconditions`, absent where no case was listened to.
    test_said: Option<Handle>,
    module_files: Handle,
    module_blocks: Handle,
    kinds: Handle,
    names: Handle,
    paths: Handle,
    starts: Handle,
    ends: Handle,
    sources: Handle,
    called: Handle,
    loaded: Handle,
    sets: Handle,
    set_offsets: Handle,
}

pub(crate) struct Journey {
    lazy: Lazy,
    columns: Columns,
    tests: usize,
    modules: usize,
    /// Whether module ids strictly ascend, so a path can be binary-searched.
    sorted: bool,
    by_path: OnceCell<HashMap<String, usize>>,
}

impl Journey {
    pub fn open(file: &str) -> Result<Journey, String> {
        let bytes = fs::read(file).map_err(|error| format!("cannot read {file}: {error}"))?;
        Journey::of(file, bytes)
    }

    /// The journey file `file` held as `bytes`, for a caller that has read them:
    /// a coverage record's case index, or a case index on its own.
    pub fn of(file: &str, bytes: Vec<u8>) -> Result<Journey, String> {
        let bytes = crate::journey_columns::recorded_cases(bytes);
        let lazy = Lazy::new(bytes, journey_format::FORMAT)
            .map_err(|error| format!("cannot read journey file {file}: {error}"))?;
        let columns = Columns {
            strings: lazy.column("strings.blob", 1)?,
            string_offsets: lazy.column("strings.off", 4)?,
            test_ids: lazy.column("tests.id", 4)?,
            test_files: lazy.column("tests.file", 4)?,
            test_names: lazy.column("tests.name", 4)?,
            test_settled: if lazy.has("tests.stopped") { Some(lazy.column("tests.stopped", 1)?) } else { None },
            test_said: if lazy.has(case_preconditions::COLUMN) { Some(lazy.column(case_preconditions::COLUMN, 4)?) } else { None },
            module_files: lazy.column("modules.file", 4)?,
            module_blocks: lazy.column("modules.blocks", 4)?,
            kinds: lazy.column("blocks.kind", 4)?,
            names: lazy.column("blocks.name", 4)?,
            paths: lazy.column("blocks.path", 4)?,
            starts: lazy.column("blocks.start", 4)?,
            ends: lazy.column("blocks.end", 4)?,
            sources: lazy.column("blocks.source", 1)?,
            called: lazy.column("blocks.calledSet", 4)?,
            loaded: lazy.column("blocks.loaded", 1)?,
            sets: lazy.column("sets.blob", 1)?,
            set_offsets: lazy.column("sets.off", 4)?,
        };
        let tests = lazy.rows(columns.test_ids);
        let modules = lazy.rows(columns.module_files);
        let mut journey = Journey { lazy, columns, tests, modules, sorted: false, by_path: OnceCell::new() };
        journey.check()?;
        journey.sorted = journey.ascending()?;
        Ok(journey)
    }

    /// Row counts agree, and every module's regions are a range inside the
    /// region columns. The counts come from the header; the bounds are the one
    /// column read whole here, one word per module.
    fn check(&self) -> Result<(), String> {
        let rows = |column| self.lazy.rows(column);
        let c = &self.columns;
        if rows(c.test_files) != self.tests
            || rows(c.test_names) != self.tests
            || c.test_settled.is_some_and(|column| rows(column) != self.tests)
            || c.test_said.is_some_and(|column| rows(column) != self.tests)
        {
            return Err("test columns disagree".to_owned());
        }
        if rows(c.module_blocks) != self.modules + 1 {
            return Err("module columns disagree".to_owned());
        }
        let blocks = rows(c.kinds);
        let lengths = [rows(c.names), rows(c.paths), rows(c.starts), rows(c.ends), rows(c.sources), rows(c.called), rows(c.loaded)];
        if lengths.into_iter().any(|length| length != blocks) {
            return Err("block columns disagree".to_owned());
        }
        let mut previous = 0;
        for module in 0..=self.modules {
            let bound = self.lazy.word(c.module_blocks, module)? as usize;
            if bound < previous || bound > blocks {
                return Err("module block bounds are invalid".to_owned());
            }
            previous = bound;
        }
        Ok(())
    }

    fn ascending(&self) -> Result<bool, String> {
        let mut previous = None;
        for module in 0..self.modules {
            let id = self.lazy.word(self.columns.module_files, module)?;
            if previous.is_some_and(|before| before >= id) {
                return Ok(false);
            }
            previous = Some(id);
        }
        Ok(true)
    }

    pub fn text(&self, id: u32) -> Result<&str, String> {
        let bytes = self.lazy.entry(self.columns.strings, self.columns.string_offsets, id as usize)?;
        std::str::from_utf8(bytes).map_err(|_| "journey string is not UTF-8".to_owned())
    }

    pub fn tests(&self) -> usize {
        self.tests
    }

    pub fn test_id(&self, test: usize) -> Result<&str, String> {
        self.text(self.lazy.word(self.columns.test_ids, test)?)
    }

    pub fn test_file(&self, test: usize) -> Result<&str, String> {
        self.text(self.lazy.word(self.columns.test_files, test)?)
    }

    pub fn test_name(&self, test: usize) -> Result<&str, String> {
        self.text(self.lazy.word(self.columns.test_names, test)?)
    }

    /// How the case settled, when the file says.
    pub fn test_settled(&self, test: usize) -> Result<Option<u8>, String> {
        self.columns.test_settled.map(|column| self.lazy.byte(column, test)).transpose()
    }

    /// What the case said it arranged, as the column spells it, when it was listened to.
    pub fn test_said(&self, test: usize) -> Result<Option<&str>, String> {
        match self.columns.test_said.map(|column| self.lazy.word(column, test)).transpose()? {
            None | Some(case_preconditions::UNHEARD) => Ok(None),
            Some(word) => self.text(word).map(Some),
        }
    }

    /// Each test's file, by test index.
    pub fn test_file_names(&self) -> Result<Vec<&str>, String> {
        (0..self.tests).map(|test| self.test_file(test)).collect()
    }

    pub fn modules(&self) -> usize {
        self.modules
    }

    pub fn module_file(&self, module: usize) -> Result<&str, String> {
        self.text(self.lazy.word(self.columns.module_files, module)?)
    }

    /// Every file the journey holds a module row for, in row order.
    pub fn files(&self) -> Result<Vec<&str>, String> {
        (0..self.modules).map(|module| self.module_file(module)).collect()
    }

    /// The module row for `file`: a binary search of the module paths, or the
    /// table of every path when they are not in order.
    pub fn module_of(&self, file: &str) -> Result<Option<usize>, String> {
        if !self.sorted {
            if self.by_path.get().is_none() {
                let mut table = HashMap::with_capacity(self.modules);
                for module in 0..self.modules {
                    table.insert(self.module_file(module)?.to_owned(), module);
                }
                let _ = self.by_path.set(table);
            }
            return Ok(self.by_path.get().and_then(|table| table.get(file).copied()));
        }
        let (mut low, mut high) = (0, self.modules);
        while low < high {
            let middle = low + (high - low) / 2;
            match order::code_unit(self.module_file(middle)?, file) {
                std::cmp::Ordering::Less => low = middle + 1,
                std::cmp::Ordering::Greater => high = middle,
                std::cmp::Ordering::Equal => return Ok(Some(middle)),
            }
        }
        Ok(None)
    }

    /// One module's regions, read out of the columns that hold them.
    pub fn regions(&self, module: usize) -> Result<Vec<Region>, String> {
        let c = &self.columns;
        let from = self.lazy.word(c.module_blocks, module)? as usize;
        let to = self.lazy.word(c.module_blocks, module + 1)? as usize;
        (from..to)
            .map(|at| {
                Ok(Region {
                    at,
                    kind: self.lazy.word(c.kinds, at)?,
                    name: self.lazy.word(c.names, at)?,
                    path: self.lazy.word(c.paths, at)?,
                    start: self.lazy.word(c.starts, at)?,
                    end: self.lazy.word(c.ends, at)?,
                    source: self.lazy.byte(c.sources, at)? == 1,
                    loaded: self.lazy.byte(c.loaded, at)? == 1,
                    called: self.lazy.word(c.called, at)?,
                })
            })
            .collect()
    }

    /// The tests in set `set`: the ones that entered every region pointing at it.
    pub fn members(&self, set: u32) -> Result<Vec<u32>, String> {
        let bytes = self
            .lazy
            .entry(self.columns.sets, self.columns.set_offsets, set as usize)
            .map_err(|_| format!("journey set id {set} is out of bounds"))?;
        decode_set(bytes, self.tests)
    }
}

/// Whether a region is source and overlaps one of the inclusive `ranges`.
pub(crate) fn overlaps(region: &Region, ranges: &[(u32, u32)]) -> bool {
    region.source && ranges.iter().any(|(start, end)| region.start <= *end && *start <= region.end)
}

/// Whether a region, with source or without, holds a line of one of the
/// inclusive `ranges`: the regions `charge_line` may charge for them. A region
/// written without an origin holds no line at both ends, so it holds none.
pub(crate) fn holds_any(region: &Region, ranges: &[(u32, u32)]) -> bool {
    let to = region.start.max(region.end);
    ranges.iter().any(|(start, end)| region.start <= *end && *start <= to)
}

/// Add to `into` the regions among `candidates` an edit to `line` charges, by
/// the rule `chargeLine` in `blocks-around.ts` states, in their order among
/// `candidates`: the narrowest regions with source holding the line, the next
/// ones out while a charged region's text on the line sits beside theirs, any
/// region whose own text is on the line, and every region without source on
/// it. `kinds[at]` is the kind of `candidates[at]`. Nothing, as
/// `blocksChargedAt` answers, when no region with source holds the line.
pub(crate) fn charge_line(candidates: &[Region], kinds: &[&str], line: u32, into: &mut Vec<Region>) {
    into.clear();
    if line < 1 {
        return;
    }
    let mut found: Vec<usize> = Vec::new();
    let mut around: Vec<usize> = Vec::new();
    for (at, region) in candidates.iter().enumerate() {
        if region.start > line || region.start.max(region.end) < line {
            continue;
        }
        if region.source {
            around.push(at);
        } else {
            found.push(at);
        }
    }
    if around.is_empty() {
        return;
    }
    let span = |at: usize| i64::from(candidates[at].end) - i64::from(candidates[at].start);
    around.sort_by_key(|at| span(*at));
    let mut index = 0;
    let mut outwards = true;
    while index < around.len() {
        let width = span(around[index]);
        let mut next = index;
        while next < around.len() && span(around[next]) == width {
            next += 1;
        }
        let group = &around[index..next];
        let beside_resume = group.iter().all(|at| kinds[*at] == "resume");
        let shares = group.iter().any(|at| shares_line(&candidates[*at], kinds[*at], line, beside_resume));
        if outwards || shares {
            found.extend_from_slice(group);
        }
        outwards = shares;
        index = next;
    }
    found.sort_unstable();
    found.dedup();
    into.extend(found.into_iter().map(|at| candidates[at]));
}

/// Whether the region's text on `line` sits beside a wider region's, by the
/// rule `sharesLine` in `blocks-around.ts` states.
fn shares_line(region: &Region, kind: &str, line: u32, unaccompanied: bool) -> bool {
    match kind {
        "module" | "continuation" => false,
        "resume" => unaccompanied,
        _ => region.start == line || (kind == "function" && region.end == line),
    }
}

/// `[start, end]` pairs out of the flat list the boundary carries.
pub(crate) fn pairs(ranges: &[u32]) -> Vec<(u32, u32)> {
    ranges.chunks_exact(2).map(|pair| (pair[0], pair[1])).collect()
}
