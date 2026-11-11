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

use crate::GitTree;
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use sha2::{Digest, Sha256};

use crate::compact::{compacted, Layer, ParseView};
use crate::read::Read;
use crate::segment::{Collected, Strings};
use crate::index::parses_only;
use crate::index_chain::{read_chain, Chain};
use crate::log::{file_name, written, LogSegment, Over};
use crate::order::code_unit;
use crate::parse_columns::{ParseColumns, ParseRow, Span};

/// Past this many segments an append writes the store as one.
const SEGMENTS: usize = 16;

/// The stores an update reads, opened: the first is the one it appends to.
pub(crate) struct Stores {
    chains: Vec<(String, Held)>,
}

/// One store as it was read.
enum Held {
    Read(Chain),
    Missing,
    /// A manifest that names no chain: its bytes, so a writer replaces only them.
    Unreadable(Vec<u8>),
}

/// Every key the stores hold, to the layer and row that hold it.
pub(crate) struct Opened<'c> {
    layers: Vec<Layer<'c>>,
    keys: FxHashMap<(&'c str, &'c str), (usize, usize)>,
}

impl Stores {
    /// The stores at `paths`; one that cannot be read holds nothing.
    pub(crate) fn read(paths: &[String]) -> Self {
        let held = |path: &String| match read_chain(path) {
            Ok(Some(chain)) => Held::Read(chain),
            Ok(None) => Held::Missing,
            Err(_) => std::fs::read(path).map_or(Held::Missing, Held::Unreadable),
        };
        Stores { chains: paths.iter().map(|path| (path.clone(), held(path))).collect() }
    }

    pub(crate) fn open(&self) -> Opened<'_> {
        let mut layers = Vec::new();
        for (_, chain) in &self.chains {
            let Held::Read(chain) = chain else { continue };
            layers.extend(opened(chain));
        }
        let keys = folded(&layers);
        Opened { layers, keys }
    }

    /// Add `rows` to the first store, as one segment; the store as one when it
    /// has grown past [`SEGMENTS`], lost a segment to damage or holds one that
    /// does not open, which heals it.
    /// `false`, and nothing written, when another
    /// writer published between the read and here.
    pub(crate) fn append<P: ParseRow>(&self, rows: &[(&str, &P)]) -> std::io::Result<bool> {
        let Some((path, chain)) = self.chains.first() else { return Ok(false) };
        if rows.is_empty() {
            return Ok(false);
        }
        let segment = parses_only(rows);
        // A manifest that cannot be read is written over, as long as it is still the one read:
        // left in place, it would refuse every append after, and every root would parse again.
        let chain = match chain {
            Held::Read(chain) => chain,
            Held::Missing => return written(path, Over::Nothing, &[], &[&segment], &[], 0),
            Held::Unreadable(bytes) => return written(path, Over::Published(bytes), &[], &[&segment], &[], 0),
        };
        let references = references(chain);
        // A store that is damaged, or holds a layer this build cannot open, is written whole from
        // what reads: appending past the gap would add what no reader reaches, and every root
        // after would parse it again.
        let readable = opened(chain).len();
        if chain.damaged() == 0 && readable == chain.segments.len() && (references.len() < SEGMENTS || chain.dropped > 0) {
            return written(path, Over::Published(chain.published()), &references, &[&segment], &[], 0);
        }
        let mut layers: Vec<&[u8]> = chain.segments.iter().take(readable).map(Vec::as_slice).collect();
        layers.push(&segment);
        let whole = compacted(&layers).map_err(std::io::Error::other)?;
        let oldest = oldest(path, &chain.references);
        let wrote = written(path, Over::Published(chain.published()), &[], &[&whole], &references, 0)?;
        if wrote {
            aged(path, &whole, oldest);
        }
        Ok(wrote)
    }

    /// Add to the first store each of `read`, as `(digest, way, parse)`, that
    /// none of the stores holds. A store not written costs the next root a
    /// parse, never an answer, so a failed write is dropped.
    pub(crate) fn add_unheld<'r>(&self, opened: &Opened, read: impl Iterator<Item = (&'r str, String, &'r Read)>) {
        let mut rows: Vec<(String, &Read)> =
            read.filter(|(digest, way, _)| !opened.holds(digest, way)).map(|(digest, way, read)| (key(digest, &way), read)).collect();
        rows.sort_by(|left, right| code_unit(&left.0, &right.0));
        rows.dedup_by(|left, right| left.0 == right.0);
        let rows: Vec<(&str, &Read)> = rows.iter().map(|(key, read)| (key.as_str(), *read)).collect();
        let _ = self.append(&rows);
    }
}

