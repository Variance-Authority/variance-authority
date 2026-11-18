//! Every tracked path under a root, with the digest of the bytes on disk.
//!
//! The same three questions `tree.ts` asks git, asked from here: the committed
//! blob of every path, read from the object store; everything the working tree
//! disagrees about, compared in-process by `worktree_status`; and the bytes those
//! paths actually hold. `ls-tree` and `status` answer only where the in-process
//! readers hand the question back.
//! The overlay rules are that file's and are reproduced exactly — a digest may
//! cause work to be skipped only when it names the bytes being scanned, and a
//! stale digest on an edited file is the one unforgivable error.
//!
//! What moves is where the output lands. A repository of four hundred thousand
//! paths is a hundred and eighty megabytes of NUL-delimited text; decoded into
//! JavaScript it is four hundred thousand strings and a `Map` to hold them,
//! before a single file has been read. Parsed here it is one `Vec` of paths and
//! one of twenty-byte object names, and the boundary carries the answers a
//! caller actually asks for.

use std::collections::HashMap;
use std::io::Write;
use std::process::{Command, Stdio};

use crate::git::git_porcelain::{configured, porcelain, settings_of, untracked_question};
use crate::stages::{part, summed, Sum};

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
pub fn snapshot(root: &str) -> Option<Snapshot> {
    snapshot_of(root, true)
}

