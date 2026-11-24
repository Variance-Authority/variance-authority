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

use rayon::prelude::*;
use regex::Regex;

use crate::chain_lookup::fold;
use crate::package_graph::{join_parses, Crossing};
use crate::package_owners::NO_OWNER;
use crate::resolve::{Resolvers, MODULE_EXTENSIONS};
use crate::specifier::{is_relative, kind_for, request_of};
use crate::segment::{encode_as, u32s, u8s, Collected, Strings, NONE};
use crate::compact::Layer;

pub(crate) const FORMAT: &str = "variance-authority-source-tree";
/// 2: the tree carries what tests load for real beside their mocks.
pub(crate) const VERSION: u8 = 2;
/// `EDGE_KINDS` in `core/relate/graph.ts`, in its order.
pub(crate) const EDGE_KINDS: [&str; 8] = ["imports", "reexports", "dynamic", "type", "asset", "declared-in", "depends-on", "depends"];

/// How a test's loads beside its mocks are resolved: from the checkout at
/// `root`, by `resolvers`, with `code` the extensions read as code.
pub(crate) struct Mocking {
    pub root: PathBuf,
    pub resolvers: Resolvers,
    pub code: HashSet<String>,
}

impl Mocking {
    /// A test's loads beside its mocks, resolved from the checkout at `root`.
    pub(crate) fn at(root: &str, tsconfig: crate::resolve::Tsconfig, code: Vec<String>) -> Self {
        let checkout = crate::resolve::checkout_root(std::path::Path::new(root));
        let resolvers = Resolvers::over(tsconfig, None, crate::emitted::Emitted::listed(&checkout, None));
        Mocking { root: checkout, resolvers, code: code.into_iter().collect() }
    }
}

/// `isTestLike` in `sense/src/taint/mocks.ts`: where a mock is expected to be written.
static TEST_LIKE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|/)(setup|setupTests|test-setup|vitest\.setup|jest\.setup)\.[cm]?[jt]sx?$|(^|/)\.storybook/").expect("a valid pattern")
});

#[cfg(feature = "standalone-cli")]
pub(crate) fn mock_cuts(layers: &[Layer], root: &str, tsconfig: crate::resolve::Tsconfig) -> Vec<(String, Vec<String>)> {
    let folded = fold(layers);
    let tests = test_crossings(layers, &folded);
    let mut pending = Vec::new();
    for test in tests {
        let Some((layer, row)) = test.parse else { continue };
        let (stored, parses) = (&layers[layer].stored, &layers[layer].parses);
        let specifiers: Vec<_> = parses.mocks_minus.range(row).map(|at| stored.text(parses.mock_minus.at(at))).collect();
        if !specifiers.is_empty() { pending.push((test.file, specifiers)); }
    }
    if pending.is_empty() { return Vec::new() }
    let mocking = Mocking::at(root, tsconfig, Vec::new());
    let known = excluded_paths(&folded);
    let mut cuts: Vec<_> = pending.into_par_iter().filter_map(|(file, specifiers)| {
        let from = mocking.root.join(file);
        let targets: Vec<_> = specifiers.into_iter()
            .filter_map(|value| mocking.resolvers.resolve(&mocking.root, &from, value, Some(&known))).collect();
        (!targets.is_empty()).then(|| (file.to_owned(), targets))
    }).collect();
    cuts.sort_unstable_by(|a, b| crate::order::code_unit(&a.0, &b.0));
    cuts
}

fn test_crossings<'a>(layers: &'a [Layer], folded: &HashMap<&'a str, (usize, usize)>) -> Vec<Crossing<'a>> {
    let mut tests: Vec<_> = folded.iter()
        .filter(|(path, _)| MODULE_EXTENSIONS.iter().any(|extension| path.ends_with(extension)) && TEST_LIKE.is_match(path))
        .map(|(&file, &at)| Crossing { file, owner: NO_OWNER, others: Vec::new(), at, parse: None })
        .collect();
    join_parses(layers, &mut tests);
    tests
}

fn excluded_paths(folded: &HashMap<&str, (usize, usize)>) -> HashMap<String, u32> {
    folded.keys().filter(|path| path.split('/').any(crate::path::excluded))
        .map(|path| ((*path).to_owned(), 0)).collect()
}

/// What one test adds: its edges and why unresolved relative loads are unknown.
struct Added {
    edges: Vec<(String, &'static str)>,
    holes: Option<String>,
}

/// Every test's loads beside its mocks, resolved, keyed by the test.
fn additions<'l>(layers: &'l [Layer], folded: &HashMap<&'l str, (usize, usize)>, mocking: &Mocking) -> HashMap<&'l str, Added> {
    let crossings = test_crossings(layers, folded);
    // A tracked build path is source only where the index holds it.
    let known = excluded_paths(folded);
    crossings
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
            if said.is_empty() {
                return None;
            }
            let from = mocking.root.join(crossing.file);
            let (mut targets, mut holes) = (Vec::new(), Vec::new());
            for value in said {
                match mocking.resolvers.resolve(&mocking.root, &from, value, Some(&known)) {
                    Some(to) => targets.push(to),
                    None if request_of(value).is_some_and(is_relative) => holes.push(value),
                    None => {}
                }
            }
            targets.sort_unstable_by(|left, right| crate::order::code_unit(left, right));
            targets.dedup();
            let edges = targets.into_iter().map(|to| {
                let kind = if kind_for("imports", &to, &mocking.code) == "asset" { "asset" } else { "imports" };
                (to, kind)
            }).collect();
            let holes = (!holes.is_empty()).then(|| format!("{} tainted relative specifier(s) that resolve to nothing: {}", holes.len(), holes.join(", ")));
            Some((crossing.file, Added { edges, holes }))
        })
        .collect()
}

pub(crate) fn tree(layers: &[Layer], mocking: &Mocking) -> Vec<u8> {
    let folded = fold(layers);
    let added = additions(layers, &folded, mocking);
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

    let [blob, off] = strings.columns();
    let ids: Vec<u32> = paths.iter().map(|path| strings.id(path)).collect();
    encode_as(FORMAT, VERSION, vec![
        blob, off,
        u32s("files.path", ids),
        u32s("files.unknown", unknown),
        u32s("edges.offset", offsets),
        u32s("edges.target", targets),
        u8s("edges.kind", kinds),
    ])
}

