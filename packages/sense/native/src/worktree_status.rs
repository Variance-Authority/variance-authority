//! `git status`, asked in-process: what the working tree and the index say
//! instead of `HEAD`, below the root.
//!
//! Three questions, answered where the snapshot already holds the answers'
//! inputs. The index against `HEAD`'s blobs, which `git_store::head` has just
//! listed. The worktree against the index, by `gix-status`, which reads the
//! stat of every entry and hashes only the files whose stat moved. And the
//! untracked files, by `gix-dir` under the repository's ignore rules.
//!
//! A file is compared by its raw bytes, not through `.gitattributes` filters:
//! the snapshot's digest names the bytes on disk, so a raw hash is the exact
//! test, and a file a filter would call clean is hashed again by `git` rather
//! than vouched for.
//!
//! `None` hands the question back to `git status`: where a filesystem monitor
//! holds the answers, under a sparse index, with a submodule below the root,
//! or in a repository that does not name its objects by SHA-1.

// compass: variance-authority.reach.source-scan

use std::collections::{BTreeSet, HashMap, HashSet};
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};

use bstr::ByteSlice;
use gix_hash::ObjectId;
use gix_index::entry::{Mode, Stage};
use gix_status::index_as_worktree::traits::{CompareBlobs, ReadData, SubmoduleStatus};
use gix_status::index_as_worktree::{Change, EntryStatus, Recorder};
use gix_worktree::stack::state::{ignore::Source, Ignore};
use gix_worktree::stack::State;

use crate::git_store::Head;

/// What the working tree says instead of `HEAD`, relative to the root: paths
/// no longer there, and paths whose bytes may differ from the committed blob.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Changes {
    pub(crate) gone: Vec<Vec<u8>>,
    pub(crate) dirty: Vec<Vec<u8>>,
}

/// The repository settings `status` reads, from the same
/// `git config --get-regexp` call as the untracked settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Config {
    pub(crate) fsmonitor: bool,
    pub(crate) ignore_case: bool,
    pub(crate) precompose_unicode: bool,
    pub(crate) file_mode: bool,
    pub(crate) symlinks: bool,
    pub(crate) trust_ctime: bool,
    pub(crate) check_stat: bool,
    pub(crate) excludes_file: Option<Vec<u8>>,
}

/// The keys `config_of` reads, as `git config --get-regexp` spells them.
pub(crate) const KEYS: &str = r"core\.(excludesfile|ignorecase|precomposeunicode|fsmonitor|filemode|symlinks|trustctime|checkstat)";

/// `git config -z --get-regexp` output as the settings it names, a later file
/// winning; none set is git's default.
pub(crate) fn config_of(listed: &[u8]) -> Config {
    let on = |value: &[u8]| !crate::git_porcelain::falsy(value);
    let mut config = Config {
        fsmonitor: false,
        ignore_case: false,
        precompose_unicode: false,
        file_mode: true,
        symlinks: true,
        trust_ctime: true,
        check_stat: true,
        excludes_file: None,
    };
    for entry in listed.split(|byte| *byte == 0).filter(|entry| !entry.is_empty()) {
        let (key, value) = match entry.iter().position(|byte| *byte == b'\n') {
            Some(newline) => (&entry[..newline], &entry[newline + 1..]),
            None => (entry, b"true".as_slice()),
        };
        match key {
            b"core.fsmonitor" => config.fsmonitor = on(value),
            b"core.ignorecase" => config.ignore_case = on(value),
            b"core.precomposeunicode" => config.precompose_unicode = on(value),
            b"core.filemode" => config.file_mode = on(value),
            b"core.symlinks" => config.symlinks = on(value),
            b"core.trustctime" => config.trust_ctime = on(value),
            b"core.checkstat" => config.check_stat = !value.eq_ignore_ascii_case(b"minimal"),
            b"core.excludesfile" => config.excludes_file = Some(value.to_vec()),
            _ => {}
        }
    }
    config
}

