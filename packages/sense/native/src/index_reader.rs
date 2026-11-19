//! The one reader of a source-index chain JavaScript opens: `load` in
//! `source-index-file.ts` hands the segments here, and what crosses back is
//! the answer to each question asked, never the whole index.
//!
//! The chain is read newest first. A layer answers only for the keys no newer
//! layer put or deleted, and a row a newer layer decided is not checked past
//! its key, since nothing reads it. A segment that does not read ends the chain
//! there: what was read above it is dropped and the layers below are read as
//! the last, so the kept layers are always the chain's oldest ones. The
//! segment that stopped the read says which release wrote it when it is one
//! of another format version.
//!
//! A row crosses as JSON that JavaScript reads with `JSON.parse`, shaped as
//! JavaScript holds it ([`HeldParse`], [`Indexed`]); a question about keys or
//! counts decodes no row. Winners keep the order a fold of the layers oldest
//! first into a JavaScript map would give them: a key sits where it was first
//! put since it was last deleted, so an iteration here is the iteration that
//! map would make.

// compass: variance-authority.reach.source-index

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::compact::{check, Layer, ParseView};
use crate::held::HeldParse;
use crate::stored::{written, Stored};

/// Parse rows decoded since the process started: what a test asks to prove a
/// question it asked decoded none.
static PARSE_ROWS_READ: AtomicU32 = AtomicU32::new(0);

/// Where a winner lies: its layer, oldest first, and its row there.
type At = (usize, usize);

struct Chain<'a> {
    /// Oldest first.
    layers: Vec<Layer<'a>>,
    written: Option<u32>,
    parses: Winners<Cow<'a, str>>,
    records: Winners<&'a str>,
    directories: Vec<(&'a str, &'a str)>,
}

/// The rows that answer for their keys, in fold order, and each key's row.
struct Winners<K> {
    order: Vec<(K, At)>,
    at: HashMap<K, usize>,
}

impl<K: std::hash::Hash + Eq + Clone> Winners<K> {
    /// `rows` in the order of `place`, where each key first entered the fold.
    fn of(rows: Vec<(K, At)>, place: &HashMap<K, At>) -> Self {
        let mut placed: Vec<(At, K, At)> = rows.into_iter().map(|(key, at)| (place[&key], key, at)).collect();
        placed.sort_unstable_by_key(|(place, _, _)| *place);
        let order: Vec<(K, At)> = placed.into_iter().map(|(_, key, at)| (key, at)).collect();
        let at = order.iter().enumerate().map(|(index, (key, _))| (key.clone(), index)).collect();
        Winners { order, at }
    }
}

self_cell::self_cell!(
    /// The segments and the chain read over them, kept together because the
    /// chain borrows the bytes.
    struct Opened {
        owner: Vec<Vec<u8>>,
        #[covariant]
        dependent: Chain,
    }
);

/// What one layer answers for, read before anything of it is kept.
struct Read<'a> {
    layer: Layer<'a>,
    parses: Keys<Cow<'a, str>>,
    records: Keys<&'a str>,
    directories: Keys<&'a str>,
}

/// One kind of key a layer decides: the rows that answer, the rows a newer
/// layer put again with no delete between, and the keys it deletes.
struct Keys<K> {
    winners: Vec<(K, usize)>,
    shadowed: Vec<(K, usize)>,
    deleted: Vec<K>,
}

/// Each key a newer layer decided, and whether it was put with no delete since
/// — the fold keeps such a key where an older layer first put it.
type Decided<K> = HashMap<K, bool>;

/// What the layers read so far decided, newest first, and where each put key
/// entered the fold.
struct Fold<K> {
    decided: Decided<K>,
    place: HashMap<K, At>,
}

impl<K> Default for Fold<K> {
    fn default() -> Self {
        Fold { decided: HashMap::new(), place: HashMap::new() }
    }
}

impl<K: std::hash::Hash + Eq + Clone> Fold<K> {
    /// Take `keys` of the layer at `layer`, older than every layer folded so far.
    fn take(&mut self, layer: usize, keys: &Keys<K>) {
        for (key, row) in keys.winners.iter().chain(&keys.shadowed) {
            self.decided.insert(key.clone(), true);
            self.place.insert(key.clone(), (layer, *row));
        }
        for key in &keys.deleted {
            self.decided.insert(key.clone(), false);
        }
    }
}

fn key<'a>(stored: &Stored<'a>, digest: u32, way: u32) -> Result<Cow<'a, str>, String> {
    if !stored.holds(digest) || !stored.holds(way) {
        return Err("a parse key the dictionary does not hold".to_owned());
    }
    let (digest, way) = (stored.text(digest), stored.text(way));
    Ok(if way.is_empty() { Cow::Borrowed(digest) } else { Cow::Owned(format!("{digest}\0{way}")) })
}

fn held<'a>(stored: &Stored<'a>, id: u32) -> Result<&'a str, String> {
    if stored.holds(id) { Ok(stored.text(id)) } else { Err("a key the dictionary does not hold".to_owned()) }
}

