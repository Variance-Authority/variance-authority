//! A warm update of the source index, made on this side.
//!
//! `updateSourceIndex` opened the whole chain as objects (a second and a half
//! on Kibana), asked each file's record whether it still stood, and folded what
//! it reused back into a diff to publish. Every one of those steps is a
//! question the chain and the tree already answer: which records the tree still
//! vouches for, which files the walk has to open, and what differs from what is
//! held. So the chain is read in place, the records that stand are the ones
//! whose digest git names and whose witnessed directories did not move, the
//! walk (`batch.rs`) opens only the files past them, and one delta is written.
//!
//! What stays JavaScript's is what it owns: the configuration digest, which
//! `reuse.ts` derives from the resolver options, and the fallbacks. This
//! declines with `None` — no chain, a legacy or damaged one, another
//! configuration, a file no native reader opens — and the JavaScript update
//! runs as it always did. Nothing here guesses.
//!
//! Nothing changed, nothing is written.

// compass: variance-authority.reach.source-index

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use napi_derive::napi;
use rayon::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::batch::{is_module, walk_beyond, GraphOptions, Walked};
use crate::compact::{merged, Layer};
use crate::emitted::Listing;
use crate::generation::{encode_generation, Deleted, Generation};
use crate::git::Oid;
use crate::index::way;
use crate::index_chain::read_chain;
use crate::log::{written, LogSegment, Over};
use crate::order::code_unit;
use crate::package_graph::{fold, names_object, At};
use crate::read::Read;
use crate::record::{built, Indexed, Settling};
use crate::witness::AliasTable;

/// What an update needs that only the caller knows.
#[napi(object)]
pub struct UpdateOptions {
    pub root: String,
    pub index: String,
    /// `TreeShape.config`: how resolution is configured, as `reuse.ts` digests it.
    pub config: String,
    pub largest_file: Option<u32>,
    pub readers: Option<u32>,
    pub tsconfig: Option<String>,
    pub condition_names: Option<Vec<String>>,
    /// `Aliases.table` as JSON, when a configuration maps specifiers.
    pub aliases: Option<String>,
    pub builtins: Vec<String>,
    pub code_extensions: Vec<String>,
    /// `READABLE`: the extensions an edge is followed for.
    pub readable: Vec<String>,
}

/// What an update did.
#[napi(object)]
pub struct Updated {
    /// Files the index holds after the update.
    pub files: u32,
    /// Files opened to make it.
    pub reread: u32,
    /// Whether a segment was written; an unchanged tree writes none.
    pub published: bool,
    /// What the file system refused, when it did: the index is then as it was.
    pub refused: Option<String>,
}

/// The tree an update is made against.
pub(crate) struct Tree<'t> {
    pub paths: &'t [String],
    pub at: &'t HashMap<String, u32>,
    pub oids: &'t [Oid],
    pub seeds: &'t [String],
    pub listing: Arc<Listing>,
}

/// A file the walk opened, and what the index will hold of it.
struct Row {
    indexed: Indexed,
    identity: String,
    read: Read,
    parsed: bool,
}

/// The files the index reaches from its seeds over the records it holds and
/// the ones just built; the reached files no record answers for are `need`.
///
/// A walk that stops at `need` is resumed from there once they are built,
/// rather than walked again from the seeds: the second walk would visit every
/// file the first one did, and on a large checkout that is most of an update.
struct Reached<'l> {
    old: FxHashSet<&'l str>,
    new: HashSet<String>,
    need: Vec<String>,
    needed: FxHashSet<String>,
    stack: Vec<Cow<'l, str>>,
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
    fn from(seeds: &'l [String], capacity: usize) -> Self {
        let stack = seeds.iter().map(|seed| Cow::Borrowed(seed.as_str())).collect();
        Reached { old: FxHashSet::with_capacity_and_hasher(capacity, Default::default()), new: HashSet::new(), need: Vec::new(), needed: FxHashSet::default(), stack }
    }

    /// Walk until the stack is empty, leaving what no record answers for in `need`.
    fn walk(&mut self, layers: &'l [Layer<'l>], valid: &FxHashMap<&'l str, At>, walked: &FxHashMap<String, Row>, readable: &FxHashSet<String>) {
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

