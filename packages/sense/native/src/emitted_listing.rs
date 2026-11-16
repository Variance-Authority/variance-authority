//! The complete active source listing and the metadata it already answers.

// compass: variance-authority.reach.source-scan

use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::ffi::OsString;
use std::io;
use std::hash::Hasher;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use oxc_resolver::FileMetadata;
use rustc_hash::FxHasher;

use super::{is_config, not_found};

/// What git lists under the root the tree was read from: every file, which of
/// them it vouches are regular files, and in every directory it descended, the
/// names a declaration is read from — `package.json` and `tsconfig*.json`. A
/// directory holding one git could not hash is not listed: git did not answer
/// for it, and the disk does.
#[derive(Default)]
pub struct Listing {
    files: Arc<HashMap<String, u32>>,
    content: Option<super::content::Content>,
    regular: Arc<Vec<bool>>,
    directories: HashMap<PathBuf, Directory>,
    unhashed: HashSet<PathBuf>,
    unhashed_directories: HashSet<PathBuf>,
    aliases: HashSet<u64>,
    unicode_directories: HashSet<PathBuf>,
}

#[derive(Default)]
struct Directory {
    names: Vec<OsString>,
    real: bool,
}

impl Listing {
    pub fn of(files: Arc<HashMap<String, u32>>, regular: Arc<Vec<bool>>, unhashed: &[String]) -> Self {
        let mut directories = HashMap::from([(PathBuf::new(), Directory { real: true, ..Directory::default() })]);
        for (path, at) in files.iter() {
            let (directory, name) = path.rsplit_once('/').unwrap_or(("", path));
            let real = regular.get(*at as usize).copied().unwrap_or(false);
            let mut above = Some(directory);
            while let Some(at) = above {
                match directories.entry(PathBuf::from(at)) {
                    Entry::Occupied(mut held) if real && !held.get().real => held.get_mut().real = true,
                    Entry::Occupied(_) => break,
                    Entry::Vacant(held) => { held.insert(Directory { real, ..Directory::default() }); }
                }
                above = (!at.is_empty()).then(|| at.rsplit_once('/').map_or("", |(parent, _)| parent));
            }
            if name == "package.json" || is_config(name.as_ref()) {
                if let Some(held) = directories.get_mut(Path::new(directory)) {
                    held.names.push(name.into());
                }
            }
        }
        let mut unhashed_directories = HashSet::new();
        for path in unhashed {
            let (directory, name) = path.rsplit_once('/').unwrap_or(("", path));
            if name == "package.json" || is_config(name.as_ref()) {
                unhashed_directories.insert(PathBuf::from(directory));
            }
        }
        let spellings = || files.keys().map(String::as_str).chain(directories.keys().filter_map(|path| path.to_str()))
            .chain(unhashed.iter().flat_map(|path| Path::new(path).ancestors()).filter_map(Path::to_str));
        let aliases = spellings().map(alias).collect();
        let unicode_directories = spellings().filter_map(|path| {
            let (directory, name) = path.rsplit_once('/').unwrap_or(("", path));
            (!name.is_ascii()).then(|| PathBuf::from(directory))
        }).collect();
        let unhashed = unhashed.iter().map(PathBuf::from).collect();
        Self { files, content: None, regular, directories, unhashed, unhashed_directories, aliases, unicode_directories }
    }

    pub(crate) fn with_content(mut self, root: PathBuf, oids: Arc<Vec<crate::git::Oid>>, store: Arc<crate::acquire::TreeObjects>) -> Self {
        if store.allows_blobs() && !oids.is_empty() { self.content = Some(super::content::Content::new(root, oids, store)); }
        self
    }

