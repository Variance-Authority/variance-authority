//! `HEAD`'s tree below the root, held by package, so that the next listing
//! reads only the trees on the paths that moved.
//!
//! The record keeps every blob below the root, the tree ids from the top of
//! the checkout down to the root, and the tree id of every package below it:
//! a directory holding a `package.json` the package owner would read
//! (`crate::package_owners::is_manifest`), a nested one a key of its own. No
//! other directory is kept, as a monorepo's directories outnumber its packages
//! by twenty to a hundred to one.
//!
//! An unchanged `HEAD^{tree}` reads no tree at all. A moved one is diffed
//! against the tree the record was read from, straight from the store, as
//! git's `diff-tree` does: a subtree both sides name by the same id is taken
//! from the record, not read, so only the trees on the paths that moved are
//! read, on both sides, whatever history lies between the two. Where the store
//! no longer holds an old tree, gc having dropped it, a package below it is
//! diffed from the id the record keys it by; a package whose own old tree is
//! gone too, and any other directory below the dropped tree, is read whole.
//!
//! A package is cut by its manifest's path, not by the name inside it: the
//! walk reads trees and nothing else, and the owner learns a name by reading
//! the blob. A manifest that names nothing is one key more, never a wrong
//! answer, since everything taken is taken by an equal tree id.
//!
//! The record is the index's (`{index}.committed`), read and advanced by every
//! listing made for that index, the update's and orientation's alike, in the segment framing,
//! compressed with a checksum;
//! one that does not decode, or was read for another root, is nothing held and
//! the tree is read whole. The working tree is compared against the listing on
//! every run, as before: this holds only what a tree id fixes.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use gix_hash::ObjectId;

use crate::git_store::Reader;
use crate::segment;
use crate::stored::Stored;

/// A blob below the root: its path from the root, its id, and whether it is a symbolic link.
pub(crate) type Blob = (Vec<u8>, ObjectId, bool);

/// The entries of one tree, as the store lists them.
type Entries = Vec<(Vec<u8>, ObjectId, Entry)>;

/// The listing of one tree below one root, with the id of every package in it.
#[derive(Debug, Default)]
pub(crate) struct Committed {
    /// `--show-prefix`: the root's place in the checkout.
    prefix: String,
    /// The tree at the top of the checkout, then each one down to the root, as
    /// far as the tree holds the root.
    chain: Vec<ObjectId>,
    /// In tree order, which is byte order over the path.
    pub(crate) blobs: Vec<Blob>,
    /// Every package below the root, in the same order.
    dirs: Vec<Dir>,
    /// Tree objects this listing read, on either side; held ones are not counted, nor recorded.
    pub(crate) read: usize,
}

#[derive(Debug)]
struct Dir {
    /// From the root, ending in `/`.
    path: Vec<u8>,
    id: ObjectId,
}

/// The record beside the index at `index`, which every listing made for that index reads and advances.
pub(crate) fn record(index: &str) -> PathBuf {
    PathBuf::from(format!("{index}.committed"))
}

/// The blobs of the tree `top` below `prefix`, taking from `held` every subtree
/// it holds by the same path and id. `None` where a new tree is missing or does not decode.
pub(crate) fn list(reader: &mut Reader, top: ObjectId, prefix: &str, held: Option<Committed>) -> Option<Committed> {
    let mut held = held.filter(|held| held.prefix == prefix).unwrap_or_default();
    let mut out = Committed { prefix: prefix.to_owned(), ..Committed::default() };
    let names: Vec<&str> = prefix.split('/').filter(|name| !name.is_empty()).collect();
    let mut tree = top;
    for depth in 0..=names.len() {
        if held.chain.get(depth) == Some(&tree) {
            out.chain.extend_from_slice(&held.chain[depth..]);
            return Some(Committed { chain: out.chain, read: out.read, ..held });
        }
        out.chain.push(tree);
        let Some(name) = names.get(depth) else { break };
        out.read += 1;
        let Some(next) = reader.subtree(&tree, name.as_bytes())? else {
            return Some(out);
        };
        tree = next;
    }
    let was = held.chain.get(names.len()).copied();
    let mut walk = Walk { reader, held: &mut held, out: &mut out };
    let entries = walk.read(&tree)?;
    let old = was.and_then(|was| walk.read(&was));
    walk.dir(entries, old, &mut Vec::new())?;
    Some(out)
}

