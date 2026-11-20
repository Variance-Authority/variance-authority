//! The untracked half of `git status`: every untracked file below the root,
//! walked by several threads under the repository's ignore rules.

// compass: variance-authority.reach.source-scan

use std::collections::BTreeSet;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};

use bstr::ByteSlice;
use gix_worktree::stack::state::{ignore::Source, Ignore};
use gix_worktree::stack::State;

use super::worktree_status::{pathspec, Config};
use crate::git_store::Checkout;

/// Every untracked file or link below the root, under the repository's ignore
/// rules, listed one by one rather than collapsed into its directory. A
/// repository nested below the root is its own, and lists nothing here.
///
/// Git walks one directory at a time, and the walk is most of what `status`
/// costs. Here a walker meeting a tracked directory while the queue runs short
/// hands it over instead of descending, so every walker has work.
pub(crate) fn untracked(head: &Checkout, index: &gix_index::File, config: &Config) -> Option<BTreeSet<Vec<u8>>> {
    untracked_below(head, index, config, vec![head.prefix.as_bytes().trim_end_with(|c| c == '/').to_vec()])
}

/// `untracked`, below `dirs` alone, each named from the top of the checkout
/// and none below another: a directory the walk enters is still classified
/// from the top, so one git ignores lists nothing.
pub(crate) fn untracked_below(head: &Checkout, index: &gix_index::File, config: &Config, dirs: Vec<Vec<u8>>) -> Option<BTreeSet<Vec<u8>>> {
    let top = head.top.as_path();
    let mut buf = Vec::new();
    let globals = gix_ignore::Search::from_git_dir(&head.common, excludes_file(config, top)?, &mut buf, Default::default()).ok()?;
    let lookup = config.ignore_case.then(|| index.prepare_icase_backing());
    let git_dir = gix_path::realpath(&head.git_dir).ok()?;
    let threads = std::thread::available_parallelism().map_or(1, usize::from).min(WALKERS);
    let queue = Queue { state: Mutex::new((dirs, 0)), ready: Condvar::new(), wanted: threads * 2 };
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
    head: &'a Checkout,
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

/// `core.excludesFile`, or git's default beside the user's configuration; none
/// when it names another user's home or git's install prefix, which only git
/// resolves.
fn excludes_file(config: &Config, top: &Path) -> Option<Option<PathBuf>> {
    match &config.excludes_file {
        Some(named) => match named.strip_prefix(b"~") {
            Some(home) if home.is_empty() || home.starts_with(b"/") => {
                let home = gix_path::from_bstr(home.trim_start_with(|c| c == '/').as_bstr()).ok()?;
                Some(gix_path::env::home_dir().map(|dir| dir.join(home)))
            }
            Some(_) => None,
            None if named.starts_with(b"%(prefix)/") => None,
            None => Some(Some(top.join(gix_path::from_bstr(named.as_bstr()).ok()?))),
        },
        None => Some(user_excludes(&mut |name| std::env::var_os(name))),
    }
}

/// Git's default excludes file, under `XDG_CONFIG_HOME` or `HOME`; an empty
/// `XDG_CONFIG_HOME` is unset to git.
pub(crate) fn user_excludes(env: &mut dyn FnMut(&str) -> Option<std::ffi::OsString>) -> Option<PathBuf> {
    gix_path::env::xdg_config("ignore", &mut |name| env(name).filter(|value| name != "XDG_CONFIG_HOME" || !value.is_empty()))
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
