//! The areas of a checkout a request's words point to, ranked where the files are.
//!
//! A request is written in the words people use for a change, and most of them
//! are no declared name. What they point to is a part of the tree: the area is a
//! directory of at most [`AREA_FILES`] files `HEAD` holds, a larger one split
//! into its children, and its words are every directory's on the way to its
//! files, its files' names and the names its files declare. Each directory
//! counts once per area. Each of the request's stems counts by how few areas
//! hold it, through the shared rarity, saturated the way BM25 saturates a
//! term's count and in integers, so one request ranks the same on every run.
//! An area's length does not discount its words: an area is long because it
//! holds more files and names, more subjects rather than more words for one,
//! the scope BM25 leaves unnormalised, and saturation already caps a repeated
//! word. Discounted, a source area declaring many names ranked below short
//! test and fixture areas even where it held the request's rarest words.
//!
//! Every file `HEAD` holds is read here, from git, and the names they declare
//! from the help store and the source index: only the ten areas answered cross
//! to JavaScript. Which dictionary terms reduce to the request's stems is the
//! one rule `search` resolves them by, in JavaScript, and those terms are what
//! cross here. A start point scopes the files by the walks it made over the
//! source tree, read where they were walked.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeMap, HashMap, HashSet};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::dependency_lexicon::describing::code_words;
use crate::help_declared::{declared, private_words, Matching};
use crate::help_publish::{open_index, opened_chain};
use crate::help_store::{FORMAT, NONE, VERSION};
use crate::source_query::{reached_by, SourceWalk};
use crate::source_trees::head_files;
use crate::stored::Stored;

/// The most files one area holds: a directory holding more is read as its children.
pub(crate) const AREA_FILES: u32 = 500;

/// How many areas an answer ranks.
const AREAS_SHOWN: usize = 10;

/// How much a path's own words count against one file's name: its words name everything under it.
const PATH_WEIGHT: u64 = 3;

/// One area the request's words point to.
#[napi(object)]
#[derive(Debug, Clone, PartialEq)]
pub struct RankedArea {
    /// The directory, repository-relative; `.` for the root.
    pub path: String,
    /// How many files `HEAD` holds in it, in scope.
    pub files: u32,
    /// The request's words it holds, as the request wrote them, the one weighing most there first.
    pub words: Vec<String>,
    pub score: u32,
    /// Whether one of its files declares a name the source index read: only such an area is a start point the source tree holds.
    pub declares: bool,
}

/// The ranking, and what scoped it.
#[napi(object)]
pub struct ClassifiedAreas {
    /// Best first, ties in code-unit order of the path.
    /// bound: at most 10 areas
    pub areas: Vec<RankedArea>,
    /// How many files the start point's walks reached together; zero when none was said.
    pub reached: u32,
    /// How many of those import something the scan could not resolve.
    pub unresolved: u32,
    /// What the addon ran and what git said, when it could not list the files `HEAD` holds; nothing was ranked.
    pub refused: Option<String>,
}

/// What the source index says the files declare.
#[derive(Default)]
pub(crate) struct DeclaredWords {
    /// For each of the request's stems, the files declaring a name that holds it, and how many such names each declares.
    pub(crate) holding: BTreeMap<String, HashMap<String, u64>>,
    /// For each file, how many words the names it declares hold together, exported or not;
    /// the ranking reads only which files have a row, the ones that declare a name.
    pub(crate) words: HashMap<String, u64>,
}