/// Every path below the root the working tree or the index disagrees with
/// `held` about, or `None` where `git status` must answer.
pub(crate) fn changes(head: &Head, held: &[(Vec<u8>, ObjectId, bool)], config: &Config) -> Option<Changes> {
    if head.format != "sha1" || config.fsmonitor {
        return None;
    }
    let prefix = head.prefix.as_bytes();
    let index = gix_index::File::at(&head.index, gix_hash::Kind::Sha1, false, Default::default()).ok()?;
    let below = |entry: &gix_index::Entry| entry.path(&index).starts_with(prefix);
    // An index holding git's untracked cache lets `status` skip the walk:
    // on Kibana it answers in 0.28 s, against 0.6 s compared here.
    if index.untracked().is_some() {
        return None;
    }
    if index.is_sparse() || index.entries().iter().any(|entry| entry.mode == Mode::COMMIT && below(entry)) {
        return None;
    }

    let (worktree, untracked) = std::thread::scope(|scope| {
        let untracked = scope.spawn(|| untracked(head, &index, config));
        (worktree(head, &index, config), untracked.join().ok().flatten())
    });
    let (removed, mut dirty) = worktree?;
    let untracked = untracked?;

    // The index against `HEAD`: a path staged away is gone unless a conflict
    // holds it, and a path staged with other contents or another kind is edited.
    let committed: HashMap<&[u8], (ObjectId, bool)> = held.iter().map(|(path, id, link)| (path.as_slice(), (*id, *link))).collect();
    let mut staged: HashSet<&[u8]> = HashSet::new();
    let mut conflicted: HashSet<&[u8]> = HashSet::new();
    for entry in index.entries() {
        let Some(path) = entry.path(&index).strip_prefix(prefix) else {
            continue;
        };
        if entry.stage() != Stage::Unconflicted {
            conflicted.insert(path);
            continue;
        }
        staged.insert(path);
        if committed.get(path) != Some(&(entry.id, entry.mode == Mode::SYMLINK)) {
            dirty.insert(path.to_vec());
        }
    }
    let mut gone: BTreeSet<Vec<u8>> = removed;
    for path in committed.keys().filter(|path| !staged.contains(*path)) {
        if conflicted.contains(*path) {
            dirty.insert(path.to_vec());
        } else {
            gone.insert(path.to_vec());
        }
    }
    // A path unstaged with `git rm --cached` is gone from the index and back
    // on disk as untracked: git lists it both ways, and its bytes are listed.
    gone.retain(|path| !untracked.contains(path));
    dirty.extend(untracked);
    dirty.retain(|path| !gone.contains(path));
    Some(Changes { gone: gone.into_iter().collect(), dirty: dirty.into_iter().collect() })
}

type Paths = BTreeSet<Vec<u8>>;

/// The worktree against the index: paths removed, and paths edited, changed
/// in kind or mode, conflicted or only intended to be added.
fn worktree(head: &Head, index: &gix_index::File, config: &Config) -> Option<(Paths, Paths)> {
    let prefix = head.prefix.as_bytes();
    let top = head.top.as_path();
    let stack = gix_worktree::Stack::new(top, State::IgnoreStack(empty_ignore(Default::default())), case(config), Vec::new(), Vec::new());
    let context = gix_status::index_as_worktree::Context {
        pathspec: pathspec(prefix, top)?,
        stack,
        filter: gix_filter::Pipeline::new(gix_command::Context::default(), gix_hash::Kind::Sha1, Default::default()),
        should_interrupt: &AtomicBool::new(false),
    };
    let options = gix_status::index_as_worktree::Options {
        fs: gix_fs::Capabilities {
            precompose_unicode: config.precompose_unicode,
            ignore_case: config.ignore_case,
            executable_bit: config.file_mode,
            symlink: config.symlinks,
        },
        thread_limit: None,
        stat: gix_index::entry::stat::Options { trust_ctime: config.trust_ctime, check_stat: config.check_stat, use_nsec: true, use_stdev: false },
        fscache: false,
    };
    let mut recorder = Recorder::<(), ()>::default();
    let compare = OnDisk { state: index, top };
    let objects = gix_object::find::Never;
    gix_status::index_as_worktree(index, top, &mut recorder, compare, NoSubmodules, objects, &mut gix_utils::progress::Discard, context, options).ok()?;

    let (mut removed, mut dirty) = (BTreeSet::new(), BTreeSet::new());
    for record in recorder.records {
        let Some(path) = record.relative_path.strip_prefix(prefix) else {
            continue;
        };
        match record.status {
            EntryStatus::NeedsUpdate(_) => {}
            EntryStatus::Change(Change::Modification { executable_bit_changed: false, content_change: None, .. }) => {}
            EntryStatus::Change(Change::Removed) => {
                removed.insert(path.to_vec());
            }
            _ => {
                dirty.insert(path.to_vec());
            }
        }
    }
    Some((removed, dirty))
}

