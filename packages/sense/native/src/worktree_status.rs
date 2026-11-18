//! `git status`, asked in-process: what the working tree and the index say
//! instead of `HEAD`, below the root.
//!
//! Three questions, answered where the snapshot already holds the answers'
//! inputs. The index against `HEAD`'s blobs, which `Head::blobs` lists while
//! the other two are walked. The worktree against the index, by `gix-status`,
//! which reads the stat of every entry and hashes only the files whose stat
//! moved. And the untracked files, by `gix-dir` under the repository's ignore
//! rules.
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
use std::path::Path;
use std::sync::atomic::AtomicBool;

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
    let on = |value: &[u8]| !crate::git::git_porcelain::falsy(value);
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

/// The working tree against the index, walked before `HEAD`'s blobs are in
/// hand: what `Walked::against` compares them with.
pub(crate) struct Walked {
    prefix: Vec<u8>,
    index: gix_index::File,
    removed: Paths,
    dirty: Paths,
    untracked: Paths,
}

/// The working tree walked against the index below the root, or `None` where
/// `git status` must answer.
pub(crate) fn walk(head: &Head, config: &Config) -> Option<Walked> {
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
    // gix-status passes over a skip-worktree entry, which a sparse checkout
    // sets without a sparse index; git reads one written back to disk.
    let handed = |entry: &gix_index::Entry| entry.mode == Mode::COMMIT || entry.flags.contains(gix_index::entry::Flags::SKIP_WORKTREE);
    if index.is_sparse() || index.entries().iter().any(|entry| handed(entry) && below(entry)) {
        return None;
    }

    let (worktree, untracked) = std::thread::scope(|scope| {
        let untracked = scope.spawn(|| super::worktree_untracked::untracked(head, &index, config));
        (worktree(head, &index, config), untracked.join().ok().flatten())
    });
    let (removed, dirty) = worktree?;
    Some(Walked { prefix: prefix.to_vec(), index, removed, dirty, untracked: untracked? })
}

impl Walked {
    /// Every path below the root the working tree or the index disagrees with
    /// `held` about.
    pub(crate) fn against(self, held: &[(Vec<u8>, ObjectId, bool)]) -> Changes {
    let Walked { prefix, index, removed, mut dirty, untracked } = self;
    let prefix = prefix.as_slice();

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
    Changes { gone: gone.into_iter().collect(), dirty: dirty.into_iter().collect() }
    }
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

/// The root as a literal pathspec, or none at the top of the checkout.
pub(crate) fn pathspec(prefix: &[u8], top: &Path) -> Option<gix_pathspec::Search> {
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
        // A file is hashed as it streams, so a large one is never held whole.
        let id = if entry.mode == Mode::SYMLINK {
            std::fs::read_link(&path).ok().and_then(|target| gix_path::into_bstr(target).ok()).and_then(|target| gix_object::compute_hash(gix_hash::Kind::Sha1, gix_object::Kind::Blob, &target).ok())
        } else {
            std::fs::File::open(&path).ok().and_then(|mut file| {
                let len = file.metadata().ok()?.len();
                let mut progress = gix_utils::progress::Discard;
                gix_object::compute_stream_hash(gix_hash::Kind::Sha1, gix_object::Kind::Blob, &mut file, len, &mut progress, &AtomicBool::new(false)).ok()
            })
        };
        let same = id == Some(entry.id);
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
