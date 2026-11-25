//! Areas ranked from the published source-index inventory and declaration evidence.
//!
//! Directories holding more than [`AREA_FILES`] files split into children.
//! Path, file and declaration words share the search stem vocabulary; rarity
//! and saturated counts rank at most ten areas. The query reads the snapshot
//! alone, including additions and deletions, without reading the checkout.

// compass: variance-authority.report.agent-surface

use std::collections::{BTreeMap, HashMap, HashSet};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::dependency_lexicon::describing::code_words;
use crate::help_declared::private_words;
use crate::chain_lookup::fold;
use crate::help_publish::{open_index, opened_chain};
use crate::help_store::{FORMAT, NONE, VERSION};
use crate::source_query::{reached_by, SourceWalk};
use crate::stored::Stored;
use crate::stages;

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
    /// How many files the published source index holds in it, in scope.
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
    /// Why the published source index was unavailable; nothing was ranked.
    pub refused: Option<String>,
}

/// What the source index says the files declare.
#[derive(Default)]
pub(crate) struct DeclaredWords {
    /// For each of the request's stems, the files declaring a name that holds it, and how many such names each declares.
    pub(crate) holding: BTreeMap<String, HashMap<String, u64>>,
    /// Files declaring at least one searchable name, exported or not.
    pub(crate) files: HashSet<String>,
}

/// The areas `query`'s words point to among the published source index's files, scored with the names the help store in `store` and the source index
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
    let reach = stages::timed("classify/reach", || reached_by(&walks));
    let reached = reach.len() as u32;
    let unresolved = reach.values().filter(|&&unknown| unknown).count() as u32;
    let answer = |areas: Vec<RankedArea>, refused: Option<String>| ClassifiedAreas { areas, reached, unresolved, refused };
    let under = if within.is_empty() { String::new() } else { format!("{within}/") };
    let store = store.ok_or_else(|| napi::Error::from_reason("this help value was not read from a store, so it has no search"))?;
    let stored = stages::timed("classify/store-open", || Stored::open_as(&store, FORMAT, VERSION)).map_err(|error| napi::Error::from_reason(format!("the help store did not read: {error}")))?;
    let opened = stages::timed("classify/index-handle", || open_index(index))?;
    let asked = code_words(&query);
    if asked.is_empty() {
        return Ok(answer(Vec::new(), None));
    }
    let stems: Vec<String> = asked.keys().cloned().collect();
    if terms.len() != stems.len() {
        return Err(napi::Error::from_reason(format!("classify was given the terms of {} stems for a request of {}", terms.len(), stems.len())));
    }
    let mut words = stages::timed("classify/store-words", || store_words(&stored, &stems, &terms)).map_err(napi::Error::from_reason)?;
    let areas = stages::timed("classify/index", || opened_chain(&opened, |layers| {
        let folded = stages::timed("classify/inventory", || fold(layers));
        let paths: Vec<&str> = folded.keys().filter_map(|path| {
            let file = path.strip_prefix(&under)?;
            (!scoped || reach.contains_key(*path)).then_some(file)
        }).collect();
        for row in stages::timed("classify/private-words", || private_words(layers, &stems)) {
            let Some(file) = row.at.strip_prefix(&under) else { continue };
            if row.declares {
                words.files.insert(file.to_owned());
            }
            for at in row.named {
                let Some(files) = stems.get(at as usize).and_then(|stem| words.holding.get_mut(stem)) else { continue };
                *files.entry(file.to_owned()).or_default() += 1;
            }
        }
        stages::timed("classify/rank", || rank(&asked, &paths, &words, AREA_FILES))
    }))?;
    let _ = root;
    Ok(match areas {
        Some(areas) => answer(areas, None),
        None => answer(Vec::new(), Some("no source index was published; `variance index` reads it".to_owned())),
    })
}

/// The bounded files one word spells, with every match counted.
#[napi(object)]
pub struct NamedFiles {
    pub name: String,
    pub files: Vec<String>,
    pub count: u32,
}

/// Words shaped as an identifier or spelled as a file, read from the same published source-index snapshot.
#[napi(object)]
pub struct ClassifiedNames {
    pub named: Vec<NamedFiles>,
    pub declared: Vec<crate::help_declared::DeclarationLocation>,
    pub refused: Option<String>,
}

