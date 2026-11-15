//! Checkout bytes out of git's object store, read in-process.
//!
//! One question: the bytes a tracked file was checked out from, as this
//! repository's object store holds them, with no replacement and nothing
//! fetched, or nothing — and then the caller reads the file. A file the index
//! recorded as unchanged is its blob, so `ask grep` inflates it out of a pack
//! instead of opening it: on Kibana an open costs about four times what an
//! inflate does, because a worktree read pays for the descriptor, not the bytes.
//!
//! [`Store::open`] refuses a whole repository where a blob may not be what
//! checkout wrote at the same length: a replace ref (git owns the ref store, so
//! `for-each-ref` reads packed and reftable refs too), a smudge or process
//! filter other than git-lfs's, a `working-tree-encoding` or `ident` attribute
//! in any attribute file git reads, an object format other than SHA-1, more
//! packs than a lookup should walk without a multi-pack index, or any git call
//! that failed. Every rewrite that changes the length is caught per file, by the
//! blob's size against the file's, whenever it happened.
//!
//! [`Store::checked_out`] is the per-file proof, in order: an unconflicted entry,
//! a regular file, none of skip-worktree, assume-valid or intent-to-add, an
//! lstat that matches the entry strictly and is not racy against the index, and
//! a size no larger than [`STORE_LARGEST`]. [`Reader::checkout_bytes`] then
//! wants the blob's header size equal to the file's and a blob that is not a
//! git-LFS pointer. Whatever fails, or errors, reads the worktree: fall back,
//! never fake.

// compass: variance-authority.reach.source-index

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use gix_hash::ObjectId;
use gix_index::entry::{stat, Flags, Mode, Stage, Stat};
use gix_object::{Find as _, Kind};
use gix_odb::Header as _;

/// The largest file a search inflates rather than the disk opening it.
///
/// Measured on a Material UI docs closure of 4,811 files, many of them images:
/// above about 64 KiB an inflate costs more than an open and a streamed read, so
/// a larger file reads the worktree and only memory changes, never the answer.
pub(crate) const STORE_LARGEST: u64 = 64 * 1024;
/// The fewest files a question must read for the store to pay for opening it.
///
/// Opening asks git five questions and loads the index, which a list must earn
/// back at a few microseconds a file: on Kibana and on Material UI the two
/// paths cost the same at about 3,000 files (`docs/performance.md`). A list
/// under it opens nothing.
pub(crate) const STORE_CROSSOVER: usize = 3_000;
/// The packs a lookup walks before a repository without a multi-pack index is
/// read from the worktree instead: each miss probes every pack's index.
const PACK_LIMIT: usize = 50;

/// Strict, and never relaxed from configuration: a file that matches on mtime,
/// ctime, size and inode is the one the index recorded.
const STRICT: stat::Options = stat::Options { trust_ctime: true, check_stat: true, use_nsec: true, use_stdev: false };

/// A repository's object store and index, opened for one question.
pub(crate) struct Store {
    objects: Arc<gix_odb::Store>,
    index: gix_index::File,
    /// Where `root` lies in the checkout, as `--show-prefix` spells it.
    prefix: String,
    root: PathBuf,
}

/// What git answered before a store opens; each `None` is a call that failed.
struct Answers {
    /// `--show-prefix`, `--show-toplevel`, `--show-object-format` and the git
    /// paths of the index, the objects and `info/attributes`, a line each.
    located: Option<String>,
    /// Whether no filter but git-lfs's smudges or processes a checkout.
    unfiltered: Option<bool>,
    /// The first replace ref, or nothing.
    replaced: Option<String>,
    /// The system and global attribute files, where git reads one.
    outside: Option<Vec<PathBuf>>,
}

/// A tracked file the index holds as unchanged, and its blob.
pub(crate) struct Fresh {
    id: ObjectId,
    size: u64,
}

/// One thread's handle on the store, with the buffer it inflates into.
pub(crate) struct Reader {
    objects: gix_odb::store::Handle<Arc<gix_odb::Store>>,
    buffer: Vec<u8>,
}

impl Store {
    /// The store behind the checkout `root` lies in, or `None` wherever a blob
    /// may not be the bytes checkout wrote at the same length.
    pub(crate) fn open(root: &Path) -> Option<Store> {
        Store::answered(root, Answers::asked(root))
    }

    fn answered(root: &Path, answers: Answers) -> Option<Store> {
        if !answers.unfiltered? || !answers.replaced?.trim().is_empty() {
            return None;
        }
        let (located, mut outside) = (answers.located?, answers.outside?);
        let mut lines = located.lines();
        let (prefix, top, format) = (lines.next()?, Path::new(lines.next()?), lines.next()?);
        let mut paths = lines.map(|path| root.join(path));
        let (index, objects, info) = (paths.next()?, paths.next()?, paths.next()?);
        if format != "sha1" || !few_packs(&objects) {
            return None;
        }
        let index = gix_index::File::at(&index, gix_hash::Kind::Sha1, true, Default::default()).ok()?;
        let objects = gix_odb::Store::at_opts(objects, gix_hash::Kind::Sha1, &mut std::iter::empty(), Default::default()).ok()?;
        let store = Store { objects: Arc::new(objects), index, prefix: prefix.to_owned(), root: root.to_owned() };
        outside.push(info);
        let outside = outside.iter().map(|path| top.join(path));
        (!store.rewrites_in_place(top, outside)).then_some(store)
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
        (size <= STORE_LARGEST).then_some(Fresh { id: entry.id, size })
    }

