//! Blobs out of git's object store, read in-process: the one reader of git's
//! bytes, for the scan and for the search.
//!
//! [`Objects`] answers the blob an id names, as this repository's object store
//! holds it, with no replacement and nothing fetched, or nothing — and then the
//! caller reads the file. [`Objects::open`] refuses a repository whose ids may
//! not name the bytes checkout wrote: a replace ref (git owns the ref store, so
//! `for-each-ref` reads packed and reftable refs too), an object format other
//! than SHA-1, or a git call that failed. The scan's wave read asks it by the
//! ids its listing holds (`acquire.rs`).
//!
//! [`Store`] is the search's: a file the index recorded as unchanged is its
//! blob, so `ask grep` inflates it out of a pack instead of opening it. On
//! Kibana an open costs about four times what an inflate does, because a
//! worktree read pays for the descriptor, not the bytes. [`Store::open`] refuses
//! too a clean, smudge or process filter other than git-lfs's, and any
//! attributes source that names `working-tree-encoding`: either can make a
//! checkout and its blob differ at one length (`中中a\n` is eight bytes in UTF-8
//! and in UTF-16LE). It refuses as well more packs than a lookup should walk
//! without a multi-pack index. Every rewrite that always changes the length —
//! `eol`, `core.autocrlf`, `ident` — is caught per file, by the blob's size
//! against the file's, whenever it happened.
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
/// Opening asks git three questions and loads the index, which a list must earn
/// back at a few microseconds a file: on Kibana and on Material UI the two
/// paths cost the same at about this many files (`docs/performance.md`). A list
/// under it opens nothing.
pub(crate) const STORE_CROSSOVER: usize = 3_000;
/// The packs a lookup walks before a repository without a multi-pack index is
/// searched from the worktree instead: each miss probes every pack's index.
const PACK_LIMIT: usize = 50;

/// Strict, and never relaxed from configuration: a file that matches on mtime,
/// ctime, size and inode is the one the index recorded.
const STRICT: stat::Options = stat::Options { trust_ctime: true, check_stat: true, use_nsec: true, use_stdev: false };

/// A repository's object store, opened for one question.
pub(crate) struct Objects {
    store: Arc<gix_odb::Store>,
}

/// A repository's object store and index, opened for one search.
pub(crate) struct Store {
    objects: Objects,
    index: gix_index::File,
    /// Where `root` lies in the checkout, as `--show-prefix` spells it.
    prefix: String,
    root: PathBuf,
}

/// What git answered before a store opens; each `None` is a call that failed.
struct Answers {
    /// `--show-prefix`, `--show-object-format` and the git paths of the index
    /// and the objects, a line each.
    located: Option<String>,
    /// Whether no filter but git-lfs's cleans, smudges or processes a checkout.
    unfiltered: Option<bool>,
    /// The first replace ref, or nothing.
    replaced: Option<String>,
    /// The system and global attributes files, as `git var` names them; an
    /// empty path is none.
    attributes: Option<[String; 2]>,
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

impl Objects {
    /// The object store behind the checkout `root` lies in, or `None` where an
    /// id may not name the bytes checkout wrote.
    pub(crate) fn open(root: &Path) -> Option<Objects> {
        let (located, replaced) = std::thread::scope(|scope| {
            let replaced = scope.spawn(|| replaced(root));
            let located = git(root, &["rev-parse", "--show-object-format", "--git-path", "objects"]);
            (located, replaced.join().ok().flatten())
        });
        let located = located?;
        let mut lines = located.lines();
        let format = lines.next()?;
        Objects::at(format, &root.join(lines.next()?), &replaced?)
    }

    fn at(format: &str, objects: &Path, replaced: &str) -> Option<Objects> {
        if format != "sha1" || !replaced.trim().is_empty() {
            return None;
        }
        let store = gix_odb::Store::at_opts(objects.to_owned(), gix_hash::Kind::Sha1, &mut std::iter::empty(), Default::default()).ok()?;
        Some(Objects { store: Arc::new(store) })
    }

