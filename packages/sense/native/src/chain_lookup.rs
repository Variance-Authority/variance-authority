//! Which record of an opened source-index chain answers for a file: the
//! newest layer that puts or deletes the file decides, and within one layer a
//! put wins over a delete. `fold` applies that rule to every file at once;
//! `record`, `newest`, `importers` and `parse` apply it to one key, by a binary
//! search per layer over columns sorted by key in code-unit order, rather than
//! a pass over every row of every layer.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;

use rustc_hash::FxHashMap;

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

/// Every parse key to its newest layer and row, borrowing its digest and way.
/// Deletes apply before puts within a layer, as they do for a point lookup.
pub(crate) fn fold_parses<'c>(layers: &[Layer<'c>]) -> FxHashMap<(&'c str, &'c str), At> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(puts: &[&str], deletes: &[&str]) -> Vec<u8> {
        let document = serde_json::json!({
            "parses": puts.iter().map(|key| (*key, serde_json::json!({ "requests": [] }))).collect::<Vec<_>>(),
            "deletedParses": deletes,
        });
        let delta = crate::generation::Delta::of(vec![document.to_string()]).unwrap();
        crate::graph_index::merged(&[], &delta)
    }

    #[test]
    fn parse_lookup_keeps_the_newest_key_and_its_way() {
        let bytes = [
            segment(&["deleted", "restored", "same\0.ts\0+", "same\0.tsx\0+", "within"], &[]),
            segment(&["within"], &["deleted", "restored", "same\0.ts\0+", "within"]),
            segment(&["restored"], &[]),
        ];
        let layers: Vec<Layer> = bytes.iter().map(|bytes| Layer::open(bytes).unwrap()).collect();
        let folded = fold_parses(&layers);
        for (digest, way, expected) in [
            ("deleted", "", None),
            ("restored", "", Some(2)),
            ("same", ".ts\0+", None),
            ("same", ".tsx\0+", Some(0)),
            ("within", "", Some(1)),
            ("absent", "", None),
        ] {
            let direct = parse(&layers, digest, way);
            assert_eq!(direct.map(|at| at.0), expected, "{digest:?} {way:?}");
            assert_eq!(folded.get(&(digest, way)).copied(), direct, "{digest:?} {way:?}");
        }
    }
}
