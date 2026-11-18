//! The native source-index lifecycle: reuse a valid publication's records,
//! read the source closure beyond them, and atomically publish its next layer.
//! Missing indexes start here without a parse store. A damaged chain keeps its
//! valid prefix; a changed configuration or legacy file is rebuilt against the
//! original publication so a competing writer is never overwritten.

// compass: variance-authority.reach.source-index

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use napi_derive::napi;
use rayon::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::batch::{walk_consumed, GraphOptions};
use crate::chain_lookup::{fold, At};
use crate::compact::{merged, ParseView};
use crate::emitted::Listing;
use crate::generation::{encode_generation, Deleted, Generation};
use crate::git::Oid;
use crate::index::way;
use crate::log::{written, written_reusing};
use crate::order::code_unit;
use crate::package_graph::names_object;
use crate::parse_store::{self, Stores};
use crate::source_read::SourceRead;
use crate::record::{Indexed, Settling};
use crate::witness::AliasTable;

#[path = "source_update_state.rs"]
mod state;
use state::Reached;

#[path = "source_update_parses.rs"]
mod parses;

#[cfg(test)]
#[path = "source_update_tests.rs"]
mod tests;

/// What an update needs that only the caller knows.
#[derive(Clone)]
#[napi(object)]
pub struct UpdateOptions {
    pub root: String,
    pub index: String,
    /// `TreeShape.config`: how resolution is configured, as `reuse.ts` digests it.
    pub config: String,
    pub largest_file: Option<u32>,
    pub readers: Option<u32>,
    /// `false` opens source bytes from the checkout only.
    pub packs: Option<bool>,
    /// Complete Git map metadata alongside an explicitly requested full preparation.
    pub prepare_map: Option<bool>,
    pub tsconfig: Option<napi::Either<String, bool>>,
    pub condition_names: Option<Vec<String>>,
    /// `Aliases.table` as JSON, when a configuration maps specifiers.
    pub aliases: Option<String>,
    pub builtins: Vec<String>,
    pub code_extensions: Vec<String>,
    /// `READABLE`: the extensions an edge is followed for.
    pub readable: Vec<String>,
    /// Parse stores consulted by content identity, the first also receiving
    /// new parses (`parse_store.rs`). Eligible Git identities allow lookup before
    /// acquisition; other reads prove identity from their bytes first.
    pub stores: Option<Vec<String>>,
}

/// What an update did.
#[napi(object)]
pub struct Updated {
    /// What the original publication could read.
    pub was: String,
    /// The foreign source-index version that ended its valid prefix.
    pub written: Option<u32>,
    /// Files the index holds after the update.
    pub files: u32,
    /// Files opened to make it.
    pub reread: u32,
    /// Modules parsed to make it: the files opened that no store answered.
    pub parsed: u32,
    /// Whether records were published; an unchanged tree publishes none, and writes only a listing it carries.
    pub published: bool,
    /// What the file system refused, when it did: the index is then as it was.
    pub refused: Option<String>,
    /// Whether the refusal is another writer's publication between the read and the write: the same update, run again, is against its chain.
    pub moved: bool,
}

/// The tree an update is made against.
#[derive(Clone)]
pub(crate) struct Tree<'t> {
    pub paths: &'t [String],
    pub at: &'t HashMap<String, u32>,
    pub oids: &'t [Oid],
    pub seeds: &'t [String],
    pub listing: Arc<Listing>,
    pub regular: &'t [bool],
    pub unhashed: &'t [String],
    /// Told of each tracked file read, and asked which parses may be shared.
    pub from_blob: &'t crate::parse_origin::FromBlob,
    /// The object store every round's walk reads from.
    pub store: &'t crate::acquire::TreeObjects,
    /// What makes this tree carried by the segment the update writes, when a watch covers it.
    #[cfg(unix)]
    pub carry: Option<crate::held_listing::Meta>,
}

/// A file the walk opened, and what the index will hold of it.
struct Row {
    indexed: Indexed,
    parsed: bool,
}

pub(crate) fn update(o: UpdateOptions, tree: Tree) -> napi::Result<Option<Updated>> {
    update_with(o, tree, false)
}

