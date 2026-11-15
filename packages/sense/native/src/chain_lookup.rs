//! Which record of an opened source-index chain answers for a file: the
//! newest layer that puts or deletes the file decides, and within one layer a
//! put wins over a delete. `fold` applies that rule to every file at once;
//! `record`, `newest`, `importers` and `parse` apply it to one key, by a binary
//! search per layer over columns sorted by key in code-unit order, rather than
//! a pass over every row of every layer.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;

use crate::compact::Layer;
use crate::stored::partition;

/// A record of the chain: its layer and row.
pub(crate) type At = (usize, usize);

/// Every file's newest record. Oldest layer first, its deletes,
/// then its puts, as `compacted` folds them.
pub(crate) fn fold<'a>(layers: &'a [Layer<'a>]) -> HashMap<&'a str, At> {
    let mut folded: HashMap<&str, At> = HashMap::new();
    for (at, layer) in layers.iter().enumerate() {
        let (stored, records) = (&layer.stored, &layer.records);
        for row in 0..records.deleted.len() {
            folded.remove(stored.text(records.deleted.at(row)));
        }
        for row in 0..records.file.len() {
            folded.insert(stored.text(records.file.at(row)), (at, row));
        }
    }
    folded
}

/// The file's newest record, and the file as the chain spells it.
pub(crate) fn record<'l>(layers: &'l [Layer<'l>], file: &str) -> Option<(&'l str, At)> {
    for (at, layer) in layers.iter().enumerate().rev() {
        let (stored, records) = (&layer.stored, &layer.records);
        let Some(id) = stored.id_of(file) else { continue };
        if let Some(row) = records.file.search(id) {
            return Some((stored.text(id), (at, row)));
        }
        if records.deleted.search(id).is_some() {
            return None;
        }
    }
    None
}

/// Whether the record at `at` is its file's newest: a row a later layer put
/// again or deleted answers for nothing.
pub(crate) fn newest(layers: &[Layer], at: At) -> bool {
    let (layer, row) = at;
    let file = layers[layer].stored.text(layers[layer].records.file.at(row));
    layers[layer + 1..].iter().all(|later| {
        later.stored.id_of(file).is_none_or(|id| later.records.file.search(id).is_none() && later.records.deleted.search(id).is_none())
    })
}

/// Every file whose newest record imports `path`, with that record, in no
/// particular order: each layer's rows that import it (`importing`), kept
/// where the row is still its file's newest record. A file whose records in
/// two layers both import `path` is named once, from the newer.
pub(crate) fn importers<'l>(layers: &'l [Layer<'l>], path: &str) -> Vec<(&'l str, At)> {
    let mut found = Vec::new();
    for (at, layer) in layers.iter().enumerate() {
        let (stored, records) = (&layer.stored, &layer.records);
        for row in records.importing(stored, path) {
            if newest(layers, (at, row)) {
                found.push((stored.text(records.file.at(row)), (at, row)));
            }
        }
    }
    found
}

/// The parse read from `digest` the way `way` names, as the fold keys it.
pub(crate) fn parse(layers: &[Layer], digest: &str, way: &str) -> Option<At> {
    for (at, layer) in layers.iter().enumerate().rev() {
        let (stored, parses) = (&layer.stored, &layer.parses);
        let (Some(digest), Some(way)) = (stored.id_of(digest), stored.id_of(way)) else { continue };
        let key = (digest, way);
        let found = |keys: crate::stored::U32s, ways: crate::stored::U32s| {
            let row = partition(keys.len(), |row| (keys.at(row), ways.at(row)) < key);
            (row < keys.len() && (keys.at(row), ways.at(row)) == key).then_some(row)
        };
        if let Some(row) = found(parses.key, parses.way) {
            return Some((at, row));
        }
        if found(parses.deleted, parses.deleted_way).is_some() {
            return None;
        }
    }
    None
}
