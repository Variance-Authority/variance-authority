//! The parses a cache keeps for every root it indexes.
//!
//! A parse is a function of a file's bytes and the way they are read (`way` in
//! `index.rs`), so it is kept under that key and nothing else: no path, no
//! root, no generation. A checkout, a directory in it and a worktree cut from
//! it read the same bytes, and the first of them to parse a module answers the
//! rest. A root's own chain still holds the parses its records name; this is
//! where a root with no record for a file looks before it opens the file.
//!
//! The store is a parses-only immutable log (`log.rs`): segments named by
//! their content, behind a manifest one writer at a time publishes under the
//! log's lock. A key's value is a function of the key, so two writers that add
//! the same key add the same row, and a writer the chain moved under skips its
//! append rather than waits: the next update that parses the file adds it.
//!
//! What is kept is reclaimed by reachability, as `git gc` keeps what a ref
//! names: a key no root chain in the cache names is dropped once the segment
//! that added it is older than the grace a writer needs between appending here
//! and publishing the root that names it.

// compass: variance-authority.reach.source-index

use std::collections::HashSet;
use std::time::{Duration, SystemTime};

use napi_derive::napi;
use rayon::prelude::*;
use rustc_hash::FxHashMap;

use crate::compact::{merged, Layer, ParseView};
use crate::index::parses_only;
use crate::index_chain::{read_chain, Chain};
use crate::log::{written, LogSegment, Over};
use crate::order::code_unit;
use crate::parse_columns::ParseRow;

/// Past this many segments an append writes the store as one.
const SEGMENTS: usize = 16;

/// The stores an update reads, opened: the first is the one it appends to.
pub(crate) struct Stores {
    chains: Vec<(String, Option<Chain>)>,
}

/// Every key the stores hold, to the layer and row that hold it.
pub(crate) struct Opened<'c> {
    layers: Vec<Layer<'c>>,
    keys: FxHashMap<(&'c str, &'c str), (usize, usize)>,
}

impl Stores {
    /// The stores at `paths`; one that cannot be read holds nothing.
    pub(crate) fn read(paths: &[String]) -> Self {
        Stores { chains: paths.iter().map(|path| (path.clone(), read_chain(path).ok().flatten())).collect() }
    }

    pub(crate) fn open(&self) -> Opened<'_> {
        let mut layers = Vec::new();
        for (_, chain) in &self.chains {
            let Some(chain) = chain else { continue };
            layers.extend(opened(chain));
        }
        let keys = folded(&layers);
        Opened { layers, keys }
    }

    /// Add `rows` to the first store, as one segment; the store as one when it
    /// has grown past [`SEGMENTS`]. Nothing, and no error, when another writer
    /// published between the read and here.
    pub(crate) fn append<P: ParseRow>(&self, rows: &[(&str, &P)]) -> std::io::Result<()> {
        let Some((path, chain)) = self.chains.first() else { return Ok(()) };
        if rows.is_empty() {
            return Ok(());
        }
        let segment = parses_only(rows);
        let Some(chain) = chain else {
            return written(path, Over::Nothing, &[], &[&segment], &[], 0).map(drop);
        };
        let references = references(chain);
        if references.len() < SEGMENTS || chain.dropped > 0 {
            return written(path, Over::Published(chain.published()), &references, &[&segment], &[], 0).map(drop);
        }
        let mut layers: Vec<&[u8]> = chain.segments[1..].iter().map(Vec::as_slice).collect();
        layers.push(&segment);
        let whole = merged(&[&chain.segments[0]], &layers).map_err(std::io::Error::other)?;
        written(path, Over::Published(chain.published()), &[], &[&whole], &references, 0).map(drop)
    }
}

impl<'c> Opened<'c> {
    /// The row the stores hold under `digest` and `way`.
    pub(crate) fn view(&self, digest: &str, way: &str) -> Option<ParseView<'_, 'c>> {
        let &(layer, row) = self.keys.get(&(digest, way))?;
        Some(ParseView::of(&self.layers[layer], row))
    }

    pub(crate) fn holds(&self, digest: &str, way: &str) -> bool {
        self.keys.contains_key(&(digest, way))
    }
}

fn references(chain: &Chain) -> Vec<LogSegment> {
    chain.references.iter().map(|reference| LogSegment { digest: reference.digest.clone(), length: reference.length as i64 }).collect()
}

/// The layers of `chain` up to the first that does not open, which ends what
/// it answers, as it ends a chain.
fn opened(chain: &Chain) -> Vec<Layer<'_>> {
    chain.segments.iter().map_while(|bytes| Layer::open(bytes).ok()).collect()
}

