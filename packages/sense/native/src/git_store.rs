//! Checkout provenance and blob acquisition for Git-backed search.
//!
//! [`Objects`] reads indexed source and configuration blobs through retained
//! native handles or buffered Git for fragmented repositories. Native search
//! retains its layout guard.
//!
//! [`Store::checked_out`] proves that a search may use a committed blob for
//! a worktree file: an ordinary unconflicted entry, no checkout flags, and
//! strict non-racy stat identity. Filters, encoding and attributes that can
//! preserve byte length defer to the worktree; size differences and LFS
//! pointers do too. Raw indexed source bytes use their listed identity and
//! report missing objects without substituting another file's bytes.

// compass: variance-authority.reach.source-index

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use gix_hash::ObjectId;
use gix_index::entry::{stat, Flags, Mode, Stage, Stat};

#[path = "git_objects.rs"]
mod objects;
pub(crate) use objects::{Objects, Reader};

/// The largest file a search inflates rather than the disk opening it.
///
/// Measured on a Material UI docs closure of 4,811 files, many of them images:
/// above about 64 KiB an inflate costs more than an open and a streamed read, so
/// a larger file reads the worktree and only memory changes, never the answer.
pub(crate) const STORE_LARGEST: u64 = 64 * 1024;
/// The fewest files a question must read for the store to pay for opening it.
///
/// Opening asks git its questions, and a search's store loads the index too,
/// which the files read must earn back at a few microseconds a file: on Kibana
/// and on Material UI the two paths cost the same at about this many files
/// (`docs/performance.md`). A search's list under it opens nothing, and a
/// tree's scans open `Objects` once the files they have read reach it.
pub(crate) const STORE_CROSSOVER: usize = 3_000;
/// The packs a lookup walks before a repository without a multi-pack index is
/// searched from the worktree instead: each miss probes every pack's index.
const PACK_LIMIT: usize = 50;

/// Strict, and never relaxed from configuration: a file that matches on mtime,
/// ctime, size and inode is the one the index recorded.
const STRICT: stat::Options = stat::Options { trust_ctime: true, check_stat: true, use_nsec: true, use_stdev: false };

/// A repository's object store and index, opened for one search.
pub(crate) struct Store {
    objects: Objects,
    index: gix_index::File,
    /// Where `root` lies in the checkout, as `--show-prefix` spells it.
    prefix: String,
    root: PathBuf,
    /// Whether an attributes source names `ident`.
    ident: bool,
}

/// What git answered before a store opens; each `None` is a call that failed.
struct Answers {
    /// `--show-prefix`, `--show-object-format`, the git paths of the index,
    /// the objects and the repository's attributes, and `--git-common-dir`, a
    /// line each.
    located: Option<String>,
    /// Whether no filter but git-lfs's cleans, smudges or processes a checkout.
    unfiltered: Option<bool>,
    /// Whether any replace ref exists.
    replaced: Option<bool>,
    /// The system and global attributes files, as `git var` names them; an
    /// empty path is none.
    attributes: Option<[String; 2]>,
}

/// A tracked file the index holds as unchanged, and its blob.
pub(crate) struct Fresh {
    id: ObjectId,
    size: u64,
    /// Whether an attributes source names `ident`.
    ident: bool,
}

/// Whether the attributes sources name a rewrite that can keep a checkout's
/// length: `working-tree-encoding`, or `ident`. A source that cannot be read
/// names both.
#[derive(Clone, Copy, Default)]
struct Named {
    encoding: bool,
    ident: bool,
}

impl Named {
    const UNREAD: Named = Named { encoding: true, ident: true };
}

impl Store {
    /// The store behind the checkout `root` lies in, or `None` wherever a blob
    /// may not be the bytes checkout wrote at the same length.
    pub(crate) fn open(root: &Path) -> Option<Store> {
        Store::answered(root, Answers::asked(root))
    }

