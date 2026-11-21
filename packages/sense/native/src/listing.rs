//! What git lists under a root, asked by path before the disk is.
//!
//! The resolver looks for a `package.json` beside every source file, and a
//! package directory can hold twenty thousand files: answered from git's
//! listing, a look costs a hash lookup and opens nothing. A path git does not
//! list is the disk's: an ignored `dist/`, a generated file, the inside of a
//! submodule and a file not hashed yet are all there without git naming them.

// compass: variance-authority.reach.source-scan

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use rustc_hash::FxBuildHasher;

use crate::emitted::is_config;

/// What git lists under the root the tree was read from: every file, which of
/// them it vouches are regular files, and in every directory it descended, the
/// names a declaration is read from — `package.json` and `tsconfig*.json`. A
/// directory holding one git could not hash declares from the disk: git did
/// not answer for it.
#[derive(Default)]
pub struct Listing {
    files: Arc<HashMap<String, u32>>,
    regular: Arc<Vec<bool>>,
    /// The declaration names git lists, by directory under the root.
    pub(crate) directories: HashMap<PathBuf, Vec<OsString>>,
    /// Every directory git lists a file beneath, the root spelled empty.
    real: HashSet<String, FxBuildHasher>,
}

/// What the listing says is at a path.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Known {
    File,
    Directory,
    /// Beneath a regular file, where nothing is.
    Absent,
}

/// What git lists at one path spelled from the root.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Entry {
    /// A regular file.
    File,
    /// A directory git lists a file beneath.
    Directory,
    /// A blob that is not a regular file: a symbolic link, which may name a
    /// file or a directory, and only the disk says which.
    Linked,
    /// Nothing git lists.
    Unlisted,
}

impl Listing {
    pub fn of(files: Arc<HashMap<String, u32>>, regular: Arc<Vec<bool>>, unhashed: &[String]) -> Self {
        let mut directories: HashMap<PathBuf, Vec<OsString>> = HashMap::new();
        for path in files.keys() {
            let (directory, name) = path.rsplit_once('/').unwrap_or(("", path));
            let mut above = Some(directory);
            while let Some(at) = above.filter(|at| !directories.contains_key(Path::new(at))) {
                directories.insert(PathBuf::from(at), Vec::new());
                above = (!at.is_empty()).then(|| at.rsplit_once('/').map_or("", |(parent, _)| parent));
            }
            if name == "package.json" || is_config(name.as_ref()) {
                if let Some(names) = directories.get_mut(Path::new(directory)) {
                    names.push(name.into());
                }
            }
        }
        let real = directories.keys().filter_map(|at| Some(at.to_str()?.to_owned())).collect();
        for path in unhashed {
            let (directory, name) = path.rsplit_once('/').unwrap_or(("", path));
            if name == "package.json" || is_config(name.as_ref()) {
                directories.remove(Path::new(directory));
            }
        }
        Self { files, regular, directories, real }
    }

    /// What is at a path under the root, or `None` where the disk answers:
    /// a path git does not list may be there all the same.
    pub(crate) fn known(&self, path: &Path) -> Option<Known> {
        // An empty listing is git that did not answer, not an empty checkout.
        if !self.real.contains("") {
            return None;
        }
        let mut spelled = String::new();
        for part in path.components() {
            let Component::Normal(part) = part else { return None };
            let part = part.to_str().filter(|part| part.is_ascii())?;
            if part == "node_modules" || part == ".git" {
                return None;
            }
            if !spelled.is_empty() {
                spelled.push('/');
            }
            spelled.push_str(part);
        }
        if let Some(&at) = self.files.get(&spelled) {
            return self.regular(at).then_some(Known::File);
        }
        if self.real.contains(&spelled) {
            return Some(Known::Directory);
        }
        // Git keeps nothing beneath a regular file it lists.
        let mut above = spelled.as_str();
        while let Some((parent, _)) = above.rsplit_once('/') {
            if self.real.contains(parent) {
                return None;
            }
            if let Some(&at) = self.files.get(parent) {
                return self.regular(at).then_some(Known::Absent);
            }
            above = parent;
        }
        None
    }

    fn regular(&self, at: u32) -> bool {
        self.regular.get(at as usize).copied().unwrap_or(false)
    }

    /// What git lists at a path spelled from the root, `/` between its
    /// parts, or `None` when git did not answer for the tree.
    pub(crate) fn spelled(&self, spelled: &str) -> Option<Entry> {
        if !self.real.contains("") {
            return None;
        }
        if let Some(&at) = self.files.get(spelled) {
            return Some(if self.regular(at) { Entry::File } else { Entry::Linked });
        }
        Some(if self.real.contains(spelled) { Entry::Directory } else { Entry::Unlisted })
    }

    /// Whether git vouches the path is a regular file. A symbolic link is a
    /// blob as well, and may name a directory.
    pub(crate) fn is_file(&self, path: &Path) -> bool {
        let mut spelled = String::new();
        for part in path.components() {
            let Component::Normal(part) = part else { return false };
            let Some(part) = part.to_str() else { return false };
            if !spelled.is_empty() {
                spelled.push('/');
            }
            spelled.push_str(part);
        }
        self.files.get(&spelled).is_some_and(|&at| self.regular(at))
    }
}