/// A parse an update writes into the index: read now, or copied from a store as it lies there.
pub(crate) enum Parse<'r, 's, 'a> {
    Read(&'r Read),
    Kept(ParseView<'s, 'a>),
}

macro_rules! either {
    ($self:ident, $row:ident => $body:expr) => {
        match $self {
            Parse::Read($row) => $body,
            Parse::Kept($row) => $body,
        }
    };
}

impl ParseRow for Parse<'_, '_, '_> {
    fn strings<'s>(&'s self, into: &mut Collected<'s>) { either!(self, row => row.strings(into)) }
    fn write(&self, strings: &Strings, into: &mut ParseColumns) { either!(self, row => row.write(strings, into)) }
    fn exports_present(&self) -> bool { either!(self, row => row.exports_present()) }
    fn declares_present(&self) -> bool { either!(self, row => row.declares_present()) }
    fn unknown(&self) -> Option<&str> { either!(self, row => row.unknown()) }
    fn harvested(&self) -> bool { either!(self, row => row.harvested()) }
    fn size(&self) -> Option<crate::source_size::Size> { either!(self, row => row.size()) }
    fn doc(&self) -> Span { either!(self, row => row.doc()) }
}

impl<'c> Opened<'c> {
    /// The row the stores hold under `digest` and `way`.
    pub(crate) fn view(&self, digest: &str, way: &str) -> Option<ParseView<'_, 'c>> {
        let &(layer, row) = self.keys.get(&(digest, way))?;
        Some(ParseView::of(&self.layers[layer], row))
    }

