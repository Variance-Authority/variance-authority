//! The tree an update is made against, and what it carries forward: the one
//! the index holds when Watchman vouches nothing moved since it was listed,
//! else git's (spec 0107, `held_listing.rs`).

// compass: variance-authority.reach.source-index

use napi_derive::napi;

use crate::GitTree;

/// The tree an update of the index at `index` is made against.
#[napi(catch_unwind)]
pub fn change_tree(root: String, index: String, dirs: Vec<String>) -> Option<GitTree> {
    crate::stages::timed("listing", || listed(root, index, dirs))
}

fn listed(root: String, index: String, dirs: Vec<String>) -> Option<GitTree> {
    #[cfg(unix)]
    {
        let (snapshot, change) = crate::held_listing::change_tree(&root, &index, &dirs)?;
        let seeds = crate::seed::seeds_of(&root, &dirs, &snapshot);
        let mut tree = crate::git_tree::tree_from_snapshot(snapshot, seeds);
        tree.change = change;
        Some(tree)
    }
    #[cfg(not(unix))]
    {
        let _ = index;
        crate::git_tree_for(root, dirs)
    }
}

/// The tree of a directory git does not list: no path git names, so every
/// file is read off the disk under a `v1:` digest, seeded from a walk of
/// `dirs` themselves, with the walk of the whole directory, and those seeds,
/// as what the languages that resolve over the tree ask about. A directory
/// asked for, and the repository it sits in, are entered and listed whole,
/// manifests included, though the walk of the whole directory steps over
/// every other repository of its own.
#[napi(catch_unwind)]
pub fn disk_tree(root: String, dirs: Vec<String>) -> GitTree {
    crate::stages::timed("listing", || disk_listed(root, dirs))
}

fn disk_listed(root: String, dirs: Vec<String>) -> GitTree {
    let mut disk = crate::seed::disk_listing(std::path::Path::new(&root), &dirs);
    let seeds = crate::seed::seed_files(root, dirs);
    if seeds.iter().any(|seed| disk.binary_search_by(|path| crate::order::code_unit(path, seed)).is_err()) {
        disk.extend(seeds.iter().cloned());
        disk.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
        disk.dedup();
    }
    let at = disk.iter().cloned().zip(0..).collect();
    let mut tree = crate::git_tree::tree_from_snapshot(crate::git::Snapshot { paths: Vec::new(), oids: Vec::new(), regular: Vec::new(), unhashed: Vec::new() }, seeds);
    tree.disk = Some((std::sync::Arc::new(at), disk));
    tree
}

#[napi]
impl GitTree {
    /// Watchman vouched for the listing the index held, and git listed nothing.
    #[napi(getter)]
    pub fn vouched(&self) -> bool {
        #[cfg(unix)]
        return matches!(self.change, Some(crate::held_listing::Change::Vouched(..)));
        #[cfg(not(unix))]
        false
    }
}

/// The listing an update under `config` carries forward, or, when the update
/// that carried it was made against this tree under the same configuration,
/// and the index at `index` is still the chain it was read from, that update's
/// answer, with nothing to do. A chain another writer replaced since is updated
/// as any other, against the tree Watchman vouched for.
#[cfg(unix)]
pub(crate) fn carry(change: &Option<crate::held_listing::Change>, config: &str, index: &str) -> Result<Option<crate::held_listing::Meta>, crate::source_update::Updated> {
    use crate::held_listing::Change;
    match change {
        Some(Change::Vouched(meta, manifest)) if meta.config.as_deref() == Some(config) && std::fs::read(index).is_ok_and(|now| now == *manifest) => {
            Err(crate::source_update::Updated { files: meta.files, reread: 0, parsed: 0, published: false, refused: None, rebuilt: None, written: None })
        }
        Some(Change::Vouched(meta, _) | Change::Listed(meta)) => Ok(Some(meta.clone())),
        None => Ok(None),
    }
}

#[cfg(test)]
#[path = "change_tree_tests.rs"]
mod tests;
