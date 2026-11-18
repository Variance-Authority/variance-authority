//! The path graph a source question opens, written from the index's layers.
//!
//! `encodeSourceTree` in `mcp/src/tools/source-tree-format.ts` is the twin:
//! same files, same ids, same columns, and the bytes are equal. Written here
//! because the fold already lives in this process; carrying every record to
//! JavaScript to be folded again was most of what publishing cost.
//!
//! The tree carries the modules a test loads for real beside its mocks
//! (`vi.importActual`, `jest.requireActual`, a factory's `require` of another
//! module), resolved here by the resolver that resolves imports, so a question
//! walks them without resolving anything. `taintRecords` in
//! `sense/src/taint/index.ts` joins the same additions under `mockTaint`, with
//! the same edges and the same `unknown` reasons. A mock's cut is one test's
//! run, not an arrow, and stays out of the tree as it stays out of every walk
//! over one.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicUsize, Ordering};

use rayon::prelude::*;
use regex::Regex;

use crate::chain_lookup::fold;
use crate::package_graph::{join_all_parses, Crossing};
use crate::package_owners::NO_OWNER;
use crate::resolve::{Resolvers, MODULE_EXTENSIONS};
use crate::specifier::{is_relative, kind_for, request_of};
use crate::segment::{encode_as, u32s, u8s, Collected, Strings, NONE};
use crate::compact::Layer;

const FORMAT: &str = "variance-authority-source-tree";
/// 2: the tree carries what tests load for real beside their mocks.
const VERSION: u8 = 2;
/// `EDGE_KINDS` in `core/relate/graph.ts`, in its order.
const EDGE_KINDS: [&str; 8] = ["imports", "reexports", "dynamic", "type", "asset", "declared-in", "depends-on", "depends"];

/// How a test's loads beside its mocks are resolved: from the checkout at
/// `root`, by `resolvers`, with `code` the extensions read as code.
pub(crate) struct Mocking {
    pub root: PathBuf,
    pub resolvers: Resolvers,
    pub code: HashSet<String>,
    /// A caller's declarative loads: a file, and the specifiers it is said to load.
    pub given: Vec<(String, Vec<String>)>,
}

impl Mocking {
    /// A test's loads beside its mocks, resolved from the checkout at `root`.
    pub(crate) fn at(root: &str, tsconfig: crate::resolve::Tsconfig, code: Vec<String>) -> Self {
        let at = std::path::Path::new(root);
        let checkout = std::fs::canonicalize(at).unwrap_or_else(|_| at.to_path_buf());
        let resolvers = Resolvers::over(tsconfig, None, crate::emitted::Emitted::listed(&checkout, None));
        Mocking { root: checkout, resolvers, code: code.into_iter().collect(), given: Vec::new() }
    }
}

/// `isTestLike` in `sense/src/taint/mocks.ts`: where a mock is expected to be written.
static TEST_LIKE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|/)(setup|setupTests|test-setup|vitest\.setup|jest\.setup)\.[cm]?[jt]sx?$|(^|/)\.storybook/").expect("a valid pattern")
});


