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
//! too a clean, smudge or process filter other than git-lfs's, and an
//! attributes file — git's system, global and `info` ones, every one the index
//! holds, and every one on the way from the top of the worktree down to the root
//! — that names `working-tree-encoding`: either can make a checkout and its blob
//! differ at one length (`中中a\n` is eight bytes in UTF-8 and in UTF-16LE). It
//! refuses as well more packs than a lookup should walk without a multi-pack
//! index. An untracked attributes file below the root is not read at open, where
//! APFS would serialise the lookups ahead of the search:
//! [`Store::rewritten_below`] reads them beside it, and one naming
//! `working-tree-encoding` or `ident` sends the whole search to the worktree.
//! Every rewrite that always changes the length — `eol`, `core.autocrlf` — is
//! caught per file, by the blob's size against the file's, whenever it
//! happened; `ident` can keep it, so where a source names `ident` a blob holding
//! `$Id` reads the worktree.
//!
//! [`Store::checked_out`] is the per-file proof, in order: an unconflicted entry,
//! a regular file, none of skip-worktree, assume-valid or intent-to-add, an
//! lstat that matches the entry strictly and is not racy against the index, and
//! a size no larger than [`STORE_LARGEST`]. [`Reader::checkout_bytes`] then
//! wants the blob's header size equal to the file's and a blob that is not a
//! git-LFS pointer. Whatever fails, or errors, reads the worktree: fall back,
//! never fake.

// compass: variance-authority.reach.source-index

use std::collections::HashSet;
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

/// One thread's handle on the store, with the buffer it inflates into.
pub(crate) struct Reader {
    objects: gix_odb::store::Handle<Arc<gix_odb::Store>>,
    buffer: Vec<u8>,
}

impl Objects {
    /// The object store behind the checkout `root` lies in, or `None` where an
    /// id may not name the bytes checkout wrote.
    pub(crate) fn open(root: &Path) -> Option<Objects> {
        let located = git(root, &["rev-parse", "--show-object-format", "--git-path", "objects", "--git-common-dir"])?;
        let mut lines = located.lines();
        let (format, objects, common) = (lines.next()?, lines.next()?, lines.next()?);
        Objects::at(format, &root.join(objects), replaced(root, &root.join(common))?)
    }

