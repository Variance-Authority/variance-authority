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
//! So a reader asks first with `GIT_NO_LAZY_FETCH=1`, which answers what is
//! here and says `missing` for the rest without fetching, and hands the missing
//! ones here. The fetch is the one git makes for its own batched prefetch. The
//! reader then asks again for what was missing, with lazy fetching left as the
//! repository has it: a fetch that failed costs the old one request per object,
//! never a text read as absent.
//!
//! A clone with no promisor remote pays nothing: its first read answers
//! everything it holds, and an object it does not hold is absent.

use napi_derive::napi;

use crate::git::git;

/// Paths one `ls-tree` is handed, so the command line stays well under the
/// operating system's argument limit whatever the paths are.
const PATHS_PER_LISTING: usize = 512;

/// Fetch `oids` from the remote that promised them, in one request.
///
/// `false` when no remote did: the repository is not a partial clone, so an
/// object it does not hold is absent and asking again answers nothing new.
/// `true` otherwise, whether or not the fetch succeeded — the caller reads
/// again either way, and a read after a failed fetch fetches lazily.
pub(crate) fn fetch_missing(root: &str, oids: &[String]) -> bool {
    let Some(remote) = remote(root) else {
        return false;
    };
    if oids.is_empty() {
        return true;
    }
    let stdin: String = oids.iter().map(|oid| format!("{oid}\n")).collect();
    let args = [
        "-c",
        "fetch.negotiationAlgorithm=noop",
        "fetch",
        &remote,
        "--no-tags",
        "--no-write-fetch-head",
        "--recurse-submodules=no",
        "--filter=blob:none",
        "--stdin",
    ];
    let _ = git(root, &args, Some(stdin.into_bytes()));
    true
}

/// [`fetch_missing`] for paths at a commit, spelled from the top of the
/// repository as `<commit>:<path>` spells them.
///
/// For a reader holding paths rather than object names: the trees name each
/// path's blob, and a partial clone holds the trees. A path the commit does
/// not hold names no blob and is left out.
#[napi(catch_unwind)]
pub fn fetch_missing_at(root: String, commit: String, paths: Vec<String>) -> bool {
    if remote(&root).is_none() {
        return false;
    }
    let mut oids = Vec::new();
    for chunk in paths.chunks(PATHS_PER_LISTING) {
        let mut args = vec!["--literal-pathspecs", "ls-tree", "-z", "--full-tree", commit.as_str(), "--"];
        args.extend(chunk.iter().map(String::as_str));
        let Some(listed) = git(&root, &args, None) else {
            continue;
        };
        // `<mode> <type> <object>\t<path>`, and only a blob is a text.
        for entry in listed.split(|byte| *byte == 0) {
            let head = entry.split(|byte| *byte == b'\t').next().unwrap_or_default();
            let mut fields = head.split(|byte| *byte == b' ').skip(1);
            if fields.next() == Some(b"blob".as_slice()) {
                oids.extend(fields.next().map(|oid| String::from_utf8_lossy(oid).into_owned()));
            }
        }
    }
    fetch_missing(&root, &oids)
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