struct Walk<'a> {
    reader: &'a mut Reader,
    held: &'a mut Committed,
    out: &'a mut Committed,
}

impl Walk<'_> {
    /// The entries of the tree `id`, counted as read, or `None` where the store holds no such tree.
    fn read(&mut self, id: &ObjectId) -> Option<Entries> {
        let entries = self.reader.entries(id)?;
        self.out.read += 1;
        Some(entries)
    }

    /// The blobs below the directory at `path`, from its new `entries` and the
    /// entries `old` its held tree has where the store still holds it.
    fn dir(&mut self, entries: Entries, old: Option<Entries>, path: &mut Vec<u8>) -> Option<()> {
        let old: HashMap<Vec<u8>, ObjectId> =
            old.into_iter().flatten().filter(|entry| matches!(entry.2, Entry::Tree)).map(|(name, id, _)| (name, id)).collect();
        for (name, oid, kind) in entries {
            let at = path.len();
            path.extend_from_slice(&name);
            match kind {
                Entry::Tree => {
                    path.push(b'/');
                    let was = old.get(&name).copied().or_else(|| self.held(path));
                    if was == Some(oid) {
                        self.take(path);
                    } else {
                        let entries = self.read(&oid)?;
                        if is_unit(path, &entries) {
                            self.out.dirs.push(Dir { path: path.clone(), id: oid });
                        }
                        let old = was.and_then(|was| self.read(&was));
                        self.dir(entries, old, path)?;
                    }
                }
                Entry::Blob { link } => self.out.blobs.push((path.clone(), oid, link)),
            }
            path.truncate(at);
        }
        Some(())
    }

    /// The tree id the record keys a package at `path` by: the old side of a
    /// package whose parent's old tree the store has dropped.
    fn held(&self, path: &[u8]) -> Option<ObjectId> {
        let dirs = &self.held.dirs;
        dirs.binary_search_by(|dir| dir.path.as_slice().cmp(path)).ok().map(|at| dirs[at].id)
    }

    /// Every held blob and package below `prefix`, moved into place. What is
    /// below a prefix is one run in byte order, and the walk asks in that
    /// order, so a run moved out, its paths emptied, lies before every later
    /// prefix and still sorts as it did.
    fn take(&mut self, prefix: &[u8]) {
        let blobs = &mut self.held.blobs;
        let start = blobs.partition_point(|blob| blob.0.as_slice() < prefix);
        let end = start + blobs[start..].partition_point(|blob| blob.0.starts_with(prefix));
        for blob in &mut blobs[start..end] {
            self.out.blobs.push((std::mem::take(&mut blob.0), blob.1, blob.2));
        }
        let dirs = &mut self.held.dirs;
        let start = dirs.partition_point(|dir| dir.path.as_slice() < prefix);
        let end = start + dirs[start..].partition_point(|dir| dir.path.starts_with(prefix));
        for dir in &mut dirs[start..end] {
            self.out.dirs.push(Dir { path: std::mem::take(&mut dir.path), id: dir.id });
        }
    }
}

/// Whether the directory at `path`, holding `entries`, is a unit of the
/// record: a package by the owner's rule for a manifest's path.
fn is_unit(path: &[u8], entries: &Entries) -> bool {
    entries.iter().any(|(name, _, kind)| name == b"package.json" && matches!(kind, Entry::Blob { .. }))
        && std::str::from_utf8(&[path, b"package.json"].concat()).is_ok_and(crate::package_owners::is_manifest)
}

/// What a tree entry is to the listing; a gitlink is a commit, and is left out.
pub(crate) enum Entry {
    Tree,
    Blob { link: bool },
}

const FORMAT: &str = "variance-authority-committed-tree";
const VERSION: u8 = 2;

