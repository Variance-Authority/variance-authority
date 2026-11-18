//! Indexed configuration bytes, owned by the same listing as their namespace.

// compass: variance-authority.reach.source-scan

use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, OnceLock};

use dashmap::DashMap;
use rustc_hash::FxBuildHasher;

use crate::{acquire::TreeObjects, git::{self, Oid}};
use super::listing::Boundary;

type Cell = Arc<OnceLock<Read>>;

pub(super) struct Content {
    root: PathBuf,
    oids: Arc<Vec<Oid>>,
    store: Arc<TreeObjects>,
    rules: OnceLock<Option<Rules>>,
    configurations: DashMap<u32, Cell, FxBuildHasher>,
}

enum Read {
    Bytes(Arc<[u8]>),
    Error(io::ErrorKind, String),
    Transformed,
}

impl From<io::Result<Option<Vec<u8>>>> for Read {
    fn from(read: io::Result<Option<Vec<u8>>>) -> Self {
        match read {
            Ok(Some(bytes)) => Self::Bytes(bytes.into()),
            Ok(None) => Self::Transformed,
            Err(error) => Self::Error(error.kind(), error.to_string()),
        }
    }
}

impl Read {
    fn answer(&self) -> Result<io::Result<Vec<u8>>, Boundary> {
        match self {
            Self::Bytes(bytes) => Ok(Ok(bytes.to_vec())),
            Self::Error(kind, message) => Ok(Err(io::Error::new(*kind, message.clone()))),
            Self::Transformed => Err(Boundary::Transformed),
        }
    }
}

impl Content {
    pub(super) fn new(root: PathBuf, oids: Arc<Vec<Oid>>, store: Arc<TreeObjects>) -> Self {
        Self { root, oids, store, rules: OnceLock::new(), configurations: DashMap::default() }
    }

    pub(super) fn root(&self) -> &Path { &self.root }

    pub(super) fn read<'a>(&self, path: &Path, row: u32, configurations: impl FnOnce() -> Vec<(&'a str, u32)>) -> Result<io::Result<Vec<u8>>, Boundary> {
        let rules = self.rules.get_or_init(|| {
            let mut phases = crate::timings::Phases::new("configuration content", "collect and order paths");
            let mut paths = configurations();
            paths.sort_unstable_by(|left, right| crate::order::code_unit(left.0, right.0));
            phases.note(format_args!("{} indexed configurations", paths.len()));
            phases.next("read Git content rules");
            let rules = Rules::read(&self.root, &paths)?;
            phases.next("acquire indexed configuration blobs");
            self.load_configurations(&rules, &paths);
            Some(rules)
        }).as_ref().ok_or(Boundary::Transformed)?;
        if !rules.blob(&self.root, path, row) { return Err(Boundary::Transformed); }
        if configuration(path) {
            let known = self.configurations.get(&row).map(|cell| Arc::clone(&cell));
            let cell = known.unwrap_or_else(|| Arc::clone(&self.configurations.entry(row).or_default()));
            return cell.get_or_init(|| self.blob(row)).answer();
        }
        self.blob(row).answer()
    }

    fn load_configurations(&self, rules: &Rules, paths: &[(&str, u32)]) {
        let eligible = paths.iter().filter(|(_, row)| rules.paths.get(row).is_some_and(|blob| *blob)).map(|(_, row)| *row).collect::<Vec<_>>();
        let mut phases = crate::timings::Phases::new("configuration blobs", "open object store");
        phases.note(format_args!("{} eligible, {} transformed configurations", eligible.len(), paths.len() - eligible.len()));
        if eligible.is_empty() { return; }
        let objects = self.store.objects_now(&self.root);
        let ids = eligible.iter().filter_map(|row| self.oids.get(*row as usize).copied()).collect::<Vec<_>>();
        phases.next("read indexed blobs");
        let mut read = objects.as_ref().map(|objects| objects.blob_bytes_many(&ids)).unwrap_or_default().into_iter();
        phases.next("retain configuration bytes");
        let (mut bytes, mut transformed, mut failed) = (0usize, 0usize, 0usize);
        for row in eligible {
            let value = if self.oids.get(row as usize).is_none() { Err(io::Error::other("the indexed path has no object identity")) }
                else { read.next().unwrap_or_else(|| Err(io::Error::other("the indexed object store could not read this blob"))) };
            match &value {
                Ok(Some(value)) => bytes += value.len(),
                Ok(None) => transformed += 1,
                Err(_) => failed += 1,
            }
            let cell = Arc::clone(&self.configurations.entry(row).or_default());
            let _ = cell.set(Read::from(value));
        }
        phases.note(format_args!("{} configurations retained, {bytes} bytes, {transformed} transformed blobs, {failed} failures", self.configurations.len()));
    }

    fn blob(&self, row: u32) -> Read {
        let read = || {
            let oid = self.oids.get(row as usize).ok_or_else(|| io::Error::other("the indexed path has no object identity"))?;
            let objects = self.store.objects_now(&self.root).ok_or_else(|| io::Error::other("the indexed object store could not be opened"))?;
            objects.blob_bytes(oid)
        };
        Read::from(read())
    }
}

