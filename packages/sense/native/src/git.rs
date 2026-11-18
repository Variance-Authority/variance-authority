//! Git's expanded index membership, overlaid with current worktree changes.
//!
//! Git owns index layouts and status. This boundary reads its NUL-delimited
//! byte protocol once for membership and once for changes, then keeps one
//! Snapshot for acquisition. Only changed, untracked and symbolic-link paths
//! ask the worktree for their bytes; clean regular paths keep indexed identities.
//!
//! An incomplete Git answer declines the snapshot so the filesystem can answer.

// compass: variance-authority.reach.source-index

use std::collections::HashMap;
use std::io::Write;
use std::process::{Command, Stdio};

use crate::git::git_porcelain::{configured, porcelain, settings_of, untracked_question};

/// A git object name, unformatted. Twenty bytes rather than forty characters.
pub type Oid = [u8; 20];

pub struct Snapshot {
    pub paths: Vec<String>,
    pub oids: Vec<Oid>,
    /// Whether git says the path is a regular file: committed with a file mode
    /// and unchanged since. A symbolic link is a blob too, and `status` prints
    /// no mode for what it names, so neither is vouched for.
    pub regular: Vec<bool>,
    /// Paths the working tree holds and git gave no digest for. They are not
    /// in `paths`, and a directory holding one is not listed by what `paths`
    /// has in it.
    pub unhashed: Vec<String>,
}

/// Every tracked path under `root`, or nothing when git cannot answer.
///
/// Nothing rather than an error, for the reason `tree.ts` gives: the scanner's
/// own digest is correct and merely slower, and a tool that refused to run
/// outside a repository would be useless in exactly the tarball and sandbox
/// cases it should handle quietly.
pub fn snapshot(root: &str) -> Option<Snapshot> { snapshot_with(root, None) }

/// Overlay the caller's authoritative path set through the ordinary worktree reader.
pub(crate) fn snapshot_with(root: &str, changed: Option<&[String]>) -> Option<Snapshot> {
    let asked = git(root, &["rev-parse", "--show-prefix"], None)?;
    let prefix = trim(&asked);
    let (listing, status) = std::thread::scope(|scope| {
        // `--full-name` fixes spelling; the pathspec separately keeps root scope.
        // Without `--sparse`, Git expands sparse entries and owns split indexes.
        let listing = scope.spawn(|| git(root, &["ls-files", "--stage", "-z", "--full-name", "--", "."], None));
        let status = scope.spawn(|| {
            if let Some(changed) = changed {
                let mut status = Vec::new();
                for path in changed {
                    status.extend_from_slice(b" M ");
                    status.extend_from_slice(prefix);
                    status.extend_from_slice(path.as_bytes());
                    status.push(0);
                }
                return Some(status);
            }
            let listed = configured(root);
            // Preserve the repository's fsmonitor and untracked-cache choices.
            // A reader never refreshes the index or takes the user's index.lock.
            let mut args = vec!["--no-optional-locks", "status", "--porcelain=v1", "-z"];
            args.extend(untracked_question(prefix, settings_of(&listed)));
            git(root, &args, None)
        });
        (listing.join().ok().flatten(), status.join().ok().flatten())
    });
    let (listed, links) = inventory(&listing?, prefix)?;
    let (moved, unhashed) = overlay(root, prefix, &status?, &links)?;
    let unhashed = unhashed.iter().map(|path| String::from_utf8_lossy(path).into_owned()).collect();
    let mut unvouched = links;
    unvouched.extend(moved.keys().cloned());
    let held = if moved.is_empty() {
        listed
    } else {
        let kept: Vec<(Vec<u8>, Oid)> = listed.into_iter().filter(|(path, _)| !moved.contains_key(path)).collect();
        let mut added: Vec<(Vec<u8>, Oid)> = moved.into_iter().filter_map(|(path, oid)| oid.map(|oid| (path, oid))).collect();
        added.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        merge(kept, added)
    };

    let mut by_path: Vec<(String, Oid, bool)> = held
        .into_iter()
        .map(|(path, oid)| {
            let regular = !unvouched.contains(&path);
            (String::from_utf8_lossy(&path).into_owned(), oid, regular)
        })
        .collect();
    // Byte order and code unit order part only past U+E000, and a name git could
    // not spell as UTF-8 is respelled above; either way this is checked, not assumed.
    if !by_path.is_sorted_by(|a, b| crate::order::code_unit(&a.0, &b.0).is_le()) {
        by_path.sort_unstable_by(|a, b| crate::order::code_unit(&a.0, &b.0));
    }

    let mut paths: Vec<String> = Vec::with_capacity(by_path.len());
    let mut oids = Vec::with_capacity(by_path.len());
    let mut regular = Vec::with_capacity(by_path.len());
    for (path, oid, vouched) in by_path {
        paths.push(path);
        oids.push(oid);
        regular.push(vouched);
    }

    Some(Snapshot { paths, oids, regular, unhashed })
}

