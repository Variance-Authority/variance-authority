//! Which record of an opened source-index chain answers for a file: the
//! newest layer that puts or deletes the file decides, and within one layer a
//! put wins over a delete. `fold` applies that rule to every file at once;
//! `record`, `newest`, `importers` and `parse` apply it to one key, by a binary
//! search per layer over columns sorted by key in code-unit order, rather than
//! a pass over every row of every layer. `held_parses` applies it to the
//! parse keys under a set of digests. `parse_fold` and `directory_fold` are
//! `fold` for the other two kinds of key, and `in_key_order` lays a fold's
//! winners out in code-unit order of their keys, the order a reader walks them.

// compass: variance-authority.reach.source-index

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasher, Hash};

use rustc_hash::FxHashMap;

use rayon::prelude::*;

use crate::compact::Layer;
use crate::order::code_unit;
use crate::stored::partition;

/// A record of the chain: its layer and row.
pub(crate) type At = (usize, usize);

/// Every file's newest record. Oldest layer first, its deletes,
/// then its puts, as `compacted` folds them.
pub(crate) fn fold<'a>(layers: &'a [Layer<'a>]) -> HashMap<&'a str, At> {
    folded(layers, |layer| {
        let (stored, records) = (&layer.stored, &layer.records);
        let puts = (0..records.file.len()).map(|row| stored.text(records.file.at(row))).collect();
        (puts, (0..records.deleted.len()).map(|row| stored.text(records.deleted.at(row))).collect())
    })
}

/// Every parse key's newest row, keyed `(digest, way)`, by `fold`'s rule.
pub(crate) fn parse_fold<'c>(layers: &[Layer<'c>]) -> FxHashMap<(&'c str, &'c str), At> {
    folded(layers, |layer| {
        let (stored, parses) = (&layer.stored, &layer.parses);
        let key = |keys: crate::stored::U32s, ways: crate::stored::U32s, row: usize| (stored.text(keys.at(row)), stored.text(ways.at(row)));
        let puts = (0..parses.key.len()).map(|row| key(parses.key, parses.way, row)).collect();
        (puts, (0..parses.deleted.len()).map(|row| key(parses.deleted, parses.deleted_way, row)).collect())
    })
}

/// Every directory's newest row, by `fold`'s rule.
pub(crate) fn directory_fold<'c>(layers: &[Layer<'c>]) -> HashMap<&'c str, At> {
    folded(layers, |layer| {
        let (stored, directories) = (&layer.stored, &layer.directories);
        let puts = (0..directories.path.len()).map(|row| stored.text(directories.path.at(row))).collect();
        (puts, (0..directories.deleted.len()).map(|row| stored.text(directories.deleted.at(row))).collect())
    })
}

/// The rule every fold here shares: oldest layer first, its deletes and then
/// its puts, so within one layer a put wins over a delete of the same key.
/// `keys` gives a layer's put keys in row order and its deleted keys.
fn folded<'l, 'c, K: Hash + Eq, S: BuildHasher + Default>(
    layers: &'l [Layer<'c>],
    keys: impl Fn(&'l Layer<'c>) -> (Vec<K>, Vec<K>),
) -> HashMap<K, At, S> {
    let mut folded = HashMap::default();
    for (at, layer) in layers.iter().enumerate() {
        let (puts, deletes) = keys(layer);
        for key in &deletes {
            folded.remove(key);
        }
        folded.extend(puts.into_iter().enumerate().map(|(row, key)| (key, (at, row))));
    }
    folded
}

/// A fold's winners, ascending by `order` of their keys.
pub(crate) fn in_key_order<K>(winners: impl IntoIterator<Item = (K, At)>, order: impl Fn(&K, &K) -> Ordering) -> Vec<(K, At)> {
    let mut sorted: Vec<(K, At)> = winners.into_iter().collect();
    sorted.sort_unstable_by(|(left, _), (right, _)| order(left, right));
    sorted
}

/// Code-unit order of `(digest, way)` parse keys, which is the order of the
/// keys `joined` makes of them: the separator sorts before every character.
pub(crate) fn parse_key_order(left: &(&str, &str), right: &(&str, &str)) -> Ordering {
    code_unit(left.0, right.0).then_with(|| code_unit(left.1, right.1))
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

/// The parse keys the chain holds under `digests`, as `(digest, way)`: the last
/// layer to put or delete a key decides, and within a layer its put, as
/// `parse_fold` folds it.
pub(crate) fn held_parses(layers: &[Layer], digests: &HashSet<&str>) -> HashSet<(String, String)> {
    let per_layer: Vec<Vec<(bool, &str, &str)>> = layers
        .par_iter()
        .map(|layer| {
            let (stored, columns) = (&layer.stored, &layer.parses);
            let mut rows = Vec::new();
            for row in 0..columns.deleted.len() {
                let digest = stored.text(columns.deleted.at(row));
                if digests.contains(digest) {
                    rows.push((false, digest, stored.text(columns.deleted_way.at(row))));
                }
            }
            for row in 0..columns.key.len() {
                let digest = stored.text(columns.key.at(row));
                if digests.contains(digest) {
                    rows.push((true, digest, stored.text(columns.way.at(row))));
                }
            }
            rows
        })
        .collect();
    let mut held = HashSet::new();
    for rows in per_layer {
        // Deletes come before puts within a layer, which is the order they were collected in.
        for (put, digest, way) in rows {
            let key = (digest.to_owned(), way.to_owned());
            if put { held.insert(key); } else { held.remove(&key); }
        }
    }
    held
}