    /// A handle for one thread; lookups never re-read the pack directory.
    pub(crate) fn reader(&self) -> Reader {
        let mut objects = self.store.to_handle_arc();
        objects.refresh_never();
        Reader { objects, buffer: Vec::new() }
    }
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
        if !few_packs(&objects) {
            return None;
        }
        let objects = Objects::at(format, &objects, &replaced)?;
        let index = gix_index::File::at(&index, gix_hash::Kind::Sha1, true, Default::default()).ok()?;
        let top = root.ancestors().nth(prefix.matches('/').count())?;
        let outside = [Path::new(&system), Path::new(&global), &info];
        if encoded(&index, top, &objects, &outside) {
            return None;
        }
        Some(Store { objects, index, prefix: prefix.to_owned(), root: root.to_owned() })
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
        self.objects.reader()
    }
}

impl Answers {
    /// Every question at once, each its own git process.
    fn asked(root: &Path) -> Answers {
        std::thread::scope(|scope| {
            let unfiltered = scope.spawn(|| unfiltered(root));
            let replaced = scope.spawn(|| replaced(root));
            let attributes = scope.spawn(|| attributes(root));
            let asked = ["rev-parse", "--show-prefix", "--show-object-format", "--git-path", "index", "--git-path", "objects", "--git-path", "info/attributes"];
            Answers {
                located: git(root, &asked),
                unfiltered: unfiltered.join().ok().flatten(),
                replaced: replaced.join().ok().flatten(),
                attributes: attributes.join().ok().flatten(),
            }
        })
    }
}

impl Reader {
    /// The size of the blob `id` names, or `None` where the store holds no blob by it.
    pub(crate) fn size(&mut self, id: &ObjectId) -> Option<u64> {
        let header = self.objects.try_header(id).ok()??;
        (header.kind() == Kind::Blob).then(|| header.size())
    }

    /// The bytes of the blob `id` names, or `None` to read the worktree: the
    /// store holds no blob by it, or holds a git-LFS pointer, which checkout
    /// smudged into other bytes.
    pub(crate) fn blob(&mut self, id: &ObjectId) -> Option<&[u8]> {
        let data = self.objects.try_find(id, &mut self.buffer).ok()??;
        (data.kind == Kind::Blob && !crate::lfs::pointer(data.data)).then_some(data.data)
    }

    /// The bytes `fresh` was checked out from, or `None` to read the worktree.
    pub(crate) fn checkout_bytes(&mut self, fresh: &Fresh) -> Option<&[u8]> {
        if self.size(&fresh.id)? != fresh.size {
            return None;
        }
        self.blob(&fresh.id)
    }
}

/// A git command's standard output, when it succeeded.
fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).current_dir(root).output().ok()?;
    output.status.success().then(|| String::from_utf8(output.stdout).ok()).flatten()
}

/// The first replace ref, or nothing; `None` when the refs could not be read.
fn replaced(root: &Path) -> Option<String> {
    let base = std::env::var("GIT_REPLACE_REF_BASE").unwrap_or_else(|_| "refs/replace/".to_owned());
    git(root, &["for-each-ref", "--count=1", "--format=%(refname)", &base])
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

/// Whether any attributes source may name `working-tree-encoding`, which can
/// rewrite a file into other bytes at its blob's length: every `.gitattributes`
/// the index holds, as checked out and as committed, and the files `outside`
/// it. A source that cannot be read is read as naming it.
fn encoded(index: &gix_index::File, top: &Path, objects: &Objects, outside: &[&Path]) -> bool {
    let names = |bytes: &[u8]| memchr::memmem::find(bytes, b"working-tree-encoding").is_some();
    let read = |path: &Path| match std::fs::read(path) {
        Ok(bytes) => names(&bytes),
        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
    };
    if outside.iter().any(|path| !path.as_os_str().is_empty() && read(path)) {
        return true;
    }
    let mut reader = objects.reader();
    index.entries().iter().any(|entry| {
        let path = entry.path(index);
        if path != ".gitattributes" && !path.ends_with(b"/.gitattributes") {
            return false;
        }
        let Ok(relative) = std::str::from_utf8(path) else { return true };
        let committed = reader.objects.try_find(&entry.id, &mut reader.buffer).ok().flatten().map(|data| names(data.data));
        committed != Some(false) || read(&top.join(relative))
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
