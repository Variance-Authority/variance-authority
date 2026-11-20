//! Local changes against the same Git index that supplied the inventory.
//! Tracked paths are compared by `gix-status`, and untracked paths walked by
//! `gix-dir`. Git handles monitors, untracked caches and sparse checkouts.
//!
//! Comparison hashes raw working bytes, without attribute filters: a digest
//! may skip a scan only when it names the bytes the scan would read.

// compass: variance-authority.reach.source-scan

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::atomic::AtomicBool;

use bstr::ByteSlice;
use gix_index::entry::Mode;
use gix_status::index_as_worktree::traits::{CompareBlobs, ReadData, SubmoduleStatus};
use gix_status::index_as_worktree::{Change, EntryStatus, Recorder};
use gix_worktree::stack::state::{ignore::Source, Ignore};
use gix_worktree::stack::State;

use crate::git_store::Checkout;

/// Changes relative to the root: removed paths and paths needing working bytes.
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

/// Compare only the working tree: inventory already comes from this index.
pub(crate) fn walk(head: &Checkout, config: &Config, index: &gix_index::File) -> Option<Changes> {
    if !can_compare(head, config, index) { return None; }
    let (worktree, untracked) = std::thread::scope(|scope| {
        let untracked = scope.spawn(|| super::worktree_untracked::untracked(head, index, config));
        (worktree(head, index, config), untracked.join().ok().flatten())
    });
    let (removed, dirty) = worktree?;
    Some(changes(removed, dirty, untracked?))
}

/// Git owns monitor results, untracked-cache reuse, sparse checkout and submodules.
pub(super) fn can_compare(head: &Checkout, config: &Config, index: &gix_index::File) -> bool {
    if head.format != "sha1" || config.fsmonitor || index.untracked().is_some() || index.is_sparse() {
        return false;
    }
    // Git's staged delta still exposes an assumed-valid path the native walk skips.
    let handed = |entry: &gix_index::Entry| entry.mode == Mode::COMMIT || entry.flags.intersects(gix_index::entry::Flags::SKIP_WORKTREE | gix_index::entry::Flags::ASSUME_VALID);
    !index.entries().iter().any(|entry| handed(entry) && entry.path(index).starts_with(head.prefix.as_bytes()))
}

/// A path removed from the index can still be an untracked file on disk.
pub(super) fn changes(mut gone: Paths, mut dirty: Paths, untracked: Paths) -> Changes {
    gone.retain(|path| !untracked.contains(path));
    dirty.extend(untracked);
    dirty.retain(|path| !gone.contains(path));
    Changes { gone: gone.into_iter().collect(), dirty: dirty.into_iter().collect() }
}

pub(super) type Paths = BTreeSet<Vec<u8>>;

/// The worktree against the index: paths removed, and paths edited, changed
/// in kind or mode, conflicted or only intended to be added.
pub(super) fn worktree(head: &Checkout, index: &gix_index::File, config: &Config) -> Option<(Paths, Paths)> {
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
