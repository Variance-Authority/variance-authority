//! What git lists under a root, asked by path before the disk is.
//!
//! The resolver looks for a `package.json` beside every source file, and a
//! package directory can hold twenty thousand files: answered from git's
//! listing, a look costs a hash lookup and opens nothing. `emitted.rs` says
//! where the disk answers instead.

// compass: variance-authority.reach.source-scan

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use rustc_hash::{FxBuildHasher, FxHasher};

use crate::emitted::is_config;

/// What git lists under the root the tree was read from: every file, which of
/// them it vouches are regular files, and in every directory it descended, the
/// names a declaration is read from — `package.json` and `tsconfig*.json`. A
/// directory holding one git could not hash is not listed: git did not answer
/// for it, and the disk does.
#[derive(Default)]
pub struct Listing {
    files: Arc<HashMap<String, u32>>,
    regular: Arc<Vec<bool>>,
    /// The declaration names git lists, by directory under the root.
    pub(crate) directories: HashMap<PathBuf, Vec<OsString>>,
    /// Every directory git lists a file beneath, the root spelled empty.
    real: HashSet<String, FxBuildHasher>,
    /// Every listed path, folded to lower case and hashed: a name that folds
    /// onto one may be the same file on a disk that ignores case.
    folded: HashSet<u64, FxBuildHasher>,
    /// What git could not hash, each a file or a directory.
    unhashed: Vec<String>,
}

/// What the listing says is at a path.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Known {
    File,
    Directory,
    Absent,
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
        let real: HashSet<String, FxBuildHasher> = directories.keys().filter_map(|at| Some(at.to_str()?.to_owned())).collect();
        let folded = files.keys().chain(real.iter()).map(|path| fold(path)).collect();
        for path in unhashed {
            let (directory, name) = path.rsplit_once('/').unwrap_or(("", path));
            if name == "package.json" || is_config(name.as_ref()) {
                directories.remove(Path::new(directory));
            }
        }
        let unhashed = unhashed.iter().map(|path| path.trim_end_matches('/').to_owned()).collect();
        Self { files, regular, directories, real, folded, unhashed }
    }

    /// What is at a path under the root, or `None` where the disk answers.
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
        let beneath = |path: &str| spelled.strip_prefix(path).is_some_and(|rest| rest.is_empty() || rest.starts_with('/'));
        if self.unhashed.iter().any(|path| beneath(path)) || self.folded.contains(&fold(&spelled)) {
            return None;
        }
        // The nearest listed path above answers: a directory, or a regular
        // file, beneath which nothing is.
        let mut above = spelled.as_str();
        while let Some((parent, _)) = above.rsplit_once('/') {
            if self.real.contains(parent) {
                return Some(Known::Absent);
            }
            if let Some(&at) = self.files.get(parent) {
                return self.regular(at).then_some(Known::Absent);
            }
            above = parent;
        }
        Some(Known::Absent)
    }

    fn regular(&self, at: u32) -> bool {
        self.regular.get(at as usize).copied().unwrap_or(false)
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

fn fold(path: &str) -> u64 {
    use std::hash::Hasher;
    let mut hasher = FxHasher::default();
    for byte in path.bytes() {
        hasher.write_u8(byte.to_ascii_lowercase());
    }
    hasher.finish()
}
