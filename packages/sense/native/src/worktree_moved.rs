//! The working tree against the index, after the index moved under a watch:
//! a branch switch, a reset, a commit. Compared where Watchman reports a file
//! moved since a held listing, and read from that listing everywhere else.
//!
//! A path Watchman reports nothing for holds the bytes the held listing named
//! when it was taken, so a clean one needs no stat: what it holds is that
//! listing's object name, and the index entry either names it or the path is
//! edited. A path the index tracks that the listing did not hold clean, and
//! every path that moved, is compared as `worktree_status` compares the whole
//! tree. The untracked half is the listing's untracked paths and the moved
//! ones git neither tracks nor ignores, and the directories whose
//! `.gitignore` moved, walked again.
//!
//! `None` hands the question back to the walk of the whole tree: where
//! that walk would hand it to `git status`, and where a repository was made
//! below the root since, which no file event says is not ours to list.

// compass: variance-authority.reach.source-scan

use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use bstr::ByteSlice;
use gix_index::entry::{Flags, Mode, Stage};

use super::worktree_status::{indexed, worktree, Config, Paths, Walked};
use crate::git::Snapshot;
use crate::git_store::Head;

/// A listing held since a Watchman clock, and every file below the root
/// Watchman reports moved since it.
pub(crate) struct Before<'a> {
    pub(crate) listing: &'a Snapshot,
    pub(crate) moved: &'a [String],
}

/// The working tree walked against the index where `before` cannot say, or
/// `None` where the walk of the whole tree must answer.
pub(crate) fn walk(head: &Head, config: &Config, before: &Before) -> Option<Walked> {
    let (prefix, top) = (head.prefix.as_bytes(), head.top.as_path());
    let moved: HashSet<&[u8]> = before.moved.iter().map(|path| path.as_bytes()).collect();
    if moved.iter().any(|path| path.split(|byte| *byte == b'/').any(|part| part == b".git")) {
        return None;
    }
    let listing = before.listing;
    // A name the listing respelled is no name to find on disk.
    if listing.paths.iter().chain(&listing.unhashed).any(|path| path.contains('\u{FFFD}')) {
        return None;
    }
    let held: HashMap<&[u8], (&[u8; 20], bool)> = listing.paths.iter().zip(&listing.oids).zip(&listing.regular).map(|((path, oid), regular)| (path.as_bytes(), (oid, *regular))).collect();
    let index = indexed(head, config)?;

    // The entries the listing speaks for leave the index the comparison reads.
    let mut dirty = Paths::new();
    let mut trimmed = index.clone();
    trimmed.remove_entries(|_, path, entry| {
        let Some(path) = path.strip_prefix(prefix) else {
            return true;
        };
        let plain = entry.stage() == Stage::Unconflicted && !entry.flags.intersects(Flags::ASSUME_VALID | Flags::INTENT_TO_ADD) && (entry.mode == Mode::FILE || entry.mode == Mode::FILE_EXECUTABLE);
        match held.get(path) {
            Some((oid, true)) if plain && !moved.contains(path) => {
                if oid.as_slice() != entry.id.as_bytes() {
                    dirty.insert(path.to_vec());
                }
                true
            }
            _ => false,
        }
    });
    let tracked = |path: &[u8]| {
        let mut full = prefix.to_vec();
        full.extend_from_slice(path);
        index.entry_by_path(full.as_bstr()).is_some()
    };

    // A directory whose `.gitignore` moved may hide or show any file below it, and is walked again.
    let mut again: Vec<Vec<u8>> = moved
        .iter()
        .filter_map(|path| match path.rsplit_once_str("/") {
            Some((dir, name)) if name == b".gitignore" => Some(dir.to_vec()),
            None if *path == b".gitignore" => Some(Vec::new()),
            _ => None,
        })
        .filter(|dir| top.join(gix_path::from_bstr(join(prefix, dir).as_bstr()).ok().unwrap_or_default()).is_dir())
        .collect();
    again.sort();
    again.dedup_by(|below, above| below.starts_with(above) && (above.is_empty() || below.get(above.len()) == Some(&b'/')));
    let outside = |path: &[u8]| !again.iter().any(|dir| dir.is_empty() || (path.starts_with(dir) && path.get(dir.len()) == Some(&b'/')));

    let mut nested = HashMap::new();
    let candidates: Vec<&[u8]> = listing
        .paths
        .iter()
        .chain(&listing.unhashed)
        .map(|path| path.as_bytes())
        .filter(|path| !moved.contains(path))
        .chain(moved.iter().copied().filter(|path| on_disk(top, &join(prefix, path)) && !below_repository(top, prefix, path, &mut nested)))
        .filter(|path| outside(path) && !tracked(path))
        .collect();

    let (compared, ignored, walked) = std::thread::scope(|scope| {
        let ignored = scope.spawn(|| ignored(&top.join(&head.prefix), &candidates));
        let walked = scope.spawn(|| {
            let dirs: Vec<Vec<u8>> = again.iter().map(|dir| join(prefix, dir).trim_end_with(|c| c == '/').to_vec()).collect();
            if dirs.is_empty() { Some(BTreeSet::new()) } else { super::worktree_untracked::untracked_below(head, &index, config, dirs) }
        });
        (worktree(head, &trimmed, config), ignored.join().ok().flatten(), walked.join().ok().flatten())
    });
    let (removed, compared) = compared?;
    dirty.extend(compared);
    let ignored = ignored?;
    let mut untracked = walked?;
    untracked.extend(candidates.into_iter().filter(|path| !ignored.contains(*path)).map(<[u8]>::to_vec));
    Some(Walked { prefix: prefix.to_vec(), index, removed, dirty, untracked })
}

