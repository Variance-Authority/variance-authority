//! `rustCoverage`: which regions of the Rust reader's cut each test's counters
//! entered.
//!
//! A binary built with `-C instrument-coverage` carries rustc's coverage map, and
//! each run of it writes a `.profraw` of counters. Both are read here, in the
//! process, with no `llvm-cov`: a counted region is charged to the innermost
//! region `rust_cut` declares around its start, and a file is named by the id a
//! module journal carries, `path@digest`, so sense's fold cuts it again exactly
//! as it cuts a JavaScript module.
//!
//! The coverage map is read once for every profile, and only the functions of
//! the checkout's files are kept from it: a test binary is mostly its
//! dependencies, and a test runs few of the functions left. A profile is then
//! read only for the functions it counted.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use llvm_profparser::coverage::coverage_mapping::read_object_file;
use llvm_profparser::coverage::{Counter, CounterType, ExprKind, Expression};
use llvm_profparser::instrumentation_profile::parse;
use napi::bindgen_prelude::Uint32Array;
use napi_derive::napi;
use rayon::prelude::*;
use variance_sense_instrument::native::{Cut, Utf16};

/// One file a test entered: its module id and the ordinals of the regions entered.
#[napi(object)]
pub struct RustEntered {
    pub id: String,
    pub ordinals: Uint32Array,
}

/// For each test, in order, the files under `root` its run entered.
///
/// A test's profiles are its own process's first, then those of the processes
/// it started, whose counts add to its own. `binaries` are the instrumented
/// executables the profiles were written by. A
/// file outside `root` is left out, since it is not the checkout's; one the cut
/// cannot parse is entered at its root alone, as a module the reader cannot parse
/// is, so an edit to it selects every test that entered it. A test with a
/// profile missing, empty or cut short, its own or a started process's, answers
/// `None`: that process left before its profile was written, so what the test
/// entered is not known.
#[napi(js_name = "rustCoverage", catch_unwind)]
pub fn rust_coverage(binaries: Vec<String>, profiles: Vec<Vec<String>>, root: String) -> napi::Result<Vec<Option<Vec<RustEntered>>>> {
    let counted: Vec<Option<Counts>> = profiles.par_iter().map(|profiles| Counts::read_all(profiles)).collect();
    let Some(version) = counted.iter().flatten().map(|counts| counts.version).next() else {
        return Ok(counted.iter().map(|counts| counts.as_ref().map(|_| Vec::new())).collect());
    };
    let map = Map::read(&binaries, version, Path::new(&root))?;
    Ok(counted.par_iter().map(|counts| counts.as_ref().map(|counts| map.entered(counts))).collect())
}

/// One profile's counters, by the function they count: its name hash and its hash.
struct Counts {
    version: u64,
    functions: HashMap<(u64, u64), Vec<u64>>,
}

impl Counts {
    /// A test's counts: its own profile's, with those of the processes it started
    /// added. None when any of them was not written whole.
    fn read_all(profiles: &[String]) -> Option<Counts> {
        let (own, started) = profiles.split_first()?;
        let mut counts = Counts::read(own)?;
        for other in started {
            for (key, values) in Counts::read(other)?.functions {
                counts.add(key, &values);
            }
        }
        Some(counts)
    }

    fn add(&mut self, key: (u64, u64), counts: &[u64]) {
        // A function counted twice, as a merge would, counts once with both.
        let summed = self.functions.entry(key).or_insert_with(|| vec![0; counts.len()]);
        if summed.len() == counts.len() {
            summed.iter_mut().zip(counts).for_each(|(sum, count)| *sum = sum.saturating_add(*count));
        }
    }

    /// None for a profile that was not written whole: one that carries no header has no version.
    fn read(profile: &str) -> Option<Counts> {
        let parsed = parse(profile).ok()?;
        let version = parsed.version()?;
        let mut read = Counts { version, functions: HashMap::new() };
        for record in parsed.records() {
            let (Some(name), Some(hash)) = (record.name_hash, record.hash) else { continue };
            let counts = record.counts();
            if counts.iter().all(|count| *count == 0) {
                continue;
            }
            read.add((name, hash), counts);
        }
        Some(read)
    }
}

