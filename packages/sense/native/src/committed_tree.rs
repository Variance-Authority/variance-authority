//! `HEAD`'s tree below the root, held by the ids it was read from, so that the
//! next listing reads only the trees whose ids it does not hold.
//!
//! A tree id names its whole content, so a held directory whose id the new
//! tree names again holds the same blobs, and they are taken, not read. An
//! unchanged `HEAD^{tree}` reads no tree at all; a moved one reads the trees on
//! the paths that moved, whatever history lies between the two, as git's
//! `diff-tree` prunes equal subtrees. Only the new side is read: the held side
//! is the record, so an old tree the store has since dropped costs nothing.
//!
//! The record is the index's (`{index}.committed`), compressed with a checksum;
//! one that does not decode, or was read for another root, is nothing held and
//! the tree is read whole. The working tree is compared against the listing on
//! every run, as before: this holds only what a tree id fixes.

// compass: variance-authority.reach.source-index

use std::io::Write as _;
use std::path::Path;

use gix_hash::ObjectId;

use crate::git_store::Reader;

/// A blob below the root: its path from the root, its id, and whether it is a symbolic link.
pub(crate) type Blob = (Vec<u8>, ObjectId, bool);

/// The listing of one tree below one root, with the id of every directory in it.
#[derive(Debug, Default)]
pub(crate) struct Committed {
    /// `--show-prefix`: the root's place in the checkout.
    prefix: String,
    /// The tree at the top of the checkout, then each one down to the root, as
    /// far as the tree holds the root.
    chain: Vec<ObjectId>,
    /// In tree order, which is byte order over the path.
    pub(crate) blobs: Vec<Blob>,
    /// Every directory below the root, in the same order, each with its range.
    dirs: Vec<Dir>,
    /// Tree objects this listing read; held ones are not counted, nor recorded.
    pub(crate) read: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Range {
    /// The first blob below the directory, and the one past its last.
    start: u32,
    end: u32,
    /// The directory past its last descendant.
    after: u32,
}

#[derive(Debug)]
struct Dir {
    /// From the root, ending in `/`.
    path: Vec<u8>,
    id: ObjectId,
    range: Range,
}

/// The blobs of the tree `top` below `prefix`, taking every directory `held`
/// holds by the same path and id. `None` where a tree is missing or does not decode.
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
    Walk { reader, held: &mut held, cursor: 0, out: &mut out }.dir(&tree, &mut Vec::new())?;
    Some(out)
}

struct Walk<'a> {
    reader: &'a mut Reader,
    held: &'a mut Committed,
    /// The first held directory not yet passed: the walk asks in their order.
    cursor: usize,
    out: &'a mut Committed,
}

impl Walk<'_> {
    fn dir(&mut self, id: &ObjectId, path: &mut Vec<u8>) -> Option<()> {
        self.out.read += 1;
        for (name, oid, kind) in self.reader.entries(id)? {
            let at = path.len();
            path.extend_from_slice(&name);
            match kind {
                Entry::Tree => {
                    path.push(b'/');
                    let me = self.out.dirs.len();
                    let start = self.out.blobs.len() as u32;
                    self.out.dirs.push(Dir { path: path.clone(), id: oid, range: Range { start, end: start, after: 0 } });
                    match self.held_at(path, &oid) {
                        Some(found) => self.take(found),
                        None => self.dir(&oid, path)?,
                    }
                    let (end, after) = (self.out.blobs.len() as u32, self.out.dirs.len() as u32);
                    (self.out.dirs[me].range.end, self.out.dirs[me].range.after) = (end, after);
                }
                Entry::Blob { link } => self.out.blobs.push((path.clone(), oid, link)),
            }
            path.truncate(at);
        }
        Some(())
    }

    /// The held directory at `path` when it holds the tree `id`. Directories are
    /// asked in byte order, which is the order they are held in.
    fn held_at(&mut self, path: &[u8], id: &ObjectId) -> Option<usize> {
        let dirs = &self.held.dirs;
        while dirs.get(self.cursor).is_some_and(|dir| dir.path.as_slice() < path) {
            self.cursor += 1;
        }
        let dir = dirs.get(self.cursor)?;
        (dir.path == path && dir.id == *id).then_some(self.cursor)
    }

    /// Everything below the held directory `found`, moved into place behind the
    /// one just pushed for it. Nothing behind the cursor is asked again.
    fn take(&mut self, found: usize) {
        let Range { start, end, after } = self.held.dirs[found].range;
        let (blob_shift, dir_shift) = (self.out.blobs.len() as i64 - start as i64, self.out.dirs.len() as i64 - found as i64 - 1);
        let moved = |at: u32, shift: i64| (at as i64 + shift) as u32;
        for blob in &mut self.held.blobs[start as usize..end as usize] {
            self.out.blobs.push((std::mem::take(&mut blob.0), blob.1, blob.2));
        }
        for dir in &mut self.held.dirs[found + 1..after as usize] {
            let Range { start, end, after } = dir.range;
            let range = Range { start: moved(start, blob_shift), end: moved(end, blob_shift), after: moved(after, dir_shift) };
            self.out.dirs.push(Dir { path: std::mem::take(&mut dir.path), id: dir.id, range });
        }
        self.cursor = after as usize;
    }
}