/// Every untracked file or link below the root, under the repository's ignore
/// rules, listed one by one rather than collapsed into its directory. A
/// repository nested below the root is its own, and lists nothing here.
///
/// Git walks one directory at a time, and the walk is most of what `status`
/// costs. Here a walker meeting a tracked directory while the queue runs short
/// hands it over instead of descending, so every walker has work.
fn untracked(head: &Head, index: &gix_index::File, config: &Config) -> Option<BTreeSet<Vec<u8>>> {
    let top = head.top.as_path();
    let mut buf = Vec::new();
    let globals = gix_ignore::Search::from_git_dir(&head.common, excludes_file(config, top), &mut buf, Default::default()).ok()?;
    let lookup = config.ignore_case.then(|| index.prepare_icase_backing());
    let git_dir = gix_path::realpath(&head.git_dir).ok()?;
    let threads = std::thread::available_parallelism().map_or(1, usize::from).min(WALKERS);
    let queue = Queue { state: Mutex::new((vec![head.prefix.as_bytes().trim_end_with(|c| c == '/').to_vec()], 0)), ready: Condvar::new(), wanted: threads * 2 };
    let failed = AtomicBool::new(false);
    let walked: Vec<BTreeSet<Vec<u8>>> = std::thread::scope(|scope| {
        let walkers: Vec<_> = (0..threads)
            .map(|_| {
                let (queue, failed, globals, lookup, git_dir) = (&queue, &failed, globals.clone(), lookup.as_ref(), git_dir.as_path());
                scope.spawn(move || {
                    let ignore = Ignore::new(Default::default(), globals, None, Source::WorktreeThenIdMappingIfNotSkipped, Default::default());
                    let excludes = gix_worktree::Stack::from_state_and_ignore_case(top, config.ignore_case, State::IgnoreStack(ignore), index, index.path_backing());
                    let Some(pathspec) = pathspec(head.prefix.as_bytes(), top) else {
                        failed.store(true, Ordering::Relaxed);
                        return BTreeSet::new();
                    };
                    let mut walker = Walker { head, index, config, lookup, git_dir, excludes, pathspec, queue, found: BTreeSet::new() };
                    while let Some(dir) = queue.take() {
                        let _done = Done(queue);
                        if walker.walk(&dir).is_none() {
                            failed.store(true, Ordering::Relaxed);
                        }
                    }
                    walker.found
                })
            })
            .collect();
        walkers
            .into_iter()
            .map(|walker| {
                walker.join().unwrap_or_else(|_| {
                    failed.store(true, Ordering::Relaxed);
                    BTreeSet::new()
                })
            })
            .collect()
    });
    if failed.load(Ordering::Relaxed) {
        return None;
    }
    Some(walked.into_iter().flatten().collect())
}

/// Marks a taken directory walked when dropped, so a walker that panics
/// still lets the others finish.
struct Done<'a>(&'a Queue);