/// What one test adds: its edges, and the reason its relative misses make it unknown.
pub(crate) struct Added {
    pub(crate) edges: Vec<(String, &'static str)>,
    pub(crate) holes: Option<String>,
    pub(crate) shadows: Vec<String>,
    pub(crate) missed: Vec<String>,
}

/// Every test's loads beside its mocks, resolved, keyed by the test.
pub(crate) fn additions<'l>(layers: &'l [Layer], folded: &HashMap<&'l str, (usize, usize)>, mocking: &Mocking, with_shadows: bool) -> HashMap<&'l str, Added> {
    let mut phases = crate::timings::Phases::new("question mock additions", "select test candidates");
    let mut crossings: Vec<Crossing> = folded
        .iter()
        .filter(|(path, _)| MODULE_EXTENSIONS.iter().any(|extension| path.ends_with(extension)) && TEST_LIKE.is_match(path))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    phases.note(format_args!("{} test candidates", crossings.len()));
    phases.next("join test parses");
    join_all_parses(layers, &mut crossings);
    phases.next("resolve mock additions");
    // A tracked `build/` is source only where the index holds it, as the scan's
    // own resolve decides: the indexed files under one are what it may land on.
    let mut known: HashMap<String, u32> = folded.keys().map(|path| ((*path).to_owned(), 0)).collect();
    for &(layer, row) in folded.values() {
        if let Some(edges) = layers[layer].records.edges_of(&layers[layer].stored, row) {
            known.extend(edges.map(|(to, _)| (to.to_owned(), 0)));
        }
    }
    let statistics = phases.enabled().then(|| (AtomicUsize::new(0), AtomicUsize::new(0)));
    let added: HashMap<&str, Added> = crossings
        .par_iter()
        .filter_map(|crossing| {
            let (layer, row) = crossing.parse?;
            let (stored, parses) = (&layers[layer].stored, &layers[layer].parses);
            let mut said: Vec<&str> = Vec::new();
            for at in parses.mocks_plus.range(row) {
                let value = stored.text(parses.mock_plus.at(at));
                if !said.contains(&value) {
                    said.push(value);
                }
            }
            let cut: Vec<&str> = if with_shadows {
                parses.mocks_minus.range(row).map(|at| stored.text(parses.mock_minus.at(at))).collect()
            } else { Vec::new() };
            if said.is_empty() && cut.is_empty() {
                return None;
            }
            if let Some((attempts, _)) = &statistics { attempts.fetch_add(said.len(), Ordering::Relaxed); }
            let from = mocking.root.join(crossing.file);
            let (mut targets, mut holes, mut missed) = (Vec::new(), Vec::new(), Vec::new());
            for value in said {
                match mocking.resolvers.resolve(&mocking.root, &from, value, Some(&known)) {
                    Some(to) => targets.push(to),
                    None => {
                        missed.push(value.to_owned());
                        if request_of(value).is_some_and(is_relative) { holes.push(value); }
                    }
                }
            }
            if let Some((_, missed)) = &statistics { missed.fetch_add(holes.len(), Ordering::Relaxed); }
            targets.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
            targets.dedup();
            let edges = targets.into_iter().map(|to| {
                let kind = if kind_for("imports", &to, &mocking.code) == "asset" { "asset" } else { "imports" };
                (to, kind)
            }).collect();
            let holes = (!holes.is_empty()).then(|| format!("{} tainted relative specifier(s) that resolve to nothing: {}", holes.len(), holes.join(", ")));
            let mut shadows: Vec<String> = cut.into_iter()
                .filter_map(|value| mocking.resolvers.resolve(&mocking.root, &from, value, Some(&known))).collect();
            shadows.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
            shadows.dedup();
            Some((crossing.file, Added { edges, holes, shadows, missed }))
        })
        .collect();
    if let Some((attempts, missed)) = statistics {
        phases.note(format_args!("{} files with additions, {} mock resolution attempts, {} relative misses, {} added edges", added.len(), attempts.load(Ordering::Relaxed), missed.load(Ordering::Relaxed), added.values().map(|added| added.edges.len()).sum::<usize>()));
    }
    phases.next("temporary cleanup");
    added
}

/// A caller's declarative loads joined onto `added`, resolved as a test's loads
/// beside its mocks are; a file the index does not hold is passed by.
fn join_given<'l>(layers: &'l [Layer], folded: &HashMap<&'l str, (usize, usize)>, mocking: &Mocking, added: &mut HashMap<&'l str, Added>) {
    if mocking.given.is_empty() {
        return;
    }
    let mut known: HashMap<String, u32> = folded.keys().map(|path| ((*path).to_owned(), 0)).collect();
    for &(layer, row) in folded.values() {
        if let Some(edges) = layers[layer].records.edges_of(&layers[layer].stored, row) {
            known.extend(edges.map(|(to, _)| (to.to_owned(), 0)));
        }
    }
    for (file, plus) in &mocking.given {
        let Some((&path, _)) = folded.get_key_value(file.as_str()) else { continue };
        let row = added.entry(path).or_insert_with(|| Added { edges: Vec::new(), holes: None, shadows: Vec::new(), missed: Vec::new() });
        let from = mocking.root.join(path);
        for value in plus {
            let Some(request) = request_of(value) else { continue };
            match mocking.resolvers.resolve(&mocking.root, &from, request, Some(&known)) {
                Some(to) => {
                    let kind = if kind_for("imports", &to, &mocking.code) == "asset" { "asset" } else { "imports" };
                    row.edges.push((to, kind));
                }
                None => {
                    if !row.missed.contains(value) { row.missed.push(value.clone()); }
                }
            }
        }
        row.edges.sort_unstable_by(|left, right| crate::order::code_unit(&left.0, &right.0));
        row.edges.dedup();
        let holes: Vec<&str> = row.missed.iter().map(String::as_str).filter(|value| request_of(value).is_some_and(is_relative)).collect();
        row.holes = (!holes.is_empty()).then(|| format!("{} tainted relative specifier(s) that resolve to nothing: {}", holes.len(), holes.join(", ")));
    }
}

