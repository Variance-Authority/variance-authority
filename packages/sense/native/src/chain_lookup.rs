//! Which record of an opened source-index chain answers for a file: the
//! newest layer that puts or deletes the file decides, and within one layer a
//! put wins over a delete. `walked` applies that rule to every key of a kind
//! at once, and `live_records`, `fold`, `parse_fold`, `directory_fold` and
//! `held_parses` are its projections;
//! `record`, `newest`, `importers` and `parse` apply it to one key, by a binary
//! search per layer over columns sorted by key in code-unit order, rather than
//! a pass over every row of every layer. `in_key_order` lays the winners out
//! in code-unit order of their keys, the order a reader walks them, and
//! `ParseKeys` is `parse` for many records at once, comparing ids where
//! `parse` compares strings.

// compass: variance-authority.reach.source-index

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::sync::OnceLock;

use rustc_hash::{FxHashMap, FxHashSet};

use rayon::prelude::*;

use crate::compact::Layer;
use crate::order::code_unit;
use crate::stored::partition;

/// A record of the chain: its layer and row.
pub(crate) type At = (usize, usize);

/// Every file's newest record, as a map: `live_records` keyed by file.
pub(crate) fn fold<'a>(layers: &'a [Layer<'a>]) -> HashMap<&'a str, At> {
    live_records(layers).into_iter().collect()
}

/// Every file's newest record, in no particular order, by the rule `walked`
/// holds.
pub(crate) fn live_records<'a>(layers: &'a [Layer<'a>]) -> Vec<(&'a str, At)> {
    walked(layers, |layer| {
        let (stored, records) = (&layer.stored, &layer.records);
        let puts = (0..records.file.len()).map(|row| (stored.text(records.file.at(row)), row)).collect();
        (puts, (0..records.deleted.len()).map(|row| stored.text(records.deleted.at(row))).collect())
    })
}

/// Every parse key's newest row, keyed `(digest, way)`, by `walked`'s rule.
pub(crate) fn parse_fold<'c>(layers: &[Layer<'c>]) -> FxHashMap<(&'c str, &'c str), At> {
    walked(layers, |layer| {
        let (stored, parses) = (&layer.stored, &layer.parses);
        let key = |keys: crate::stored::U32s, ways: crate::stored::U32s, row: usize| (stored.text(keys.at(row)), stored.text(ways.at(row)));
        let puts = (0..parses.key.len()).map(|row| (key(parses.key, parses.way, row), row)).collect();
        (puts, (0..parses.deleted.len()).map(|row| key(parses.deleted, parses.deleted_way, row)).collect())
    }).into_iter().collect()
}

/// Every directory's newest row, by `walked`'s rule.
pub(crate) fn directory_fold<'c>(layers: &[Layer<'c>]) -> HashMap<&'c str, At> {
    walked(layers, |layer| {
        let (stored, directories) = (&layer.stored, &layer.directories);
        let puts = (0..directories.path.len()).map(|row| (stored.text(directories.path.at(row)), row)).collect();
        (puts, (0..directories.deleted.len()).map(|row| stored.text(directories.deleted.at(row))).collect())
    }).into_iter().collect()
}

/// The rule every whole-chain answer here shares: the newest layer that puts
/// or deletes a key decides, and within one layer a put wins over a delete of
/// the same key. The layers are walked newest first; a layer's put is kept
/// unless a newer layer put or deleted its key, so the newest layer's puts are
/// kept with no lookup. `keys` gives a layer's put keys with their rows, and
/// its deleted keys. The winners come in no particular order.
fn walked<'l, 'c, K: Hash + Eq + Copy + Send + Sync>(
    layers: &'l [Layer<'c>],
    keys: impl Fn(&'l Layer<'c>) -> (Vec<(K, usize)>, Vec<K>),
) -> Vec<(K, At)> {
    let mut touched: FxHashSet<K> = FxHashSet::default();
    let mut live = Vec::new();
    for (at, layer) in layers.iter().enumerate().rev() {
        let (puts, deletes) = keys(layer);
        let kept = puts.par_iter().filter(|(key, _)| !touched.contains(key)).map(|&(key, row)| (key, (at, row)));
        live.par_extend(kept);
        if at > 0 {
            touched.extend(puts.into_iter().map(|(key, _)| key));
            touched.extend(deletes);
        }
    }
    live
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
        let stored = &layer.stored;
        let (Some(digest), Some(way)) = (stored.id_of(digest), stored.id_of(way)) else { continue };
        if let Some(decided) = keyed(layer, at, (digest, way)) {
            return decided;
        }
    }
    None
}