/// Retry a same-length segment whose contents panicked while they were read.
pub(crate) fn rebuild(o: UpdateOptions, tree: Tree) -> napi::Result<Option<Updated>> {
    update_with(o, tree, true)
}

fn update_with(o: UpdateOptions, tree: Tree, damaged: bool) -> napi::Result<Option<Updated>> {
    let mut phases = crate::timings::Phases::new("update", "open chain and store");
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {} did not update: {error}", o.index));
    let baseline = state::Baseline::read(&o.index);
    let mut view = baseline.view(&o.config);
    if damaged {
        view.layers.clear();
        view.count = 0;
        view.was = "damaged";
        view.written = None;
        view.repair = true;
    }
    let segments = &baseline.segments()[..view.count];
    let (was, prior_version, repair, records_current) = (view.was, view.written, view.repair, view.records_current);
    let parse_layers = view.layers;
    let layers = &parse_layers[..view.count];
    let stores = Stores::read(o.stores.as_deref().unwrap_or_default());
    let store = stores.open();
    let held_parse = |identity: &str, file: &str| {
        let way = way(file);
        crate::chain_lookup::parse(&parse_layers, identity, &way)
            .map(|(at, row)| ParseView::of(&parse_layers[at], row))
            .or_else(|| store.view(identity, &way))
    };
    let kept = |identity: &str, file: &str| held_parse(identity, file)?.source_read(file);
    let aliases = match o.aliases.as_deref().map(serde_json::from_str::<AliasTable>).transpose() {
        Ok(aliases) => aliases,
        Err(_) => return Ok(None),
    };

    let mut held_directories: HashMap<&str, &str> = HashMap::new();
    for layer in layers {
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

    let folded = fold(layers);
    let valid: FxHashMap<&str, At> = folded
        .par_iter()
        .filter(|(file, at)| {
            if !records_current || !tree.store.allows_blobs() { return false; }
            let (layer, row) = **at;
            let (stored, records) = (&layers[layer].stored, &layers[layer].records);
            let Some(digest) = stored.optional(records.digest.at(row)) else { return false };
            let Some(&index) = tree.at.get(**file) else { return false };
            let Some(oid) = tree.oids.get(index as usize) else { return false };
            let size_refusal = records.unknown_of(stored, row).is_some_and(|why| crate::acquire::declined_for_size(file, why));
            let regular = tree.regular.get(index as usize) == Some(&true);
            let valid_origin = if size_refusal {
                let largest = u64::from(o.largest_file.unwrap_or(crate::acquire::LARGEST_FILE));
                if regular {
                    tree.store.objects_now(std::path::Path::new(&o.root)).is_some_and(|objects| objects.with_readers(1, |readers|
                        readers[0].size(&gix_hash::ObjectId::from_bytes_or_panic(oid)).is_some_and(|size| size > largest)))
                } else {
                    std::fs::symlink_metadata(std::path::Path::new(&o.root).join(file)).is_ok_and(|entry| entry.is_file())
                        && crate::acquire::still_too_large(std::path::Path::new(&o.root), file, largest)
                }
            } else { regular };
            valid_origin && names_object(digest, oid)
                && (moved.is_empty() || !records.witnesses_of(stored, row).any(|directory| moved.contains(directory)))
        })
        .map(|(file, at)| (*file, *at))
        .collect();

    phases.next("walk and settle");
    let readable: FxHashSet<String> = o.readable.into_iter().collect();
    let mut walked: FxHashMap<String, Row> = FxHashMap::default();
    let mut reached = Reached::from(tree.seeds, valid.len());
    let mut parsed = 0;
    let mut parses = parses::Parses::default();
    let session = crate::scan_session::State::default();
    let mut settled: Option<(HashSet<String>, HashSet<String>, HashSet<String>)> = None;
    loop {
        reached.walk(layers, &valid, &walked, &readable);
        if reached.need.is_empty() {
            break;
        }
        let need = std::mem::take(&mut reached.need);
        let (builtins, code, dirs) = settled.get_or_insert_with(|| {
            (
                o.builtins.iter().cloned().collect(),
                o.code_extensions.iter().cloned().collect(),
                directories.keys().cloned().collect(),
            )
        });
        let settling = Settling { builtins, code, remembering: true, directories: dirs, aliases: aliases.as_ref() };
        let consumed = walk_consumed(
            GraphOptions {
                root: o.root.clone(),
                seeds: need.clone(),
                largest_file: o.largest_file,
                readers: o.readers,
                tsconfig: crate::resolve::Tsconfig::from_js(o.tsconfig.clone()),
                condition_names: o.condition_names.clone(),
                include_parses: false,
            },
            tree.paths,
            tree.at,
            tree.oids,
            Arc::clone(&tree.listing),
            &|file| valid.contains_key(file) || walked.contains_key(file),
            &kept,
            None,
            tree.from_blob,
            tree.store,
            &session,
            |files, read, acquired, targets| parses.consume(files, read, acquired, targets, &settling, layers, &held_parse),
        );
        parsed += consumed.parsed;
        let before = walked.len();
        walked.extend(consumed.rows.into_iter().flatten());
        // A walk that makes no progress cannot publish the complete closure.
        if walked.len() == before || need.iter().any(|file| !walked.contains_key(file.as_str())) {
            return Ok(None);
        }
        reached.stack.extend(need.into_iter().map(Cow::Owned));
    }
    let prefetched = if o.stores.as_ref().is_some_and(|stores| !stores.is_empty()) { std::mem::take(&mut *session.prefetched.borrow_mut()) } else { HashMap::new() };
    drop(session);
    let prepared = crate::scan_session::prepared_parses(&prefetched, None);
    parses.trace();

    let files = (reached.old.len() + reached.new.len()) as u32;
    let reread = reached.new.len() as u32;

    phases.next("encode and publish");
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

    // What this update parsed of the blob it is named by that no store holds, for every root after it.
    let add_unheld = || stores.add_encoded(&store, &parses.segments, tree.from_blob, &prepared);
    phases.next("prepare publication");
    // A parse is kept while a reached record names it. Only identities that
    // moved can have lost their last user.
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
                wanted.contains(digest).then(|| parse_store::key(digest, &way(file)))
            })
            .collect();
        users.extend(reached.new.iter().filter_map(|file| {
            let row = &walked[file.as_str()];
            if !row.parsed { return None }
            Some(parse_store::key(row.indexed.record.digest.as_deref()?, &way(file)))
        }));
        users
    };
    let mut deleted_parses: Vec<String> = retired
        .iter()
        .filter_map(|(file, digest)| Some(parse_store::key((*digest)?, &way(file))))
        .filter(|key| {
            let (digest, way) = crate::generation::key_parts(key);
            !users.contains(key) && crate::chain_lookup::parse(layers, digest, way).is_some()
        })
        .collect();

    let mut put_directories: Vec<(String, String)> = directories
        .iter()
        .filter(|(path, digest)| held_directories.get(path.as_str()) != Some(&digest.as_str()))
        .map(|(path, digest)| (path.clone(), digest.clone()))
        .collect();
    let mut deleted_directories: Vec<String> =
        held_directories.keys().filter(|path| !directories.contains_key(**path)).map(|path| (*path).to_owned()).collect();

    let unchanged = !repair
        && puts.is_empty()
        && deleted_records.is_empty()
        && parses.segments.is_empty()
        && deleted_parses.is_empty()
        && put_directories.is_empty()
        && deleted_directories.is_empty();
    #[cfg(unix)]
    let listing = tree.carry.map(|mut meta| {
        meta.config = Some(o.config.clone());
        meta.files = files;
        crate::held_listing::columns(tree.paths, tree.oids, tree.regular, tree.unhashed, &meta)
    });
    #[cfg(not(unix))]
    let listing: Option<Vec<crate::segment::Column>> = None;
    let carried = |segment: Vec<u8>, listing: Option<Vec<crate::segment::Column>>| -> Result<Vec<u8>, String> {
        #[cfg(unix)]
        if let Some(listing) = listing {
            return crate::held_listing::carried(&segment, listing);
        }
        let _ = &listing;
        Ok(segment)
    };
    let original = baseline.references();
    let references = &original[..view.count.min(original.len())];
    let published = baseline.over();
    let working_count = baseline.working(view.count);
    // The working layer and this delta become the next working layer: an update
    // rewrites what changed since the index was readied, and never the base.
    let base = references.len() - working_count;
    let beneath: Vec<&[u8]> = segments[..base].iter().map(Vec::as_slice).collect();
    if unchanged {
        phases.next("parse stores");
        add_unheld();
        let Some(listing) = listing else {
            return Ok(Some(Updated { was: was.to_owned(), written: prior_version, files, reread, parsed, published: false, refused: None, moved: false }));
        };
        // Nothing to publish, and a listing to carry: the working layer is
        // written again with it, so the next update can ask Watchman from here.
        let working: Vec<&[u8]> = segments[base..].iter().map(Vec::as_slice).collect();
        let working = match working.as_slice() {
            [] => encode_generation::<SourceRead>(&Generation { config: Some(&o.config), directories: &[], parses: &[], records: &[], deleted: Deleted::default() }),
            [only] => only.to_vec(),
            _ => merged(&beneath, &working).map_err(fail)?,
        };
        let working = carried(working, Some(listing)).map_err(fail)?;
        return match written(&o.index, published, &references[..base], &[&working], &original[base..], 1) {
            Ok(true) => Ok(Some(Updated { was: was.to_owned(), written: prior_version, files, reread, parsed, published: false, refused: None, moved: false })),
            Ok(false) => Ok(Some(Updated { was: was.to_owned(), written: prior_version, files, reread, parsed, published: false, refused: Some(format!("{} moved after it was read; run the index update again", o.index)), moved: true })),
            Err(error) => Ok(Some(Updated { was: was.to_owned(), written: prior_version, files, reread, parsed, published: false, refused: Some(format!("{}: {error}", o.index)), moved: false })),
        };
    }

    puts.sort_by(|left, right| code_unit(left.0, right.0));
    put_directories.sort_by(|left, right| code_unit(&left.0, &right.0));
    for keys in [&mut deleted_records, &mut deleted_parses, &mut deleted_directories] {
        keys.sort_by(|left, right| code_unit(left, right));
        keys.dedup();
    }
    phases.next("encode generation");
    let delta = encode_generation::<SourceRead>(&Generation {
        config: Some(&o.config),
        directories: &put_directories,
        parses: &[],
        records: &puts,
        deleted: Deleted { parses: &deleted_parses, records: &deleted_records, directories: &deleted_directories },
    });
    phases.next("parse stores");
    let reusable = add_unheld();
    phases.next("release source facts");
    drop(prepared);
    drop(prefetched);
    drop(puts);
    walked.into_par_iter().for_each(drop);

    phases.next("merge generation");
    let cold = layers.is_empty();
    let publications;
    let working;
    let working_count;
    if cold {
        working = carried(delta, listing).map_err(fail)?;
        let mut encoded: Vec<&[u8]> = parses.segments.iter().map(Vec::as_slice).collect();
        encoded.push(&working);
        publications = encoded;
        working_count = 0;
    } else {
        let mut pending: Vec<&[u8]> = segments[base..].iter().map(Vec::as_slice).collect();
        pending.extend(parses.segments.iter().map(Vec::as_slice));
        pending.push(&delta);
        let merged = merged(&beneath, &pending).map_err(fail)?;
        working = carried(merged, listing).map_err(fail)?;
        publications = vec![working.as_slice()];
        working_count = 1;
    }
    phases.next("write publication");
    // Another writer between the read and here: its chain is not the one this delta is against.
    let (refused, moved) = match written_reusing(&o.index, published, &references[..base], &publications, &original[base..], working_count, if cold { &reusable } else { &[] }) {
        Ok(false) => (Some(format!("{} moved after it was read; run the index update again", o.index)), true),
        Ok(true) => (None, false),
        Err(error) => (Some(format!("{}: {error}", o.index)), false),
    };
    Ok(Some(Updated { was: was.to_owned(), written: prior_version, files, reread, parsed, published: refused.is_none(), refused, moved }))
}