pub(super) fn configuration(path: &Path) -> bool {
    path.file_name().is_some_and(|name| name == "package.json" || name == "jsconfig.json" || name == "Cargo.toml" || name == "Package.swift" || super::is_config(name))
}

struct Rules {
    autocrlf: bool,
    /// A proof by row, sharing the listing's path map rather than copying it.
    paths: DashMap<u32, bool, FxBuildHasher>,
}

impl Rules {
    fn read(root: &Path, paths: &[(&str, u32)]) -> Option<Self> {
        let mut phases = crate::timings::Phases::new("configuration rules", "read Git configuration");
        let output = Command::new("git").args(["config", "--null", "--type=bool-or-str", "--get-regexp", r"^core\.(autocrlf|eol)$"]).current_dir(root).output().ok()?;
        let listed = match output.status.code() { Some(0) => output.stdout, Some(1) => Vec::new(), _ => return None };
        let mut autocrlf = false;
        for entry in listed.split(|byte| *byte == 0) {
            if let Some(value) = entry.strip_prefix(b"core.autocrlf\n") {
                autocrlf = value.eq_ignore_ascii_case(b"true");
            }
        }
        phases.next("read Git attributes");
        let read = attributes(root, &paths.iter().map(|(path, _)| *path).collect::<Vec<_>>(), autocrlf)?;
        Some(Self { autocrlf, paths: paths.iter().zip(read).map(|((_, row), blob)| (*row, blob)).collect() })
    }

    fn blob(&self, root: &Path, path: &Path, row: u32) -> bool {
        if let Some(blob) = self.paths.get(&row) { return *blob; }
        let blob = path.to_str().and_then(|path| attributes(root, &[path], self.autocrlf)).and_then(|mut values| values.pop()).unwrap_or(false);
        *self.paths.entry(row).or_insert(blob)
    }
}

/// Git owns attribute precedence, including macros and sources outside the
/// index. Only the small configuration set crosses this query, once per tree.
fn attributes(root: &Path, paths: &[&str], autocrlf: bool) -> Option<Vec<bool>> {
    const NAMES: [&str; 6] = ["filter", "ident", "working-tree-encoding", "text", "eol", "crlf"];
    if paths.is_empty() { return Some(Vec::new()); }
    let input = paths.iter().flat_map(|path| path.as_bytes().iter().copied().chain(std::iter::once(0))).collect();
    let output = git::git(root.to_str()?, &["check-attr", "-z", "--stdin", "filter", "ident", "working-tree-encoding", "text", "eol", "crlf"], Some(input))?;
    let fields = output.strip_suffix(&[0])?.split(|byte| *byte == 0).collect::<Vec<_>>();
    if fields.len() != paths.len() * NAMES.len() * 3 { return None; }
    paths.iter().zip(fields.chunks_exact(NAMES.len() * 3)).map(|(path, entries)| {
        let mut values = [b"".as_slice(); 6];
        for (at, (name, entry)) in NAMES.iter().zip(entries.chunks_exact(3)).enumerate() {
            if entry[0] != path.as_bytes() || entry[1] != name.as_bytes() { return None; }
            values[at] = entry[2];
        }
        let named = |at: usize| !matches!(values[at], b"unspecified" | b"unset");
        // A rewrite retains its explicit boundary. Raw bytes, including EOLs,
        // participate in configuration hashes as well as JSON interpretation.
        let filtered = (0..3).any(named);
        let text = named(3) || named(4) || named(5) || (autocrlf && values[3] != b"unset");
        Some(!filtered && !text)
    }).collect()
}

/// Only explicit content boundaries delegate to the working tree. A known
/// eligible blob that fails to read stays an error rather than opening a file.
pub(crate) fn read(listing: Option<&super::Listing>, path: &Path) -> io::Result<Vec<u8>> {
    match listing.map(|listing| listing.read(path)) {
        Some(Ok(answer)) => answer,
        Some(Err(_)) | None => std::fs::read(path),
    }
}
