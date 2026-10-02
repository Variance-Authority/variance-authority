//! The code map of a checkout, prepared when `variance index` publishes the
//! source index and read back a page at a time by `variance ask orient`.
//!
//! The package graph is folded into nested areas (`orient_map_tree.rs`), each
//! area named and described (`orient_map_pages.rs`), and every page is written
//! beside the index as one JSON document carrying the digest of the index
//! manifest it was folded from. A question reads that document and nothing
//! else, so its cost is one page whatever the size of the repository, and a
//! map older than the index it describes says so rather than passing for
//! current.

// compass: variance-authority.reach.relations

use napi::bindgen_prelude::AsyncTask;
use napi_derive::napi;

use crate::off_thread::{off_thread, OffThread};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::compact::Layer;
use crate::index_chain::read_chain;
use crate::GitTree;
use crate::orient_map_pages::{layers, names, number, pages, Page, Row};
use crate::orient_map_read::{read, Read};
use crate::orient_map_signals::signals;
use crate::orient_map_tree::tree;

const FORMAT: u32 = 6;

#[derive(Serialize, Deserialize)]
pub(crate) struct Stored {
    format: u32,
    /// sha256 of the index manifest the map was folded from.
    pub(crate) index: String,
    /// sha256 over the path and blob id of every manifest and `.gitattributes`
    /// git listed; absent when git listed nothing.
    listed: Option<String>,
    unmarked: bool,
    /// What the fold made; absent when there was nothing to fold, and
    /// `unmade` says why.
    pub(crate) made: Option<Made>,
    pub(crate) unmade: Option<String>,
    pages: Vec<Page>,
    /// Every package in code-unit order of name, with the layer it sits in and
    /// the packages it takes, so two maps can be compared package by package.
    pub(crate) placed: Vec<Placed>,
}

/// One package's place in the dependency layers.
#[derive(Serialize, Deserialize)]
pub(crate) struct Placed {
    pub(crate) package: String,
    pub(crate) directory: String,
    pub(crate) layer: u32,
    pub(crate) takes: Vec<String>,
    /// The runtime closure of what it ships (`orient_map_closure.rs`).
    pub(crate) lines: u64,
    pub(crate) own: u64,
    pub(crate) files: u32,
    pub(crate) unsized_files: u32,
    /// Its manifest offers none of its files (`Read::undeclared`).
    pub(crate) undeclared: bool,
}

/// What a kept map is, read without its pages.
#[derive(Deserialize)]
struct Kept {
    index: String,
    listed: Option<String>,
    unmarked: bool,
    made: Option<Made>,
    unmade: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub(crate) struct Made {
    packages: u32,
    areas: u32,
    levels: u32,
    layers: u32,
    unread: u32,
}

/// The one field every format of the map shares, read before the rest.
#[derive(Deserialize)]
struct Format {
    format: u32,
}

/// Where the map of the index at `index` is kept.
pub(crate) fn map_path(index: &str) -> String {
    format!("{index}.map")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn manifest_digest(index: &str) -> Option<String> {
    let bytes = std::fs::read(index).ok()?;
    Some(hex(&Sha256::digest(&bytes)))
}

/// The bytes kept at `path` when they are a map of this format.
pub(crate) fn kept_bytes(path: &str) -> Result<Option<Vec<u8>>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("the code map at {path} did not read: {error}")),
    };
    let current = serde_json::from_slice::<Format>(&bytes).is_ok_and(|format| format.format == FORMAT);
    Ok(current.then_some(bytes))
}

/// The checkout as git listed it: the scan's listing when one is carried, or
/// the map's own.
struct Listed<'a> {
    paths: &'a [String],
    oids: &'a [crate::git::Oid],
    unhashed: &'a [String],
}

impl<'a> From<&'a crate::git::Snapshot> for Listed<'a> {
    fn from(snapshot: &'a crate::git::Snapshot) -> Self {
        Listed { paths: &snapshot.paths, oids: &snapshot.oids, unhashed: &snapshot.unhashed }
    }
}