    /// A handle for one thread; lookups never re-read the pack directory.
    pub(crate) fn reader(&self) -> Reader {
        let mut objects = self.objects.to_handle_arc();
        objects.refresh_never();
        Reader { objects, buffer: Vec::new() }
    }

    /// Whether an attribute that rewrites a checkout without changing its
    /// length is named in a tracked `.gitattributes`, as committed or on disk,
    /// or in one of the `outside` files git reads.
    fn rewrites_in_place(&self, top: &Path, mut outside: impl Iterator<Item = PathBuf>) -> bool {
        let tracked = self.index.entries().iter().filter(|entry| {
            let path = entry.path(&self.index);
            path == ".gitattributes" || path.ends_with(b"/.gitattributes")
        });
        let mut reader = self.reader();
        for entry in tracked {
            let path = top.join(entry.path(&self.index).to_string());
            let held = std::fs::read(path).ok();
            let committed = reader.objects.try_find(&entry.id, &mut reader.buffer).ok().flatten().map(|data| data.data.to_vec());
            if held.is_none() && committed.is_none() {
                return true;
            }
            if held.into_iter().chain(committed).any(|text| rewrites(&text)) {
                return true;
            }
        }
        outside.any(|path| std::fs::read(path).is_ok_and(|text| rewrites(&text)))
    }
}

impl Answers {
    /// Every question at once, each its own git process.
    fn asked(root: &Path) -> Answers {
        let replace_base = std::env::var("GIT_REPLACE_REF_BASE").unwrap_or_else(|_| "refs/replace/".to_owned());
        std::thread::scope(|scope| {
            let located = scope.spawn(|| {
                let asked = ["--show-prefix", "--show-toplevel", "--show-object-format", "--git-path", "index"];
                git(root, &[&["rev-parse"][..], &asked, &["--git-path", "objects", "--git-path", "info/attributes"]].concat())
            });
            let unfiltered = scope.spawn(|| unfiltered(root));
            let replaced = scope.spawn(|| git(root, &["for-each-ref", "--count=1", "--format=%(refname)", &replace_base]));
            let system = scope.spawn(|| attribute_file(root, "GIT_ATTR_SYSTEM"));
            let global = attribute_file(root, "GIT_ATTR_GLOBAL");
            let system = system.join().ok().flatten();
            Answers {
                located: located.join().ok().flatten(),
                unfiltered: unfiltered.join().ok().flatten(),
                replaced: replaced.join().ok().flatten(),
                outside: system.zip(global).map(|(system, global)| system.into_iter().chain(global).collect()),
            }
        })
    }
}

impl Reader {
    /// The bytes `fresh` was checked out from, or `None` to read the worktree.
    pub(crate) fn checkout_bytes(&mut self, fresh: &Fresh) -> Option<&[u8]> {
        let header = self.objects.try_header(&fresh.id).ok()??;
        if header.kind() != Kind::Blob || header.size() != fresh.size {
            return None;
        }
        let data = self.objects.try_find(&fresh.id, &mut self.buffer).ok()??;
        (data.kind == Kind::Blob && !crate::lfs::pointer(data.data)).then_some(data.data)
    }
}

/// A git command's standard output, when it succeeded.
fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).current_dir(root).output().ok()?;
    output.status.success().then(|| String::from_utf8(output.stdout).ok()).flatten()
}

/// Whether no filter but git-lfs's smudges or processes a checkout; `None` when
/// the configuration could not be read.
fn unfiltered(root: &Path) -> Option<bool> {
    let output = Command::new("git")
        .args(["config", "--null", "--name-only", "--get-regexp", r"^filter\..*\.(smudge|process)$"])
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

/// The attribute file git names for `variable` (`git var`, git 2.42 on), or
/// `Some(None)` when it reads none: `GIT_ATTR_NOSYSTEM` answers 1 and nothing.
fn attribute_file(root: &Path, variable: &str) -> Option<Option<PathBuf>> {
    let output = Command::new("git").args(["var", variable]).current_dir(root).output().ok()?;
    let path = String::from_utf8(output.stdout).ok()?;
    let path = path.trim_end_matches('\n');
    match output.status.code() {
        Some(0) => Some((!path.is_empty()).then(|| PathBuf::from(path))),
        Some(1) if path.is_empty() => Some(None),
        _ => None,
    }
}

/// Whether attribute text names `working-tree-encoding` or `ident` in any
/// token, set, unset or in a macro: either can rewrite a checkout and keep its
/// length. A pattern spelt the same refuses too, which only costs speed.
fn rewrites(text: &[u8]) -> bool {
    text.split(|byte| *byte == b'\n').any(|line| {
        let line = line.trim_ascii();
        !line.starts_with(b"#")
            && line.split(u8::is_ascii_whitespace).any(|token| {
                let token = token.strip_prefix(b"-").or_else(|| token.strip_prefix(b"!")).unwrap_or(token);
                let name = token.split(|byte| *byte == b'=').next().unwrap_or(token);
                name == b"working-tree-encoding" || name == b"ident"
            })
    })
}

/// Whether a lookup that misses walks few enough pack indexes.
fn few_packs(objects: &Path) -> bool {
    let pack = objects.join("pack");
    if pack.join("multi-pack-index").is_file() {
        return true;
    }
    let Ok(entries) = std::fs::read_dir(&pack) else { return true };
    entries.flatten().filter(|entry| entry.path().extension().is_some_and(|extension| extension == "pack")).count() <= PACK_LIMIT
}

#[cfg(test)]
#[path = "git_store_tests.rs"]
mod tests;