/// What one layer says of the parse key `(digest, way)`, as ids of its own
/// dictionary: its row when it puts the key, `Some(None)` when it deletes it,
/// and `None` when it does neither and an older layer decides.
fn keyed(layer: &Layer, at: usize, key: (u32, u32)) -> Option<Option<At>> {
    let parses = &layer.parses;
    let found = |keys: crate::stored::U32s, ways: crate::stored::U32s| {
        let row = partition(keys.len(), |row| (keys.at(row), ways.at(row)) < key);
        (row < keys.len() && (keys.at(row), ways.at(row)) == key).then_some(row)
    };
    if let Some(row) = found(parses.key, parses.way) {
        return Some(Some((at, row)));
    }
    found(parses.deleted, parses.deleted_way).map(|_| None)
}

/// `parse` for the records of one chain, many at a time. A record's digest is
/// an id of its own layer's dictionary, so its own layer is searched by that
/// id; a newer layer by a map of the digests its parse keys name, built once
/// on first use; an older one by its dictionary, as `parse` does. A file's way
/// is spelled once by `index::way` and matched against the ways each layer's
/// parse keys name.
pub(crate) struct ParseKeys<'l, 'c> {
    layers: &'l [Layer<'c>],
    ways: Vec<OnceLock<FxHashMap<&'c str, u32>>>,
    digests: Vec<OnceLock<FxHashMap<&'c str, u32>>>,
}

impl<'l, 'c> ParseKeys<'l, 'c> {
    pub(crate) fn new(layers: &'l [Layer<'c>]) -> Self {
        ParseKeys { layers, ways: layers.iter().map(|_| OnceLock::new()).collect(), digests: layers.iter().map(|_| OnceLock::new()).collect() }
    }

    /// The parse of the record at `record`, whose file is `file`: what
    /// `parse(layers, digest, &way(file))` answers, or `None` for a record
    /// with no digest.
    pub(crate) fn of(&self, record: At, file: &str) -> Option<At> {
        let (own, row) = record;
        let (stored, records) = (&self.layers[own].stored, &self.layers[own].records);
        let digest = records.digest.at(row);
        let text = stored.optional(digest)?;
        let way = crate::index::way(file);
        for (at, layer) in self.layers.iter().enumerate().rev() {
            let parses = &layer.parses;
            if parses.key.len() == 0 && parses.deleted.len() == 0 { continue }
            let Some(&way) = self.ways(at).get(way.as_str()) else { continue };
            let digest = match at.cmp(&own) {
                Ordering::Equal => Some(digest),
                Ordering::Greater => self.digests(at).get(text).copied(),
                Ordering::Less => layer.stored.id_of(text),
            };
            let Some(digest) = digest else { continue };
            if let Some(decided) = keyed(layer, at, (digest, way)) {
                return decided;
            }
        }
        None
    }

    /// The ways the parse keys of layer `at` name, put or deleted, with their ids.
    fn ways(&self, at: usize) -> &FxHashMap<&'c str, u32> {
        self.ways[at].get_or_init(|| {
            let (stored, parses) = (&self.layers[at].stored, &self.layers[at].parses);
            (0..parses.way.len()).map(|row| parses.way.at(row))
                .chain((0..parses.deleted_way.len()).map(|row| parses.deleted_way.at(row)))
                .map(|id| (stored.text(id), id))
                .collect()
        })
    }

    /// The digests the parse keys of layer `at` name, put or deleted, with their ids.
    fn digests(&self, at: usize) -> &FxHashMap<&'c str, u32> {
        self.digests[at].get_or_init(|| {
            let (stored, parses) = (&self.layers[at].stored, &self.layers[at].parses);
            (0..parses.key.len()).map(|row| parses.key.at(row))
                .chain((0..parses.deleted.len()).map(|row| parses.deleted.at(row)))
                .map(|id| (stored.text(id), id))
                .collect()
        })
    }
}

/// The parse keys the chain holds under `digests`, as `(digest, way)`, by
/// `walked`'s rule.
pub(crate) fn held_parses(layers: &[Layer], digests: &HashSet<&str>) -> HashSet<(String, String)> {
    walked(layers, |layer| {
        let (stored, parses) = (&layer.stored, &layer.parses);
        let key = |keys: crate::stored::U32s, ways: crate::stored::U32s, row: usize| (stored.text(keys.at(row)), stored.text(ways.at(row)));
        let puts = (0..parses.key.len()).map(|row| (key(parses.key, parses.way, row), row)).filter(|((digest, _), _)| digests.contains(digest)).collect();
        (puts, (0..parses.deleted.len()).map(|row| key(parses.deleted, parses.deleted_way, row)).filter(|(digest, _)| digests.contains(digest)).collect())
    })
    .into_iter()
    .map(|((digest, way), _)| (digest.to_owned(), way.to_owned()))
    .collect()
}
