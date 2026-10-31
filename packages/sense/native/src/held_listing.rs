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
    /// `UpdateOptions.config` and `Updated.files` of the update that wrote it.
    pub config: Option<String>,
    pub files: u32,
}

/// How a tree was come by, for the update made against it.
pub(crate) enum Change {
    /// Read back from the chain: Watchman reports nothing since its clock.
    Vouched(Meta),
    /// Listed by git under a watch, to be carried by what the update writes.
    Listed(Meta),
}

/// The files whose change moves what git lists: HEAD and what it points at,
/// the index, the exclude files, and every configuration file git read.
fn inputs(root: &str) -> Option<Vec<PathBuf>> {
    let dirs = git::git(root, &["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], None)?;
    let dirs = String::from_utf8(dirs).ok()?;
    let mut lines = dirs.lines();
    let (dir, common) = (PathBuf::from(lines.next()?), PathBuf::from(lines.next()?));
    let mut inputs = vec![dir.join("HEAD"), dir.join("index"), common.join("packed-refs"), common.join("info/exclude")];
    if let Ok(head) = std::fs::read_to_string(dir.join("HEAD")) {
        if let Some(reference) = head.trim().strip_prefix("ref: ") {
            inputs.push(common.join(reference));
        }
    }
    // `-z` prints the origin, then the key and value split by a newline, each ended by NUL.
    let config = git::git(root, &["config", "--show-origin", "--list", "-z"], None).unwrap_or_default();
    let mut fields = config.split(|byte| *byte == 0);
    while let (Some(origin), Some(entry)) = (fields.next(), fields.next()) {
        let origin = String::from_utf8_lossy(origin);
        if let Some(file) = origin.strip_prefix("file:") {
            inputs.push(Path::new(root).join(file));
        }
        let entry = String::from_utf8_lossy(entry);
        if let Some(excludes) = entry.strip_prefix("core.excludesfile\n") {
            inputs.push(Path::new(root).join(excludes));
        }
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| home.as_ref().map(|home| home.join(".config")));
    inputs.extend(home.map(|home| home.join(".gitconfig")));
    inputs.extend(config.into_iter().flat_map(|config| [config.join("git/config"), config.join("git/ignore")]));
    inputs.sort();
    inputs.dedup();
    Some(inputs)
}

fn stamped(inputs: &[PathBuf]) -> Vec<(String, Option<Stamp>)> {
    inputs.iter().map(|input| (input.to_string_lossy().into_owned(), stamp(input))).collect()
}

/// The listing the newest segment of the chain at `index` holds, and when it stands.
fn held(index: &str) -> Option<(Snapshot, Meta)> {
    let (digests, _) = crate::index_chain::manifest_digests(index)?;
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
    (oids.len() == paths.len() && regular.len() == paths.len()).then_some((Snapshot { paths, oids, regular, unhashed }, meta))
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

/// The tree under `root` for an update of the index at `index`: the held one when
/// Watchman vouches for it, else git's, with what makes it carried when a watch covers `root`.
pub(crate) fn change_tree(root: &str, index: &str, dirs: &[String]) -> Option<(Snapshot, Option<Change>)> {
    let held = held(index);
    let socket = watchman::socket(Path::new(&format!("{index}.watchman.json")));
    let excluded = Path::new(index).parent().and_then(|parent| parent.strip_prefix(root).ok()).map(|parent| parent.to_string_lossy().into_owned()).filter(|parent| !parent.is_empty());
    if let (Some(socket), Some((snapshot, meta))) = (&socket, held) {
        let vouched = meta.watch.socket == *socket
            && meta.dirs == dirs
            && meta.watch.ignored.is_empty()
            && meta.inputs.iter().all(|(input, was)| stamp(Path::new(input)) == *was)
            && watchman::since(&meta.watch, excluded.as_deref()).is_some_and(|since| !since.fresh && ignores_all(root, &since.files));
        if vouched {
            return Some((snapshot, Some(Change::Vouched(meta))));
        }
    }
    // The clock and the stamps are taken before git lists, so whatever moves while it does is after them.
    let watch = socket.and_then(|socket| watchman::watch(&socket, root));
    let inputs = watch.as_ref().and_then(|_| inputs(root));
    let before = inputs.as_deref().map(stamped);
    let snapshot = git::snapshot(root)?;
    let after = inputs.as_deref().map(stamped);
    let change = match (watch, before) {
        // `status` refreshing the index while it listed is a listing nothing can vouch for yet.
        (Some(watch), Some(before)) if Some(&before) == after.as_ref() => {
            Some(Change::Listed(Meta { watch, dirs: dirs.to_vec(), inputs: before, config: None, files: 0 }))
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
