//! The walk a warm update makes over the records it holds and the files it
//! just read, from the index's seeds.

// compass: variance-authority.reach.source-index

use std::borrow::Cow;
use std::collections::HashSet;

use rustc_hash::{FxHashMap, FxHashSet};

use super::Row;
use crate::chain_lookup::At;
use crate::compact::Layer;

/// The files the index reaches from its seeds over the records it holds and
/// the ones just built; the reached files no record answers for are `need`.
///
/// A walk that stops at `need` is resumed from there once they are built,
/// rather than walked again from the seeds: the second walk would visit every
/// file the first one did, and on a large checkout that is most of an update.
pub(super) struct Reached<'l> {
    pub(super) old: FxHashSet<&'l str>,
    pub(super) new: HashSet<String>,
    pub(super) need: Vec<String>,
    needed: FxHashSet<String>,
    pub(super) stack: Vec<Cow<'l, str>>,
}

/// Node's `extname`.
fn extname(path: &str) -> &str {
    let base = path.rsplit('/').next().unwrap_or(path);
    match base.rfind('.') {
        Some(at) if at > 0 => &base[at..],
        _ => "",
    }
}

impl<'l> Reached<'l> {
    pub(super) fn from(seeds: &'l [String], capacity: usize) -> Self {
        let stack = seeds.iter().map(|seed| Cow::Borrowed(seed.as_str())).collect();
        Reached { old: FxHashSet::with_capacity_and_hasher(capacity, Default::default()), new: HashSet::new(), need: Vec::new(), needed: FxHashSet::default(), stack }
    }

    /// Walk until the stack is empty, leaving what no record answers for in `need`.
    pub(super) fn walk(&mut self, layers: &'l [Layer<'l>], valid: &FxHashMap<&'l str, At>, walked: &FxHashMap<String, Row>, readable: &FxHashSet<String>) {
        while let Some(file) = self.stack.pop() {
            if let Some(row) = walked.get(file.as_ref()) {
                if self.new.insert(file.as_ref().to_owned()) {
                    let edges = row.indexed.record.edges.iter().flatten().map(|edge| edge.to.as_str());
                    self.stack.extend(edges.filter(|to| readable.contains(extname(to))).map(|to| Cow::Owned(to.to_owned())));
                }
            } else if let Some((&key, &(layer, at))) = valid.get_key_value(file.as_ref()) {
                if self.old.insert(key) {
                    let (stored, records) = (&layers[layer].stored, &layers[layer].records);
                    if let Some(edges) = records.edges_of(stored, at) {
                        self.stack.extend(edges.map(|(to, _)| to).filter(|to| readable.contains(extname(to))).map(Cow::Borrowed));
                    }
                }
            } else if self.needed.insert(file.as_ref().to_owned()) {
                self.need.push(file.into_owned());
            }
        }
    }
}