    fn answered(root: &Path, answers: Answers) -> Option<Store> {
        if !answers.unfiltered? {
            return None;
        }
        let (located, replaced, [system, global]) = (answers.located?, answers.replaced?, answers.attributes?);
        let mut lines = located.lines();
        let (prefix, format) = (lines.next()?, lines.next()?);
        let mut paths = lines.map(|path| root.join(path));
        let (index, objects, info) = (paths.next()?, paths.next()?, paths.next()?);
        let objects = Objects::at(format, &objects, replaced, None)?;
        let index = gix_index::File::at(&index, gix_hash::Kind::Sha1, true, Default::default()).ok()?;
        let top = root.ancestors().nth(prefix.matches('/').count())?;
        // Git resolves a relative `core.attributesFile` from the top of the worktree.
        let named_file = |path: String| if path.is_empty() { PathBuf::new() } else { top.join(path) };
        let mut outside = vec![named_file(system), named_file(global), info];
        outside.extend(root.ancestors().take_while(|directory| directory.starts_with(top)).map(|directory| directory.join(".gitattributes")));
        let named = named(&index, top, &objects, &outside);
        if named.encoding {
            return None;
        }
        Some(Store { objects, index, prefix: prefix.to_owned(), root: root.to_owned(), ident: named.ident })
    }

    /// `file`, relative to the root this store was opened at, when the index
    /// holds it as a regular file unchanged since it was recorded.
    pub(crate) fn checked_out(&self, file: &str) -> Option<Fresh> {
        let path = format!("{}{file}", self.prefix);
        let entry = self.index.entry_by_path_and_stage(path.as_bytes().into(), Stage::Unconflicted)?;
        if entry.mode != Mode::FILE && entry.mode != Mode::FILE_EXECUTABLE {
            return None;
        }
        if entry.flags.intersects(Flags::SKIP_WORKTREE | Flags::ASSUME_VALID | Flags::INTENT_TO_ADD) {
            return None;
        }
        let metadata = gix_index::fs::Metadata::from_path_no_follow(&self.root.join(file)).ok()?;
        if !metadata.is_file() {
            return None;
        }
        let stat = Stat::from_fs(&metadata).ok()?;
        if !entry.stat.matches(&stat, STRICT) || entry.stat.is_racy(self.index.timestamp(), STRICT) {
            return None;
        }
        let size = metadata.len();
        (size <= STORE_LARGEST).then_some(Fresh { id: entry.id, size, ident: self.ident })
    }

    /// Whether a `.gitattributes` the index does not hold, in a directory below
    /// the root that holds a file of `files`, names a rewrite that can keep a
    /// checkout's length, or could not be read. Then the store's answer for
    /// `files` is not proof, and the worktree's is.
    ///
    /// A lookup a directory, one at a time: APFS serialises them, so more
    /// threads buy little, and the search runs this beside its own work.
    pub(crate) fn rewritten_below(&self, files: &[String]) -> bool {
        let mut directories = HashSet::new();
        for file in files {
            let mut at = file.as_str();
            // A directory met before had its own parents met with it.
            while let Some((parent, _)) = at.rsplit_once('/') {
                if !directories.insert(parent) {
                    break;
                }
                at = parent;
            }
        }
        directories.into_iter().any(|directory| {
            let tracked = format!("{}{directory}/.gitattributes", self.prefix);
            if self.index.entry_by_path(tracked.as_bytes().into()).is_some() {
                return false;
            }
            let named = read(&self.root.join(directory).join(".gitattributes"));
            named.encoding || named.ident
        })
    }

    /// A handle for one thread; lookups never re-read the pack directory.
    pub(crate) fn reader(&self) -> Reader {
        self.objects.reader()
    }
}

impl Answers {
    /// Every question at once, each its own git process.
    fn asked(root: &Path) -> Answers {
        std::thread::scope(|scope| {
            let unfiltered = scope.spawn(|| unfiltered(root));
            let attributes = scope.spawn(|| attributes(root));
            let replaced = scope.spawn(|| replaced(root));
            let asked = ["rev-parse", "--show-prefix", "--show-object-format", "--git-path", "index", "--git-path", "objects", "--git-path", "info/attributes"];
            let located = git(root, &asked);
            Answers {
                replaced: replaced.join().ok().flatten(),
                located,
                unfiltered: unfiltered.join().ok().flatten(),
                attributes: attributes.join().ok().flatten(),
            }
        })
    }
}

