//! The one reader of a source-index chain JavaScript opens: `load` in
//! `source-index-file.ts` hands the segments here, and what crosses back is
//! the answer to each question asked, never the whole index.
//!
//! The chain is read newest first, and a segment reads when its framing does
//! (`Layer::open`), its dictionary and text heap read, each key column names
//! strings the dictionary holds and ascends, as the lookups that answer from it
//! search it, and each directory names a digest it holds. That is what deciding
//! which segments are kept, and finding a key in them, needs, and it costs the
//! keys, not the rows. A segment that does not read ends the chain there: what
//! was read above it is dropped and the layers below are read as the last, so
//! the kept layers are always the chain's oldest ones. The segment that
//! stopped the read says which release wrote it when it is one of another
//! format version.
//!
//! A row is checked when it is asked for (`check::parse`, `Records::check`):
//! one that names what its segment does not hold reads as absent, from a
//! lookup, a membership and a walk alike. Everything a read can fail at is a
//! cache miss, so a scan derives that row again and the save writes it over.
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

/// The layer `bytes` holds, its keys checked before it is kept; its rows are checked when asked for.
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

    /// Whether the parse row at `at` names only what its segment holds.
    fn parse_reads(&self, (layer, row): At) -> bool {
        let layer = &self.layers[layer];
        check::parse(&layer.stored, &layer.parses, row).is_ok()
    }

    /// Whether the record row at `at` names only what its segment holds.
    fn record_reads(&self, (layer, row): At) -> bool {
        let layer = &self.layers[layer];
        layer.records.check(&layer.stored, row).is_ok()
    }

    /// The parse row at `at`, as JSON; none when it does not read.
    fn parse_json(&self, at: At) -> Option<String> {
        self.parse_reads(at).then(|| {
            let held = HeldParse::of(&ParseView::of(&self.layers[at.0], at.1));
            serde_json::to_string(&held).expect("a parse row serializes")
        })
    }

    /// The record row at `at`, as JSON; none when it does not read.
    fn record_json(&self, at: At) -> Option<String> {
        self.record_reads(at).then(|| {
            let layer = &self.layers[at.0];
            serde_json::to_string(&layer.records.indexed(&layer.stored, at.1)).expect("a record serializes")
        })
    }
}

/// A source-index chain opened for the questions JavaScript asks of it.
#[napi]
pub struct SourceIndexReader {
    /// None once closed: the segments are let go then, not when the handle is collected.
    opened: Option<Opened>,
}

/// Open the chain `segments` holds, oldest first.
#[napi(catch_unwind)]
pub fn open_source_index_reader(segments: Vec<Buffer>) -> napi::Result<SourceIndexReader> {
    Ok(SourceIndexReader { opened: Some(Opened::new(segments, |segments| chain(segments))) })
}

impl SourceIndexReader {
    fn chain(&self) -> napi::Result<&Chain<'_>> {
        self.opened
            .as_ref()
            .map(Opened::borrow_dependent)
            .ok_or_else(|| napi::Error::from_reason("the source index reader is closed"))
    }
}

/// `[key, row]` pairs of `rows[start..start + count]`, as one JSON array; a row that does not read is left out.
fn page(rows: &[At], start: u32, count: u32, key: impl Fn(At) -> String, row: impl Fn(At) -> Option<String>) -> String {
    let start = (start as usize).min(rows.len());
    let end = start.saturating_add(count as usize).min(rows.len());
    let mut json = String::from("[");
    for at in &rows[start..end] {
        let Some(row) = row(*at) else { continue };
        if json.len() > 1 {
            json.push(',');
        }
        json.push('[');
        json.push_str(&serde_json::to_string(&key(*at)).expect("a key serializes"));
        json.push(',');
        json.push_str(&row);
        json.push(']');
    }
    json.push(']');
    json
}

#[napi]
impl SourceIndexReader {
    /// Let the segments go now, rather than when the handle is collected; every
    /// question after this is refused.
    #[napi]
    pub fn close(&mut self) {
        self.opened = None;
    }

