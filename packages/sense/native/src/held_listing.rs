//! The tree an update was made against, carried by the generation it wrote.
//!
//! Spec 0107: the newest segment of the chain holds, in `listing.*` sections
//! the reader's decode never opens, every path with its object name and the
//! facts that say when that listing still stands — the Watchman clock taken
//! before git listed it, the watch it was taken on, and the files git reads to
//! answer `status`. The next update asks Watchman what moved since that clock;
//! nothing moved, and none of git's own inputs changed, is the listing as held,
//! with no git run. Anything else lists with git, as before, and the listing
//! is carried forward from there.

// compass: variance-authority.reach.source-index

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::git::{self, Oid, Snapshot};
use crate::segment::{self, Column};
use crate::stored::Stored;
use crate::watchman::{self, Watch};

const PATHS: &str = "listing.paths";
const OIDS: &str = "listing.oids";
const REGULAR: &str = "listing.regular";
const UNHASHED: &str = "listing.unhashed";
const META: &str = "listing.meta";

/// What a file looked like when the listing was taken; `None` is a file not there.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Stamp {
    size: u64,
    modified: i64,
    nanos: i64,
    changed: i64,
    inode: u64,
}

fn stamp(path: &Path) -> Option<Stamp> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::metadata(path).ok()?;
    Some(Stamp { size: metadata.size(), modified: metadata.mtime(), nanos: metadata.mtime_nsec(), changed: metadata.ctime_nsec() + metadata.ctime() * 1_000_000_000, inode: metadata.ino() })
}

/// When a held listing still stands, beside it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Meta {
    pub watch: Watch,
    /// The roots the seeds were taken from.
    pub dirs: Vec<String>,
    /// Each file git reads to answer `ls-tree HEAD` and `status`, and how it looked.
    pub inputs: Vec<(String, Option<Stamp>)>,
    /// Git's own directories: what moves in them is git's, and the inputs say whether it matters.
    pub git: Vec<String>,
    /// `UpdateOptions.config` and `Updated.files` of the update that wrote it.
    pub config: Option<String>,
    pub files: u32,
}

/// How a tree was come by, for the update made against it.
pub(crate) enum Change {
    /// Read back from the chain whose manifest is `.1`: Watchman reports nothing since its clock.
    Vouched(Meta, Vec<u8>),
    /// Listed by git under a watch, to be carried by what the update writes.
    Listed(Meta),
}

/// Git's directories, and the files whose change moves what git lists: HEAD
/// and what it points at, the index, the exclude and attribute files, and
/// every configuration file git read.
fn inputs(root: &str) -> Option<(Vec<String>, Vec<PathBuf>)> {
    // Three questions none of which waits on another: asked at once, they cost one spawn's time.
    // `--path` reads `core.excludesfile` and `core.attributesFile` as git expands them, `~/` included.
    let (dirs, config, named) = std::thread::scope(|scope| {
        let dirs = scope.spawn(|| git::git(root, &["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--symbolic-full-name", "HEAD"], None));
        let config = scope.spawn(|| git::git(root, &["config", "--show-origin", "--list", "-z"], None));
        let named = git::git(root, &["config", "--path", "-z", "--get-regexp", r"^core\.(excludesfile|attributesfile)$"], None);
        (dirs.join().ok().flatten(), config.join().ok().flatten(), named)
    });
    let dirs = String::from_utf8(dirs?).ok()?;
    let mut lines = dirs.lines();
    let (dir, common) = (PathBuf::from(lines.next()?), PathBuf::from(lines.next()?));
    let mut inputs = vec![dir.join("HEAD"), dir.join("index"), common.join("packed-refs"), common.join("info/exclude"), common.join("info/attributes")];
    // The branch HEAD names; a detached HEAD prints `HEAD`, which is already stamped.
    inputs.extend(lines.next().filter(|reference| reference.starts_with("refs/")).map(|reference| common.join(reference)));
    // `-z` prints the origin, then the key and value split by a newline, each ended by NUL.
    // A configuration git could not read is one nothing can vouch for.
    let config = config?;
    let mut fields = config.split(|byte| *byte == 0);
    while let (Some(origin), Some(_)) = (fields.next(), fields.next()) {
        if let Some(file) = String::from_utf8_lossy(origin).strip_prefix("file:") {
            inputs.push(Path::new(root).join(file));
        }
    }
    // Exits 1 when neither is set.
    for entry in named.unwrap_or_default().split(|byte| *byte == 0) {
        if let Some((_, file)) = String::from_utf8_lossy(entry).split_once('\n') {
            inputs.push(Path::new(root).join(file));
        }
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| home.as_ref().map(|home| home.join(".config")));
    inputs.extend(home.map(|home| home.join(".gitconfig")));
    inputs.extend(config.into_iter().flat_map(|config| [config.join("git/config"), config.join("git/ignore"), config.join("git/attributes")]));
    inputs.sort();
    inputs.dedup();
    let mut git = vec![dir.to_string_lossy().into_owned(), common.to_string_lossy().into_owned()];
    git.dedup();
    Some((git, inputs))
}