/// Every parse key `layers` hold, as `(digest, way)`, to the layer and row that
/// hold it: the last layer to put or delete a key decides.
fn folded<'c>(layers: &[Layer<'c>]) -> FxHashMap<(&'c str, &'c str), (usize, usize)> {
    let mut keys = FxHashMap::default();
    for (at, layer) in layers.iter().enumerate() {
        let (stored, parses) = (&layer.stored, &layer.parses);
        for row in 0..parses.deleted.len() {
            keys.remove(&(stored.text(parses.deleted.at(row)), stored.text(parses.deleted_way.at(row))));
        }
        for row in 0..parses.key.len() {
            keys.insert((stored.text(parses.key.at(row)), stored.text(parses.way.at(row))), (at, row));
        }
    }
    keys
}

/// The row key the encoder writes for `digest` and `way`.
fn key(digest: &str, way: &str) -> String {
    if way.is_empty() { digest.to_owned() } else { format!("{digest}\0{way}") }
}

/// The parse keys the chain at `path` holds, as `(digest, way)`.
fn named(path: &str) -> HashSet<(String, String)> {
    let Ok(Some(chain)) = read_chain(path) else { return HashSet::new() };
    folded(&opened(&chain)).into_keys().map(|(digest, way)| (digest.to_owned(), way.to_owned())).collect()
}

/// Add to the first of `stores` every parse the chain at `chain` holds and no
/// store does; how many went in. What a scan read in JavaScript reaches the
/// store this way, after the root that read it is published.
#[napi(catch_unwind)]
pub fn fill_parse_store(stores: Vec<String>, chain: String) -> napi::Result<u32> {
    let fail = |error: String| napi::Error::from_reason(format!("the parse store at {} was not filled: {error}", stores.first().map_or("", String::as_str)));
    let Some(root) = read_chain(&chain).map_err(fail)? else { return Ok(0) };
    let layers = opened(&root);
    let held = Stores::read(&stores);
    let store = held.open();
    let mut rows: Vec<(String, ParseView)> = folded(&layers)
        .into_iter()
        .filter(|((digest, way), _)| !store.holds(digest, way))
        .map(|((digest, way), (layer, row))| (key(digest, way), ParseView::of(&layers[layer], row)))
        .collect();
    if rows.is_empty() {
        return Ok(0);
    }
    rows.sort_by(|left, right| code_unit(&left.0, &right.0));
    let rows: Vec<(&str, &ParseView)> = rows.iter().map(|(key, view)| (key.as_str(), view)).collect();
    held.append(&rows).map_err(|error| fail(error.to_string()))?;
    Ok(rows.len() as u32)
}

/// Drop from the store at `store` every key no chain in `chains` names, unless
/// the segment that holds it was written less than `grace_ms` ago; how many
/// keys went. The store is written again as one segment, and only when a key goes.
#[napi(catch_unwind)]
pub fn prune_parse_store(store: String, chains: Vec<String>, grace_ms: f64) -> napi::Result<u32> {
    let fail = |error: String| napi::Error::from_reason(format!("the parse store at {store} was not pruned: {error}"));
    let Some(chain) = read_chain(&store).map_err(fail)? else { return Ok(0) };
    let live: HashSet<(String, String)> = chains.par_iter().map(|path| named(path)).reduce(HashSet::new, |mut all, one| {
        all.extend(one);
        all
    });
    let grace = Duration::from_millis(grace_ms.max(0.0) as u64);
    let now = SystemTime::now();
    let directory = format!("{store}.segments");
    let layers = opened(&chain);
    let young: Vec<bool> = chain
        .references
        .iter()
        .take(layers.len())
        .map(|reference| {
            let name = format!("{directory}/{}.bin", reference.digest.replacen(':', "-", 1));
            let written_at = std::fs::metadata(name).and_then(|meta| meta.modified()).unwrap_or(now);
            now.duration_since(written_at).unwrap_or_default() < grace
        })
        .collect();
    let keys = folded(&layers);
    let mut kept: Vec<(String, ParseView)> = Vec::new();
    for (&(digest, way), &(layer, row)) in &keys {
        if young[layer] || live.contains(&(digest.to_owned(), way.to_owned())) {
            kept.push((key(digest, way), ParseView::of(&layers[layer], row)));
        }
    }
    let dropped = (keys.len() - kept.len()) as u32;
    if dropped == 0 {
        return Ok(0);
    }
    kept.sort_by(|left, right| code_unit(&left.0, &right.0));
    let rows: Vec<(&str, &ParseView)> = kept.iter().map(|(key, view)| (key.as_str(), view)).collect();
    let whole = parses_only(&rows);
    match written(&store, Over::Published(chain.published()), &[], &[&whole], &references(&chain), 0) {
        Ok(true) => Ok(dropped),
        // Another writer appended meanwhile; the next prune sees what it added.
        Ok(false) => Ok(0),
        Err(error) => Err(fail(error.to_string())),
    }
}
