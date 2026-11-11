//! Which parses were made from the blob Git named, and so may leave their checkout.
//!
//! A parse is kept under Git's name for its file, and the file is read off the
//! disk wherever that is cheaper than Git's object store. The name can then be
//! of other bytes than the ones parsed: an edit Git was told not to look for
//! (`--assume-unchanged`), or one made after the listing. Such a parse answers
//! its own checkout, which reads those bytes, and no other.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use napi_derive::napi;
use sha1::{Digest, Sha1};

use crate::git::{self, Oid};
use crate::index::way;
use crate::parse_store::key;
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

/// By parse key, whether every read one tree made under it was of the blob it
/// names. Paths of one blob share a key, and a row does not say which of them
/// it was parsed from, so one read of other bytes withholds the key for the
/// tree's life: no later read of the blob admits it again.
#[derive(Default)]
pub(crate) struct FromBlob(Mutex<HashMap<String, bool>>);

impl FromBlob {
    /// A parse was made for the file Git names `oid`; `named` is whether its
    /// bytes were that blob.
    pub(crate) fn saw(&self, oid: &Oid, file: &str, named: bool) {
        let mut held = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        *held.entry(key(&git::spell(oid), &way(file))).or_insert(true) &= named;
    }

    /// Whether the parse kept under `identity` may be offered to another
    /// checkout: one kept under the digest of the bytes read, as a file Git
    /// does not list is, or one whose key this tree read, and only as the blob.
    pub(crate) fn shares(&self, identity: &str, way: &str) -> bool {
        !identity.starts_with("git:") || self.0.lock().unwrap_or_else(PoisonError::into_inner).get(&key(identity, way)) == Some(&true)
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
    fn offers_a_blob_only_while_every_read_of_it_was_the_blob_and_any_parse_kept_by_its_own_digest() {
        let oid = git::parse_oid(b"ce013625030ba8dba906f756967f9e9ca394464a").expect("an object name");
        let held = FromBlob::default();
        let identity = git::spell(&oid);
        assert!(!held.shares(&identity, "ts"), "a key no read proved");
        held.saw(&oid, "a.ts", true);
        assert!(held.shares(&identity, &way("a.ts")));
        held.saw(&oid, "b.ts", false);
        assert!(!held.shares(&identity, &way("a.ts")), "another path of the blob held other bytes");
        held.saw(&oid, "a.ts", true);
        assert!(!held.shares(&identity, &way("a.ts")), "a later read of the blob admits nothing again");
        assert!(held.shares("sha256-of-the-bytes-read", "ts"));
    }
}
