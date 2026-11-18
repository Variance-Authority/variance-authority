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
//! `reuse.ts` derives from the resolver options. Every index is made here: a
//! chain this cannot stand on — none, a legacy or damaged one, another
//! configuration — is rebuilt from the tree, and what it cannot do at all is
//! an error rather than somebody else's turn.
//!
//! Nothing changed, no record is written; a listing the tree carries (spec
//! 0107) is written with the segment it stands beside.

// compass: variance-authority.reach.source-index

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use napi_derive::napi;
use rayon::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::acquire::{declined_for_size, still_too_large, LARGEST_FILE};
use crate::batch::{neighbours, texting, walk_beyond, GraphOptions, Neighbours, Walked};
use crate::chain_lookup::{fold, held_parses, At};
use crate::compact::{merged, Layer};
use crate::emitted::Listing;
use crate::generation::{encode_generation, Deleted, Generation};
use crate::git::Oid;
use crate::index::way;
use crate::index_chain::{read_chain, Chain};
use crate::log::{written, LogSegment, Over};
use crate::order::code_unit;
use crate::package_graph::names_object;
use crate::parse_store::{self, Parse, Stores};
use crate::read::Read;
use crate::record::{built, Indexed, Settling};
use crate::witness::AliasTable;
use crate::world::World;

#[path = "source_update_reach.rs"]
mod reach;
use reach::Reached;

/// What an update needs that only the caller knows.
#[napi(object)]
#[derive(Clone)]
pub struct UpdateOptions {
    pub root: String,
    pub index: String,
    /// `TreeShape.config`: how resolution is configured, as `reuse.ts` digests it.
    pub config: String,
    pub largest_file: Option<u32>,
    pub readers: Option<u32>,
    pub tsconfig: Option<napi::Either<String, bool>>,
    pub condition_names: Option<Vec<String>>,
    /// `Aliases.table` as JSON, when a configuration maps specifiers.
    pub aliases: Option<String>,
    pub builtins: Vec<String>,
    pub code_extensions: Vec<String>,
    /// `READABLE`: the extensions an edge is followed for.
    pub readable: Vec<String>,
    /// The parse stores a file is looked up in before it is opened, the first
    /// the one this update adds its parses to (`parse_store.rs`). With them, an
    /// index that does not exist yet is started here.
    pub stores: Option<Vec<String>>,
    /// `false` reads every file off the working tree, never out of Git's object store.
    pub packs: Option<bool>,
}

/// What an update did.
#[napi(object)]
pub struct Updated {
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
    /// Why a chain on disk was rebuilt rather than updated: `damaged`, or `other-version` when another release wrote it.
    pub rebuilt: Option<String>,
    /// The format version that release wrote, when `rebuilt` is `other-version`.
    pub written: Option<u32>,
}

/// The tree an update is made against.
pub(crate) struct Tree<'t> {
    pub paths: &'t [String],
    pub at: &'t HashMap<String, u32>,
    pub oids: &'t [Oid],
    pub seeds: &'t [String],
    pub listing: Arc<Listing>,
    pub regular: &'t [bool],
    pub unhashed: &'t [String],
    /// The files a language that resolves over the tree asks about, sorted: git's
    /// listing, or the disk's for a directory git does not list.
    pub world: (&'t HashMap<String, u32>, &'t [String]),
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
    identity: String,
    read: Read,
    parsed: bool,
    /// Answered by a store rather than read.
    kept: bool,
}

