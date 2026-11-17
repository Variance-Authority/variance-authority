//! Parses shared across roots by file bytes and reading mode (`way` in `index.rs`).
//! A store reads only the parse columns of its immutable log (`log.rs`), so a
//! cold root can seed it with an already encoded generation. Root records and
//! other metadata carried by that generation do not affect lookup or pruning.
//! The log owns locking and publication: a writer whose snapshot moved skips
//! its append. Reachability reclaims keys no root names after the grace between
//! store append and root publication. Each root retains its own parse segments.

// compass: variance-authority.reach.source-index

use std::collections::HashSet;
use std::time::{Duration, SystemTime};

use napi_derive::napi;

use crate::GitTree;
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use sha2::{Digest, Sha256};

use crate::compact::{compacted, Layer, ParseView};
use crate::chain_lookup::fold_parses;
use crate::source_read::SourceRead;
use crate::segment::{Collected, Strings};
use crate::index::parses_only;
use crate::index_chain::{read_chain, Chain};
use crate::log::{file_name, written, written_retaining, LogSegment, Over, WrittenSegment};
use crate::order::code_unit;
use crate::parse_columns::{ParseColumns, ParseRow};

/// Past this many appended layers an append writes the store as one.
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
        let keys = fold_parses(&layers);
        Opened { layers, keys }
    }

    /// Add `rows` to the first store, as one segment; the store as one when it
    /// has grown past [`SEGMENTS`], lost a segment to damage or holds one that
    /// does not open, which heals it.
    /// `false`, and nothing written, when another
    /// writer published between the read and here.
    pub(crate) fn append<P: ParseRow>(&self, rows: &[(&str, &P)]) -> std::io::Result<bool> {
        let mut phases = crate::timings::Phases::new("parse store append", "encode rows");
        let Some((path, chain)) = self.chains.first() else {
            phases.note("disabled: no destination");
            return Ok(false);
        };
        if rows.is_empty() {
            phases.note("skipped: no rows");
            return Ok(false);
        }
        let segment = parses_only(rows);
        phases.note(format_args!("{} rows, {} bytes encoded", rows.len(), segment.len()));
        phases.next("publish rows");
        let result = (|| {
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
            if chain.damaged() == 0 && readable == chain.segments.len() && (chain.working < SEGMENTS || chain.dropped > 0) {
                return written(path, Over::Published(chain.published()), &references, &[&segment], &[], chain.working + 1);
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
        })();
        match &result {
            Ok(true) => phases.note(format_args!("{} rows appended", rows.len())),
            Ok(false) => phases.note("skipped: publication unchanged"),
            Err(error) => phases.note(format_args!("failed: {error}")),
        }
        result
    }

    /// Add to the first store each of `read`, as `(digest, way, parse)`, that
    /// none of the stores holds. A store not written costs the next root a
    /// parse, never an answer, so a failed write is dropped.
    fn add_unheld<'r, P: ParseRow + 'r>(&self, opened: &Opened, read: impl Iterator<Item = (&'r str, String, &'r P)>) {
        let mut phases = crate::timings::Phases::new("parse store", "collect unheld rows");
        if self.chains.is_empty() {
            phases.note("disabled: no destination; input rows not consumed");
            return;
        }
        let mut rows: Vec<(String, &P)> =
            read.filter(|(digest, way, _)| !opened.holds(digest, way)).map(|(digest, way, read)| (key(digest, &way), read)).collect();
        rows.sort_by(|left, right| code_unit(&left.0, &right.0));
        rows.dedup_by(|left, right| left.0 == right.0);
        let rows: Vec<(&str, &P)> = rows.iter().map(|(key, read)| (key.as_str(), *read)).collect();
        phases.note(format_args!("{} unheld rows selected", rows.len()));
        phases.next("append selected rows");
        let _ = self.append(&rows);
    }

    /// Select full parse views only after the last read settled Git provenance.
    /// An entirely eligible cold input seeds the missing destination verbatim.
    pub(crate) fn add_encoded<'a>(&self, opened: &Opened, encoded: &'a [Vec<u8>], from_blob: &crate::parse_origin::FromBlob, prepared: &[crate::scan_session::PreparedParse]) -> Vec<WrittenSegment<'a>> {
        if self.chains.is_empty() { return Vec::new() }
        let layers: Vec<_> = encoded.iter().map(|bytes| Layer::open(bytes).expect("the encoder wrote a complete generation")).collect();
        let mut rows: Vec<_> = unheld_views(&layers, opened, from_blob).into_iter().map(|(key, view)| (key, Parse::Kept(view))).collect();
        let complete = rows.len() == layers.iter().map(|layer| layer.parses.key.len()).sum::<usize>();
        let root_rows = rows.len();
        rows.extend(prepared.iter().filter(|row| !row.kept && from_blob.shares(&row.identity, &crate::index::way(row.file)))
            .filter(|row| !opened.holds(&row.identity, &crate::index::way(row.file)))
            .map(|row| (key(&row.identity, &crate::index::way(row.file)), Parse::Read(row.read))));
        if rows.is_empty() { return Vec::new() }
        if complete && rows.len() == root_rows {
            if let Some(written) = self.seed(opened, &encoded.iter().map(Vec::as_slice).collect::<Vec<_>>()) { return written }
        }
        self.add_unheld(opened, rows.iter().map(|(key, row)| {
            let (digest, way) = crate::generation::key_parts(key);
            (digest, way.to_owned(), row)
        }));
        Vec::new()
    }

    /// `Some` means the missing destination was attempted, including a lost
    /// publication race: input rows must not overwrite the winner afterwards.
    fn seed<'a>(&self, opened: &Opened, generations: &[&'a [u8]]) -> Option<Vec<WrittenSegment<'a>>> {
        let Some((path, Held::Missing)) = self.chains.first() else { return None };
        if !opened.keys.is_empty() { return None }
        let phases = crate::timings::Phases::new("parse store", "publish encoded generations");
        match written_retaining(path, Over::Nothing, &[], generations, &[], 0) {
            Ok(Some(written)) => {
                phases.note(format_args!("{} encoded bytes seeded in {} segments", generations.iter().map(|bytes| bytes.len()).sum::<usize>(), generations.len()));
                return Some(written);
            },
            Ok(None) => phases.note("skipped: publication unchanged"),
            Err(error) => phases.note(format_args!("failed: {error}")),
        }
        Some(Vec::new())
    }
}