/// The files each of `words` spells by their name: a word with a dot is a file's
/// whole name, and any other its name before the first dot. A word with a slash
/// is a path, and none of these. In one read of `paths`, in their order.
fn spelled<'a, 'w>(words: &'w [String], paths: &[&'a str]) -> HashMap<&'w str, Vec<&'a str>> {
    let mut files: HashMap<&str, Vec<&str>> = words.iter().filter(|word| !word.contains('/')).map(|word| (word.as_str(), Vec::new())).collect();
    for &path in paths {
        let name = path.rsplit('/').next().unwrap_or(path);
        let stem = crate::path::name_and_suffix(path).0;
        for word in [name.contains('.').then_some(name), (!stem.contains('.')).then_some(stem)].into_iter().flatten() {
            if let Some(found) = files.get_mut(word) {
                found.push(path);
            }
        }
    }
    files
}

/// The files each word spells, and the exact declaration locations of a word
/// that is no file's spelling; no live checkout is read.
///
/// bound: only the requested names' exact declarations, and at most `cap` filenames per name
#[napi(catch_unwind)]
pub fn classify_names(words: Vec<String>, cap: u32, index: String, within: String) -> napi::Result<ClassifiedNames> {
    let opened = open_index(index)?;
    let prefix = if within.is_empty() { String::new() } else { format!("{within}/") };
    let answer = opened_chain(&opened, |layers| {
        let folded = fold(layers);
        let mut paths: Vec<&str> = folded.keys().filter_map(|path| path.strip_prefix(&prefix)).collect();
        paths.sort_unstable_by(|one, other| crate::order::code_unit(one, other));
        let mut by_name = spelled(&words, &paths);
        let mut named = Vec::new();
        let mut declared = Vec::new();
        let mut seen = HashSet::new();
        for word in words.iter().filter(|word| seen.insert(word.as_str())) {
            let files: Vec<&str> = if word.contains('/') {
                // A path is the file at it; a leading `./` is the workspace's own folder.
                let path = word.strip_prefix("./").unwrap_or(word);
                folded.contains_key(format!("{prefix}{path}").as_str()).then_some(path).into_iter().collect()
            } else {
                let mut files = by_name.remove(word.as_str()).unwrap_or_default();
                // The file at the root is the word itself, so the cap never drops it.
                files.sort_by_key(|path| path != word);
                files
            };
            if !files.is_empty() {
                named.push(NamedFiles { name: word.clone(), count: files.len() as u32, files: files.into_iter().take(cap as usize).map(str::to_owned).collect() });
            }
            if word.contains(['.', '/']) {
                continue;
            }
            declared.extend(crate::help_declared::declaration_locations(layers, word).into_iter().filter_map(|mut row| {
                row.at = row.at.strip_prefix(&prefix)?.to_owned();
                Some(row)
            }));
        }
        ClassifiedNames { named, declared, refused: None }
    })?;
    Ok(answer.unwrap_or_else(|| ClassifiedNames { named: Vec::new(), declared: Vec::new(), refused: Some("no source index was published; `variance index` reads it".to_owned()) }))
}

/// What the help store says the files declare: per stem, the files whose
/// exported names hold one of its `terms`; and the files whose exported names
/// hold any search term.
fn store_words(stored: &Stored, stems: &[String], terms: &[Vec<u32>]) -> Result<DeclaredWords, String> {
    let names = stored.u32s("names.name")?;
    let exp_off = stored.u32s("names.expOff")?;
    let exp = stored.u32s("names.exp")?;
    let exp_at = stored.u32s("exp.at")?;
    let term_name_off = stored.u32s("terms.nameOff")?;
    let term_name = stored.u32s("terms.name")?;
    let term_count = term_name_off.len().saturating_sub(1);
    // Every export is written at a file; a row without one names none.
    let exported_at = |row: u32| Some(exp_at.at(row as usize)).filter(|&at| at != NONE).map(|at| stored.text(at));
    let exported = |name: u32| exp_off.range(name as usize).map(|at| exp.at(at)).filter_map(exported_at);
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
            // A name counts once per file, even when both its type and value are exported there.
            for file in exported(name).collect::<HashSet<&str>>() {
                *files.entry(file.to_owned()).or_default() += 1;
            }
        }
        found.holding.insert(stem_of.clone(), files);
    }
    let mut searchable = vec![false; names.len()];
    for at in 0..term_name.len() {
        if let Some(held) = searchable.get_mut(term_name.at(at) as usize) {
            *held = true;
        }
    }
    for (name, &held) in searchable.iter().enumerate() {
        if held {
            found.files.extend(exported(name as u32).map(str::to_owned));
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
        if declared.files.contains(path) {
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
                    // No length: the helper saturates as if every area had the mean length.
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
