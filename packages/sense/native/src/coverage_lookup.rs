//! Finding rows of a coverage record by path, and naming the rows a selection
//! found, without handing JavaScript a string it does not return.
//!
//! Both tables and the dictionary under them are sorted in UTF-16 code units
//! by the writer, so every question here is a binary search, and each probe
//! compares stored UTF-8 bytes against the asked path's without building a
//! string. A run of paths or of the dictionary is decompressed once for as long
//! as the record is open; what crosses back to JavaScript is row numbers, and
//! the strings of the rows a selection is about to report.

// compass: variance-authority.reach

use std::cmp::Ordering;
use std::collections::HashMap;

use napi::bindgen_prelude::{FnArgs, FunctionRef, Uint32Array, Uint8Array};
use napi::{Env, Result};
use napi_derive::napi;

use crate::coverage_columns::{invalid, Blob, Door, Sections, Words};

/// The columns a lookup reads, each opened and none of them read yet.
pub(crate) struct Coverage {
    strings: usize,
    offsets: Words,
    blob: Blob,
    module_path: Words,
    test_path: Words,
    test_preconditions: Words,
    precondition_name: Words,
    block_name: Words,
    block_path: Words,
}

/// Two UTF-8 strings in the order their UTF-16 code units sort.
///
/// UTF-8 bytes sort as code points do, and code points sort as UTF-16 does
/// except at one seam: a character above U+FFFF is a surrogate pair from
/// U+D800, so it sorts before U+E000 to U+FFFF rather than after them. Where
/// the first differing byte puts one string on each side of that seam — a lead
/// byte of 0xEE or 0xEF against one of 0xF0 and up — the order flips.
pub(crate) fn code_unit_order(left: &[u8], right: &[u8]) -> Ordering {
    let Some(at) = left.iter().zip(right).position(|(a, b)| a != b) else {
        return left.len().cmp(&right.len());
    };
    let (a, b) = (left[at], right[at]);
    let seam = |low: u8, high: u8| (0xee..=0xef).contains(&low) && high >= 0xf0;
    if seam(a, b) {
        Ordering::Greater
    } else if seam(b, a) {
        Ordering::Less
    } else {
        a.cmp(&b)
    }
}

/// A binary search over `rows` sorted rows, probing as `Math.floor` midpoints
/// over an inclusive range do, so a run of equal rows yields the same one.
fn bisect(rows: usize, mut probe: impl FnMut(usize) -> Result<Ordering>) -> Result<Option<usize>> {
    let (mut low, mut high) = (0_i64, rows as i64 - 1);
    while low <= high {
        let middle = (low + high) / 2;
        match probe(middle as usize)? {
            Ordering::Equal => return Ok(Some(middle as usize)),
            Ordering::Less => low = middle + 1,
            Ordering::Greater => high = middle - 1,
        }
    }
    Ok(None)
}

impl Coverage {
    pub fn open(door: &dyn Door, length: usize) -> Result<Coverage> {
        let sections = Sections::open(door, length)?;
        let strings = sections.rows("strings.off")?.checked_sub(1).ok_or_else(invalid)?;
        let ids = u32::try_from(strings).ok();
        Ok(Coverage {
            strings,
            offsets: sections.words("strings.off", None)?,
            blob: sections.blob("strings.blob")?,
            module_path: sections.words("modules.path", ids)?,
            test_path: sections.words("tests.path", ids)?,
            test_preconditions: sections.words("tests.preconditions", None)?,
            precondition_name: sections.words("preconditions.name", ids)?,
            block_name: sections.words("blocks.name", ids)?,
            block_path: sections.words("blocks.path", ids)?,
        })
    }