/// What a tree entry is to the listing; a gitlink is a commit, and is left out.
pub(crate) enum Entry {
    Tree,
    Blob { link: bool },
}

const MAGIC: &[u8] = b"va-committed\x01";

impl Committed {
    /// The record, as written; equal for two listings of the same tree below the same root.
    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut bytes = MAGIC.to_vec();
        put(&mut bytes, self.prefix.as_bytes());
        count(&mut bytes, self.chain.len());
        for id in &self.chain {
            bytes.extend_from_slice(id.as_bytes());
        }
        count(&mut bytes, self.blobs.len());
        for (path, id, link) in &self.blobs {
            put(&mut bytes, path);
            bytes.extend_from_slice(id.as_bytes());
            bytes.push(u8::from(*link));
        }
        count(&mut bytes, self.dirs.len());
        for Dir { path, id, range } in &self.dirs {
            put(&mut bytes, path);
            bytes.extend_from_slice(id.as_bytes());
            for at in [range.start, range.end, range.after] {
                bytes.extend_from_slice(&at.to_le_bytes());
            }
        }
        bytes
    }

    /// The record `bytes` holds, or `None` where it is not one this build wrote
    /// whole: a range out of place reads as nothing held, never as a listing.
    fn decode(bytes: &[u8]) -> Option<Committed> {
        let mut at = Cursor(bytes.strip_prefix(MAGIC)?);
        let prefix = String::from_utf8(at.bytes()?.to_vec()).ok()?;
        let chain = (0..at.count()?).map(|_| at.id()).collect::<Option<Vec<_>>>()?;
        let blobs = (0..at.count()?).map(|_| Some((at.bytes()?.to_vec(), at.id()?, at.take(1)?[0] == 1))).collect::<Option<Vec<_>>>()?;
        let mut dirs = Vec::new();
        for _ in 0..at.count()? {
            let (path, id) = (at.bytes()?.to_vec(), at.id()?);
            let range = Range { start: at.u32()?, end: at.u32()?, after: at.u32()? };
            dirs.push(Dir { path, id, range });
        }
        let placed = dirs.iter().enumerate().all(|(index, dir)| {
            let Range { start, end, after } = dir.range;
            start <= end && end as usize <= blobs.len() && index < after as usize && after as usize <= dirs.len()
        });
        let sorted = dirs.windows(2).all(|pair| pair[0].path < pair[1].path);
        (at.0.is_empty() && placed && sorted).then_some(Committed { prefix, chain, blobs, dirs, read: 0 })
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

fn count(bytes: &mut Vec<u8>, count: usize) {
    bytes.extend_from_slice(&(count as u32).to_le_bytes());
}

fn put(bytes: &mut Vec<u8>, field: &[u8]) {
    count(bytes, field.len());
    bytes.extend_from_slice(field);
}

struct Cursor<'a>(&'a [u8]);

impl<'a> Cursor<'a> {
    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        let (field, rest) = self.0.split_at_checked(length)?;
        self.0 = rest;
        Some(field)
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn count(&mut self) -> Option<usize> {
        self.u32().map(|count| count as usize)
    }

    fn bytes(&mut self) -> Option<&'a [u8]> {
        let length = self.count()?;
        self.take(length)
    }

    fn id(&mut self) -> Option<ObjectId> {
        ObjectId::try_from(self.take(20)?).ok()
    }
}

#[cfg(test)]
#[path = "committed_tree_tests.rs"]
mod tests;
