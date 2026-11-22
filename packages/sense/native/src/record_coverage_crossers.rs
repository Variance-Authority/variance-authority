//! Who crossed each region of the coverage rows a run hands over, and what each
//! test file ran over.
//!
//! The crossers come one of two ways. A caller holding them as names lists the
//! names once (`members`) and each region's crossers by index into them. A run
//! hands the columns its fold left (`crossed`), read here by module and
//! ordinal, so no region's crossers become strings on the way (#1748).

use napi::bindgen_prelude::Uint32Array;
use napi_derive::napi;
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use variance_sense_instrument::digest;

use crate::order;
use crate::record_coverage_encode::CoverageRows;

/// A run's crossings as its fold left them (`run_crossings.rs`).
#[napi(object)]
pub struct RunCrossed {
    /// The test files the columns name, by their number there.
    pub tests: Vec<String>,
    /// The modules the columns hold, in their order.
    pub ids: Vec<String>,
    /// Per module of `ids`, `[count, (ordinal, n, test…)*]`: who crossed each region.
    pub hits: Uint32Array,
    /// The same, for who crossed it before their first test.
    pub loaded: Uint32Array,
    /// The id of each module of the rows, in their order.
    pub modules: Vec<String>,
}

/// One column of crossers per region.
enum Lists<'a> {
    /// Per region, where its crossers start in `values`.
    Offsets(&'a [u32], &'a [u32]),
    /// A fold column, by module id and ordinal.
    Regions(FxHashMap<(&'a str, u32), (usize, usize)>, &'a [u32]),
}

/// Who crossed each region of `rows`, as rows of its tests.
pub(crate) struct Crossers<'a> {
    rows: &'a CoverageRows,
    names: &'a [String],
    /// Each name's test row; absent where no test row holds it.
    named: Vec<Option<u32>>,
    called: Lists<'a>,
    loaded: Lists<'a>,
}

impl<'a> Crossers<'a> {
    /// The crossers `rows` hold; a test row whose path another already holds is refused.
    pub(crate) fn of(rows: &'a CoverageRows) -> Result<Self, String> {
        let by_path: FxHashMap<&str, u32> = rows.test_path.iter().enumerate().map(|(row, path)| (path.as_str(), row as u32)).collect();
        if by_path.len() < rows.test_path.len() {
            return Err("duplicate test coverage observation".to_owned());
        }
        let Some(crossed) = &rows.crossed else {
            let named = rows.members.iter().map(|member| by_path.get(member.as_str()).copied()).collect();
            return Ok(Crossers { rows, names: &rows.members, named, called: Lists::Offsets(&rows.called_offsets, &rows.called), loaded: Lists::Offsets(&rows.loaded_offsets, &rows.loaded) });
        };
        if !rows.members.is_empty() || !rows.called.is_empty() || !rows.loaded.is_empty() {
            return Err("coverage rows name their crossers twice: as members and as a run's crossings".to_owned());
        }
        if crossed.modules.len() != rows.module_path.len() {
            return Err(format!("a run's crossings name {} modules where the rows hold {}", crossed.modules.len(), rows.module_path.len()));
        }
        let named = crossed.tests.iter().map(|test| by_path.get(test.as_str()).copied()).collect();
        Ok(Crossers { rows, names: &crossed.tests, named, called: regions(&crossed.hits, &crossed.ids)?, loaded: regions(&crossed.loaded, &crossed.ids)? })
    }

    /// The test rows that crossed region `block` of module `module`, `loaded` for those that did before their first test.
    pub(crate) fn rows_of(&self, module: usize, block: usize, loaded: bool) -> impl Iterator<Item = Result<u32, String>> + '_ {
        let values = self.values(module, block, if loaded { &self.loaded } else { &self.called });
        values.iter().map(move |name| match self.named.get(*name as usize) {
            Some(Some(row)) => Ok(*row),
            Some(None) => Err(format!("coverage crossing names an unobserved test: {}", self.names[*name as usize])),
            None => Err(format!("coverage crossing names member {name}, past the {} held", self.names.len())),
        })
    }

    fn values(&self, module: usize, block: usize, lists: &Lists<'a>) -> &'a [u32] {
        match lists {
            Lists::Offsets(offsets, values) => &values[offsets[block] as usize..offsets[block + 1] as usize],
            Lists::Regions(regions, column) => {
                let id = self.rows.crossed.as_ref().expect("regions are a run's").modules[module].as_str();
                regions.get(&(id, self.rows.block_ordinal[block])).map_or(&[], |(start, end)| &column[*start..*end])
            }
        }
    }
}

fn regions<'a>(column: &'a [u32], ids: &'a [String]) -> Result<Lists<'a>, String> {
    let short = || "a run's crossings end inside a module".to_owned();
    let mut regions = FxHashMap::default();
    let mut at = 0;
    for id in ids {
        let count = *column.get(at).ok_or_else(short)?;
        at += 1;
        for _ in 0..count {
            let (ordinal, n) = (*column.get(at).ok_or_else(short)?, *column.get(at + 1).ok_or_else(short)? as usize);
            let end = at + 2 + n;
            if end > column.len() {
                return Err(short());
            }
            regions.insert((id.as_str(), ordinal), (at + 2, end));
            at = end;
        }
    }
    Ok(Lists::Regions(regions, column))
}

/// What each test row of `rows` ran over, as `[file, digest]` in row order:
/// every module some region of which it crossed or loaded, at the text it was
/// recorded from, and its preconditions, digested as `inputsOf` names them.
pub(crate) fn inputs(rows: &CoverageRows) -> Result<Vec<(String, String)>, String> {
    let crossers = Crossers::of(rows)?;
    let tests = rows.test_path.len();
    let mut entered: Vec<Vec<usize>> = vec![Vec::new(); tests];
    let mut last = vec![usize::MAX; tests];
    for module in 0..rows.module_path.len() {
        for block in rows.module_blocks[module] as usize..rows.module_blocks[module + 1] as usize {
            for loaded in [false, true] {
                for row in crossers.rows_of(module, block, loaded) {
                    // A crosser no test row holds is no test's input.
                    let Ok(row) = row else { continue };
                    let row = row as usize;
                    if last[row] != module {
                        last[row] = module;
                        entered[row].push(module);
                    }
                }
            }
        }
    }
    // Each test's digest is its own: they are taken on every core.
    let (paths, sources, tests_at, names, digests, files): (&[String], &[String], &[u32], &[String], &[String], &[String]) =
        (&rows.module_path, &rows.module_source, &rows.test_preconditions, &rows.precondition_name, &rows.precondition_digest, &rows.test_path);
    entered
        .into_par_iter()
        .enumerate()
        .map(|(test, modules)| {
            let mut read: Vec<(&str, &str)> = modules.into_iter().map(|module| (paths[module].as_str(), sources[module].as_str())).collect();
            read.sort_by(|left, right| order::code_unit(left.0, right.0));
            let range = tests_at[test] as usize..tests_at[test + 1] as usize;
            let mut held: Vec<(&str, &str)> = range.map(|at| (names[at].as_str(), digests[at].as_str())).collect();
            held.sort_by(|left, right| order::code_unit(left.0, right.0));
            let json = serde_json::to_string(&(read, held)).map_err(|error| error.to_string())?;
            Ok((files[test].clone(), digest::of_string(&json)))
        })
        .collect()
}