/// Every key of one kind a layer puts, once; the rows no newer layer decided,
/// each checked by `check`; and the keys it deletes, none of them one it puts
/// or deletes twice.
fn layer_keys<'a, K: std::hash::Hash + Eq + Clone>(
    puts: impl Iterator<Item = Result<K, String>>,
    deletes: impl Iterator<Item = Result<K, String>>,
    decided: &Decided<K>,
    mut check: impl FnMut(usize) -> Result<(), String>,
) -> Result<Keys<K>, String> {
    let (mut seen, mut winners, mut shadowed) = (HashSet::new(), Vec::new(), Vec::new());
    for (row, key) in puts.enumerate() {
        let key = key?;
        if !seen.insert(key.clone()) {
            return Err("a key two rows put".to_owned());
        }
        match decided.get(&key) {
            None => {
                check(row)?;
                winners.push((key, row));
            }
            Some(true) => shadowed.push((key, row)),
            Some(false) => {}
        }
    }
    let mut deleted = HashSet::new();
    for key in deletes {
        let key = key?;
        if seen.contains(&key) || !deleted.insert(key.clone()) {
            return Err("a key a layer both puts and deletes, or deletes twice".to_owned());
        }
    }
    Ok(Keys { winners, shadowed, deleted: deleted.into_iter().collect() })
}

fn read_layer<'a>(bytes: &'a [u8], folds: &Folds<'a>, builtins: &HashSet<String>) -> Result<Read<'a>, String> {
    let layer = Layer::open(bytes)?;
    let stored = &layer.stored;
    if !stored.has_texts() {
        return Err("no text heap".to_owned());
    }
    let columns = &layer.parses;
    let parses = layer_keys(
        (0..columns.key.len()).map(|row| key(stored, columns.key.at(row), columns.way.at(row))),
        (0..columns.deleted.len()).map(|at| key(stored, columns.deleted.at(at), columns.deleted_way.at(at))),
        &folds.parses.decided,
        |row| check::parse(stored, columns, row),
    )?;
    let records = &layer.records;
    let records = layer_keys(
        (0..records.file.len()).map(|row| held(stored, records.file.at(row))),
        (0..records.deleted.len()).map(|at| held(stored, records.deleted.at(at))),
        &folds.records.decided,
        |row| layer.records.check(stored, row, builtins),
    )?;
    let rows = &layer.directories;
    let directories = layer_keys(
        (0..rows.path.len()).map(|row| held(stored, rows.path.at(row))),
        (0..rows.deleted.len()).map(|at| held(stored, rows.deleted.at(at))),
        &folds.directories.decided,
        |row| held(stored, rows.digest.at(row)).map(|_| ()),
    )?;
    // `layer` moves into the result; the borrows above are of the bytes, not of it.
    Ok(Read { parses, records, directories, layer })
}

/// The folds of the three kinds of key.
#[derive(Default)]
struct Folds<'a> {
    parses: Fold<Cow<'a, str>>,
    records: Fold<&'a str>,
    directories: Fold<&'a str>,
}

fn chain<'a>(segments: &'a [Vec<u8>], builtins: &HashSet<String>) -> Chain<'a> {
    let (mut read, mut folds, mut stopped) = (Vec::<Read<'a>>::new(), Folds::default(), None);
    for (index, bytes) in segments.iter().enumerate().rev() {
        match read_layer(bytes, &folds, builtins) {
            Ok(layer) => {
                folds.parses.take(index, &layer.parses);
                folds.records.take(index, &layer.records);
                folds.directories.take(index, &layer.directories);
                read.push(layer);
            }
            Err(_) => {
                stopped = written(bytes);
                read.clear();
                folds = Folds::default();
            }
        }
    }
    read.reverse();
    // The kept layers are the chain's oldest, so a layer's index is its segment's.
    let (mut parses, mut records, mut directories, mut layers) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for (index, layer) in read.into_iter().enumerate() {
        parses.extend(layer.parses.winners.into_iter().map(|(key, row)| (key, (index, row))));
        records.extend(layer.records.winners.into_iter().map(|(file, row)| (file, (index, row))));
        directories.extend(layer.directories.winners.into_iter().map(|(path, row)| (path, (index, row))));
        layers.push(layer.layer);
    }
    let directories = Winners::of(directories, &folds.directories.place);
    let directories = directories
        .order
        .into_iter()
        .map(|(path, (index, row))| {
            let layer: &Layer<'a> = &layers[index];
            (path, layer.stored.text(layer.directories.digest.at(row)))
        })
        .collect();
    Chain {
        layers,
        written: stopped,
        parses: Winners::of(parses, &folds.parses.place),
        records: Winners::of(records, &folds.records.place),
        directories,
    }
}

/// A source-index chain opened for the questions JavaScript asks of it.
#[napi]
pub struct SourceIndexReader {
    opened: Opened,
}