    /// The rows held under each `(digest, way)` of `wanted`, as one parse-only
    /// segment keyed as `keyFor` spells it; a key no store holds is left out.
    pub(crate) fn segment(&self, wanted: impl Iterator<Item = (String, String)>) -> Vec<u8> {
        let mut rows: Vec<(String, ParseView)> =
            wanted.filter_map(|(digest, way)| Some((key(&digest, &way), self.view(&digest, &way)?))).collect();
        rows.sort_by(|left, right| code_unit(&left.0, &right.0));
        rows.dedup_by(|left, right| left.0 == right.0);
        let rows: Vec<(&str, &ParseView)> = rows.iter().map(|(key, view)| (key.as_str(), view)).collect();
        parses_only(&rows)
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

/// When the segment named `digest` of the store at `path` was written.
fn written_at(path: &str, digest: &str) -> Option<SystemTime> {
    std::fs::metadata(file_name(&format!("{path}.segments"), digest)).and_then(|meta| meta.modified()).ok()
}

/// When the oldest of `references` in the store at `path` was written, read
/// before a rewrite removes them.
fn oldest(path: &str, references: &[crate::index_chain::Reference]) -> Option<SystemTime> {
    references.iter().filter_map(|reference| written_at(path, &reference.digest)).min()
}

/// Date the segment `bytes` just written to the store at `path` as `oldest`,
/// the oldest of the segments it replaced: a key's age runs from when it was
/// added, and a rewrite that reset it would keep a busy store from ever passing
/// the grace. A key added since reads as older than it is, which costs at most
/// a parse dropped before its root is published, and a reparse.
fn aged(path: &str, bytes: &[u8], oldest: Option<SystemTime>) {
    let Some(oldest) = oldest else { return };
    let digest = crate::digest::of_sha256(Sha256::digest(bytes).as_slice());
    let name = file_name(&format!("{path}.segments"), &digest);
    if let Ok(file) = std::fs::File::options().write(true).open(name) {
        let _ = file.set_modified(oldest);
    }
}

impl<'r, 's, 'c> Parse<'r, 's, 'c> {
    /// The keyed parse a walk's row of `file` puts in the index it publishes:
    /// the store's, whole, when the store answered it (`kept`), else the one
    /// read now. `None` when the store no longer holds a kept row.
    pub(crate) fn of(store: Option<&'s Opened<'c>>, digest: &str, file: &str, kept: bool, read: &'r Read) -> Option<(String, Self)> {
        let way = crate::index::way(file);
        let parse = if kept { Parse::Kept(store?.view(digest, &way)?) } else { Parse::Read(read) };
        Some((key(digest, &way), parse))
    }
}

/// The row key the encoder writes for `digest` and `way`.
pub(crate) fn key(digest: &str, way: &str) -> String {
    if way.is_empty() { digest.to_owned() } else { format!("{digest}\0{way}") }
}

/// The parse keys the chain at `path` holds, as `(digest, way)`; `None` when it
/// cannot be read, which says nothing of what it names. No chain names nothing.
fn named(path: &str) -> Option<HashSet<(String, String)>> {
    match read_chain(path) {
        Ok(Some(chain)) => Some(folded(&opened(&chain)).into_keys().map(|(digest, way)| (digest.to_owned(), way.to_owned())).collect()),
        Ok(None) => Some(HashSet::new()),
        Err(_) => None,
    }
}

#[napi]
impl GitTree {
    /// Add to the first of `stores` every parse the chain at `chain` holds, no
    /// store does, and this tree read only as the blob it is kept under; how
    /// many went in.
    #[napi(catch_unwind)]
    pub fn fill_parse_store(&self, stores: Vec<String>, chain: String) -> napi::Result<u32> {
        fill(&stores, &chain, &self.from_blob)
    }
}

/// Add to the first of `stores` every parse the chain at `chain` holds, no
/// store does and `from_blob` shares; how many went in.
fn fill(stores: &[String], chain: &str, from_blob: &crate::parse_origin::FromBlob) -> napi::Result<u32> {
    let fail = |error: String| napi::Error::from_reason(format!("the parse store at {} was not filled: {error}", stores.first().map_or("", String::as_str)));
    let Some(root) = read_chain(chain).map_err(fail)? else { return Ok(0) };
    let layers = opened(&root);
    let held = Stores::read(stores);
    let store = held.open();
    let mut rows: Vec<(String, ParseView)> = folded(&layers)
        .into_iter()
        .filter(|((digest, way), _)| !store.holds(digest, way) && from_blob.shares(digest, way))
        .map(|((digest, way), (layer, row))| (key(digest, way), ParseView::of(&layers[layer], row)))
        .collect();
    if rows.is_empty() {
        return Ok(0);
    }
    rows.sort_by(|left, right| code_unit(&left.0, &right.0));
    let rows: Vec<(&str, &ParseView)> = rows.iter().map(|(key, view)| (key.as_str(), view)).collect();
    let wrote = held.append(&rows).map_err(|error| fail(error.to_string()))?;
    Ok(if wrote { rows.len() as u32 } else { 0 })
}

/// Drop from the store at `store` every key no chain in `chains` names, unless
/// the segment that holds it was written less than `grace_ms` ago; how many
/// keys went. The store is written again as one segment, and only when a key goes.
#[napi(catch_unwind)]
pub fn prune_parse_store(store: String, chains: Vec<String>, grace_ms: f64) -> napi::Result<u32> {
    let fail = |error: String| napi::Error::from_reason(format!("the parse store at {store} was not pruned: {error}"));
    let Some(chain) = read_chain(&store).map_err(fail)? else { return Ok(0) };
    // A chain that cannot be read may name any key, so nothing is dropped on its word.
    let Some(live) = chains.par_iter().map(|path| named(path)).reduce(
        || Some(HashSet::new()),
        |all, one| {
            let (mut all, one) = (all?, one?);
            all.extend(one);
            Some(all)
        },
    ) else {
        return Ok(0);
    };
    let grace = Duration::from_millis(grace_ms.max(0.0) as u64);
    let now = SystemTime::now();
    let layers = opened(&chain);
    let young: Vec<bool> = chain
        .references
        .iter()
        .take(layers.len())
        .map(|reference| now.duration_since(written_at(&store, &reference.digest).unwrap_or(now)).unwrap_or_default() < grace)
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
    let oldest = oldest(&store, &chain.references);
    match written(&store, Over::Published(chain.published()), &[], &[&whole], &references(&chain), 0) {
        Ok(true) => {
            aged(&store, &whole, oldest);
            Ok(dropped)
        }
        // Another writer appended meanwhile; the next prune sees what it added.
        Ok(false) => Ok(0),
        Err(error) => Err(fail(error.to_string())),
    }
}