fn stamped(inputs: &[PathBuf]) -> Vec<(String, Option<Stamp>)> {
    inputs.iter().map(|input| (input.to_string_lossy().into_owned(), stamp(input))).collect()
}

/// The listing the newest segment of the chain at `index` holds, when it stands, and the manifest it was read under.
fn held(index: &str) -> Option<(Snapshot, Meta, Vec<u8>)> {
    let manifest = std::fs::read(index).ok()?;
    let (digests, _) = crate::index_chain::manifest_digests_of(&manifest)?;
    let newest = crate::index_chain::read_tail(index, &digests, digests.len().checked_sub(1)?)?.pop()?;
    let stored = Stored::open(&newest).ok()?;
    let meta: Meta = serde_json::from_slice(stored.maybe_u8s(META).ok()??).ok()?;
    let strings = |name| -> Option<Vec<String>> {
        let bytes = stored.u8s(name).ok()?;
        if bytes.is_empty() { return Some(Vec::new()) }
        Some(bytes.split(|byte| *byte == 0).map(|path| String::from_utf8_lossy(path).into_owned()).collect())
    };
    let paths = strings(PATHS)?;
    let oids: Vec<Oid> = stored.u8s(OIDS).ok()?.chunks_exact(20).map(|oid| oid.try_into().unwrap_or([0; 20])).collect();
    let regular: Vec<bool> = stored.u8s(REGULAR).ok()?.iter().map(|byte| *byte == 1).collect();
    let unhashed = strings(UNHASHED)?;
    (oids.len() == paths.len() && regular.len() == paths.len()).then_some((Snapshot { paths, oids, regular, unhashed }, meta, manifest))
}

/// Git ignores every one of `paths` under `root`, so none of them is in a listing.
/// A tool's cache, a build's output: most of what moves in a checkout is these.
/// A tracked file is never ignored, whatever pattern matches it.
fn ignores_all(root: &str, paths: &[String]) -> bool {
    if paths.is_empty() {
        return true;
    }
    let asked: Vec<u8> = paths.iter().flat_map(|path| path.bytes().chain([0])).collect();
    // Exits 1, and so answers `None`, when it ignores none of them.
    git::git(root, &["check-ignore", "--stdin", "-z"], Some(asked))
        .is_some_and(|ignored| ignored.iter().filter(|byte| **byte == 0).count() == paths.len())
}

/// Whether a held listing can still be vouched for, before Watchman is asked:
/// the same checkout, server and roots, a watch that hides none of its paths, and git's inputs as they were.
fn stands(meta: &Meta, paths: &[String], root: &str, socket: &str, dirs: &[String], stamp: impl Fn(&str) -> Option<Stamp>) -> bool {
    // An index shared across checkouts holds another's listing, watch and stamps: none of them speaks for this one.
    let made = meta.watch.relative.as_ref().map_or_else(|| PathBuf::from(&meta.watch.watched), |relative| Path::new(&meta.watch.watched).join(relative));
    made == Path::new(root) && meta.watch.socket == socket && meta.dirs == dirs && meta.watch.ignored.is_empty() && !hides(&meta.watch, paths) && meta.inputs.iter().all(|(input, was)| stamp(input) == *was)
}