/// What the map is folded from beside the index, as git listed it: every
/// manifest that may name a package and every `.gitattributes`, by blob id.
/// `None` when git gave no blob id for one of them.
fn listing(snapshot: &Listed) -> Option<String> {
    let counts = |path: &str| {
        let name = path.rsplit('/').next().unwrap_or(path);
        (name == "package.json" && crate::package_owners::is_package(path)) || name == ".gitattributes"
    };
    if snapshot.unhashed.iter().any(|path| counts(path)) {
        return None;
    }
    let mut digest = Sha256::new();
    for (path, oid) in snapshot.paths.iter().zip(snapshot.oids).filter(|(path, _)| counts(path)) {
        digest.update(path.as_bytes());
        digest.update([0]);
        digest.update(oid);
    }
    Some(hex(&digest.finalize()))
}

/// What preparing the map made of the checkout.
#[napi(object)]
pub struct OrientMapPrepared {
    /// `undefined` when no map was folded, and `unmade` says why.
    pub map: Option<OrientMapMade>,
    /// Why no map was folded, as a clause: `the root's is the only named
    /// manifest`, `no manifest names a package`, or `the source index holds no
    /// file records`.
    pub unmade: Option<String>,
    /// Git could not list the checkout, so the files are the ones the index
    /// holds and the manifests the ones found beside them.
    pub walked: bool,
    /// Git listed the checkout but could not say which files are generated or
    /// vendored, so none were set aside.
    pub unmarked: bool,
    /// No scan's listing was carried to the map, so git listed the checkout
    /// again for it.
    pub relisted: bool,
}

#[napi(object)]
pub struct OrientMapMade {
    pub packages: u32,
    pub areas: u32,
    /// How many areas deep the deepest package sits.
    pub levels: u32,
    pub layers: u32,
    /// Counted files whose requests could not be read against their parse:
    /// their edges are on the map, but not the names they take, and a request
    /// the index left unresolved is not answered by its bare specifier.
    pub unread: u32,
}

impl From<Made> for OrientMapMade {
    fn from(made: Made) -> Self {
        OrientMapMade { packages: made.packages, areas: made.areas, levels: made.levels, layers: made.layers, unread: made.unread }
    }
}

/// Fold the index at `index` into the code map and write it beside the index,
/// with no scan's listing to carry: git lists the checkout for the map, and
/// the result says so. `scanned` is a scan that ran and could not list with
/// git, so none is asked for. `undefined` when there is no index.
#[napi(ts_return_type = "Promise<OrientMapPrepared | null>")]
pub fn prepare_orient_map(root: String, index: String, scanned: Option<bool>) -> AsyncTask<OffThread<Option<OrientMapPrepared>>> {
    off_thread(move || uncarried(&root, &index, scanned))
}

/// `prepare_orient_map`, on the calling thread.
pub(crate) fn uncarried(root: &str, index: &str, scanned: Option<bool>) -> napi::Result<Option<OrientMapPrepared>> {
    if scanned == Some(true) {
        return prepare(root, index, None, false);
    }
    let snapshot = crate::git::snapshot(root);
    prepare(root, index, snapshot.as_ref().map(Listed::from), snapshot.is_some())
}

/// `GitTree::prepare_orient_map`, on the calling thread.
#[cfg(test)]
pub(crate) fn carried(tree: &GitTree, root: &str, index: &str) -> napi::Result<Option<OrientMapPrepared>> {
    prepare(root, index, Some(Listed { paths: &tree.paths, oids: &tree.oids, unhashed: &tree.unhashed }), false)
}

#[napi]
impl GitTree {
    /// Fold the index at `index` into the code map, carrying this listing of
    /// the checkout — the one the scan that published the index took — rather
    /// than asking git again. `undefined` when there is no index.
    /// The listing is copied, because the fold runs off the JavaScript thread
    /// while this tree stays JavaScript's.
    #[napi(ts_return_type = "Promise<OrientMapPrepared | null>")]
    pub fn prepare_orient_map(&self, root: String, index: String) -> AsyncTask<OffThread<Option<OrientMapPrepared>>> {
        let (paths, oids, unhashed) = (self.paths.clone(), self.oids.clone(), self.unhashed.clone());
        off_thread(move || {
            let listed = Listed { paths: &paths, oids: &oids, unhashed: &unhashed };
            prepare(&root, &index, Some(listed), false)
        })
    }
}