impl Drop for Done<'_> {
    fn drop(&mut self) {
        self.0.done();
    }
}

/// How many walkers share the untracked walk. On Kibana's 134,729 paths four
/// walk it in 0.41 s against one's 0.77 s, and more walk it slower: they queue
/// on the filesystem rather than on each other.
const WALKERS: usize = 4;

/// Directories waiting for a walker, and how many walks are under way: the
/// walk is over when both are none.
struct Queue {
    state: Mutex<(Vec<Vec<u8>>, usize)>,
    ready: Condvar,
    wanted: usize,
}

impl Queue {
    fn take(&self) -> Option<Vec<u8>> {
        let mut state = self.state.lock().ok()?;
        loop {
            if let Some(dir) = state.0.pop() {
                state.1 += 1;
                return Some(dir);
            }
            if state.1 == 0 {
                return None;
            }
            state = self.ready.wait(state).ok()?;
        }
    }

    fn done(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.1 -= 1;
            if state.1 == 0 && state.0.is_empty() {
                self.ready.notify_all();
            }
        }
    }

    /// Takes `dir` when the walkers are short of work.
    fn offer(&self, dir: &[u8]) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if state.0.len() >= self.wanted {
            return false;
        }
        state.0.push(dir.to_vec());
        self.ready.notify_one();
        true
    }
}

/// One thread's walks, with its own ignore stack and pathspec.
struct Walker<'a> {
    head: &'a Head,
    index: &'a gix_index::File,
    config: &'a Config,
    lookup: Option<&'a gix_index::AccelerateLookup<'a>>,
    git_dir: &'a Path,
    excludes: gix_worktree::Stack,
    pathspec: gix_pathspec::Search,
    queue: &'a Queue,
    found: BTreeSet<Vec<u8>>,
}

impl Walker<'_> {
    fn walk(&mut self, dir: &[u8]) -> Option<()> {
        let (top, config, index) = (self.head.top.as_path(), self.config, self.index);
        let root = top.join(gix_path::from_bstr(dir.as_bstr()).ok()?);
        let context = gix_dir::walk::Context {
            should_interrupt: None,
            git_dir_realpath: self.git_dir,
            current_dir: top,
            index,
            ignore_case_index_lookup: self.lookup,
            pathspec: &mut self.pathspec,
            pathspec_attributes: &mut |_, _, _, _| false,
            excludes: Some(&mut self.excludes),
            objects: &gix_object::find::Never,
            explicit_traversal_root: Some(&root),
        };
        let options = gix_dir::walk::Options {
            precompose_unicode: config.precompose_unicode,
            ignore_case: config.ignore_case,
            recurse_repositories: false,
            emit_pruned: false,
            emit_ignored: None,
            for_deletion: None,
            classify_untracked_bare_repositories: false,
            emit_tracked: false,
            emit_untracked: gix_dir::walk::EmissionMode::Matching,
            emit_empty_directories: false,
            emit_collapsed: None,
            symlinks_to_directories_are_ignored_like_directories: false,
            worktree_relative_worktree_dirs: None,
        };
        let mut found = Untracked { prefix: self.head.prefix.as_bytes(), root: dir, queue: self.queue, found: &mut self.found };
        gix_dir::walk(top, context, options, &mut found).ok()?;
        Some(())
    }
}

/// `core.excludesFile`, or git's default beside the user's configuration.
fn excludes_file(config: &Config, top: &Path) -> Option<PathBuf> {
    match &config.excludes_file {
        Some(named) => {
            let named = gix_path::from_bstr(named.as_bstr()).ok()?;
            match named.strip_prefix("~") {
                Ok(home) => gix_path::env::home_dir().map(|dir| dir.join(home)),
                Err(_) => Some(top.join(named)),
            }
        }
        None => gix_path::env::xdg_config("ignore", &mut |name| std::env::var_os(name)),
    }
}

