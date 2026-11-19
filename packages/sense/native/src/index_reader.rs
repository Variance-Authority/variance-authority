//! The one reader of a source-index chain JavaScript opens: `load` in
//! `source-index-file.ts` hands the segments here, and what crosses back is
//! the answer to each question asked, never the whole index.
//!
//! The chain is read newest first, and a segment reads when its framing does
//! (`Layer::open`) and every row it holds names only what its dictionary and
//! text heap hold, with each key column ascending, as the lookups that answer
//! from it search it. A segment that does not read ends the chain there: what
//! was read above it is dropped and the layers below are read as the last, so
//! the kept layers are always the chain's oldest ones. The segment that
//! stopped the read says which release wrote it when it is one of another
//! format version.
//!
//! Which row answers for a key is `chain_lookup.rs`'s to say, for one key and
//! for a walk of them all; a walk goes in code-unit order of its keys. A row
//! crosses as JSON that JavaScript reads with `JSON.parse`, shaped as
//! JavaScript holds it ([`HeldParse`], [`Indexed`]); a question about keys or
//! counts decodes no row.

// compass: variance-authority.reach.source-index

use std::sync::OnceLock;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

use crate::chain_lookup::{self, At};
use crate::compact::{check, joined, Layer, ParseView};
use crate::generation::key_parts;
use crate::held::HeldParse;
use crate::order::code_unit;
use crate::stored::{written, Stored};

struct Chain<'a> {
    /// Oldest first.
    layers: Vec<Layer<'a>>,
    written: Option<u32>,
    directories: Vec<(&'a str, &'a str)>,
    /// The winning rows of a walk, in key order, laid out when a walk first asks.
    parses: OnceLock<Vec<At>>,
    records: OnceLock<Vec<At>>,
}

self_cell::self_cell!(
    /// The segments and the chain read over them, kept together because the
    /// chain borrows the bytes. The bytes are JavaScript's own buffers, held
    /// rather than copied, so they must not change while the reader is open:
    /// each is a segment file read whole and never written again.
    struct Opened {
        owner: Vec<Buffer>,
        #[covariant]
        dependent: Chain,
    }
);

fn need(reads: bool, what: &str) -> Result<(), String> {
    if reads { Ok(()) } else { Err(format!("a segment whose {what} does not read")) }
}

/// Whether `len` keys, read by `key`, name strings the dictionary holds and
/// ascend with no key twice: a binary search over them finds every one.
fn ascending(stored: &Stored, len: usize, key: impl Fn(usize) -> (u32, u32), what: &str) -> Result<(), String> {
    let mut before = None;
    for row in 0..len {
        let (first, second) = key(row);
        need(stored.holds(first) && stored.holds(second) && before < Some((first, second)), what)?;
        before = Some((first, second));
    }
    Ok(())
}

/// Every row of the layer `bytes` holds, checked before anything of it is kept.
fn read_layer(bytes: &[u8]) -> Result<Layer<'_>, String> {
    let layer = Layer::open(bytes)?;
    let stored = &layer.stored;
    need(stored.has_texts(), "text heap")?;
    let (parses, records, directories) = (&layer.parses, &layer.records, &layer.directories);
    ascending(stored, parses.key.len(), |row| (parses.key.at(row), parses.way.at(row)), "parse keys")?;
    ascending(stored, parses.deleted.len(), |row| (parses.deleted.at(row), parses.deleted_way.at(row)), "deleted parse keys")?;
    for (column, what) in [
        (&records.file, "record files"),
        (&records.deleted, "deleted record files"),
        (&directories.path, "directory paths"),
        (&directories.deleted, "deleted directory paths"),
    ] {
        // A key of one column pairs with the first id, which every dictionary holds.
        ascending(stored, column.len(), |row| (column.at(row), 0), what)?;
    }
    for row in 0..parses.key.len() {
        check::parse(stored, parses, row)?;
    }
    for row in 0..records.file.len() {
        records.check(stored, row)?;
    }
    for row in 0..directories.path.len() {
        need(stored.holds(directories.digest.at(row)), "directory digest")?;
    }
    Ok(layer)
}

fn chain<B: std::ops::Deref<Target = [u8]>>(segments: &[B]) -> Chain<'_> {
    let (mut layers, mut written_by) = (Vec::new(), None);
    for bytes in segments.iter().rev() {
        match read_layer(bytes) {
            Ok(layer) => layers.push(layer),
            Err(_) => {
                written_by = written(bytes);
                layers.clear();
            }
        }
    }
    layers.reverse();
    let directories = chain_lookup::in_key_order(chain_lookup::directory_fold(&layers), |left, right| code_unit(left, right))
        .into_iter()
        .map(|(path, (layer, row))| {
            let layer = &layers[layer];
            (path, layer.stored.text(layer.directories.digest.at(row)))
        })
        .collect();
    Chain { layers, written: written_by, directories, parses: OnceLock::new(), records: OnceLock::new() }
}

impl<'a> Chain<'a> {
    fn parse_key(&self, (layer, row): At) -> String {
        let layer = &self.layers[layer];
        joined(layer.stored.text(layer.parses.key.at(row)), layer.stored.text(layer.parses.way.at(row)))
    }