/// The coverage map of the binaries, narrowed to the functions of the checkout's files.
struct Map {
    files: Vec<File>,
    functions: Vec<Function>,
}

/// One function of the checkout, by the hashes a profile counts it under.
struct Function {
    key: (u64, u64),
    expressions: Vec<Expression>,
    /// Each region in one of the checkout's files: its counter, its file and where it starts.
    regions: Vec<(Counter, usize, usize, usize)>,
}

impl Map {
    fn read(binaries: &[String], version: u64, root: &Path) -> napi::Result<Map> {
        let mut files: Vec<File> = Vec::new();
        let mut at: HashMap<PathBuf, Option<usize>> = HashMap::new();
        let mut functions = Vec::new();
        for binary in binaries {
            let info = read_object_file(Path::new(binary), version)
                .map_err(|error| napi::Error::from_reason(format!("{binary}: {error}")))?;
            let mut paths: HashMap<u64, Vec<Option<usize>>> = HashMap::new();
            for function in &info.cov_fun {
                let ours = paths.entry(function.header.filenames_ref).or_insert_with(|| {
                    info.get_files_from_id(function.header.filenames_ref)
                        .into_iter()
                        .map(|path| {
                            *at.entry(path).or_insert_with_key(|path| {
                                File::read(path, root).map(|file| {
                                    files.push(file);
                                    files.len() - 1
                                })
                            })
                        })
                        .collect()
                });
                let regions: Vec<_> = function
                    .regions
                    .iter()
                    .filter_map(|region| {
                        let file = (*ours.get(region.file_id)?)?;
                        Some((region.count, file, region.loc.line_start, region.loc.column_start))
                    })
                    .collect();
                if regions.is_empty() {
                    continue;
                }
                functions.push(Function {
                    key: (function.header.name_hash, function.header.fn_hash),
                    expressions: function.expressions.clone(),
                    regions,
                });
            }
        }
        Ok(Map { files, functions })
    }

    fn entered(&self, counts: &Counts) -> Vec<RustEntered> {
        let mut ordinals: Vec<Vec<u32>> = vec![Vec::new(); self.files.len()];
        for function in &self.functions {
            let Some(counters) = counts.functions.get(&function.key) else { continue };
            let mut values = vec![None; function.expressions.len()];
            for (counter, file, line, column) in &function.regions {
                if value(*counter, counters, &function.expressions, &mut values) > 0 {
                    // rustc counts only function bodies, so a file entered had its root run too, as a module's load runs it.
                    ordinals[*file].push(0);
                    ordinals[*file].extend(self.files[*file].charged(*line, *column));
                }
            }
        }
        let mut entered: Vec<RustEntered> = ordinals
            .into_iter()
            .enumerate()
            .filter(|(_, ordinals)| !ordinals.is_empty())
            .map(|(file, mut ordinals)| {
                ordinals.sort_unstable();
                ordinals.dedup();
                RustEntered { id: self.files[file].id.clone(), ordinals: Uint32Array::new(ordinals) }
            })
            .collect();
        entered.sort_by(|left, right| left.id.cmp(&right.id));
        entered
    }
}

/// A counter's count: a counter of the profile's, or an expression over others,
/// worked out once per function with a stack rather than by recursion, since an
/// expression may stand on a long chain of others.
fn value(counter: Counter, counters: &[u64], expressions: &[Expression], values: &mut [Option<i64>]) -> i64 {
    let direct = |counter: Counter, values: &[Option<i64>]| match counter.kind {
        CounterType::Zero => Some(0),
        CounterType::ProfileInstrumentation => Some(counters.get(counter.id as usize).map_or(0, |count| *count as i64)),
        CounterType::Expression(_) => values.get(counter.id as usize).copied().unwrap_or(Some(0)),
    };
    if let Some(known) = direct(counter, values) {
        return known;
    }
    let mut pending = vec![counter.id as usize];
    while let Some(&at) = pending.last() {
        let expression = expressions[at];
        match (direct(expression.lhs, values), direct(expression.rhs, values)) {
            (Some(lhs), Some(rhs)) => {
                values[at] = Some(match expression.kind {
                    ExprKind::Add => lhs.saturating_add(rhs),
                    ExprKind::Subtract => lhs.saturating_sub(rhs),
                });
                pending.pop();
            }
            (lhs, rhs) => {
                // An expression is never its own operand, so this ends.
                if lhs.is_none() {
                    pending.push(expression.lhs.id as usize);
                }
                if rhs.is_none() {
                    pending.push(expression.rhs.id as usize);
                }
            }
        }
    }
    values[counter.id as usize].unwrap_or(0)
}