    /// How many of the chain's oldest segments read; the rest are dropped.
    #[napi(catch_unwind)]
    pub fn kept(&self) -> napi::Result<u32> {
        Ok(self.chain()?.layers.len() as u32)
    }

    /// The format version of the segment that stopped the read, when another release wrote it.
    #[napi(catch_unwind)]
    pub fn written(&self) -> napi::Result<Option<u32>> {
        Ok(self.chain()?.written)
    }

    /// The newest kept layer's configuration.
    #[napi(catch_unwind)]
    pub fn config(&self) -> napi::Result<Option<String>> {
        Ok(self.chain()?.layers.last().and_then(|layer| layer.config).map(str::to_owned))
    }

    /// Every directory and its digest, flattened: path, digest, path, …
    #[napi(catch_unwind)]
    pub fn directories(&self) -> napi::Result<Vec<String>> {
        Ok(self.chain()?.directories.iter().flat_map(|(path, digest)| [path.to_string(), digest.to_string()]).collect())
    }

    /// How many parse keys the chain answers for, read from the keys: a row
    /// that turns out not to read when asked is counted.
    #[napi(catch_unwind)]
    pub fn parse_count(&self) -> napi::Result<u32> {
        Ok(self.chain()?.parses().len() as u32)
    }

    #[napi(catch_unwind)]
    pub fn parse_keys(&self) -> napi::Result<Vec<String>> {
        let chain = self.chain()?;
        Ok(chain.parses().iter().map(|&at| chain.parse_key(at)).collect())
    }

    #[napi(catch_unwind)]
    pub fn has_parse(&self, key: String) -> napi::Result<bool> {
        let chain = self.chain()?;
        Ok(chain.parse_at(&key).is_some_and(|at| chain.parse_reads(at)))
    }

    /// The parse `key` names, as JSON; none when the chain holds none.
    #[napi(catch_unwind)]
    pub fn parse(&self, key: String) -> napi::Result<Option<String>> {
        let chain = self.chain()?;
        Ok(chain.parse_at(&key).and_then(|at| chain.parse_json(at)))
    }

    /// `[key, parse]` pairs from `start`, at most `count` of them, as one JSON array.
    #[napi(catch_unwind)]
    pub fn parses(&self, start: u32, count: u32) -> napi::Result<String> {
        let chain = self.chain()?;
        Ok(page(chain.parses(), start, count, |at| chain.parse_key(at), |at| chain.parse_json(at)))
    }

    #[napi(catch_unwind)]
    pub fn record_count(&self) -> napi::Result<u32> {
        Ok(self.chain()?.records().len() as u32)
    }

    #[napi(catch_unwind)]
    pub fn record_files(&self) -> napi::Result<Vec<String>> {
        let chain = self.chain()?;
        Ok(chain.records().iter().map(|&at| chain.record_file(at).to_owned()).collect())
    }

    #[napi(catch_unwind)]
    pub fn has_record(&self, file: String) -> napi::Result<bool> {
        let chain = self.chain()?;
        Ok(chain.record_at(&file).is_some_and(|at| chain.record_reads(at)))
    }

    /// The record of `file`, as JSON; none when the chain holds none.
    #[napi(catch_unwind)]
    pub fn record(&self, file: String) -> napi::Result<Option<String>> {
        let chain = self.chain()?;
        Ok(chain.record_at(&file).and_then(|at| chain.record_json(at)))
    }

    /// `[file, record]` pairs from `start`, at most `count` of them, as one JSON array.
    #[napi(catch_unwind)]
    pub fn records(&self, start: u32, count: u32) -> napi::Result<String> {
        let chain = self.chain()?;
        Ok(page(chain.records(), start, count, |at| chain.record_file(at).to_owned(), |at| chain.record_json(at)))
    }
}

#[cfg(test)]
#[path = "index_reader_test.rs"]
mod tests;