    /// The bytes of dictionary entry `id`.
    fn text<'a>(&'a self, door: &dyn Door, id: u32) -> Result<&'a [u8]> {
        if id as usize >= self.strings {
            return Err(invalid());
        }
        self.blob.entry(door, &self.offsets, id as usize)
    }

    /// Dictionary entry `id`, as JavaScript would decode it.
    pub fn string(&self, door: &dyn Door, id: u32) -> Result<String> {
        Ok(String::from_utf8_lossy(self.text(door, id)?).into_owned())
    }

    fn path_at<'a>(&'a self, door: &dyn Door, column: &Words, row: usize) -> Result<&'a [u8]> {
        self.text(door, column.at(door, row)?)
    }

    /// One row of a path-sorted column holding `path`, if any does: the row
    /// the JavaScript search this replaced landed on, among equal rows.
    fn search(&self, door: &dyn Door, column: &Words, path: &[u8]) -> Result<Option<usize>> {
        bisect(column.rows(), |row| Ok(code_unit_order(self.path_at(door, column, row)?, path)))
    }

    /// Every module row recorded under exactly `path`, in row order.
    pub fn modules(&self, door: &dyn Door, path: &str) -> Result<Vec<u32>> {
        let column = &self.module_path;
        let wanted = path.as_bytes();
        let Some(found) = self.search(door, column, wanted)? else {
            return Ok(Vec::new());
        };
        let mut first = found;
        while first > 0 && self.path_at(door, column, first - 1)? == wanted {
            first -= 1;
        }
        let mut end = found + 1;
        while end < column.rows() && self.path_at(door, column, end)? == wanted {
            end += 1;
        }
        Ok((first..end).map(|row| row as u32).collect())
    }

    /// The test row recorded under exactly `path`.
    pub fn test(&self, door: &dyn Door, path: &str) -> Result<Option<u32>> {
        Ok(self.search(door, &self.test_path, path.as_bytes())?.map(|row| row as u32))
    }

    /// The id the dictionary interned `value` under.
    pub fn interned(&self, door: &dyn Door, value: &str) -> Result<Option<u32>> {
        let found = bisect(self.strings, |id| Ok(code_unit_order(self.text(door, id as u32)?, value.as_bytes())))?;
        Ok(found.map(|id| id as u32))
    }

    /// The paths of these test rows.
    pub fn test_paths(&self, door: &dyn Door, tests: &[u32]) -> Result<Vec<String>> {
        tests.iter().map(|test| self.string(door, self.test_path.at(door, *test as usize)?)).collect()
    }

    /// The preconditions of each test, as a run of names per test.
    fn each_test(&self, door: &dyn Door, mut visit: impl FnMut(usize, u32) -> Result<()>) -> Result<()> {
        let mut end = self.test_preconditions.at(door, 0)? as usize;
        for test in 0..self.test_path.rows() {
            let start = end;
            end = self.test_preconditions.at(door, test + 1)? as usize;
            for input in start..end {
                visit(test, self.precondition_name.at(door, input)?)?;
            }
        }
        Ok(())
    }

    /// Which tests declare any of `files`, each with the indices into `files`
    /// it declares, in the order its row holds them.
    pub fn governed(&self, door: &dyn Door, files: &[String]) -> Result<Vec<(u32, Vec<u32>)>> {
        let mut wanted = HashMap::new();
        for (at, file) in files.iter().enumerate() {
            if let Some(id) = self.interned(door, file)? {
                wanted.insert(id, at as u32);
            }
        }
        if wanted.is_empty() {
            return Ok(Vec::new());
        }
        let mut governed: Vec<(u32, Vec<u32>)> = Vec::new();
        self.each_test(door, |test, name| {
            if let Some(file) = wanted.get(&name) {
                match governed.last_mut() {
                    Some((row, held)) if *row == test as u32 => held.push(*file),
                    _ => governed.push((test as u32, vec![*file])),
                }
            }
            Ok(())
        })?;
        Ok(governed)
    }

    /// The preconditions every test declares other than its own file, in code-unit order.
    pub fn shared(&self, door: &dyn Door) -> Result<Vec<String>> {
        let tests = self.test_path.rows();
        if tests == 0 {
            return Ok(Vec::new());
        }
        let mut counts: HashMap<u32, usize> = HashMap::new();
        let mut end = self.test_preconditions.at(door, 0)? as usize;
        for test in 0..tests {
            let start = end;
            end = self.test_preconditions.at(door, test + 1)? as usize;
            let own = self.test_path.at(door, test)?;
            for input in start..end {
                let name = self.precondition_name.at(door, input)?;
                if name != own {
                    *counts.entry(name).or_default() += 1;
                }
            }
        }
        let mut shared = Vec::new();
        for (name, count) in counts {
            if count == tests {
                shared.push(self.text(door, name)?);
            }
        }
        shared.sort_by(|left, right| code_unit_order(left, right));
        Ok(shared.into_iter().map(|text| String::from_utf8_lossy(text).into_owned()).collect())
    }

    /// The name and path of each block, as indices into the distinct strings they use.
    pub fn regions(&self, door: &dyn Door, blocks: &[u32]) -> Result<(Vec<String>, Vec<u32>, Vec<u32>)> {
        let mut strings = Vec::new();
        let mut seen: HashMap<u32, u32> = HashMap::new();
        let mut index = |id: u32| -> Result<u32> {
            if let Some(at) = seen.get(&id) {
                return Ok(*at);
            }
            let at = strings.len() as u32;
            strings.push(self.string(door, id)?);
            seen.insert(id, at);
            Ok(at)
        };
        let mut names = Vec::with_capacity(blocks.len());
        let mut paths = Vec::with_capacity(blocks.len());
        for block in blocks {
            names.push(index(self.block_name.at(door, *block as usize)?)?);
            paths.push(index(self.block_path.at(door, *block as usize)?)?);
        }
        Ok((strings, names, paths))
    }
}