/// The areas `query`'s words point to among the files `HEAD` holds under
/// `root`, scored with the names the help store in `store` and the source index
/// at `index` say they declare. `terms` are, per stem of the request in the
/// order `describedWords` gives them, the store's dictionary terms that reduce
/// to it. `within` is the workspace's offset below the
/// index's root, empty when they are one. When `scoped`, only the files the
/// walks `from` and `to` reached together are ranked; a start point that was
/// said and refused passes neither, and ranks nothing.
///
/// bound: at most 10 areas
#[napi(catch_unwind)]
#[allow(clippy::too_many_arguments)]
pub fn classify_areas(
    root: String,
    query: String,
    terms: Vec<Vec<u32>>,
    store: Option<Buffer>,
    index: String,
    within: String,
    scoped: bool,
    from: Option<&SourceWalk>,
    to: Option<&SourceWalk>,
) -> napi::Result<ClassifiedAreas> {
    let walks: Vec<&SourceWalk> = [from, to].into_iter().flatten().collect();
    let reach = reached_by(&walks);
    let reached = reach.len() as u32;
    let unresolved = reach.values().filter(|&&unknown| unknown).count() as u32;
    let answer = |areas: Vec<RankedArea>, refused: Option<String>| ClassifiedAreas { areas, reached, unresolved, refused };
    let listed = match head_files(&root) {
        Ok(listed) => listed,
        Err(why) => return Ok(answer(Vec::new(), Some(why))),
    };
    let under = if within.is_empty() { String::new() } else { format!("{within}/") };
    let paths: Vec<&str> = if scoped {
        listed.iter().map(String::as_str).filter(|path| reach.contains_key(format!("{under}{path}").as_str())).collect()
    } else {
        listed.iter().map(String::as_str).collect()
    };
    if paths.is_empty() {
        return Ok(answer(Vec::new(), None));
    }
    let store = store.ok_or_else(|| napi::Error::from_reason("this help value was not read from a store, so it has no search"))?;
    let stored = Stored::open_as(&store, FORMAT, VERSION).map_err(|error| napi::Error::from_reason(format!("the help store did not read: {error}")))?;
    let opened = open_index(index)?;
    let asked = code_words(&query);
    if asked.is_empty() {
        return Ok(answer(Vec::new(), None));
    }
    let stems: Vec<String> = asked.keys().cloned().collect();
    if terms.len() != stems.len() {
        return Err(napi::Error::from_reason(format!("classify was given the terms of {} stems for a request of {}", terms.len(), stems.len())));
    }
    let mut words = store_words(&stored, &stems, &terms).map_err(napi::Error::from_reason)?;
    opened_chain(&opened, |layers| {
        // A file's own top-level names, which no export binds, are its words too,
        // read from the index the host read the tree from: a nested workspace's
        // names its files from the graph's root, so they are named from the workspace.
        let matching = Matching::Described { stems: stems.clone(), query: query.clone() };
        for name in declared(&root, layers, "", matching, None).names {
            if name.holder.is_some() || name.on.is_some() || !name.at.starts_with(&under) {
                continue;
            }
            let file = &name.at[under.len()..];
            for &at in name.named.iter().flatten() {
                let Some(files) = stems.get(at as usize).and_then(|stem| words.holding.get_mut(stem)) else { continue };
                *files.entry(file.to_owned()).or_default() += 1;
            }
        }
        // A private top-level name, one no export binds, declares a name in
        // its file too.
        for row in private_words(layers) {
            if row.words == 0 || !row.at.starts_with(&under) {
                continue;
            }
            *words.words.entry(row.at[under.len()..].to_owned()).or_default() += u64::from(row.words);
        }
    })?;
    Ok(answer(rank(&asked, &paths, &words, AREA_FILES), None))
}

/// What the help store says the files declare: per stem, the files whose
/// exported names hold one of its `terms`; per file, how many words its
/// exported names hold.
fn store_words(stored: &Stored, stems: &[String], terms: &[Vec<u32>]) -> Result<DeclaredWords, String> {
    let name_count = stored.u32s("names.name")?.len();
    let exp_off = stored.u32s("names.expOff")?;
    let exp = stored.u32s("names.exp")?;
    let exp_at = stored.u32s("exp.at")?;
    let term_name_off = stored.u32s("terms.nameOff")?;
    let term_name = stored.u32s("terms.name")?;
    let term_count = term_name_off.len().saturating_sub(1);
    // Every export is written at a file; a row without one names none.
    let exported_at = |row: u32| Some(exp_at.at(row as usize)).filter(|&at| at != NONE).map(|at| stored.text(at));
    // A name counts once per file, even when its type and value are both exported there.
    let exported = |name: u32| exp_off.range(name as usize).map(|at| exp.at(at)).filter_map(exported_at).collect::<HashSet<&str>>();
    let named = |term: usize| term_name_off.range(term).map(|at| term_name.at(at));

    let mut found = DeclaredWords::default();
    for (stem_of, terms) in stems.iter().zip(terms) {
        let mut names = HashSet::new();
        for &term in terms {
            if (term as usize) >= term_count {
                return Err(format!("term {term} is not in the help store's dictionary of {term_count}"));
            }
            names.extend(named(term as usize));
        }
        let mut files: HashMap<String, u64> = HashMap::new();
        for name in names {
            for file in exported(name) {
                *files.entry(file.to_owned()).or_default() += 1;
            }
        }
        found.holding.insert(stem_of.clone(), files);
    }
    // Each term lists the names holding it, so a name holds as many words as terms list it.
    let mut words_of = vec![0u64; name_count];
    for at in 0..term_name.len() {
        if let Some(held) = words_of.get_mut(term_name.at(at) as usize) {
            *held += 1;
        }
    }
    for (name, &held) in words_of.iter().enumerate() {
        if held == 0 {
            continue;
        }
        for file in exported(name as u32) {
            *found.words.entry(file.to_owned()).or_default() += held;
        }
    }
    Ok(found)
}

/// One directory and what the request's stems count in it.
#[derive(Default)]
struct Area<'a> {
    files: u32,
    /// Directory paths whose own segment has already contributed to this area's vocabulary.
    directories: HashSet<&'a str>,
    held: HashMap<&'a str, u64>,
    declares: bool,
}

