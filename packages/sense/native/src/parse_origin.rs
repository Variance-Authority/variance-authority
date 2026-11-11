//! Which parses were made from the blob Git named, and so may leave their checkout.
//!
//! A parse is kept under Git's name for its file, and the file is read off the
//! disk wherever that is cheaper than Git's object store. The name can then be
//! of other bytes than the ones parsed: an edit Git was told not to look for
//! (`--assume-unchanged`), or one made after the listing. Such a parse answers
//! its own checkout, which reads those bytes, and no other.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, PoisonError};

use napi::Either;
use napi_derive::napi;
use sha1::{Digest, Sha1};

use crate::acquire::{self, Answer};
use crate::batch::{scan_batch_with_oids, ScanBatch, ScanOptions};
use crate::git::{self, Oid};
use crate::resolve::Tsconfig;
use crate::index::way;
use crate::parse_store::{self, key};
use crate::GitTree;

/// Whether `bytes` are the blob Git names `oid`.
// TODO: an object name is twenty bytes here (`git::Oid`), so a SHA-256
// repository lists nothing and none of its parses is kept under a blob's name.
pub(crate) fn names(oid: &Oid, bytes: &[u8]) -> bool {
    let mut hasher = Sha1::new();
    hasher.update(format!("blob {}\0", bytes.len()));
    hasher.update(bytes);
    hasher.finalize().as_slice() == oid
}

/// The parses one tree's reads made from the blob each is kept under, by parse key.
#[derive(Default)]
pub(crate) struct FromBlob(Mutex<HashSet<String>>);

impl FromBlob {
    /// A parse was made for the file Git names `oid`; `named` is whether its
    /// bytes were that blob. The last read decides: its parse is the one kept.
    pub(crate) fn saw(&self, oid: &Oid, file: &str, named: bool) {
        let key = key(&git::spell(oid), &way(file));
        let mut held = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if named {
            held.insert(key);
        } else {
            held.remove(&key);
        }
    }

    /// Read `files` off the disk, each named by the one of `oids` at its place, or by
    /// none where `oids` is empty; every read of a file Git names is seen.
    pub(crate) fn read_disk(
        &self,
        root: &str,
        files: &[String],
        oids: &[Option<Oid>],
        largest_file: Option<u32>,
        digests: Option<bool>,
        readers: Option<u32>,
    ) -> Vec<Answer> {
        let read = acquire::read_disk(root.to_owned(), files.to_vec(), oids, largest_file, digests, readers, true);
        for ((file, oid), (_, named)) in files.iter().zip(oids).zip(&read) {
            if let Some(oid) = oid {
                self.saw(oid, file, *named);
            }
        }
        read.into_iter().map(|(answer, _)| answer).collect()
    }

    /// Whether the parse kept under `identity` may be offered to another
    /// checkout: one made from that blob, or one kept under the digest of the
    /// bytes read, as a file Git does not list is.
    pub(crate) fn shares(&self, identity: &str, way: &str) -> bool {
        !identity.starts_with("git:") || self.0.lock().unwrap_or_else(PoisonError::into_inner).contains(&key(identity, way))
    }
}

#[napi]
impl GitTree {
    /// Tell the tree that a parse of `file` was made in JavaScript from `contents`.
    #[napi(catch_unwind)]
    pub fn parsed_from(&self, file: String, contents: String) {
        if let Some(index) = self.at.get(&file) {
            let oid = &self.oids[*index as usize];
            self.from_blob.saw(oid, &file, names(oid, contents.as_bytes()));
        }
    }

    /// `scan_batch` for a scan that reads no blob out of Git's object store
    /// (`packs: false`): the same frontier off the disk, resolved without this
    /// tree's listing, with each file's bytes told from the blob this tree names.
    #[napi(catch_unwind)]
    #[allow(clippy::too_many_arguments, reason = "the positional contract of `scan_batch`")]
    pub fn scan_disk(
        &self,
        root: String,
        files: Vec<String>,
        largest_file: Option<u32>,
        digests: Option<bool>,
        readers: Option<u32>,
        tsconfig: Option<Either<String, bool>>,
        condition_names: Option<Vec<String>>,
        listed: Option<Vec<String>>,
    ) -> ScanBatch {
        let listed: Option<HashMap<String, u32>> = listed.map(|paths| paths.into_iter().zip(0..).collect());
        let oids: Vec<Option<Oid>> = files.iter().map(|file| self.at.get(file).map(|index| self.oids[*index as usize])).collect();
        let options = ScanOptions { root, files, largest_file, digests, readers, tsconfig: Tsconfig::from_js(tsconfig), condition_names };
        scan_batch_with_oids(options, None, listed.as_ref(), None, &|_, _| None, &oids, &self.from_blob)
    }

    /// Add to the first of `stores` every parse the chain at `chain` holds, no
    /// store does, and this tree's reads made from the blob it is kept under;
    /// how many went in. What a scan read in JavaScript reaches the store this
    /// way, after the root that read it is published.
    #[napi(catch_unwind)]
    pub fn fill_parse_store(&self, stores: Vec<String>, chain: String) -> napi::Result<u32> {
        parse_store::fill(&stores, &chain, &self.from_blob)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_bytes_as_git_does() {
        // `printf 'hello\n' | git hash-object --stdin`
        let oid = git::parse_oid(b"ce013625030ba8dba906f756967f9e9ca394464a").expect("an object name");
        assert!(names(&oid, b"hello\n"));
        assert!(!names(&oid, b"hello\r\n"));
    }

    #[test]
    fn offers_only_the_last_read_of_a_blob_and_any_parse_kept_by_its_own_digest() {
        let oid = git::parse_oid(b"ce013625030ba8dba906f756967f9e9ca394464a").expect("an object name");
        let held = FromBlob::default();
        let identity = git::spell(&oid);
        assert!(!held.shares(&identity, "ts"));
        held.saw(&oid, "a.ts", true);
        assert!(held.shares(&identity, &way("a.ts")));
        held.saw(&oid, "a.ts", false);
        assert!(!held.shares(&identity, &way("a.ts")));
        assert!(held.shares("sha256-of-the-bytes-read", "ts"));
    }
}