fn unheld_views<'s, 'a>(layers: &'s [Layer<'a>], store: &Opened, from_blob: &crate::parse_origin::FromBlob) -> Vec<(String, ParseView<'s, 'a>)> {
    fold_parses(layers).into_iter()
        .filter(|((digest, way), _)| !store.holds(digest, way) && from_blob.shares(digest, way))
        .map(|((digest, way), (layer, row))| (key(digest, way), ParseView::of(&layers[layer], row))).collect()
}

/// A parse an update writes into the index: read now, or copied from a store as it lies there.
pub(crate) enum Parse<'r, 's, 'a> {
    Read(&'r SourceRead),
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
    fn write<'text>(&'text self, strings: &Strings, into: &mut ParseColumns<'text>) { either!(self, row => row.write(strings, into)) }
    fn exports_present(&self) -> bool { either!(self, row => row.exports_present()) }
    fn declares_present(&self) -> bool { either!(self, row => row.declares_present()) }
    fn unknown(&self) -> Option<&str> { either!(self, row => row.unknown()) }
    fn harvested(&self) -> bool { either!(self, row => row.harvested()) }
    fn size(&self) -> Option<crate::source_size::Size> { either!(self, row => row.size()) }
    fn doc(&self) -> Option<(u32, u32, Option<&str>)> { either!(self, row => row.doc()) }
    fn words(&self, item: crate::name_table::Item, at: usize) -> Option<Option<std::borrow::Cow<'_, str>>> { either!(self, row => row.words(item, at)) }
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

/// The row key the encoder writes for `digest` and `way`.
pub(crate) fn key(digest: &str, way: &str) -> String {
    if way.is_empty() { digest.to_owned() } else { format!("{digest}\0{way}") }
}

/// The parse keys the chain at `path` holds, as `(digest, way)`; `None` when it
/// cannot be read, which says nothing of what it names. No chain names nothing.
fn named(path: &str) -> Option<HashSet<(String, String)>> {
    match read_chain(path) {
        Ok(Some(chain)) => Some(fold_parses(&opened(&chain)).into_keys().map(|(digest, way)| (digest.to_owned(), way.to_owned())).collect()),
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
    let mut rows = unheld_views(&layers, &store, from_blob);
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
    let keys = fold_parses(&layers);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_destination_never_consumes_unheld_parse_rows() {
        let stores = Stores::read(&[]);
        let opened = stores.open();
        let read = SourceRead::default();
        let consumed = std::cell::Cell::new(0);
        let rows = std::iter::once_with(|| {
            consumed.set(consumed.get() + 1);
            ("digest", "tsx".to_owned(), &read)
        });
        stores.add_unheld(&opened, rows);
        assert_eq!(consumed.get(), 0, "a disabled store must not collect or sort parses");
    }

    #[test]
    fn a_missing_destination_accepts_only_one_multigeneration_seed() {
        let root = crate::git_fixture::repository("parse-store-seed-race", &[]);
        let path = root.join("parses.bin").to_str().unwrap().to_owned();
        let first = Stores::read(std::slice::from_ref(&path));
        let second = Stores::read(std::slice::from_ref(&path));
        let read = SourceRead::default();
        let a = parses_only(&[("a", &read)]);
        let b = parses_only(&[("b", &read)]);
        assert!(first.seed(&first.open(), &[&a, &b]).is_some());
        assert!(second.seed(&second.open(), &[&b]).is_some(), "a losing seed is complete, so rows cannot overwrite the winner");
        let chain = read_chain(&path).unwrap().unwrap();
        assert!(chain.segments == vec![a, b], "a writer that observed missing never replaces the winner");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_nonempty_opened_view_keeps_only_the_unheld_input_rows() {
        let root = crate::git_fixture::repository("parse-store-seed-held", &[]);
        let destination = root.join("parses.bin").to_str().unwrap().to_owned();
        let upstream = root.join("upstream.bin").to_str().unwrap().to_owned();
        let read = SourceRead::default();
        Stores::read(std::slice::from_ref(&upstream)).append(&[("a", &read)]).unwrap();
        let stores = Stores::read(&[destination.clone(), upstream]);
        let candidate = parses_only(&[("a", &read), ("b", &read)]);
        assert!(stores.seed(&stores.open(), &[&candidate]).is_none(), "an upstream store makes this a selected append");
        stores.add_unheld(&stores.open(), [("a", String::new(), &read), ("b", String::new(), &read)].into_iter());
        let chain = read_chain(&destination).unwrap().unwrap();
        let layer = Layer::open(&chain.segments[0]).unwrap();
        assert_eq!(layer.parses.key.len(), 1);
        assert_eq!(layer.stored.text(layer.parses.key.at(0)), "b");
        let stores = Stores::read(std::slice::from_ref(&destination));
        let next = parses_only(&[("c", &read)]);
        assert!(stores.seed(&stores.open(), &[&next]).is_none(), "a published destination is appended");
        stores.add_unheld(&stores.open(), std::iter::once(("c", String::new(), &read)));
        let stores = Stores::read(std::slice::from_ref(&destination));
        assert!(stores.open().holds("b", ""), "an existing destination is appended, never seeded over");
        assert!(stores.open().holds("c", ""));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_multisegment_seed_counts_only_later_appends_toward_compaction() {
        let root = crate::git_fixture::repository("parse-store-base-layers", &[]);
        let path = root.join("parses.bin").to_str().unwrap().to_owned();
        let read = SourceRead::default();
        let seed: Vec<_> = (0..SEGMENTS + 1).map(|n| parses_only(&[(&format!("base-{n}"), &read)])).collect();
        let stores = Stores::read(std::slice::from_ref(&path));
        assert!(stores.seed(&stores.open(), &seed.iter().map(Vec::as_slice).collect::<Vec<_>>()).is_some());
        for n in 0..SEGMENTS {
            let stores = Stores::read(std::slice::from_ref(&path));
            assert!(stores.append(&[(&format!("append-{n}"), &read)]).unwrap());
            let chain = read_chain(&path).unwrap().unwrap();
            assert_eq!((chain.segments.len(), chain.working), (seed.len() + n + 1, n + 1));
            assert_eq!(chain.segments[..seed.len()], seed, "a small append preserves the encoded immutable base");
        }
        assert!(Stores::read(std::slice::from_ref(&path)).append(&[("compact-now", &read)]).unwrap());
        let chain = read_chain(&path).unwrap().unwrap();
        assert_eq!((chain.segments.len(), chain.working), (1, 0), "compaction starts a new immutable base");
        let layers = opened(&chain);
        assert_eq!(fold_parses(&layers).len(), seed.len() + SEGMENTS + 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn encoded_rows_are_selected_after_git_provenance_is_revoked() {
        let root = crate::git_fixture::repository("parse-store-late-provenance", &[]);
        let path = root.join("parses.bin").to_str().unwrap().to_owned();
        let provenance = crate::parse_origin::FromBlob::default();
        let oid = [7; 20];
        let digest = crate::git::spell(&oid);
        let way = crate::index::way("a.ts");
        provenance.saw(&oid, "a.ts", true);
        assert!(provenance.shares(&digest, &way));
        let read = SourceRead::default();
        let encoded = parses_only(&[(key(&digest, &way).as_str(), &read)]);
        provenance.saw(&oid, "a.ts", false);
        let stores = Stores::read(std::slice::from_ref(&path));
        let encoded = vec![encoded];
        let receipts = stores.add_encoded(&stores.open(), &encoded, &provenance, &[]);
        assert!(receipts.is_empty(), "revoked provenance cannot issue a reusable file receipt");
        assert!(read_chain(&path).unwrap().is_none(), "encoding did not decide final shareability");
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(all(test, unix))]
#[path = "parse_store_cow_tests.rs"]
mod cow_tests;
