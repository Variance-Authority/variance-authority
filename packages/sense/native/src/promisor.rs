//! Objects a partial clone has not fetched yet, fetched in one request.
//!
//! A clone made with `--filter` holds the commits and trees it was given and
//! only the blobs its checkout needed; the rest stay with the remote that
//! promised them, and git fetches one when something reads it. `git diff`
//! fetches the blobs it is about to compare together, before comparing them.
//! `cat-file --batch` does not: every object it is asked for and lacks is a
//! request of its own. On a blobless clone of Material UI from GitHub, fifteen
//! such reads took 9.0 s; one request for the same fifteen took 0.7 s, and the
//! reads after it 0.03 s.
//!
//! So a reader hands here every blob it is about to read, and then reads
//! them with lazy fetching left as the repository has it. The fetch is the one
//! git makes for its own batched prefetch. A fetch that failed costs the old
//! one request per object, never a text read as absent.
//!
//! The reader does not ask first with `GIT_NO_LAZY_FETCH=1`: git 2.43, the one
//! Ubuntu 24.04 ships, stops at the first object that variable forbids, warning
//! "lazy fetching disabled" and exiting 128 with "could not fetch ... from
//! promisor remote", rather than answering it `missing`.
//!
//! A clone with no promisor remote pays nothing: there is no remote to ask, and
//! an object it does not hold is not in the repository.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::git::git;

/// Whether `root` is a partial clone. Settled when it was cloned, so asked once
/// per checkout rather than once per read.
pub(crate) fn partial(root: &str) -> bool {
    promised(root).is_some()
}

/// Fetch `oids` from the remote that promised them, in one request, or git's
/// reason for not fetching them. Nothing to do outside a partial clone.
pub(crate) fn fetch(root: &str, oids: &[String]) -> Result<(), String> {
    match promised(root) {
        Some(remote) => fetch_from(root, &remote, oids),
        None => Ok(()),
    }
}

/// [`remote`], asked once per checkout.
fn promised(root: &str) -> Option<String> {
    static ASKED: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let asked = ASKED.get_or_init(Mutex::default);
    if let Some(known) = asked.lock().ok().and_then(|held| held.get(root).cloned()) {
        return known;
    }
    let known = remote(root);
    if let Ok(mut held) = asked.lock() {
        held.insert(root.to_owned(), known.clone());
    }
    known
}

fn fetch_from(root: &str, remote: &str, oids: &[String]) -> Result<(), String> {
    if oids.is_empty() {
        return Ok(());
    }
    let stdin: String = oids.iter().map(|oid| format!("{oid}\n")).collect();
    let args = [
        "-c",
        "fetch.negotiationAlgorithm=noop",
        "fetch",
        remote,
        "--no-tags",
        "--no-write-fetch-head",
        "--recurse-submodules=no",
        "--filter=blob:none",
        "--stdin",
    ];
    crate::git::answer(root, &args, Some(stdin.into_bytes())).map(drop)
}

/// The remote a partial clone fetches what it lacks from, as git chooses it:
/// the one `extensions.partialClone` names, then each `remote.<name>.promisor`
/// in the order the configuration lists them.
fn remote(root: &str) -> Option<String> {
    let listed = git(root, &["config", "--get-regexp", r"^(extensions\.partialclone|remote\..*\.promisor)$"], None)?;
    let listed = String::from_utf8_lossy(&listed);
    let mut promised = None;
    for line in listed.lines() {
        let (key, value) = line.split_once(' ').unwrap_or((line, "true"));
        if key == "extensions.partialclone" && !value.is_empty() {
            return Some(value.to_owned());
        }
        let name = key.strip_prefix("remote.").and_then(|key| key.strip_suffix(".promisor"));
        if promised.is_none() && name.is_some() && truthy(value) {
            promised = name.map(str::to_owned);
        }
    }
    promised
}

/// A configuration boolean as git reads one.
fn truthy(value: &str) -> bool {
    matches!(value.to_ascii_lowercase().as_str(), "true" | "yes" | "on" | "1")
}