/// The root as a literal pathspec, or none at the top of the checkout.
fn pathspec(prefix: &[u8], top: &Path) -> Option<gix_pathspec::Search> {
    let trimmed = prefix.trim_end_with(|c| c == '/');
    let patterns = if trimmed.is_empty() {
        Vec::new()
    } else {
        vec![gix_pathspec::parse(trimmed, gix_pathspec::Defaults { literal: true, ..Default::default() }).ok()?]
    };
    gix_pathspec::Search::from_specs(patterns, None, top).ok()
}

fn case(config: &Config) -> gix_worktree::glob::pattern::Case {
    if config.ignore_case { gix_worktree::glob::pattern::Case::Fold } else { gix_worktree::glob::pattern::Case::Sensitive }
}

fn empty_ignore(globals: gix_ignore::Search) -> Ignore {
    Ignore::new(Default::default(), globals, None, Source::IdMapping, Default::default())
}

/// Compares an entry with the raw bytes on disk, or the path a link holds.
#[derive(Clone)]
struct OnDisk<'a> {
    state: &'a gix_index::State,
    top: &'a Path,
}

impl CompareBlobs for OnDisk<'_> {
    type Output = ();

    fn compare_blobs<'a, 'b>(&mut self, entry: &gix_index::Entry, size: u64, _: impl ReadData<'a>, _: &mut Vec<u8>) -> gix_error::Result<Option<()>> {
        // A size that moved is an edit, unless the index zeroed it to mark the entry racy.
        if u64::from(entry.stat.size) != size && (entry.id.is_empty_blob() || entry.stat.size != 0) {
            return Ok(Some(()));
        }
        let Ok(path) = gix_path::from_bstr(entry.path_in(self.state.path_backing())) else {
            return Ok(Some(()));
        };
        let path = self.top.join(path);
        let bytes = if entry.mode == Mode::SYMLINK {
            std::fs::read_link(&path).ok().and_then(|target| gix_path::into_bstr(target).ok().map(|target| target.to_vec()))
        } else {
            std::fs::read(&path).ok()
        };
        let same = bytes.and_then(|bytes| gix_object::compute_hash(gix_hash::Kind::Sha1, gix_object::Kind::Blob, &bytes).ok()) == Some(entry.id);
        Ok((!same).then_some(()))
    }
}

/// A submodule below the root sends `status` back to git before this runs.
#[derive(Clone)]
struct NoSubmodules;

impl SubmoduleStatus for NoSubmodules {
    type Output = ();

    fn status(&mut self, _: &gix_index::Entry, _: &bstr::BStr) -> gix_error::Result<Option<()>> {
        Ok(None)
    }
}

struct Untracked<'a> {
    prefix: &'a [u8],
    /// The directory this walk started from, which it descends itself.
    root: &'a [u8],
    queue: &'a Queue,
    found: &'a mut BTreeSet<Vec<u8>>,
}

impl gix_dir::walk::Delegate for Untracked<'_> {
    fn emit(&mut self, entry: gix_dir::EntryRef<'_>, _: Option<gix_dir::entry::Status>) -> gix_dir::walk::Action {
        use gix_dir::entry::{Kind, Status};
        if entry.status == Status::Untracked && matches!(entry.disk_kind, Some(Kind::File | Kind::Symlink)) {
            if let Some(path) = entry.rela_path.strip_prefix(self.prefix) {
                self.found.insert(path.to_vec());
            }
        }
        ControlFlow::Continue(())
    }

    fn can_recurse(&mut self, entry: gix_dir::EntryRef<'_>, for_deletion: Option<gix_dir::walk::ForDeletionMode>, worktree_root_is_repository: bool) -> bool {
        use gix_dir::entry::{Kind, Status};
        let handed = entry.status == Status::Tracked && entry.disk_kind == Some(Kind::Directory) && entry.rela_path.as_bytes() != self.root && self.queue.offer(&entry.rela_path);
        !handed && entry.status.can_recurse(entry.disk_kind, entry.pathspec_match, for_deletion, worktree_root_is_repository)
    }
}