/// Fold the index at `index` into the code map and write it beside the index.
/// When there is no package to fold, what is written beside the index is why,
/// so a question is answered with the reason rather than with a map left from
/// before. A kept map folded from this index and these manifests is kept as
/// it is, so an index with nothing changed costs no fold.
fn prepare(root: &str, index: &str, snapshot: Option<Listed>, relisted: bool) -> napi::Result<Option<OrientMapPrepared>> {
    // The reason alone: the caller says what was not prepared.
    let fail = napi::Error::from_reason;
    let path = map_path(index);
    let Some(chain) = read_chain(index).map_err(fail)? else { return Ok(None) };
    let digest = hex(&Sha256::digest(chain.published()));
    let walked = snapshot.is_none();
    let listed = snapshot.as_ref().and_then(listing);
    if listed.is_some() {
        let kept = kept_bytes(&path).map_err(fail)?.and_then(|bytes| serde_json::from_slice::<Kept>(&bytes).ok());
        let kept = kept.filter(|kept| kept.index == digest && kept.listed == listed && crate::orient_map_shipped::kept(index, &digest));
        if let Some(kept) = kept {
            return Ok(Some(OrientMapPrepared { map: kept.made.map(Into::into), unmade: kept.unmade, walked, unmarked: kept.unmarked, relisted }));
        }
    }
    // Git owns the file list and the generated and vendored marks. Outside a
    // checkout git answers neither: the files are then the ones the index
    // holds, nothing is marked, and the result says so.
    let layers_read: Vec<Layer> = chain
        .segments
        .iter()
        .enumerate()
        .map(|(at, bytes)| Layer::open(bytes).map_err(|error| format!("segment {at}: {error}")))
        .collect::<Result<_, _>>()
        .map_err(fail)?;
    let mut unmarked = false;
    let read = std::thread::scope(|scope| {
        let marks = scope.spawn(|| {
            snapshot.as_ref().and_then(|_| {
                crate::git::git(root, &["ls-files", "-z", ":(attr:linguist-generated)", ":(attr:linguist-vendored)"], None)
            })
        });
        read(root, &layers_read, snapshot.as_ref().map(|snapshot| snapshot.paths), || {
            let made = marks.join().ok().flatten();
            unmarked = !walked && made.is_none();
            made.unwrap_or_default()
                .split(|&byte| byte == 0)
                .filter(|path| !path.is_empty())
                .map(|path| String::from_utf8_lossy(path).into_owned())
                .collect()
        })
    });
    let stored = match fold(&read) {
        Ok((made, pages, placed)) => Stored { format: FORMAT, index: digest, listed, unmarked, made: Some(made), unmade: None, pages, placed },
        Err(unmade) => {
            Stored { format: FORMAT, index: digest, listed, unmarked, made: None, unmade: Some(unmade.to_owned()), pages: Vec::new(), placed: Vec::new() }
        }
    };
    let text = serde_json::to_vec(&stored).map_err(|error| fail(error.to_string()))?;
    let written = format!("{path}.{}", std::process::id());
    std::fs::write(&written, text)
        .and_then(|()| std::fs::rename(&written, &path))
        .map_err(|error| fail(format!("{path} was not written: {error}")))?;
    crate::orient_map_shipped::write(index, &stored.index, &read.shipped, &read.catalogued).map_err(fail)?;
    Ok(Some(OrientMapPrepared { map: stored.made.map(Into::into), unmade: stored.unmade, walked, unmarked, relisted }))
}

/// The map's pages and what they hold, or why there is nothing to fold.
fn fold(read: &Read) -> Result<(Made, Vec<Page>, Vec<Placed>), &'static str> {
    if read.records == 0 {
        return Err("the source index holds no file records");
    }
    if read.packages.is_empty() {
        return Err("no manifest names a package");
    }
    let signals = signals(read);
    if signals.packages.is_empty() {
        return Err("the root's is the only named manifest");
    }
    let root = tree(&signals);
    let mut importers = vec![0u32; read.packages.len()];
    for &(_, b, _) in &read.edges {
        importers[b as usize] += 1;
    }
    let mut named = Vec::new();
    names(&root, &signals, read, &importers, &mut named);
    let areas = number(&root, &named);
    let (layer, count) = layers(read);
    let pages = pages(read, &signals, &areas, &layer);
    let levels = areas.iter().map(|area| if area.id.is_empty() { 0 } else { area.id.split('.').count() as u32 }).max().unwrap_or(0);
    let mut takes: Vec<Vec<String>> = vec![Vec::new(); read.packages.len()];
    for &(importer, provider, _) in &read.edges {
        takes[importer as usize].push(read.packages[provider as usize].name.clone());
    }
    let placed = read
        .packages
        .iter()
        .zip(&layer)
        .zip(takes)
        .zip(&read.closures)
        .zip(&read.undeclared)
        .map(|((((named, &layer), takes), closure), &undeclared)| Placed {
            package: named.name.clone(),
            directory: named.directory.clone(),
            layer,
            takes,
            lines: closure.lines,
            own: closure.own,
            files: closure.files,
            unsized_files: closure.unsized_files,
            undeclared,
        })
        .collect();
    Ok((Made { packages: pages[0].packages, areas: pages.len() as u32 - 1, levels, layers: count, unread: read.unread }, pages, placed))
}