impl Committed {
    /// The record, as written; equal for two listings of the same tree below the same root.
    pub(crate) fn encode(&self) -> Vec<u8> {
        let (blob_paths, blob_offsets) = joined(self.blobs.iter().map(|blob| blob.0.as_slice()));
        let (dir_paths, dir_offsets) = joined(self.dirs.iter().map(|dir| dir.path.as_slice()));
        // Paths are git's bytes, not always UTF-8, so they sit in byte heaps and the dictionary is empty.
        segment::encode_as(FORMAT, VERSION, vec![
            segment::u8s("strings.blob", Vec::new()),
            segment::u32s("strings.off", vec![0]),
            segment::u8s("prefix", self.prefix.as_bytes().to_vec()),
            segment::u8s("chain", self.chain.iter().flat_map(|id| id.as_bytes().to_owned()).collect()),
            segment::u8s("blobs.path", blob_paths),
            segment::u32s("blobs.path.off", blob_offsets),
            segment::u8s("blobs.id", self.blobs.iter().flat_map(|blob| blob.1.as_bytes().to_owned()).collect()),
            segment::u8s("blobs.link", self.blobs.iter().map(|blob| u8::from(blob.2)).collect()),
            segment::u8s("dirs.path", dir_paths),
            segment::u32s("dirs.path.off", dir_offsets),
            segment::u8s("dirs.id", self.dirs.iter().flat_map(|dir| dir.id.as_bytes().to_owned()).collect()),
        ])
    }

    /// The record `bytes` holds, or `None` where it is not one this build wrote
    /// whole: paths out of order read as nothing held, never as a listing.
    fn decode(bytes: &[u8]) -> Option<Committed> {
        let stored = Stored::open_as(bytes, FORMAT, VERSION).ok()?;
        let prefix = String::from_utf8(stored.u8s("prefix").ok()?.to_vec()).ok()?;
        let chain = ids(stored.u8s("chain").ok()?)?;
        let blob_ids = ids(stored.u8s("blobs.id").ok()?)?;
        let links = stored.codes("blobs.link", 1).ok()?;
        let blob_paths = paths(&stored, "blobs.path", blob_ids.len())?;
        let dir_ids = ids(stored.u8s("dirs.id").ok()?)?;
        let dir_paths = paths(&stored, "dirs.path", dir_ids.len())?;
        if links.len() != blob_ids.len() {
            return None;
        }
        let blobs: Vec<Blob> = blob_paths.into_iter().zip(blob_ids).zip(links).map(|((path, id), link)| (path, id, *link == 1)).collect();
        let dirs: Vec<Dir> = dir_paths.into_iter().zip(dir_ids).map(|(path, id)| Dir { path, id }).collect();
        let sorted = blobs.windows(2).all(|pair| pair[0].0 < pair[1].0) && dirs.windows(2).all(|pair| pair[0].path < pair[1].path);
        sorted.then_some(Committed { prefix, chain, blobs, dirs, read: 0 })
    }

    /// What `path` holds, or nothing held.
    pub(crate) fn load(path: &Path) -> Option<Committed> {
        Committed::decode(&zstd::stream::decode_all(std::fs::File::open(path).ok()?).ok()?)
    }

    /// Written to `path` in one rename; a listing that fails to land is read again next time.
    pub(crate) fn save(&self, path: &Path) {
        let written = (|| {
            let mut encoder = zstd::stream::Encoder::new(Vec::new(), 1).ok()?;
            encoder.include_checksum(true).ok()?;
            encoder.write_all(&self.encode()).ok()?;
            encoder.finish().ok()
        })();
        if let (Some(bytes), Some(path)) = (written, path.to_str()) {
            let _ = crate::journey_output::replace(path, &bytes);
        }
    }
}

/// Paths laid end to end, with the offset of each and one past the last.
fn joined<'p>(paths: impl Iterator<Item = &'p [u8]>) -> (Vec<u8>, Vec<u32>) {
    let (mut blob, mut offsets) = (Vec::new(), vec![0]);
    for path in paths {
        blob.extend_from_slice(path);
        offsets.push(blob.len() as u32);
    }
    (blob, offsets)
}

fn paths(stored: &Stored, name: &str, rows: usize) -> Option<Vec<Vec<u8>>> {
    let blob = stored.u8s(name).ok()?;
    let offsets = stored.offsets(&format!("{name}.off"), rows, blob.len()).ok()?;
    Some((0..rows).map(|at| blob[offsets.at(at) as usize..offsets.at(at + 1) as usize].to_vec()).collect())
}

fn ids(bytes: &[u8]) -> Option<Vec<ObjectId>> {
    let (chunks, rest) = bytes.as_chunks::<20>();
    rest.is_empty().then(|| chunks.iter().map(|id| ObjectId::try_from(id.as_slice())).collect::<Result<_, _>>().ok())?
}

#[cfg(test)]
#[path = "committed_tree_tests.rs"]
mod tests;
