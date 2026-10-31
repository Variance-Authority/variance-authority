//! The tree an update is made against, and what it carries forward: the one
//! the index holds when Watchman vouches nothing moved since it was listed,
//! else git's (spec 0107, `held_listing.rs`).

// compass: variance-authority.reach.source-index

use napi_derive::napi;

use crate::GitTree;

/// The tree an update of the index at `index` is made against.
#[napi(catch_unwind)]
pub fn change_tree(root: String, index: String, dirs: Vec<String>) -> Option<GitTree> {
    #[cfg(unix)]
    {
        let (snapshot, change) = crate::held_listing::change_tree(&root, &index, &dirs)?;
        let seeds = crate::seed::seed_paths(&root, &dirs, &snapshot.paths);
        let mut tree = crate::tree_from_snapshot(snapshot, seeds);
        tree.change = change;
        Some(tree)
    }
    #[cfg(not(unix))]
    {
        let _ = index;
        crate::git_tree_for(root, dirs)
    }
}

#[napi]
impl GitTree {
    /// Watchman vouched for the listing the index held, and git listed nothing.
    #[napi(getter)]
    pub fn vouched(&self) -> bool {
        #[cfg(unix)]
        return matches!(self.change, Some(crate::held_listing::Change::Vouched(_)));
        #[cfg(not(unix))]
        false
    }
}

/// The listing an update under `config` carries forward, or, when the update
/// that carried it was made against this tree under the same configuration,
/// that update's answer, with nothing to do.
#[cfg(unix)]
pub(crate) fn carry(change: &Option<crate::held_listing::Change>, config: &str) -> Result<Option<crate::held_listing::Meta>, crate::source_update::Updated> {
    use crate::held_listing::Change;
    match change {
        Some(Change::Vouched(meta)) if meta.config.as_deref() == Some(config) => {
            Err(crate::source_update::Updated { files: meta.files, reread: 0, published: false, refused: None })
        }
        Some(Change::Vouched(meta) | Change::Listed(meta)) => Ok(Some(meta.clone())),
        None => Ok(None),
    }
}