    pub(crate) fn relative<'a>(&self, path: &'a Path) -> Option<&'a Path> {
        path.strip_prefix(self.content.as_ref()?.root()).ok()
    }

    pub(crate) fn read(&self, path: &Path) -> Result<io::Result<Vec<u8>>, Boundary> {
        let content = self.content.as_ref().ok_or(Boundary::Outside)?;
        let relative = path.strip_prefix(content.root()).map_err(|_| Boundary::Outside)?;
        let row = self.at(relative).ok_or(Boundary::Outside)?;
        if !self.regular.get(row as usize).copied().unwrap_or(false) { return Err(Boundary::Uncertain); }
        content.read(relative, row, || self.files.iter().filter(|(path, row)| self.regular.get(**row as usize).copied().unwrap_or(false) && super::content::configuration(Path::new(path))).map(|(path, row)| (path.as_str(), *row)).collect())
    }

    /// Whether git vouches the path is a regular file. A symbolic link is a
    /// blob as well, and may name a directory.
    pub(crate) fn is_file(&self, path: &Path) -> bool {
        self.at(path).is_some_and(|at| self.regular.get(at as usize).copied().unwrap_or(false))
    }

    /// Exact regular paths are already their real spelling. A regular leaf
    /// proves its ancestors; an uncertain or caller-supplied leaf does not.
    pub(super) fn positive(&self, path: &Path) -> Option<FileMetadata> {
        if installed(path) { return None; }
        if self.is_file(path) { return Some(FileMetadata::new(true, false, false)); }
        self.directories.get(path).is_some_and(|directory| directory.real)
            .then(|| FileMetadata::new(false, true, false))
    }

    pub(super) fn uncertain(&self) -> impl Iterator<Item = &str> {
        self.files.iter().filter(|(_, at)| !self.regular.get(**at as usize).copied().unwrap_or(false)).map(|(path, _)| path.as_str())
    }

    fn at(&self, path: &Path) -> Option<u32> {
        self.files.get(path.to_str()?).copied()
    }

    pub(super) fn configs(&self, directory: &Path) -> Option<&[OsString]> {
        (!self.unhashed_directories.contains(directory)).then(|| self.directories.get(directory).map(|held| held.names.as_slice())).flatten()
    }

    /// The source snapshot owns ordinary repository paths. Configurations,
    /// installs and symbolic or changed paths retain their filesystem boundary.
    pub(crate) fn metadata(&self, path: &Path) -> Result<io::Result<FileMetadata>, Boundary> {
        if installed(path) {
            return Err(Boundary::Installed);
        }
        if self.unhashed.contains(path) { return Err(Boundary::Uncertain); }
        if let Some(at) = self.at(path) {
            return if self.regular.get(at as usize).copied().unwrap_or(false) {
                Ok(Ok(FileMetadata::new(true, false, false)))
            } else { Err(Boundary::Uncertain) };
        }
        if path.file_name().is_some_and(|name| name == "package.json" || is_config(name)) {
            return Err(Boundary::Config);
        }
        if let Some(directory) = self.directories.get(path) {
            return if directory.real { Ok(Ok(FileMetadata::new(false, true, false))) }
                else { Err(Boundary::Uncertain) };
        }
        // Git keys have one spelling. The resolver and OS own other spellings;
        // collapsing `..` here would change its meaning beneath a symlink.
        if path.to_str().is_some_and(|path| path.split(std::path::is_separator).any(|part| matches!(part, "" | "." | ".."))) {
            return Err(Boundary::Uncertain);
        }
        // Possible case aliases retain OS precedence. The fingerprint is only
        // an uncertainty proof: collisions add a disk check, never a file.
        if path.to_str().is_none_or(|path| !path.is_ascii() || self.aliases.contains(&alias(path))) {
            return Err(Boundary::Casing);
        }
        for parent in path.ancestors().skip(1) {
            if self.unhashed.contains(parent) { return Err(Boundary::Uncertain); }
            if self.unicode_directories.contains(parent) { return Err(Boundary::Casing); }
            if let Some(directory) = self.directories.get(parent) {
                return if directory.real { Ok(Err(not_found())) }
                    else { Err(Boundary::Uncertain) };
            }
            if let Some(at) = self.at(parent) {
                return if self.regular.get(at as usize).copied().unwrap_or(false) {
                    Ok(Err(not_found()))
                } else { Err(Boundary::Uncertain) };
            }
            if parent.to_str().is_some_and(|parent| self.aliases.contains(&alias(parent))) {
                return Err(Boundary::Casing);
            }
        }
        Err(Boundary::Outside)
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Boundary { Config, Installed, Uncertain, Outside, Casing, Transformed }

fn installed(path: &Path) -> bool {
    path.components().any(|part| matches!(part, Component::Normal(name) if name == "node_modules" || name == ".git"))
}

fn alias(path: &str) -> u64 {
    let mut hash = FxHasher::default();
    let folded = path.bytes().any(|byte| byte.is_ascii_uppercase()).then(|| path.to_ascii_lowercase());
    hash.write(folded.as_deref().unwrap_or(path).as_bytes());
    hash.finish()
}