    fn at(format: &str, objects: &Path, replaced: bool) -> Option<Objects> {
        if format != "sha1" || replaced {
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

/// Where the root lies in its checkout, and the blobs `HEAD` holds below it.
pub(crate) struct Head {
    /// `--show-prefix`: the root's place in the checkout, from its top.
    pub(crate) prefix: String,
    /// Every blob below the root, as `ls-tree -r HEAD -- .` lists it run there:
    /// in tree order, which is byte order over the path, each path from the
    /// root, with whether it is a symbolic link. A gitlink is a commit, not a
    /// blob, and is left out. `None` where the store will not open, or a tree
    /// is missing or does not decode, and `ls-tree` answers instead.
    pub(crate) blobs: Option<Vec<(Vec<u8>, ObjectId, bool)>>,
}

/// What `HEAD` holds below `root`, asked of git in one call, or `None` where
/// git names no tree for `HEAD`, as on an unborn branch.
pub(crate) fn head(root: &Path) -> Option<Head> {
    let located = git(root, &["rev-parse", "--show-prefix", "--show-object-format", "--git-path", "objects", "--git-common-dir", "HEAD^{tree}"])?;
    let mut lines = located.lines();
    let (prefix, format, objects, common, tree) = (lines.next()?, lines.next()?, lines.next()?, lines.next()?, lines.next()?);
    let blobs = replaced(root, &root.join(common))
        .and_then(|replaced| Objects::at(format, &root.join(objects), replaced))
        .and_then(|objects| below(&mut objects.reader(), ObjectId::from_hex(tree.as_bytes()).ok()?, prefix));
    Some(Head { prefix: prefix.to_owned(), blobs })
}

/// The blobs below `prefix` in the tree `tree`; a prefix the tree does not
/// hold has none.
fn below(reader: &mut Reader, mut tree: ObjectId, prefix: &str) -> Option<Vec<(Vec<u8>, ObjectId, bool)>> {
    for name in prefix.split('/').filter(|name| !name.is_empty()) {
        let Some(next) = reader.subtree(&tree, name.as_bytes())? else {
            return Some(Vec::new());
        };
        tree = next;
    }
    let mut blobs = Vec::new();
    reader.blobs(&tree, &mut Vec::new(), &mut blobs)?;
    Some(blobs)
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
        let objects = Objects::at(format, &objects, replaced)?;
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
            let asked = ["rev-parse", "--show-prefix", "--show-object-format", "--git-path", "index", "--git-path", "objects", "--git-path", "info/attributes", "--git-common-dir"];
            let located = git(root, &asked);
            let common = located.as_deref().and_then(|located| located.lines().nth(5));
            Answers {
                replaced: common.and_then(|common| replaced(root, &root.join(common))),
                located,
                unfiltered: unfiltered.join().ok().flatten(),
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

    /// The tree `name` names in the tree `id`, `Some(None)` where it holds no
    /// tree by that name, or `None` where `id` is no tree the store can decode.
    fn subtree(&mut self, id: &ObjectId, name: &[u8]) -> Option<Option<ObjectId>> {
        let data = self.objects.try_find(id, &mut self.buffer).ok()??;
        if data.kind != Kind::Tree {
            return None;
        }
        for entry in gix_object::TreeRefIter::from_bytes(data.data, gix_hash::Kind::Sha1) {
            let entry = entry.ok()?;
            if entry.filename == name {
                return Some(entry.mode.is_tree().then(|| entry.oid.to_owned()));
            }
        }
        Some(None)
    }

    /// Every blob below the tree `id`, each path behind `path`, depth first in
    /// tree order.
    fn blobs(&mut self, id: &ObjectId, path: &mut Vec<u8>, out: &mut Vec<(Vec<u8>, ObjectId, bool)>) -> Option<()> {
        let data = self.objects.try_find(id, &mut self.buffer).ok()??;
        if data.kind != Kind::Tree {
            return None;
        }
        // Owned before the descent: a subtree's read reuses the buffer these borrow.
        let mut entries = Vec::new();
        for entry in gix_object::TreeRefIter::from_bytes(data.data, gix_hash::Kind::Sha1) {
            let entry = entry.ok()?;
            if entry.mode.is_tree() || entry.mode.is_blob_or_symlink() {
                entries.push((entry.filename.to_vec(), entry.oid.to_owned(), entry.mode));
            }
        }
        for (name, oid, mode) in entries {
            let at = path.len();
            path.extend_from_slice(&name);
            if mode.is_tree() {
                path.push(b'/');
                self.blobs(&oid, path, out)?;
            } else {
                out.push((path.clone(), oid, mode.is_link()));
            }
            path.truncate(at);
        }
        Some(())
    }

    /// The bytes `fresh` was checked out from, or `None` to read the worktree,
    /// as for a blob holding `$Id` where `ident` may have rewritten it.
    pub(crate) fn checkout_bytes(&mut self, fresh: &Fresh) -> Option<&[u8]> {
        if self.size(&fresh.id)? != fresh.size {
            return None;
        }
        let blob = self.blob(&fresh.id)?;
        (!fresh.ident || memchr::memmem::find(blob, b"$Id").is_none()).then_some(blob)
    }
}

/// A git command's standard output, when it succeeded.
fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).current_dir(root).output().ok()?;
    output.status.success().then(|| String::from_utf8(output.stdout).ok()).flatten()
}

/// Whether any replace ref exists; `None` when the refs could not be read.
/// The files backend is read from the common directory, a loose ref and a
/// packed one alike; reftable, whose format this does not decode, is asked of
/// git.
fn replaced(root: &Path, common: &Path) -> Option<bool> {
    let base = std::env::var("GIT_REPLACE_REF_BASE").unwrap_or_else(|_| "refs/replace/".to_owned());
    if common.join("reftable").is_dir() {
        return git(root, &["for-each-ref", "--count=1", "--format=%(refname)", &base]).map(|first| !first.trim().is_empty());
    }
    if holds_a_file(&common.join(&base)) {
        return Some(true);
    }
    match std::fs::read(common.join("packed-refs")) {
        // `<object> <refname>` per ref; `#` opens the header and `^` a peeled object.
        Ok(packed) => Some(packed.split(|byte| *byte == b'\n').any(|line| {
            !line.starts_with(b"#") && !line.starts_with(b"^") && line.splitn(2, |byte| *byte == b' ').nth(1).is_some_and(|name| name.starts_with(base.as_bytes()))
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(false),
        Err(_) => None,
    }
}

/// Whether `directory`, or any directory below it, holds a file: a loose ref.
fn holds_a_file(directory: &Path) -> bool {
    std::fs::read_dir(directory).is_ok_and(|entries| {
        entries.flatten().any(|entry| entry.file_type().is_ok_and(|kind| if kind.is_dir() { holds_a_file(&entry.path()) } else { true }))
    })
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
        let committed = reader.objects.try_find(&entry.id, &mut reader.buffer).ok().flatten().map_or(Named::UNREAD, |data| names(data.data));
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
    entries.flatten().filter(|entry| entry.path().extension().is_some_and(|extension| extension == "pack")).count() <= PACK_LIMIT
}

#[cfg(test)]
#[path = "git_store_tests.rs"]
mod tests;