/// Stage-zero file identities, in Git's path order, and the symbolic links.
/// Conflicted stages are not worktree identities; porcelain supplies their bytes.
fn inventory(listing: &[u8], prefix: &[u8]) -> Option<(Vec<(Vec<u8>, Oid)>, std::collections::HashSet<Vec<u8>>)> {
    let mut listed = Vec::with_capacity(listing.len() / 96);
    let mut links = std::collections::HashSet::new();
    if listing.is_empty() {
        return Some((listed, links));
    }
    // A truncated final record must not turn a partial inventory into success.
    for entry in listing.strip_suffix(&[0])?.split(|byte| *byte == 0) {
        let tab = entry.iter().position(|byte| *byte == b'\t')?;
        let mut fields = entry[..tab].split(|byte| *byte == b' ');
        let (mode, oid, stage) = (fields.next()?, parse_oid(fields.next()?)?, fields.next()?);
        if fields.next().is_some() || !matches!(mode, b"100644" | b"100755" | b"120000" | b"160000") || !matches!(stage, b"0" | b"1" | b"2" | b"3") {
            return None;
        }
        if stage != b"0" || mode == b"160000" {
            continue;
        }
        let relative = entry[tab + 1..].strip_prefix(prefix)?;
        if relative.is_empty() {
            return None;
        }
        if mode == b"120000" {
            links.insert(relative.to_vec());
        }
        listed.push((relative.to_vec(), oid));
    }
    Some((listed, links))
}

/// What the working tree says instead of the committed listing, path by path:
/// `Some` is a digest for the bytes on disk, and `None` a path not there to name
/// — deleted, renamed away, or unreadable.
pub(crate) type Moved = HashMap<Vec<u8>, Option<Oid>>;

/// Every path the working tree disagrees about, with the ones it holds that
/// hashed nothing, or `None` when git did not answer and every committed digest
/// is withdrawn with it.
///
/// Porcelain status spells every path from the top of the checkout, wherever it
/// runs, and ignores `status.relativePaths`. So each path loses `prefix` here,
/// the scan root's place in the checkout, to match the listing's names, and a
/// path beside the root is dropped: a rename across the root is a deletion or
/// an addition on the root's side.
///
/// Failure removes the disagreeing paths rather than leaving them: a stale
/// digest on an edited file is a subject nobody observes, and no digest at all
/// is a file the scan hashes for itself.
fn overlay(root: &str, prefix: &[u8], status: &[u8], links: &std::collections::HashSet<Vec<u8>>) -> Option<(Moved, Vec<Vec<u8>>)> {
    let (mut moved, mut dirty) = porcelain(root, prefix, status)?;

    // A link's object is the path it holds, not the bytes behind it, so a link is named as an edited file is.
    let unlisted: Vec<Vec<u8>> = links.iter().filter(|link| !moved.contains_key(*link) && !dirty.contains(link)).cloned().collect();
    dirty.extend(unlisted);
    if dirty.is_empty() {
        return Some((moved, Vec::new()));
    }

    // Hashed nothing: the path is not a file, or it is unreadable or vanished
    // between the two calls. Withdrawing the entry hands the question back to
    // the scan rather than answering it with a digest for contents nobody saw.
    for path in &dirty {
        moved.insert(path.clone(), None);
    }
    // Only files go to `hash-object`. A submodule `status` names without a
    // trailing slash, or a link to a directory or to nothing, fails the batch,
    // and a failed batch withdraws every edited file's digest with its own.
    let files: Vec<&[u8]> = dirty.iter().map(Vec::as_slice).filter(|path| is_file(root, path)).collect();
    for (path, oid) in hash_on_disk(root, prefix, &files) {
        moved.insert(path, Some(oid));
    }
    // A named path the disk does not hold is gone, not unread: a conflict's
    // surviving side removed by hand, or a deleted path a caller named changed.
    let unhashed = dirty.into_iter().filter(|path| moved.get(path).is_some_and(Option::is_none) && exists(root, path)).collect();

    Some((moved, unhashed))
}

/// Two lists in byte order, as one.
fn merge(left: Vec<(Vec<u8>, Oid)>, right: Vec<(Vec<u8>, Oid)>) -> Vec<(Vec<u8>, Oid)> {
    let mut out = Vec::with_capacity(left.len() + right.len());
    let (mut left, mut right) = (left.into_iter().peekable(), right.into_iter().peekable());
    loop {
        let take_left = match (left.peek(), right.peek()) {
            (Some(l), Some(r)) => l.0 <= r.0,
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => return out,
        };
        out.extend(if take_left { left.next() } else { right.next() });
    }
}

/// Whether `path` is a file on disk, following a link as `hash-object` does.
///
/// Asked of the disk because the disk is what `hash-object` reads: a gitlink's
/// or a link's entry in `status` does not say what it points at now.
fn is_file(root: &str, path: &[u8]) -> bool {
    #[cfg(unix)]
    let path = std::path::Path::new(<std::ffi::OsStr as std::os::unix::ffi::OsStrExt>::from_bytes(path));
    #[cfg(not(unix))]
    let Ok(path) = std::str::from_utf8(path).map(std::path::Path::new) else {
        return false;
    };
    std::fs::metadata(std::path::Path::new(root).join(path)).is_ok_and(|meta| meta.is_file())
}

