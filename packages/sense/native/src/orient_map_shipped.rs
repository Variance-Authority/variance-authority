//! The files the code map read as shipped, kept beside it.
//!
//! The fold decides which counted files are on the tests' side (`tests` in
//! `orient_map_read.rs`); every other counted file is one its package ships.
//! A relation rule about what a package offers seeds from these files, so the
//! split is written down once, where it is made, and read back rather than
//! decided a second time by a path pattern. It is a file of its own because
//! the map's pages are read a page at a time and this list is read whole.

// compass: variance-authority.reach.relations

use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Stored {
    /// sha256 of the index manifest the list was read from.
    index: String,
    files: Vec<String>,
}

/// The index digest alone, read without the list.
#[derive(Deserialize)]
struct Kept {
    index: String,
}

fn shipped_path(index: &str) -> String {
    format!("{index}.shipped")
}

/// Whether the list kept beside the index at `index` was read from the index
/// whose manifest digest is `digest`.
pub(crate) fn kept(index: &str, digest: &str) -> bool {
    std::fs::read(shipped_path(index))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Kept>(&bytes).ok())
        .is_some_and(|kept| kept.index == digest)
}

/// Write `files` beside the index at `index`, replacing what was there in one rename.
pub(crate) fn write(index: &str, digest: &str, files: &[String]) -> Result<(), String> {
    let path = shipped_path(index);
    let stored = Stored { index: digest.to_owned(), files: files.to_vec() };
    let text = serde_json::to_vec(&stored).map_err(|error| error.to_string())?;
    let written = format!("{path}.{}", std::process::id());
    std::fs::write(&written, text)
        .and_then(|()| std::fs::rename(&written, &path))
        .map_err(|error| format!("{path} was not written: {error}"))
}

#[napi(object)]
pub struct OrientShipped {
    /// Whether the list was read from the index as it stands now.
    pub current: bool,
    /// Every counted file not on the tests' side, in code-unit order.
    pub files: Vec<String>,
}

/// The shipped files kept beside the index at `index`. `undefined` when no
/// list is kept there.
#[napi(catch_unwind)]
pub fn orient_shipped(index: String) -> napi::Result<Option<OrientShipped>> {
    let path = shipped_path(&index);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(napi::Error::from_reason(format!("{path} did not read: {error}"))),
    };
    let stored: Stored =
        serde_json::from_slice(&bytes).map_err(|error| napi::Error::from_reason(format!("{path} did not read: {error}")))?;
    let current = crate::orient_map::manifest_digest(&index).as_deref() == Some(stored.index.as_str());
    Ok(Some(OrientShipped { current, files: stored.files }))
}