/// The update, and whether it lost the race: another writer published between
/// the read of the chain and this update's publication, which wrote nothing.
pub(crate) fn update(o: UpdateOptions, tree: Tree, trusted: bool) -> napi::Result<(Updated, bool)> {
    let fail = |error: String| napi::Error::from_reason(format!("the source index at {} did not update: {error}", o.index));
    // A chain this update cannot stand on — unreadable, legacy, damaged, or one
    // whose read panicked (`trusted` false) — is rebuilt from the tree, as a
    // missing one is. One made under another configuration is stood on with none
    // of its records trusted: every file is resolved again and only what differs
    // is written, so its base, and what is built on that base, stays.
    let found = read_chain(&o.index);
    let unreadable = found.is_err();
    let read = found.ok().flatten();
    let fits = |chain: &&Chain| trusted && chain.dropped == 0 && !chain.references.is_empty() && chain.references.len() == chain.segments.len();
    let opened = read.as_ref().filter(fits).and_then(|chain| chain.segments.par_iter().map(|bytes| Layer::open(bytes)).collect::<Result<Vec<_>, _>>().ok());
    let configured = opened.as_ref().is_some_and(|layers| layers.last().and_then(|layer| layer.config) == Some(o.config.as_str()));
    // A chain left behind for a segment that does not read is told apart from one
    // that only predates the manifest, and one another release wrote from both.
    let (rebuilt, version) = match (&read, &opened) {
        (None, _) if unreadable => (Some("damaged".to_string()), None),
        (Some(_), None) if !trusted => (Some("damaged".to_string()), None),
        (Some(chain), None) if chain.dropped > 0 || chain.segments.iter().any(|bytes| Layer::open(bytes).is_err()) => {
            let version = chain.segments.iter().find_map(|bytes| crate::stored::written(bytes));
            (Some(if version.is_some() { "other-version" } else { "damaged" }.to_string()), version)
        }
        _ => (None, None),
    };
    let chain = if opened.is_some() { read.as_ref() } else { None };
    let layers = opened.unwrap_or_default();
    let segments: &[Vec<u8>] = chain.map_or(&[], |chain| &chain.segments);
    let stores = Stores::read(o.stores.as_deref().unwrap_or_default());
    let store = stores.open();
    let kept = |identity: &str, file: &str| store.view(identity, &way(file))?.read();
    let aliases = o.aliases.as_deref().map(serde_json::from_str::<AliasTable>).transpose().map_err(|error| fail(format!("its aliases: {error}")))?;

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
    let (root, largest) = (Path::new(&o.root), u64::from(o.largest_file.unwrap_or(LARGEST_FILE)));
    let valid: FxHashMap<&str, At> = folded
        .par_iter()
        .filter(|_| configured)
        .filter(|(file, at)| {
            let (layer, row) = **at;
            let (stored, records) = (&layers[layer].stored, &layers[layer].records);
            let Some(digest) = stored.optional(records.digest.at(row)) else { return false };
            let Some(&index) = tree.at.get(**file) else { return false };
            names_object(digest, &tree.oids[index as usize])
                && (moved.is_empty() || !records.witnesses_of(stored, row).any(|directory| moved.contains(directory)))
                // Git's object is the cleaned bytes and a decline was decided on
                // the checked-out ones, so it holds while those are still over.
                && records
                    .unknown_of(stored, row)
                    .is_none_or(|unknown| !declined_for_size(file, unknown) || still_too_large(root, file, largest))
        })
        .map(|(file, at)| (*file, *at))
        .collect();

    let readable: FxHashSet<String> = o.readable.into_iter().collect();
    let mut walked: FxHashMap<String, Row> = FxHashMap::default();
    let mut reached = Reached::from(tree.seeds, valid.len());
    let mut settled: Option<(HashSet<String>, HashSet<String>, HashSet<String>)> = None;
    // One world for every round: what it builds over the tree (Rust's module
    // tree, read from every `.rs` file) is the same each round.
    let read_by_world = Neighbours::default();
    let parsing = neighbours(&o.root, tree.at, tree.oids, o.largest_file, o.readers, &kept, tree.from_blob, tree.store, &read_by_world);
    let texting = texting(&o.root);
    let world = World::new(Some(tree.world.0), Some(tree.world.1)).reading(&parsing, &texting);
    loop {
        reached.walk(&layers, &valid, &walked, &readable);
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
        let Walked { files, identities, read, targets, kept: answered } = walk_beyond(
            GraphOptions {
                root: o.root.clone(),
                seeds: need.clone(),
                largest_file: o.largest_file,
                readers: o.readers,
                tsconfig: crate::resolve::Tsconfig::from_js(o.tsconfig.clone()),
                condition_names: o.condition_names.clone(),
                include_parses: false,
            },
            tree.at,
            tree.oids,
            Arc::clone(&tree.listing),
            &world,
            &read_by_world,
            &|file| valid.contains_key(file) || walked.contains_key(file),
            &kept,
            tree.from_blob,
            tree.store,
        );
        let settling = Settling { builtins, code, remembering: true, directories: dirs, aliases: aliases.as_ref() };
        let before = walked.len();
        let rows: Vec<Row> = files
            .par_iter()
            .zip(identities.into_par_iter())
            .zip(read.into_par_iter())
            .zip(targets.par_iter())
            .zip(answered.into_par_iter())
            .map(|((((file, identity), (read, _, outcome)), targets), kept)| {
                let indexed = built(file, &identity, &read, outcome, targets, &settling);
                Row { indexed, identity, read, parsed: outcome.parsed(), kept }
            })
            .collect();
        walked.extend(files.into_iter().zip(rows));
        // What was needed is walked on from: a file the walk did not build would be walked for again, forever.
        if let Some(file) = need.iter().find(|file| !walked.contains_key(file.as_str())).or(need.first().filter(|_| walked.len() == before)) {
            return Err(fail(format!("{file} was reached and not read")));
        }
        reached.stack.extend(need.into_iter().map(Cow::Owned));
    }

    let files = (reached.old.len() + reached.new.len()) as u32;
    let reread = reached.new.len() as u32;
    let parsed = reached.new.iter().filter(|file| walked[file.as_str()].parsed && !walked[file.as_str()].kept).count() as u32;

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
    let fresh: Vec<(String, Parse)> = reached
        .new
        .iter()
        .map(|file| (file, &walked[file.as_str()]))
        .filter(|(_, row)| row.parsed && !row.identity.is_empty())
        .filter_map(|(file, row)| Parse::of(Some(&store), &row.identity, file, row.kept, &row.read))
        .collect();
    // What this update parsed of the blob it is named by that no store holds, for every root after it.
    let parsed_here = reached.new.iter().map(|file| (file, &walked[file.as_str()]));
    let parsed_here = parsed_here.filter(|(file, row)| row.parsed && !row.kept && !row.identity.is_empty() && tree.from_blob.shares(&row.identity, &way(file)));
    // The store serves the next root and the index this one: neither reads the other, so they are written side by side.
    let updated = std::thread::scope(|scope| {
        scope.spawn(|| stores.add_unheld(&store, parsed_here.map(|(file, row)| (row.identity.as_str(), way(file), &row.read))));
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
                    wanted.contains(digest).then(|| parse_store::key(digest, &way(file)))
                })
                .collect();
            users.extend(fresh.iter().map(|(key, _)| key.clone()));
            users
        };
        let mut deleted_parses: Vec<String> = retired
            .iter()
            .filter_map(|(file, digest)| Some(parse_store::key((*digest)?, &way(file))))
            .filter(|key| {
                let (digest, way) = crate::generation::key_parts(key);
                held.contains(&(digest.to_owned(), way.to_owned())) && !users.contains(key)
            })
            .collect();
        let mut parses: Vec<(String, Parse)> = fresh
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

        // A configuration that changed alone is still published, or every update after it resolves again.
        let unchanged = configured && puts.is_empty()
            && deleted_records.is_empty()
            && parses.is_empty()
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
        let segment = |reference: &crate::index_chain::Reference| LogSegment { digest: reference.digest.clone(), length: reference.length as i64 };
        let (references, published, working_count): (Vec<LogSegment>, Over, usize) = match chain {
            Some(chain) => (chain.references.iter().map(segment).collect(), Over::Published(chain.published()), chain.working),
            // A chain rebuilt is replaced only while it is still the one read;
            // a first build only where nothing was published.
            None => (Vec::new(), match &read {
                Some(read) => Over::Published(read.published()),
                None if unreadable => Over::Anything,
                None => Over::Nothing,
            }, 0),
        };
        // A chain rebuilt rather than updated leaves nothing of its own behind.
        let stale: Vec<LogSegment> = match (chain, &read) {
            (None, Some(read)) => read.references.iter().map(segment).collect(),
            _ => Vec::new(),
        };
        // The working layer and this delta become the next working layer: an update
        // rewrites what changed since the index was readied, and never the base.
        let base = references.len() - working_count;
        let beneath: Vec<&[u8]> = segments[..base].iter().map(Vec::as_slice).collect();
        if unchanged {
            let Some(listing) = listing else {
                return Ok((Updated { files, reread, parsed, published: false, refused: None, rebuilt, written: version }, false));
            };
            // Nothing to publish, and a listing to carry: the working layer is
            // written again with it, so the next update can ask Watchman from here.
            let working: Vec<&[u8]> = segments[base..].iter().map(Vec::as_slice).collect();
            let working = match working.as_slice() {
                [] => encode_generation::<Read>(&Generation { config: Some(&o.config), directories: &[], parses: &[], records: &[], deleted: Deleted::default() }),
                [only] => only.to_vec(),
                _ => merged(&beneath, &working).map_err(fail)?,
            };
            let working = carried(working, Some(listing)).map_err(fail)?;
            return match written(&o.index, published, &references[..base], &[&working], &references[base..], 1) {
                Ok(still) => Ok((Updated { files, reread, parsed, published: false, refused: None, rebuilt, written: version }, !still)),
                Err(error) => Ok((Updated { files, reread, parsed, published: false, refused: Some(format!("{}: {error}", o.index)), rebuilt, written: version }, false)),
            };
        }

        puts.sort_by(|left, right| code_unit(left.0, right.0));
        parses.sort_by(|left, right| code_unit(&left.0, &right.0));
        parses.dedup_by(|left, right| left.0 == right.0);
        put_directories.sort_by(|left, right| code_unit(&left.0, &right.0));
        for keys in [&mut deleted_records, &mut deleted_parses, &mut deleted_directories] {
            keys.sort_by(|left, right| code_unit(left, right));
            keys.dedup();
        }
        let parse_rows: Vec<(&str, &Parse)> = parses.iter().map(|(key, parse)| (key.as_str(), parse)).collect();
        let delta = encode_generation(&Generation {
            config: Some(&o.config),
            directories: &put_directories,
            parses: &parse_rows,
            records: &puts,
            deleted: Deleted { parses: &deleted_parses, records: &deleted_records, directories: &deleted_directories },
        });

        let mut working: Vec<&[u8]> = segments[base..].iter().map(Vec::as_slice).collect();
        working.push(&delta);
        let working = if working.len() == 1 { delta.clone() } else { merged(&beneath, &working).map_err(fail)? };
        let working = carried(working, listing).map_err(fail)?;
        // A first update has no base to carry a working layer over: what it writes
        // is the base, and readying finds nothing to fold.
        let layered = usize::from(chain.is_some());
        // Another writer between the read and here: its chain is not the one this delta is against.
        let replaced: Vec<LogSegment> = references[base..].iter().chain(&stale).cloned().collect();
        let outcome = written(&o.index, published, &references[..base], &[&working], &replaced, layered);
        let refused = match &outcome {
            Ok(false) => Some(format!("{}: another writer published it after this update read it", o.index)),
            Ok(true) => None,
            Err(error) => Some(format!("{}: {error}", o.index)),
        };
        let lost = matches!(outcome, Ok(false));
        Ok((Updated { files, reread, parsed, published: refused.is_none(), refused, rebuilt, written: version }, lost))
    });
    // Freeing every row the walk read takes a third of a second on a large tree, and nothing waits for it.
    std::thread::spawn(move || drop(walked));
    updated
}