/// Whether the watch's `ignore_vcs` directories, which Watchman never reports into,
/// hold a path of the listing. Each names a directory at the watched root.
fn hides(watch: &Watch, paths: &[String]) -> bool {
    watch.vcs.iter().any(|dir| {
        let below = match &watch.relative {
            None => Some(dir.as_str()),
            Some(relative) => dir.strip_prefix(relative.as_str()).and_then(|rest| rest.strip_prefix('/')),
        };
        // A directory above the checkout's root, or beside it, holds nothing of it; one that is the root holds all of it.
        let covers = watch.relative.as_ref().is_some_and(|relative| relative == dir || relative.starts_with(&format!("{dir}/")));
        covers || below.is_some_and(|below| paths.iter().any(|path| path.strip_prefix(below).is_some_and(|rest| rest.starts_with('/'))))
    })
}

/// The tree under `root` for an update of the index at `index`: the held one when
/// Watchman vouches for it, else git's, with what makes it carried when a watch covers `root`.
pub(crate) fn change_tree(root: &str, index: &str, dirs: &[String]) -> Option<(Snapshot, Option<Change>)> {
    let held = held(index);
    let socket = watchman::socket(Path::new(&format!("{index}.watchman.json")));
    // What the update writes, and what git writes as it answers, are left out of what Watchman is asked.
    let below = |dir: &Path| dir.strip_prefix(root).ok().map(|dir| dir.to_string_lossy().into_owned()).filter(|dir| !dir.is_empty());
    let index_dir = Path::new(index).parent().and_then(below);
    if let (Some(socket), Some((snapshot, meta, manifest))) = (&socket, held) {
        let excluded: Vec<String> = index_dir.iter().cloned().chain(meta.git.iter().filter_map(|dir| below(Path::new(dir)))).collect();
        let stands = stands(&meta, &snapshot.paths, root, socket, dirs, |input| stamp(Path::new(input)));
        if stands && watchman::since(&meta.watch, &excluded).is_some_and(|since| !since.fresh && ignores_all(root, &since.files)) {
            return Some((snapshot, Some(Change::Vouched(meta, manifest))));
        }
    }
    // The clock and the stamps are taken before git lists, so whatever moves while it does is after them.
    let (watch, inputs) = std::thread::scope(|scope| {
        let inputs = scope.spawn(|| socket.as_ref().and_then(|_| inputs(root)));
        (socket.as_deref().and_then(|socket| watchman::watch(socket, root)), inputs.join().ok().flatten())
    });
    let (git, inputs) = watch.as_ref().and(inputs).unzip();
    let before = inputs.as_deref().map(stamped);
    let snapshot = git::snapshot(root)?;
    let after = inputs.as_deref().map(stamped);
    let change = match (watch.zip(git), before) {
        // `status` refreshing the index while it listed is a listing nothing can vouch for yet.
        (Some((watch, git)), Some(before)) if Some(&before) == after.as_ref() => {
            Some(Change::Listed(Meta { watch, dirs: dirs.to_vec(), inputs: before, git, config: None, files: 0 }))
        }
        _ => None,
    };
    Some((snapshot, change))
}

/// The listing's sections, for the segment an update writes.
pub(crate) fn columns(paths: &[String], oids: &[Oid], regular: &[bool], unhashed: &[String], meta: &Meta) -> Vec<Column> {
    vec![
        segment::u8s(PATHS, paths.join("\0").into_bytes()),
        segment::u8s(OIDS, oids.concat()),
        segment::u8s(REGULAR, regular.iter().map(|regular| u8::from(*regular)).collect()),
        segment::u8s(UNHASHED, unhashed.join("\0").into_bytes()),
        segment::u8s(META, serde_json::to_vec(meta).unwrap_or_default()),
    ]
}

/// `segment` with the listing sections it held replaced by `listing`.
pub(crate) fn carried(segment: &[u8], listing: Vec<Column>) -> Result<Vec<u8>, String> {
    let stored = Stored::open(segment)?;
    let mut columns: Vec<Column> = stored
        .columns()
        .into_iter()
        .filter(|(name, _, _)| !name.starts_with("listing."))
        .map(|(name, width, bytes)| segment::column(name.to_owned(), width, bytes.to_vec()))
        .collect();
    columns.extend(listing);
    Ok(segment::encode(columns))
}