fn join(prefix: &[u8], path: &[u8]) -> Vec<u8> {
    [prefix, path].concat()
}

/// Whether a file or link is at `path`, from the top of the checkout.
fn on_disk(top: &Path, path: &[u8]) -> bool {
    gix_path::from_bstr(path.as_bstr()).is_ok_and(|path| std::fs::symlink_metadata(top.join(path)).is_ok_and(|meta| !meta.is_dir()))
}

/// Whether a directory above `path`, below the root, holds a repository of its own.
fn below_repository(top: &Path, prefix: &[u8], path: &[u8], seen: &mut HashMap<Vec<u8>, bool>) -> bool {
    let mut at = 0;
    while let Some(slash) = path[at..].find_byte(b'/') {
        let dir = &path[..at + slash];
        let nested = *seen.entry(dir.to_vec()).or_insert_with(|| {
            gix_path::from_bstr(join(prefix, dir).as_bstr()).is_ok_and(|dir| std::fs::symlink_metadata(top.join(dir).join(".git")).is_ok())
        });
        if nested {
            return true;
        }
        at += slash + 1;
    }
    false
}

/// Which of `paths`, relative to `root`, git ignores; `None` when git did not answer.
fn ignored(root: &Path, paths: &[&[u8]]) -> Option<HashSet<Vec<u8>>> {
    if paths.is_empty() {
        return Some(HashSet::new());
    }
    let asked: Vec<u8> = paths.iter().flat_map(|path| path.iter().copied().chain([0])).collect();
    let mut child = Command::new("git")
        .args(["check-ignore", "--stdin", "-z"])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut pipe = child.stdin.take()?;
    // On its own thread, as `git::answer` writes: a long list outgrows the pipe while git writes back.
    std::thread::spawn(move || {
        let _ = pipe.write_all(&asked);
    });
    let output = child.wait_with_output().ok()?;
    // 1 is git ignoring none of them.
    match output.status.code() {
        Some(0 | 1) => Some(output.stdout.split(|byte| *byte == 0).filter(|path| !path.is_empty()).map(<[u8]>::to_vec).collect()),
        _ => None,
    }
}