pub(crate) fn tree(layers: &[Layer], mocking: &Mocking) -> Vec<u8> {
    let mut phases = crate::timings::Phases::new("question source tree", "fold records");
    let folded = fold(layers);
    phases.note(format_args!("{} records, {} layers", folded.len(), layers.len()));
    phases.next("mock additions");
    let mut added = additions(layers, &folded, mocking, false);
    join_given(layers, &folded, mocking, &mut added);
    phases.next("collect and sort paths");
    let mut files: Collected = Collected::default();
    for (&path, &(layer, row)) in &folded {
        files.insert(path);
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        if let Some(edges) = records.edges_of(stored, row) {
            files.extend(edges.map(|(to, _)| to));
        }
    }
    // A file only a test's load names is one nothing read, the way
    // `taintRecords` brings it in: unknown, and edgeless.
    let unwalked: Vec<(&str, String)> = added
        .values()
        .flat_map(|added| added.edges.iter().map(|(to, _)| to.as_str()))
        .filter(|to| !folded.contains_key(to))
        .collect::<HashSet<&str>>()
        .into_iter()
        .map(|to| (to, format!("{to} is named by a taint addition and is outside the scanned directories: nothing read it, so its own imports are unknown")))
        .collect();
    let unwalked: HashMap<&str, &str> = unwalked.iter().map(|(to, reason)| (*to, reason.as_str())).collect();
    let reasons: HashMap<&str, String> = added
        .iter()
        .filter_map(|(&file, added)| {
            let holes = added.holes.as_deref()?;
            let (layer, row) = folded[file];
            Some((file, match layers[layer].records.unknown_of(&layers[layer].stored, row) {
                Some(unknown) => format!("{unknown}; {holes}"),
                None => holes.to_owned(),
            }))
        })
        .collect();
    files.extend(added.values().flat_map(|added| added.edges.iter().map(|(to, _)| to.as_str())));
    let mut paths: Vec<&str> = files.iter().copied().collect();
    paths.par_sort_unstable_by(|left, right| crate::order::code_unit(left, right));

    phases.note(format_args!("{} paths", paths.len()));
    phases.next("strings and path lookup");
    let unknown_of = |path: &str| -> Option<&str> {
        if let Some(reason) = reasons.get(path) {
            return Some(reason.as_str());
        }
        match folded.get(path) {
            Some(&(layer, row)) => layers[layer].records.unknown_of(&layers[layer].stored, row),
            None => unwalked.get(path).copied(),
        }
    };
    let mut collected = files;
    for &path in &paths {
        collected.extend(unknown_of(path));
    }
    let mut strings = Strings::of(collected);
    let at: HashMap<&str, u32> = paths.iter().enumerate().map(|(index, &path)| (path, index as u32)).collect();

    phases.next("edge columns");
    let mut offsets = Vec::with_capacity(paths.len() + 1);
    let (mut targets, mut kinds) = (Vec::new(), Vec::new());
    let mut unknown = vec![NONE; paths.len()];
    let mut row_edges: Vec<(u32, u8)> = Vec::new();
    for (index, &path) in paths.iter().enumerate() {
        offsets.push(targets.len() as u32);
        unknown[index] = strings.optional(unknown_of(path));
        let Some(&(layer, row)) = folded.get(path) else { continue };
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        row_edges.clear();
        let loaded = added.get(path).into_iter().flat_map(|added| added.edges.iter().map(|(to, kind)| (to.as_str(), *kind)));
        for (to, kind) in records.edges_of(stored, row).into_iter().flatten().chain(loaded) {
            let (Some(&target), Some(kind)) = (at.get(to), EDGE_KINDS.iter().position(|known| *known == kind)) else { continue };
            row_edges.push((target, kind as u8));
        }
        row_edges.sort_unstable();
        row_edges.dedup();
        for &(target, kind) in &row_edges {
            targets.push(target);
            kinds.push(kind);
        }
    }
    offsets.push(targets.len() as u32);

    phases.note(format_args!("{} edges", targets.len()));
    phases.next("binary framing");
    let [blob, off] = strings.columns();
    let ids: Vec<u32> = paths.iter().map(|path| strings.id(path)).collect();
    let bytes = encode_as(FORMAT, VERSION, vec![
        blob, off,
        u32s("files.path", ids),
        u32s("files.unknown", unknown),
        u32s("edges.offset", offsets),
        u32s("edges.target", targets),
        u8s("edges.kind", kinds),
    ]);
    phases.note(format_args!("{} bytes", bytes.len()));
    phases.next("temporary cleanup");
    bytes
}

