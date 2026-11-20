//! Working-checkout inventory from Git's index, without reading HEAD's trees.
// compass: variance-authority.reach.source-scan

use gix_hash::ObjectId;
use gix_index::entry::Mode;

use crate::git_store::Checkout;

pub(super) struct Listed {
    /// Carried into the worktree comparison, rather than opened there again.
    pub index: Option<gix_index::File>,
    pub blobs: Vec<(Vec<u8>, ObjectId, bool)>,
}

/// Read native index formats directly; let Git expand a sparse index or answer a format it owns.
pub(super) fn read(checkout: &Checkout) -> Option<Listed> {
    if checkout.format != "sha1" { return None; }
    let index = gix_index::File::at_or_default(&checkout.index, gix_hash::Kind::Sha1, false, Default::default()).ok();
    let prefix = checkout.prefix.as_bytes();
    if let Some(index) = index.filter(|index| !index.is_sparse()) {
        let mut blobs = Vec::with_capacity(index.entries().len());
        for entry in index.entries() {
            if !matches!(entry.mode, Mode::FILE | Mode::FILE_EXECUTABLE | Mode::SYMLINK) { continue; }
            let Some(path) = entry.path(&index).strip_prefix(prefix) else { continue; };
            // Conflict stages name one working path; the overlay supplies its bytes.
            if blobs.last().is_some_and(|(last, _, _)| last == path) { continue; }
            blobs.push((path.to_vec(), entry.id, entry.mode == Mode::SYMLINK));
        }
        return Some(Listed { index: Some(index), blobs });
    }
    let bytes = crate::stages::summed(crate::stages::Sum::LsFiles, || super::git(checkout.root.to_str()?, &["--no-optional-locks", "ls-files", "--stage", "--full-name", "-z", "--", "."], None))?;
    let mut blobs = Vec::new();
    for entry in bytes.split(|byte| *byte == 0).filter(|entry| !entry.is_empty()) {
        let tab = entry.iter().position(|byte| *byte == b'\t')?;
        let mut fields = entry[..tab].split(|byte| *byte == b' ');
        let (mode, oid) = (fields.next()?, super::parse_oid(fields.next()?)?);
        if !matches!(mode, b"100644" | b"100755" | b"120000") { continue; }
        let Some(path) = entry[tab + 1..].strip_prefix(prefix) else { continue; };
        if blobs.last().is_some_and(|(last, _, _)| last == path) { continue; }
        blobs.push((path.to_vec(), ObjectId::from(oid), mode == b"120000"));
    }
    Some(Listed { index: None, blobs })
}

#[cfg(test)]
#[path = "git_inventory_tests.rs"]
mod tests;