/// One row of a page, as `variance ask orient` prints it.
#[napi(object)]
pub struct OrientMapRow {
    pub id: String,
    pub name: String,
    pub packages: u32,
    pub files: u32,
    pub low: u32,
    pub high: u32,
    pub median: u32,
    pub incoming: u32,
    pub front: Vec<OrientMapShare>,
    pub more: u32,
    pub outgoing: u32,
    pub uses: Vec<OrientMapShare>,
}

/// A package or an area, and how many files the share is of.
#[napi(object)]
pub struct OrientMapShare {
    pub name: String,
    pub files: u32,
}

#[napi(object)]
pub struct OrientMapPage {
    /// `''` for the top page.
    pub id: String,
    pub name: String,
    pub packages: u32,
    pub files: u32,
    pub low: u32,
    pub high: u32,
    /// Packages on this page no area inside it took.
    pub alone: u32,
    pub rows: Vec<OrientMapRow>,
    /// The packages no area inside this one took, listed after the rows: all
    /// of them in an area with no areas inside it.
    pub list: Vec<String>,
}

#[napi(object)]
pub struct OrientMapAnswer {
    /// Whether the map was folded from the index as it stands now.
    pub current: bool,
    /// `undefined` when there was nothing to fold, and `unmade` says why.
    pub layers: Option<u32>,
    /// `undefined` when the map has no area by the id asked.
    pub page: Option<OrientMapPage>,
    /// Why no map was folded from this index.
    pub unmade: Option<String>,
}

/// One page of the map kept beside the index at `index`: the top one, or the
/// area `area`. `undefined` when no map is kept there, or one of a format this
/// reader does not know.
#[napi(catch_unwind)]
pub fn orient_map_page(index: String, area: Option<String>) -> napi::Result<Option<OrientMapAnswer>> {
    let path = map_path(&index);
    // A map of another format is no map this reader can answer from, which is
    // what `variance index` answers.
    let Some(bytes) = kept_bytes(&path).map_err(napi::Error::from_reason)? else { return Ok(None) };
    let stored: Stored = serde_json::from_slice(&bytes)
        .map_err(|error| napi::Error::from_reason(format!("the code map at {path} did not read: {error}")))?;
    let current = manifest_digest(&index).as_deref() == Some(stored.index.as_str());
    let wanted = area.unwrap_or_default();
    let share = |(name, files): (String, u32)| OrientMapShare { name, files };
    let page = stored.pages.into_iter().find(|page| page.id == wanted).map(|page| OrientMapPage {
        id: page.id,
        name: page.name,
        packages: page.packages,
        files: page.files,
        low: page.low,
        high: page.high,
        alone: page.alone,
        rows: page
            .rows
            .into_iter()
            .map(|row: Row| OrientMapRow {
                id: row.id,
                name: row.name,
                packages: row.packages,
                files: row.files,
                low: row.low,
                high: row.high,
                median: row.median,
                incoming: row.incoming,
                front: row.front.into_iter().map(share).collect(),
                more: row.more,
                outgoing: row.outgoing,
                uses: row.uses.into_iter().map(share).collect(),
            })
            .collect(),
        list: page.list,
    });
    Ok(Some(OrientMapAnswer { current, layers: stored.made.map(|made| made.layers), page, unmade: stored.unmade }))
}

#[cfg(all(test, unix))]
#[path = "orient_map_tests.rs"]
mod tests;