/// The areas of `paths` that `asked`'s stems point to, best first and at most
/// [`AREAS_SHOWN`]; ties in code-unit order of the path. A directory holding
/// more than `most` files is read as its children.
pub(crate) fn rank<'a>(asked: &'a BTreeMap<String, String>, paths: &[&'a str], declared: &DeclaredWords, most: u32) -> Vec<RankedArea> {
    if asked.is_empty() {
        return Vec::new();
    }
    // The asked stems among each path segment's words.
    let mut cuts: HashMap<&'a str, Vec<String>> = HashMap::new();
    let mut cut = |segment: &'a str| -> Vec<String> {
        cuts.entry(segment).or_insert_with(|| code_words(segment).into_keys().filter(|stem| asked.contains_key(stem)).collect()).clone()
    };
    let under = files_under(paths);
    let mut areas: HashMap<&str, Area> = HashMap::new();
    let mut file_of: HashMap<&str, &str> = HashMap::new();
    for &path in paths {
        let directory = area_directory(path, &under, most);
        let area = areas.entry(directory).or_default();
        let mut start = 0;
        for (at, _) in path.match_indices('/') {
            let prefix = &path[..at];
            if area.directories.insert(prefix) {
                for stem in cut(&path[start..at]) {
                    *area.held.entry(asked.get_key_value(&stem).map(|(key, _)| key.as_str()).unwrap_or_default()).or_default() += PATH_WEIGHT;
                }
            }
            start = at + 1;
        }
        area.files += 1;
        file_of.insert(path, directory);
        if declared.words.contains_key(path) {
            area.declares = true;
        }
        for stem in cut(base_name(path)) {
            *area.held.entry(asked.get_key_value(&stem).map(|(key, _)| key.as_str()).unwrap_or_default()).or_default() += 1;
        }
    }
    for (stem, files) in &declared.holding {
        let Some((stem, _)) = asked.get_key_value(stem) else { continue };
        for (file, &names) in files {
            let Some(area) = file_of.get(file.as_str()).and_then(|directory| areas.get_mut(directory)) else { continue };
            *area.held.entry(stem.as_str()).or_default() += names;
            area.declares = true;
        }
    }
    let mut holders: HashMap<&str, u64> = HashMap::new();
    for area in areas.values() {
        for &stem in area.held.keys() {
            *holders.entry(stem).or_default() += 1;
        }
    }
    let population = areas.len() as f64;
    let mut ranked: Vec<RankedArea> = areas
        .iter()
        .filter(|(_, area)| !area.held.is_empty())
        .map(|(&directory, area)| {
            let weighs: HashMap<&str, f64> = area
                .held
                .iter()
                .map(|(&stem, &held)| {
                    let rarity = crate::rarity::rarity(population, holders.get(stem).copied().unwrap_or(0) as f64);
                    (stem, ((rarity * crate::rarity::saturation(held as f64, 0.0, 0.0, 0.0)) / 1000.0).floor())
                })
                .collect();
            let score = weighs.values().sum::<f64>();
            // `asked` is in stem order, and the sort is stable, so equal weights keep it.
            let mut words: Vec<(&String, f64)> = asked.iter().filter_map(|(stem, word)| weighs.get(stem.as_str()).map(|&weight| (word, weight))).collect();
            words.sort_by(|one, other| other.1.total_cmp(&one.1));
            RankedArea {
                path: if directory.is_empty() { ".".to_owned() } else { directory.to_owned() },
                files: area.files,
                words: words.into_iter().map(|(word, _)| word.clone()).collect(),
                score: score as u32,
                declares: area.declares,
            }
        })
        .collect();
    ranked.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| crate::order::code_unit(&a.path, &b.path)));
    ranked.truncate(AREAS_SHOWN);
    ranked
}

/// How many of `paths` each directory holds, at any depth; the root is `""`.
fn files_under<'a>(paths: &[&'a str]) -> HashMap<&'a str, u32> {
    let mut under: HashMap<&str, u32> = HashMap::new();
    for &path in paths {
        *under.entry("").or_default() += 1;
        for (at, _) in path.match_indices('/') {
            *under.entry(&path[..at]).or_default() += 1;
        }
    }
    under
}

/// The outermost directory over `path` holding at most `most` files, or the file's own directory when none does.
fn area_directory<'a>(path: &'a str, under: &HashMap<&str, u32>, most: u32) -> &'a str {
    let held = |directory: &str| under.get(directory).copied().unwrap_or(0);
    if held("") <= most {
        return "";
    }
    if let Some((at, _)) = path.match_indices('/').find(|&(at, _)| held(&path[..at]) <= most) {
        return &path[..at];
    }
    path.rfind('/').map_or("", |last| &path[..last])
}

/// A file's name without its directory and its last extension.
fn base_name(path: &str) -> &str {
    let name = path.rfind('/').map_or(path, |slash| &path[slash + 1..]);
    match name.rfind('.') {
        Some(dot) if dot > 0 => &name[..dot],
        _ => name,
    }
}

#[cfg(test)]
#[path = "classify_areas_tests.rs"]
mod tests;
