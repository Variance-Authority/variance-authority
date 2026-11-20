//! File identity shared by carried listings and snapshots of a changing index.
// compass: variance-authority.reach.source-index

use std::path::Path;
use serde::{Deserialize, Serialize};

/// What a file looked like when the listing was taken; `None` is a file not there.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Stamp {
    size: u64,
    modified: i64,
    nanos: i64,
    changed: i64,
    inode: u64,
}

pub(crate) fn stamp(path: &Path) -> Option<Stamp> {
    let metadata = std::fs::metadata(path).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(Stamp { size: metadata.size(), modified: metadata.mtime(), nanos: metadata.mtime_nsec(), changed: metadata.ctime_nsec() + metadata.ctime() * 1_000_000_000, inode: metadata.ino() })
    }
    #[cfg(not(unix))]
    {
        let modified = metadata.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
        let created = metadata.created().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
        Some(Stamp { size: metadata.len(), modified: modified.as_secs() as i64, nanos: modified.subsec_nanos() as i64, changed: created.as_secs() as i64, inode: created.subsec_nanos() as u64 })
    }
}