/// A Rust file of the checkout, cut once for every profile that entered it.
struct File {
    id: String,
    /// None for a file the cut cannot parse, whose root alone is charged.
    cut: Option<Cut>,
    /// Where each line starts, in bytes.
    lines: Vec<usize>,
    utf16: Option<Utf16>,
}

impl File {
    fn read(path: &Path, root: &Path) -> Option<File> {
        let relative = path.strip_prefix(root).ok()?;
        let source = std::fs::read_to_string(path).ok()?;
        let cut = crate::rust_cut::cut(&source);
        let id = variance_sense_instrument::module_id(&relative.to_string_lossy().replace('\\', "/"), &source);
        let lines = std::iter::once(0).chain(source.match_indices('\n').map(|(at, _)| at + 1)).collect();
        let utf16 = (!source.is_ascii()).then(|| Utf16::new(&source));
        Some(File { id, cut, lines, utf16 })
    }

    /// The innermost block around a region that starts at a 1-based line and byte column.
    fn charged(&self, line: usize, column: usize) -> Option<u32> {
        let byte = *self.lines.get(line.checked_sub(1)?)? + column.saturating_sub(1);
        let at = self.utf16.as_ref().map_or(byte as u32, |table| table.at(byte as u32));
        // Blocks are in pre-order, so the last one around a point is the innermost.
        self.cut.as_ref()?.blocks.iter().rposition(|block| block.start <= at && at < block.end).map(|ordinal| ordinal as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The profile runtime creates the file as the process starts, so one that left early leaves it empty.
    #[test]
    fn a_profile_missing_or_empty_is_not_known() {
        let empty = std::env::temp_dir().join(format!("variance-empty-{}.profraw", std::process::id()));
        std::fs::write(&empty, b"").expect("the file is written");
        let profiles = vec![vec!["/nonexistent/aborted.profraw".into()], vec![empty.to_string_lossy().into_owned()]];
        let entered = rust_coverage(Vec::new(), profiles, "/".into());
        std::fs::remove_file(&empty).ok();
        let entered = entered.expect("an unreadable profile is no error");
        assert_eq!(entered.len(), 2);
        assert!(entered.iter().all(Option::is_none));
    }

    // As a JavaScript module the reader cannot parse: an edit to it selects every test that entered it.
    #[test]
    fn a_file_the_cut_refuses_is_entered_at_its_root() {
        let root = std::env::temp_dir().join(format!("variance-rust-coverage-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("a scratch directory");
        let source = "fn broken( {\n";
        std::fs::write(root.join("broken.rs"), source).expect("the file is written");
        let file = File::read(&root.join("broken.rs"), &root);
        std::fs::remove_dir_all(&root).ok();
        let file = file.expect("a file under the root is kept though the cut refuses it");
        let map = Map {
            files: vec![file],
            functions: vec![Function { key: (1, 2), expressions: Vec::new(), regions: vec![(Counter::instrumentation(0), 0, 1, 1)] }],
        };
        let counts = Counts { version: 0, functions: HashMap::from([((1, 2), vec![1])]) };
        let entered = map.entered(&counts);
        assert_eq!(entered.len(), 1);
        assert_eq!(entered[0].id, variance_sense_instrument::module_id("broken.rs", source));
        assert_eq!(entered[0].ordinals.to_vec(), vec![0]);
    }
}
