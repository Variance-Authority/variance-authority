//! Every tracked path under a root, with the digest of the bytes on disk.
//!
//! The same three questions `tree.ts` asks git, asked from here: `ls-tree` for
//! the committed blob of every path, `status` for everything the working tree
//! disagrees about, and `hash-object` for the bytes those paths actually hold.
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

/// A git object name, unformatted. Twenty bytes rather than forty characters.
pub type Oid = [u8; 20];

pub struct Snapshot {
    pub paths: Vec<String>,
    pub oids: Vec<Oid>,
}

/// Every tracked path under `root`, or nothing when git cannot answer.
///
/// Nothing rather than an error, for the reason `tree.ts` gives: the scanner's
/// own digest is correct and merely slower, and a tool that refused to run
/// outside a repository would be useless in exactly the tarball and sandbox
/// cases it should handle quietly.
pub fn snapshot(root: &str) -> Option<Snapshot> {
    let prefix = git(root, &["rev-parse", "--show-prefix"], None)?;
    let prefix = trim(&prefix);
    let (listing, status) = std::thread::scope(|scope| {
        let listing = scope.spawn(|| git(root, &["ls-tree", "-r", "-z", "HEAD", "--", "."], None));
        // `core.fsmonitor` and `core.untrackedCache` are left to the repository,
        // for the reason `tree.ts` gives: they are what make this call cheap, and
        // overriding either way spends a user's configuration on their behalf.
        // At the top of the checkout the question is also asked in the one shape
        // git's untracked cache answers, for the reason `tree.ts` gives.
        let status = scope.spawn(|| {
            if prefix.is_empty() {
                git(root, &["status", "--porcelain=v1", "-z", "--untracked-files=normal"], None)
            } else {
                git(
                    root,
                    &[
                        "-c",
                        "status.relativePaths=true",
                        "status",
                        "--porcelain=v1",
                        "-z",
                        "--untracked-files=all",
                        "--",
                        ".",
                    ],
                    None,
                )
            }
        });
        (listing.join().ok().flatten(), status.join().ok().flatten())
    });
    // A repository with no commit yet has no tree to list, and that is an empty
    // listing rather than an unanswerable one: `status` names every file as
    // added or untracked, and the overlay hashes each of them from disk.
    let listing = match listing {
        Some(listing) => listing,
        None if unborn(root) => Vec::new(),
        None => return None,
    };

    // Kept in the order `ls-tree` prints it, which is byte order over the whole
    // path: a map here would scatter it, and putting it back cost more than
    // reading it did. The overlay is the part that moves, and it is small.
    let mut listed: Vec<(Vec<u8>, Oid)> = Vec::with_capacity(listing.len() / 96);
    for entry in listing.split(|byte| *byte == 0) {
        // `<mode> <type> <object>\t<path>`, and only blobs are files.
        let Some(tab) = entry.iter().position(|byte| *byte == b'\t') else {
            continue;
        };
        let (head, path) = entry.split_at(tab);
        let mut fields = head.split(|byte| *byte == b' ');
        let (_mode, kind, object) = (fields.next(), fields.next(), fields.next());
        if kind != Some(b"blob".as_slice()) {
            continue;
        }
        let Some(oid) = object.and_then(parse_oid) else {
            continue;
        };
        let path = &path[1..];
        let relative = path.strip_prefix(prefix).unwrap_or(path);
        listed.push((relative.to_vec(), oid));
    }

    let moved = overlay(root, status);
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

    let mut by_path: Vec<(String, Oid)> = held
        .into_iter()
        .map(|(path, oid)| (String::from_utf8_lossy(&path).into_owned(), oid))
        .collect();
    // Byte order and code unit order part only past U+E000, and a name git could
    // not spell as UTF-8 is respelled above; either way this is checked, not assumed.
    if !by_path.is_sorted_by(|a, b| crate::order::code_unit(&a.0, &b.0).is_le()) {
        by_path.sort_unstable_by(|a, b| crate::order::code_unit(&a.0, &b.0));
    }

    let mut paths: Vec<String> = Vec::with_capacity(by_path.len());
    let mut oids = Vec::with_capacity(by_path.len());
    for (path, oid) in by_path {
        paths.push(path);
        oids.push(oid);
    }

    Some(Snapshot { paths, oids })
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
type Moved = HashMap<Vec<u8>, Option<Oid>>;

/// Every path the working tree disagrees about, or `None` when git did not
/// answer and every committed digest is withdrawn with it.
///
/// Failure removes the disagreeing paths rather than leaving them: a stale
/// digest on an edited file is a subject nobody observes, and no digest at all
/// is a file the scan hashes for itself.
fn overlay(root: &str, status: Option<Vec<u8>>) -> Option<Moved> {
    let status = status?;

    let fields: Vec<&[u8]> = status.split(|byte| *byte == 0).collect();
    let mut moved: Moved = HashMap::new();
    let mut dirty: Vec<Vec<u8>> = Vec::new();
    let mut collapsed: Vec<&[u8]> = Vec::new();

    let mut at = 0;
    while at < fields.len() {
        let entry = fields[at];
        at += 1;
        if entry.len() < 4 {
            continue;
        }

        let codes = &entry[..2];
        let path = &entry[3..];

        // A rename carries its old path as the next field, and that path is gone.
        if codes.contains(&b'R') {
            if let Some(from) = fields.get(at) {
                moved.insert(from.to_vec(), None);
            }
            at += 1;
        }

        if codes.contains(&b'D') {
            moved.insert(path.to_vec(), None);
        } else if path.ends_with(b"/") {
            // A directory git did not descend: untracked, collapsed by
            // `--untracked-files=normal`, or a repository of its own. It has no
            // blob, and one in the batch fails `hash-object` for every file.
            if codes == b"??" {
                collapsed.push(path);
            }
        } else {
            dirty.push(path.to_vec());
        }
    }

    if !collapsed.is_empty() {
        // Only the directories git collapsed are walked, and the walk is git's,
        // so the ignore rules are the ones `status` applied. Unanswered, the
        // files under them are unknown, and git has not answered.
        let mut args = vec!["--literal-pathspecs", "ls-files", "-z", "--others", "--exclude-standard", "--"];
        let spelled: Option<Vec<&str>> = collapsed.iter().map(|dir| std::str::from_utf8(dir).ok()).collect();
        let listed = spelled.and_then(|dirs| {
            args.extend(dirs);
            git(root, &args, None)
        });
        let listed = listed?;
        for path in listed.split(|byte| *byte == 0) {
            if !path.is_empty() && !path.ends_with(b"/") {
                dirty.push(path.to_vec());
            }
        }
    }

    if dirty.is_empty() {
        return Some(moved);
    }

    // Hashed nothing: the file is unreadable or vanished between the two calls.
    // Withdrawing the entry hands the question back to the scan rather than
    // answering it with a digest for contents nobody saw.
    for path in &dirty {
        moved.insert(path.clone(), None);
    }
    for (path, oid) in hash_on_disk(root, &dirty) {
        moved.insert(path, Some(oid));
    }

    Some(moved)
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

/// Blob digests for the bytes currently on disk.
///
/// The paths come back in the order they went in, which is the only thing
/// pairing them — `hash-object` prints digests and nothing else. A short answer
/// means git stopped early, on a directory or a path it could not open, and
/// pairing the survivors by position would attach one file's digest to
/// another's name; the whole batch is discarded instead.
fn hash_on_disk(root: &str, paths: &[Vec<u8>]) -> Vec<(Vec<u8>, Oid)> {
    let mut stdin = Vec::with_capacity(paths.iter().map(|path| path.len() + 1).sum());
    for path in paths {
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
        .filter_map(|(line, path)| parse_oid(trim(line)).map(|oid| (path.clone(), oid)))
        .collect()
}

fn trim(line: &[u8]) -> &[u8] {
    let mut end = line.len();
    while end > 0 && line[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    &line[..end]
}

fn parse_oid(hex: &[u8]) -> Option<Oid> {
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
fn git(root: &str, args: &[&str], stdin: Option<Vec<u8>>) -> Option<Vec<u8>> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });

    let mut child = command.spawn().ok()?;

    if let Some(bytes) = stdin {
        // On its own thread: a list of two hundred thousand paths is larger than
        // a pipe buffer, and writing it from here while git waits for us to read
        // its output is a deadlock rather than a slow call.
        let mut pipe = child.stdin.take()?;
        std::thread::spawn(move || {
            let _ = pipe.write_all(&bytes);
        });
    }

    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }

    Some(output.stdout)
}