    fn record_file(&self, (layer, row): At) -> &'a str {
        let layer = &self.layers[layer];
        layer.stored.text(layer.records.file.at(row))
    }

    fn parses(&self) -> &[At] {
        self.parses.get_or_init(|| {
            let winners = chain_lookup::in_key_order(chain_lookup::parse_fold(&self.layers), chain_lookup::parse_key_order);
            winners.into_iter().map(|(_, at)| at).collect()
        })
    }

    fn records(&self) -> &[At] {
        self.records.get_or_init(|| {
            let winners = chain_lookup::in_key_order(chain_lookup::fold(&self.layers), |left, right| code_unit(left, right));
            winners.into_iter().map(|(_, at)| at).collect()
        })
    }

    fn parse_at(&self, key: &str) -> Option<At> {
        let (digest, way) = key_parts(key);
        chain_lookup::parse(&self.layers, digest, way)
    }

    fn record_at(&self, file: &str) -> Option<At> {
        chain_lookup::record(&self.layers, file).map(|(_, at)| at)
    }

    fn parse_json(&self, (layer, row): At) -> String {
        let held = HeldParse::of(&ParseView::of(&self.layers[layer], row));
        serde_json::to_string(&held).expect("a parse row serializes")
    }

    fn record_json(&self, (layer, row): At) -> String {
        let layer = &self.layers[layer];
        serde_json::to_string(&layer.records.indexed(&layer.stored, row)).expect("a record serializes")
    }
}

/// A source-index chain opened for the questions JavaScript asks of it.
#[napi]
pub struct SourceIndexReader {
    opened: Opened,
}

/// Open the chain `segments` holds, oldest first.
#[napi(catch_unwind)]
pub fn open_source_index_reader(segments: Vec<Buffer>) -> napi::Result<SourceIndexReader> {
    Ok(SourceIndexReader { opened: Opened::new(segments, |segments| chain(segments)) })
}

impl SourceIndexReader {
    fn chain(&self) -> &Chain<'_> {
        self.opened.borrow_dependent()
    }
}

/// `[key, row]` pairs of `rows[start..start + count]`, as one JSON array.
fn page(rows: &[At], start: u32, count: u32, key: impl Fn(At) -> String, row: impl Fn(At) -> String) -> String {
    let start = (start as usize).min(rows.len());
    let end = start.saturating_add(count as usize).min(rows.len());
    let mut json = String::from("[");
    for (index, at) in rows[start..end].iter().enumerate() {
        if index > 0 {
            json.push(',');
        }
        json.push('[');
        json.push_str(&serde_json::to_string(&key(*at)).expect("a key serializes"));
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
    #[napi(catch_unwind)]
    pub fn kept(&self) -> u32 {
        self.chain().layers.len() as u32
    }

    /// The format version of the segment that stopped the read, when another release wrote it.
    #[napi(catch_unwind)]
    pub fn written(&self) -> Option<u32> {
        self.chain().written
    }

    /// The newest kept layer's configuration.
    #[napi(catch_unwind)]
    pub fn config(&self) -> Option<String> {
        self.chain().layers.last().and_then(|layer| layer.config).map(str::to_owned)
    }

    /// Every directory and its digest, flattened: path, digest, path, …
    #[napi(catch_unwind)]
    pub fn directories(&self) -> Vec<String> {
        self.chain().directories.iter().flat_map(|(path, digest)| [path.to_string(), digest.to_string()]).collect()
    }

    #[napi(catch_unwind)]
    pub fn parse_count(&self) -> u32 {
        self.chain().parses().len() as u32
    }

    #[napi(catch_unwind)]
    pub fn parse_keys(&self) -> Vec<String> {
        let chain = self.chain();
        chain.parses().iter().map(|&at| chain.parse_key(at)).collect()
    }

    #[napi(catch_unwind)]
    pub fn has_parse(&self, key: String) -> bool {
        self.chain().parse_at(&key).is_some()
    }

    /// The parse `key` names, as JSON; none when the chain holds none.
    #[napi(catch_unwind)]
    pub fn parse(&self, key: String) -> Option<String> {
        let chain = self.chain();
        chain.parse_at(&key).map(|at| chain.parse_json(at))
    }

    /// `[key, parse]` pairs from `start`, at most `count` of them, as one JSON array.
    #[napi(catch_unwind)]
    pub fn parses(&self, start: u32, count: u32) -> String {
        let chain = self.chain();
        page(chain.parses(), start, count, |at| chain.parse_key(at), |at| chain.parse_json(at))
    }

    #[napi(catch_unwind)]
    pub fn record_count(&self) -> u32 {
        self.chain().records().len() as u32
    }

    #[napi(catch_unwind)]
    pub fn record_files(&self) -> Vec<String> {
        let chain = self.chain();
        chain.records().iter().map(|&at| chain.record_file(at).to_owned()).collect()
    }

    #[napi(catch_unwind)]
    pub fn has_record(&self, file: String) -> bool {
        self.chain().record_at(&file).is_some()
    }

    /// The record of `file`, as JSON; none when the chain holds none.
    #[napi(catch_unwind)]
    pub fn record(&self, file: String) -> Option<String> {
        let chain = self.chain();
        chain.record_at(&file).map(|at| chain.record_json(at))
    }

    /// `[file, record]` pairs from `start`, at most `count` of them, as one JSON array.
    #[napi(catch_unwind)]
    pub fn records(&self, start: u32, count: u32) -> String {
        let chain = self.chain();
        page(chain.records(), start, count, |at| chain.record_file(at).to_owned(), |at| chain.record_json(at))
    }
}

#[cfg(test)]
#[path = "index_reader_test.rs"]
mod tests;