type Read = FunctionRef<FnArgs<(f64, f64)>, Uint8Array>;

/// The door JavaScript holds open: a call back into its own reader.
struct Asked<'a> {
    env: &'a Env,
    read: &'a Read,
}

impl Door for Asked<'_> {
    fn read(&self, from: usize, to: usize) -> Result<Vec<u8>> {
        let bytes = self.read.borrow_back(self.env)?.call((from as f64, to as f64).into())?;
        if bytes.len() != to - from {
            return Err(invalid());
        }
        Ok(bytes.to_vec())
    }
}

/// One coverage record's lookups, for as long as JavaScript holds it open.
#[napi]
pub struct CoverageLookup {
    coverage: Coverage,
    read: Read,
}

/// The lookups of the record `read` answers for, `length` bytes long. `read`
/// is asked for one range of the record at a time and returns its bytes.
#[napi(catch_unwind)]
pub fn open_coverage_lookup(env: Env, length: f64, read: Read) -> Result<CoverageLookup> {
    let coverage = Coverage::open(&Asked { env: &env, read: &read }, length as usize)?;
    Ok(CoverageLookup { coverage, read })
}

/// Which tests declare one of the asked files: a test row, and the indices of
/// the files it declares.
#[napi(object)]
pub struct CoverageGoverned {
    pub test: u32,
    pub files: Vec<u32>,
}

/// Names and paths of blocks, each an index into `strings`.
#[napi(object)]
pub struct CoverageRegions {
    pub strings: Vec<String>,
    pub names: Uint32Array,
    pub paths: Uint32Array,
}

#[napi]
impl CoverageLookup {
    fn door<'a>(&'a self, env: &'a Env) -> Asked<'a> {
        Asked { env, read: &self.read }
    }

    #[napi(catch_unwind)]
    pub fn modules(&self, env: Env, path: String) -> Result<Vec<u32>> {
        self.coverage.modules(&self.door(&env), &path)
    }

    #[napi(catch_unwind)]
    pub fn test(&self, env: Env, path: String) -> Result<Option<u32>> {
        self.coverage.test(&self.door(&env), &path)
    }

    #[napi(catch_unwind)]
    pub fn interned(&self, env: Env, value: String) -> Result<Option<u32>> {
        self.coverage.interned(&self.door(&env), &value)
    }

    #[napi(catch_unwind)]
    pub fn test_paths(&self, env: Env, tests: Uint32Array) -> Result<Vec<String>> {
        self.coverage.test_paths(&self.door(&env), &tests)
    }

    #[napi(catch_unwind)]
    pub fn governed(&self, env: Env, files: Vec<String>) -> Result<Vec<CoverageGoverned>> {
        let found = self.coverage.governed(&self.door(&env), &files)?;
        Ok(found.into_iter().map(|(test, files)| CoverageGoverned { test, files }).collect())
    }

    #[napi(catch_unwind)]
    pub fn shared(&self, env: Env) -> Result<Vec<String>> {
        self.coverage.shared(&self.door(&env))
    }

    #[napi(catch_unwind)]
    pub fn regions(&self, env: Env, blocks: Uint32Array) -> Result<CoverageRegions> {
        let (strings, names, paths) = self.coverage.regions(&self.door(&env), &blocks)?;
        Ok(CoverageRegions { strings, names: names.into(), paths: paths.into() })
    }
}

#[cfg(test)]
#[path = "coverage_lookup_tests.rs"]
mod tests;