/// Open the chain `segments` holds, oldest first; a package name a record
/// stores is checked against `builtins`, the runtime's.
#[napi(catch_unwind)]
pub fn open_source_index_reader(segments: Vec<Buffer>, builtins: Vec<String>) -> napi::Result<SourceIndexReader> {
    let builtins: HashSet<String> = builtins.into_iter().collect();
    let owned = segments.into_iter().map(|segment| segment.to_vec()).collect();
    Ok(SourceIndexReader { opened: Opened::new(owned, |segments| chain(segments, &builtins)) })
}

/// Parse rows decoded since the addon loaded.
#[napi]
pub fn source_index_parse_rows_read() -> u32 {
    PARSE_ROWS_READ.load(Ordering::Relaxed)
}

impl SourceIndexReader {
    fn chain(&self) -> &Chain<'_> {
        self.opened.borrow_dependent()
    }
}

fn parse_json(chain: &Chain, (layer, row): At) -> String {
    PARSE_ROWS_READ.fetch_add(1, Ordering::Relaxed);
    let held = HeldParse::of(&ParseView::of(&chain.layers[layer], row));
    serde_json::to_string(&held).expect("a parse row serializes")
}

fn record_json(chain: &Chain, (layer, row): At) -> String {
    let layer = &chain.layers[layer];
    serde_json::to_string(&layer.records.indexed(&layer.stored, row)).expect("a record serializes")
}

/// `[key, row]` pairs of `order[start..start + count]`, as one JSON array.
fn page<K: AsRef<str>>(order: &[(K, At)], start: u32, count: u32, row: impl Fn(At) -> String) -> String {
    let start = (start as usize).min(order.len());
    let end = start.saturating_add(count as usize).min(order.len());
    let mut json = String::from("[");
    for (index, (key, at)) in order[start..end].iter().enumerate() {
        if index > 0 {
            json.push(',');
        }
        json.push('[');
        json.push_str(&serde_json::to_string(key.as_ref()).expect("a key serializes"));
        json.push(',');
        json.push_str(&row(*at));
        json.push(']');
    }
    json.push(']');
    json
}

#[napi]
impl SourceIndexReader {
    /// How many of the chain's oldest segments read; the rest are dropped.
    #[napi]
    pub fn kept(&self) -> u32 {
        self.chain().layers.len() as u32
    }

    /// The format version of the segment that stopped the read, when another release wrote it.
    #[napi]
    pub fn written(&self) -> Option<u32> {
        self.chain().written
    }

    /// The newest kept layer's configuration.
    #[napi]
    pub fn config(&self) -> Option<String> {
        self.chain().layers.last().and_then(|layer| layer.config).map(str::to_owned)
    }

    /// Every directory and its digest, flattened: path, digest, path, …
    #[napi]
    pub fn directories(&self) -> Vec<String> {
        self.chain().directories.iter().flat_map(|(path, digest)| [path.to_string(), digest.to_string()]).collect()
    }

    #[napi]
    pub fn parse_count(&self) -> u32 {
        self.chain().parses.order.len() as u32
    }

    #[napi]
    pub fn parse_keys(&self) -> Vec<String> {
        self.chain().parses.order.iter().map(|(key, _)| key.to_string()).collect()
    }

    #[napi]
    pub fn has_parse(&self, key: String) -> bool {
        self.chain().parses.at.contains_key(key.as_str())
    }

    /// The parse `key` names, as JSON; none when the chain holds none.
    #[napi]
    pub fn parse(&self, key: String) -> Option<String> {
        let chain = self.chain();
        chain.parses.at.get(key.as_str()).map(|&index| parse_json(chain, chain.parses.order[index].1))
    }

    /// `[key, parse]` pairs from `start`, at most `count` of them, as one JSON array.
    #[napi]
    pub fn parses(&self, start: u32, count: u32) -> String {
        let chain = self.chain();
        page(&chain.parses.order, start, count, |at| parse_json(chain, at))
    }

    #[napi]
    pub fn record_count(&self) -> u32 {
        self.chain().records.order.len() as u32
    }

    #[napi]
    pub fn record_files(&self) -> Vec<String> {
        self.chain().records.order.iter().map(|(file, _)| file.to_string()).collect()
    }

    #[napi]
    pub fn has_record(&self, file: String) -> bool {
        self.chain().records.at.contains_key(file.as_str())
    }

    /// The record of `file`, as JSON; none when the chain holds none.
    #[napi]
    pub fn record(&self, file: String) -> Option<String> {
        let chain = self.chain();
        chain.records.at.get(file.as_str()).map(|&index| record_json(chain, chain.records.order[index].1))
    }

    /// `[file, record]` pairs from `start`, at most `count` of them, as one JSON array.
    #[napi]
    pub fn records(&self, start: u32, count: u32) -> String {
        let chain = self.chain();
        page(&chain.records.order, start, count, |at| record_json(chain, at))
    }
}

#[cfg(test)]
#[path = "index_reader_test.rs"]
mod tests;