/// The parse keys the chain holds under `digests`, as `(digest, way)`: the last
/// layer to put or delete a key decides, as `orderedMap` folds it.
fn held_parses(layers: &[Layer], digests: &HashSet<&str>) -> HashSet<(String, String)> {
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

/// The key a parse is stored under: `joinedKey` in `source-index-format.ts`.
fn joined(digest: &str, way: &str) -> String {
    if way.is_empty() { digest.to_owned() } else { format!("{digest}\0{way}") }
}

pub(crate) fn update(o: UpdateOptions, tree: Tree) -> napi::Result<Option<Updated>> {
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {} did not update: {error}", o.index));
    // A chain that cannot be read is the JavaScript update's to describe, which is where its refusals are worded.
    let Ok(Some(chain)) = read_chain(&o.index) else { return Ok(None) };
    if chain.dropped > 0 || chain.references.is_empty() || chain.references.len() != chain.segments.len() {
        return Ok(None);
    }
    let Ok(layers) = chain.segments.par_iter().map(|bytes| Layer::open(bytes)).collect::<Result<Vec<_>, _>>() else {
        return Ok(None);
    };
    if layers.last().and_then(|layer| layer.config) != Some(o.config.as_str()) {
        return Ok(None);
    }
    let aliases = match o.aliases.as_deref().map(serde_json::from_str::<AliasTable>).transpose() {
        Ok(aliases) => aliases,
        Err(_) => return Ok(None),
    };

    let mut held_directories: HashMap<&str, &str> = HashMap::new();
    for layer in &layers {
        let (stored, directories) = (&layer.stored, &layer.directories);
        for row in 0..directories.deleted.len() {
            held_directories.remove(stored.text(directories.deleted.at(row)));
        }
        for row in 0..directories.path.len() {
            held_directories.insert(stored.text(directories.path.at(row)), stored.text(directories.digest.at(row)));
        }
    }
    let directories = crate::tree::directories(tree.paths);
    let mut moved: HashSet<&str> = directories
        .iter()
        .filter(|(path, digest)| held_directories.get(path.as_str()) != Some(&digest.as_str()))
        .map(|(path, _)| path.as_str())
        .collect();
    moved.extend(held_directories.keys().filter(|path| !directories.contains_key(**path)));

    let folded = fold(&layers);
    let valid: FxHashMap<&str, At> = folded
        .par_iter()
        .filter(|(file, at)| {
            let (layer, row) = **at;
            let (stored, records) = (&layers[layer].stored, &layers[layer].records);
            let Some(digest) = stored.optional(records.digest.at(row)) else { return false };
            let Some(&index) = tree.at.get(**file) else { return false };
            names_object(digest, &tree.oids[index as usize])
                && (moved.is_empty() || !records.witnesses_of(stored, row).any(|directory| moved.contains(directory)))
        })
        .map(|(file, at)| (*file, *at))
        .collect();

    let readable: FxHashSet<String> = o.readable.into_iter().collect();
    let mut walked: FxHashMap<String, Row> = FxHashMap::default();
    let mut reached = Reached::from(tree.seeds, valid.len());
    let mut settled: Option<(HashSet<String>, HashSet<String>, HashSet<String>)> = None;
    loop {
        reached.walk(&layers, &valid, &walked, &readable);
        if reached.need.is_empty() {
            break;
        }
        // A file the native reader does not open is the JavaScript update's to read.
        if reached.need.iter().any(|file| !is_module(file)) {
            return Ok(None);
        }
        let need = std::mem::take(&mut reached.need);
        let (builtins, code, dirs) = settled.get_or_insert_with(|| {
            (
                o.builtins.iter().cloned().collect(),
                o.code_extensions.iter().cloned().collect(),
                directories.keys().cloned().collect(),
            )
        });
        let Walked { files, identities, read, targets } = walk_beyond(
            GraphOptions {
                root: o.root.clone(),
                seeds: need.clone(),
                largest_file: o.largest_file,
                readers: o.readers,
                tsconfig: o.tsconfig.clone(),
                condition_names: o.condition_names.clone(),
                include_parses: false,
            },
            tree.at,
            tree.oids,
            Arc::clone(&tree.listing),
            &|file| valid.contains_key(file) || walked.contains_key(file),
        );
        let settling = Settling { builtins, code, remembering: true, directories: dirs, aliases: aliases.as_ref() };
        let before = walked.len();
        let rows: Vec<Row> = files
            .par_iter()
            .zip(identities.into_par_iter())
            .zip(read.into_par_iter())
            .zip(targets.par_iter())
            .map(|(((file, identity), (read, _, parsed)), targets)| {
                let indexed = built(file, &identity, &read, parsed, targets, &settling);
                Row { indexed, identity, read, parsed }
            })
            .collect();
        walked.extend(files.into_iter().zip(rows));
        // What was needed is walked on from; a file the walk did not build is the JavaScript update's.
        if walked.len() == before || need.iter().any(|file| !walked.contains_key(file.as_str())) {
            return Ok(None);
        }
        reached.stack.extend(need.into_iter().map(Cow::Owned));
    }

    let files = (reached.old.len() + reached.new.len()) as u32;
    let reread = reached.new.len() as u32;

    // Records: what the walk built and the index does not already say, and what nothing reaches.
    let mut puts: Vec<(&str, &Indexed)> = Vec::new();
    let mut retired: Vec<(&str, Option<&str>)> = Vec::new();
    for file in &reached.new {
        let row = &walked[file.as_str()];
        match folded.get(file.as_str()) {
            Some(&(layer, at)) => {
                let (stored, records) = (&layers[layer].stored, &layers[layer].records);
                if records.indexed(stored, at) != row.indexed {
                    puts.push((file, &row.indexed));
                }
                let digest = stored.optional(records.digest.at(at));
                if digest != row.indexed.record.digest.as_deref() {
                    retired.push((file, digest));
                }
            }
            None => puts.push((file, &row.indexed)),
        }
    }
    let mut deleted_records: Vec<String> = Vec::new();
    for (&file, &(layer, at)) in &folded {
        if reached.old.contains(file) || reached.new.contains(file) {
            continue;
        }
        deleted_records.push(file.to_owned());
        let (stored, records) = (&layers[layer].stored, &layers[layer].records);
        retired.push((file, stored.optional(records.digest.at(at))));
    }

    // Parses: a key is kept while some reached record names it. Only the digests
    // that moved can have lost their last user, so those are the ones looked at.
    let fresh: Vec<(String, &Read)> = reached
        .new
        .iter()
        .map(|file| (file, &walked[file.as_str()]))
        .filter(|(_, row)| row.parsed && !row.identity.is_empty())
        .map(|(file, row)| (joined(&row.identity, &way(file)), &row.read))
        .collect();
    let mut interest: HashSet<&str> = retired.iter().filter_map(|(_, digest)| *digest).collect();
    interest.extend(reached.new.iter().map(|file| walked[file.as_str()].identity.as_str()).filter(|digest| !digest.is_empty()));
    let held = if interest.is_empty() { HashSet::new() } else { held_parses(&layers, &interest) };
    let users: HashSet<String> = if retired.is_empty() {
        HashSet::new()
    } else {
        let wanted: HashSet<&str> = retired.iter().filter_map(|(_, digest)| *digest).collect();
        let mut users: HashSet<String> = valid
            .par_iter()
            .filter(|(file, _)| reached.old.contains(**file))
            .filter_map(|(file, &(layer, at))| {
                let (stored, records) = (&layers[layer].stored, &layers[layer].records);
                let digest = stored.optional(records.digest.at(at))?;
                wanted.contains(digest).then(|| joined(digest, &way(file)))
            })
            .collect();
        users.extend(fresh.iter().map(|(key, _)| key.clone()));
        users
    };
    let mut deleted_parses: Vec<String> = retired
        .iter()
        .filter_map(|(file, digest)| Some(joined((*digest)?, &way(file))))
        .filter(|key| {
            let (digest, way) = crate::generation::key_parts(key);
            held.contains(&(digest.to_owned(), way.to_owned())) && !users.contains(key)
        })
        .collect();
    let mut parses: Vec<(String, &Read)> = fresh
        .into_iter()
        .filter(|(key, _)| {
            let (digest, way) = crate::generation::key_parts(key);
            !held.contains(&(digest.to_owned(), way.to_owned()))
        })
        .collect();

    let mut put_directories: Vec<(String, String)> = directories
        .iter()
        .filter(|(path, digest)| held_directories.get(path.as_str()) != Some(&digest.as_str()))
        .map(|(path, digest)| (path.clone(), digest.clone()))
        .collect();
    let mut deleted_directories: Vec<String> =
        held_directories.keys().filter(|path| !directories.contains_key(**path)).map(|path| (*path).to_owned()).collect();

    let unchanged = puts.is_empty()
        && deleted_records.is_empty()
        && parses.is_empty()
        && deleted_parses.is_empty()
        && put_directories.is_empty()
        && deleted_directories.is_empty();
    if unchanged {
        return Ok(Some(Updated { files, reread, published: false, refused: None }));
    }

    puts.sort_by(|left, right| code_unit(left.0, right.0));
    parses.sort_by(|left, right| code_unit(&left.0, &right.0));
    parses.dedup_by(|left, right| left.0 == right.0);
    put_directories.sort_by(|left, right| code_unit(&left.0, &right.0));
    for keys in [&mut deleted_records, &mut deleted_parses, &mut deleted_directories] {
        keys.sort_by(|left, right| code_unit(left, right));
        keys.dedup();
    }
    let parse_rows: Vec<(&str, &Read)> = parses.iter().map(|(key, read)| (key.as_str(), *read)).collect();
    let delta = encode_generation(&Generation {
        config: Some(&o.config),
        directories: &put_directories,
        parses: &parse_rows,
        records: &puts,
        deleted: Deleted { parses: &deleted_parses, records: &deleted_records, directories: &deleted_directories },
    });

    let references: Vec<LogSegment> = chain
        .references
        .iter()
        .map(|reference| LogSegment { digest: reference.digest.clone(), length: reference.length as i64 })
        .collect();
    // The working layer and this delta become the next working layer: an update
    // rewrites what changed since the index was readied, and never the base.
    let base = references.len() - chain.working;
    let mut working: Vec<&[u8]> = chain.segments[base..].iter().map(Vec::as_slice).collect();
    working.push(&delta);
    let working = if working.len() == 1 { delta.clone() } else { merged(&working).map_err(fail)? };
    // Another writer between the read and here: its chain is not the one this delta is against.
    let refused = match written(&o.index, Over::Published(chain.published()), &references[..base], &[&working], &references[base..], 1) {
        Ok(false) => return Ok(None),
        Ok(true) => None,
        Err(error) => Some(format!("{}: {error}", o.index)),
    };
    Ok(Some(Updated { files, reread, published: refused.is_none(), refused }))
}