/// Whether the disk holds anything at `path`, a dangling link included.
fn exists(root: &str, path: &[u8]) -> bool {
    #[cfg(unix)]
    let path = std::path::Path::new(<std::ffi::OsStr as std::os::unix::ffi::OsStrExt>::from_bytes(path));
    #[cfg(not(unix))]
    let Ok(path) = std::str::from_utf8(path).map(std::path::Path::new) else {
        return true;
    };
    std::fs::symlink_metadata(std::path::Path::new(root).join(path)).is_ok()
}

/// Blob digests for the bytes currently on disk.
///
/// The paths come back in the order they went in, which is the only thing
/// pairing them — `hash-object` prints digests and nothing else. A short answer
/// means git stopped early, on a path that went away or could not be opened
/// after `is_file` saw it, and pairing the survivors by position would attach
/// one file's digest to another's name; the whole batch is discarded instead.
///
/// `hash-object --stdin-paths` reads each path from the top of the checkout,
/// wherever it runs, so each goes in behind `prefix` and comes back without it.
/// Spelled from the top rather than absolute, a path matches `.gitattributes`
/// as it would from a scan at the top.
fn hash_on_disk(root: &str, prefix: &[u8], paths: &[&[u8]]) -> Vec<(Vec<u8>, Oid)> {
    if paths.is_empty() {
        return Vec::new();
    }
    let mut stdin = Vec::with_capacity(paths.iter().map(|path| prefix.len() + path.len() + 1).sum());
    for path in paths {
        stdin.extend_from_slice(prefix);
        stdin.extend_from_slice(path);
        stdin.push(b'\n');
    }

    let Some(out) = git(root, &["hash-object", "--stdin-paths"], Some(stdin)) else {
        return Vec::new();
    };

    let lines: Vec<&[u8]> = out
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .collect();
    if lines.len() != paths.len() {
        return Vec::new();
    }

    lines
        .iter()
        .zip(paths)
        .filter_map(|(line, path)| parse_oid(trim(line)).map(|oid| (path.to_vec(), oid)))
        .collect()
}

fn trim(line: &[u8]) -> &[u8] {
    let mut end = line.len();
    while end > 0 && line[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    &line[..end]
}

pub(crate) fn parse_oid(hex: &[u8]) -> Option<Oid> {
    if hex.len() != 40 {
        return None;
    }
    let mut oid = [0u8; 20];
    for (at, byte) in oid.iter_mut().enumerate() {
        *byte = (nibble(hex[at * 2])? << 4) | nibble(hex[at * 2 + 1])?;
    }
    Some(oid)
}

fn nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// A git object name as this project spells a digest.
///
/// Prefixed, because this repository's own digests are `v1:` and the two schemes
/// must never be compared as though they were one.
pub fn spell(oid: &Oid) -> String {
    let mut out = String::with_capacity(44);
    out.push_str("git:");
    for byte in oid {
        out.push(HEX[(byte >> 4) as usize]);
        out.push(HEX[(byte & 0x0f) as usize]);
    }
    out
}

/// A raw object name for `cat-file --batch`.
pub fn hex(oid: &Oid) -> String {
    spell(oid)[4..].to_owned()
}

const HEX: [char; 16] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f',
];

/// Run git in `root`, with an optional stdin, returning its stdout bytes.
///
/// Identity is never inherited into the child beyond what the environment
/// already holds: these are read-only queries and write no objects.
pub(crate) fn git(root: &str, args: &[&str], stdin: Option<Vec<u8>>) -> Option<Vec<u8>> {
    answer(root, args, stdin).ok()
}

/// [`git`], or why git did not answer: what it wrote to stderr, or how it
/// ended when it wrote nothing. For a caller whose answer is wrong without
/// git's, which then fails with git's own reason rather than a softer answer.
pub(crate) fn answer(root: &str, args: &[&str], stdin: Option<Vec<u8>>) -> Result<Vec<u8>, String> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });

    let mut child = command.spawn().map_err(|error| format!("git did not start: {error}"))?;

    if let Some(bytes) = stdin {
        // On its own thread: a list of two hundred thousand paths is larger than
        // a pipe buffer, and writing it from here while git waits for us to read
        // its output is a deadlock rather than a slow call.
        let mut pipe = child.stdin.take().ok_or("git took no input")?;
        std::thread::spawn(move || {
            let _ = pipe.write_all(&bytes);
        });
    }

    let output = child.wait_with_output().map_err(|error| format!("git did not finish: {error}"))?;
    if !output.status.success() {
        let said = String::from_utf8_lossy(&output.stderr);
        let said = said.trim();
        return Err(if said.is_empty() { format!("git {} ended with {}", args.join(" "), output.status) } else { said.to_owned() });
    }

    Ok(output.stdout)
}

// The Git status question and its byte protocol.
#[path = "git_porcelain.rs"]
pub(crate) mod git_porcelain;

#[cfg(all(test, unix))]
#[path = "git_tests.rs"]
mod tests;

#[cfg(all(test, unix))]
#[path = "git_inventory_tests.rs"]
mod inventory_tests;