/// A git command's standard output, when it succeeded.
fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).current_dir(root).output().ok()?;
    output.status.success().then(|| String::from_utf8(output.stdout).ok()).flatten()
}

/// Whether any replace ref exists; `None` when the refs could not be read.
fn replaced(root: &Path) -> Option<bool> {
    let base = std::env::var("GIT_REPLACE_REF_BASE").unwrap_or_else(|_| "refs/replace/".to_owned());
    git(root, &["for-each-ref", "--count=1", "--format=%(refname)", &base]).map(|first| !first.trim().is_empty())
}

/// Whether no filter but git-lfs's cleans, smudges or processes a checkout; `None` when
/// the configuration could not be read.
fn unfiltered(root: &Path) -> Option<bool> {
    let output = Command::new("git")
        .args(["config", "--null", "--name-only", "--get-regexp", r"^filter\..*\.(clean|smudge|process)$"])
        .current_dir(root)
        .output()
        .ok()?;
    match output.status.code() {
        Some(1) => Some(true),
        Some(0) => Some(output.stdout.split(|byte| *byte == 0).filter(|key| !key.is_empty()).all(|key| {
            let filter = std::str::from_utf8(key).ok().and_then(|key| key.strip_prefix("filter."));
            filter.and_then(|rest| rest.rsplit_once('.')).is_some_and(|(name, _)| name == "lfs")
        })),
        _ => None,
    }
}

/// The system and global attributes files `git var` names; `None` when it
/// names neither, as git before 2.42 does.
fn attributes(root: &Path) -> Option<[String; 2]> {
    let listed = git(root, &["var", "-l"])?;
    let named = |key: &str| listed.lines().find_map(|line| line.strip_prefix(key)?.strip_prefix('=')).map(str::to_owned);
    Some([named("GIT_ATTR_SYSTEM")?, named("GIT_ATTR_GLOBAL")?])
}

/// What the attributes sources name: every `.gitattributes` the index holds,
/// as checked out and as committed, and the files `outside` it.
fn named(index: &gix_index::File, top: &Path, objects: &Objects, outside: &[PathBuf]) -> Named {
    let either = |one: Named, other: Named| Named { encoding: one.encoding || other.encoding, ident: one.ident || other.ident };
    let outside = outside.iter().filter(|path| !path.as_os_str().is_empty()).map(|path| read(path)).fold(Named::default(), either);
    let mut reader = objects.reader();
    index.entries().iter().fold(outside, |named, entry| {
        let path = entry.path(index);
        if path != ".gitattributes" && !path.ends_with(b"/.gitattributes") {
            return named;
        }
        let Ok(relative) = std::str::from_utf8(path) else { return Named::UNREAD };
        let committed = reader.raw_blob(&entry.id).map_or(Named::UNREAD, names);
        either(named, either(committed, read(&top.join(relative))))
    })
}

/// What an attributes file's bytes name.
fn names(bytes: &[u8]) -> Named {
    Named { encoding: memchr::memmem::find(bytes, b"working-tree-encoding").is_some(), ident: memchr::memmem::find(bytes, b"ident").is_some() }
}

/// What the attributes file at `path` names: nothing when there is none.
fn read(path: &Path) -> Named {
    match std::fs::read(path) {
        Ok(bytes) => names(&bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Named::default(),
        Err(_) => Named::UNREAD,
    }
}

/// Whether a lookup that misses walks few enough pack indexes.
fn few_packs(objects: &Path) -> bool {
    let pack = objects.join("pack");
    if pack.join("multi-pack-index").is_file() {
        return true;
    }
    let Ok(entries) = std::fs::read_dir(&pack) else { return true };
    let count = entries.flatten().filter(|entry| entry.path().extension().is_some_and(|extension| extension == "pack")).count();
    if crate::timings::enabled() {
        eprintln!("sense git objects: {count} packs, no multi-pack index, limit {PACK_LIMIT}; {}", if count <= PACK_LIMIT { "native pack lookups allowed" } else { "native pack lookups declined" });
    }
    count <= PACK_LIMIT
}

#[cfg(test)]
#[path = "git_store_tests.rs"]
mod tests;