/// `snapshot`, with the working tree compared in-process only when `compared`
/// asks for it: the tests hold the two answers side by side.
fn snapshot_of(root: &str, compared: bool) -> Option<Snapshot> {
    // One call names the root's place and `HEAD`'s tree, and the object store
    // lists the tree in-process; `ls-tree` answers where it will not, as under a
    // replace ref or on an unborn branch.
    let head = summed(Sum::Head, || crate::git_store::head(std::path::Path::new(root)));
    let asked = match &head {
        Some(head) => head.prefix.clone().into_bytes(),
        None => trim(&git(root, &["rev-parse", "--show-prefix"], None)?).to_vec(),
    };
    let prefix = asked.as_slice();
    let status = |listed: &[u8]| {
        let mut args = vec!["--no-optional-locks", "status", "--porcelain=v1", "-z"];
        args.extend(untracked_question(prefix, settings_of(listed)));
        summed(Sum::GitStatus, || git(root, &args, None))
    };
    // The working tree is walked while `HEAD`'s tree is listed: the walk needs
    // only the index, and the listing is what it is compared with after.
    let (listing, (listed, walked)) = std::thread::scope(|scope| {
        // `core.fsmonitor` and `core.untrackedCache` are left to the repository,
        // for the reason `working-tree-changes.ts` gives: they are what make this
        // call cheap, and overriding either way spends a user's configuration on
        // their behalf. The shape of the question is `untracked_question`'s.
        // A reader never writes the index: its refresh would race the user's
        // own git for `index.lock`, and move the stamp a held listing stands on.
        // `git status` answers where `worktree_status` hands the question back.
        let walk = scope.spawn(|| {
            let worktree = part(Sum::Worktree);
            let listed = configured(root);
            // A walk that panics on an odd working tree hands the question to
            // `git status`, as one that declines does.
            let walked = match (compared, &head) {
                (true, Some(head)) => std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    crate::git::worktree_status::walk(head, &crate::git::worktree_status::config_of(&listed))
                }))
                .ok()
                .flatten(),
                _ => None,
            };
            worktree.end();
            let walked = walked.ok_or_else(|| status(&listed));
            (listed, walked)
        });
        let listing = match summed(Sum::Tree, || head.as_ref().and_then(|head| head.blobs())) {
            Some(blobs) => Some(Listing::Held(blobs)),
            None => summed(Sum::LsTree, || git(root, &["ls-tree", "-r", "-z", "HEAD", "--", "."], None)).map(Listing::Printed),
        };
        (listing, walk.join().expect("the walk does not panic"))
    });
    // The index and `HEAD`'s blobs, both held, are compared in-process; a tree
    // the store will not list is `git status`'s to compare.
    let status = match (walked, &listing) {
        (Ok(walked), Some(Listing::Held(blobs))) => Some(Status::Known(summed(Sum::Compare, || walked.against(blobs)))),
        (Ok(_), _) => status(&listed).map(Status::Printed),
        (Err(printed), _) => printed.map(Status::Printed),
    };
    // A repository with no commit yet has no tree to list, and that is an empty
    // listing rather than an unanswerable one: `status` names every file as
    // added or untracked, and the overlay hashes each of them from disk.
    let listing = match listing {
        Some(listing) => listing,
        None if unborn(root) => Listing::Printed(Vec::new()),
        None => return None,
    };

    // Kept in the order `ls-tree` prints it, which is byte order over the whole
    // path: a map here would scatter it, and putting it back cost more than
    // reading it did. The overlay is the part that moves, and it is small.
    let mut listed: Vec<(Vec<u8>, Oid)> = Vec::new();
    let mut links: std::collections::HashSet<Vec<u8>> = std::collections::HashSet::new();
    match listing {
        Listing::Held(blobs) => {
            let _tree = part(Sum::Tree);
            listed.reserve(blobs.len());
            for (path, id, link) in blobs {
                if link {
                    links.insert(path.clone());
                }
                let mut oid = [0u8; 20];
                oid.copy_from_slice(id.as_bytes());
                listed.push((path, oid));
            }
        }
        Listing::Printed(listing) => {
            let _ls_tree = part(Sum::LsTree);
            listed.reserve(listing.len() / 96);
            for entry in listing.split(|byte| *byte == 0) {
                // `<mode> <type> <object>\t<path>`, and only blobs are files.
                let Some(tab) = entry.iter().position(|byte| *byte == b'\t') else {
                    continue;
                };
                let (head, path) = entry.split_at(tab);
                let mut fields = head.split(|byte| *byte == b' ');
                let (mode, kind, object) = (fields.next(), fields.next(), fields.next());
                if kind != Some(b"blob".as_slice()) {
                    continue;
                }
                let Some(oid) = object.and_then(parse_oid) else {
                    continue;
                };
                let path = &path[1..];
                let relative = path.strip_prefix(prefix).unwrap_or(path);
                if mode == Some(b"120000".as_slice()) {
                    links.insert(relative.to_vec());
                }
                listed.push((relative.to_vec(), oid));
            }
        }
    }

    let (moved, unhashed) = match summed(Sum::Overlay, || overlay(root, prefix, status, &links)) {
        Some((moved, unhashed)) => (Some(moved), unhashed),
        None => (None, Vec::new()),
    };
    let _merge = part(Sum::Merge);
    let unhashed = unhashed.iter().map(|path| String::from_utf8_lossy(path).into_owned()).collect();
    let mut unvouched = links;
    unvouched.extend(moved.iter().flat_map(|moved| moved.keys().cloned()));
    let held = match moved {
        None => Vec::new(),
        Some(moved) if moved.is_empty() => listed,
        Some(moved) => {
            let kept: Vec<(Vec<u8>, Oid)> = listed.into_iter().filter(|(path, _)| !moved.contains_key(path)).collect();
            let mut added: Vec<(Vec<u8>, Oid)> = moved.into_iter().filter_map(|(path, oid)| oid.map(|oid| (path, oid))).collect();
            added.sort_unstable_by(|a, b| a.0.cmp(&b.0));
            merge(kept, added)
        }
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

/// What the working tree says instead of `HEAD`: compared in-process, or printed by `status`.
enum Status {
    Known(crate::git::worktree_status::Changes),
    Printed(Vec<u8>),
}

/// What `HEAD` holds below the root: read from the object store, or printed by `ls-tree`.
enum Listing {
    Held(Vec<(Vec<u8>, gix_hash::ObjectId, bool)>),
    Printed(Vec<u8>),
}

/// Whether `HEAD` names a branch nobody has committed to yet.
///
/// Asked only after `ls-tree` has failed, so a checkout with history never pays
/// for it. `--show-prefix` has already succeeded by then, so this is a
/// repository; `--verify` failing on it means `HEAD` resolves to no commit.
fn unborn(root: &str) -> bool {
    git(root, &["rev-parse", "--quiet", "--verify", "HEAD"], None).is_none()
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
fn overlay(root: &str, prefix: &[u8], status: Option<Status>, links: &std::collections::HashSet<Vec<u8>>) -> Option<(Moved, Vec<Vec<u8>>)> {
    let (mut moved, mut dirty) = match status? {
        Status::Known(changes) => (changes.gone.into_iter().map(|path| (path, None)).collect(), changes.dirty),
        Status::Printed(printed) => porcelain(root, prefix, &printed)?,
    };

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
    let unhashed = dirty.into_iter().filter(|path| moved.get(path).is_some_and(Option::is_none)).collect();

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

    let Some(out) = summed(Sum::HashObject, || git(root, &["hash-object", "--stdin-paths"], Some(stdin))) else {
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

// What `status` asks git, and the comparison that answers in its place.
#[path = "git_porcelain.rs"]
pub(crate) mod git_porcelain;
#[path = "worktree_status.rs"]
pub(crate) mod worktree_status;
#[path = "worktree_untracked.rs"]
pub(crate) mod worktree_untracked;

#[cfg(all(test, unix))]
#[path = "git_tests.rs"]
mod tests;
