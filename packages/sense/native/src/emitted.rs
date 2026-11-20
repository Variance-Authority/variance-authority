//! Built output, read as the source it is built from.
//!
//! A workspace package whose manifest exports `./dist/index.js` is still the
//! code under `src/`: nobody edits `dist/`, and whether it exists, or is older
//! than the source, says what somebody last ran, not what the code is. The
//! `tsconfig` that builds the package owns the answer — `outDir` is where
//! output goes and `rootDir` is what it mirrors — so the resolver is handed a
//! file system that answers for a path under `outDir` from the file under
//! `rootDir` it is emitted from. TypeScript does the same across project
//! references: an import that lands in a referenced project's output is read
//! from that project's source, built or not.
//!
//! So an import of a sibling package reaches the same source file whether the
//! package was built, built long ago, or never built, and output with no source
//! behind it — a file whose source was deleted since the last build — is not
//! there. A file under `outDir` of a kind TypeScript does not emit, such as a
//! stylesheet a build step copied, is read from the disk as it is.
//!
//! Only a directory holding a `package.json`, and not under `node_modules` once
//! its symlinks are followed, declares a layout: a package somebody published
//! is its output. A layout needs both options written in the config chain;
//! without `rootDir`, TypeScript 5 infers the common directory of the inputs
//! and TypeScript 6 takes the config's own directory, so there is no single
//! reading of it. A config whose chain sets `noEmit` writes nothing, so its
//! `outDir` is not where anything went: a package that type-checks its `bin/`
//! with one config and builds `src/` with another is read through the second.
//! One that sets `emitDeclarationOnly` writes declarations and no code, so the
//! code in its `outDir` is some other tool's and is read from the disk. Two
//! configs that name one `outDir` are both kept, in the order they are read,
//! and the first whose `rootDir` holds the source answers.
//!
//! Git owns which configs a directory holds. A scan that carries the tree reads
//! them from its listing — `HEAD` with the working tree's edits and untracked
//! files over it — and the disk only for a directory git did not descend: no
//! tree, outside the root, ignored, or a repository of its own. Which files
//! are there is the disk's: an import may land in an ignored `dist/`, a
//! generated file or a submodule, none of which git lists. The listing answers
//! for what it does list, and beneath a regular file, where nothing is; for the
//! rest, each directory is read once, and a name it does not hold is not there
//! without a look of its own. A package directory can hold twenty thousand
//! files, and every `package.json` the resolver looks for beside a source file
//! was most of what resolving cost.
//!
//! `src/emitted.ts` reads output back by the `outDir` rule alone, from what the
//! resolver found on disk, and `emitted.test.ts` lands both on one fixture.

// compass: variance-authority.reach.source-scan

use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use dashmap::DashMap;
use oxc_resolver::{FileMetadata, FileSystemOs};
use rustc_hash::FxBuildHasher;
use serde_json::Value;

use crate::conditions::{normalize, Configs};
pub(crate) use crate::listing::{Entry, Known, Listing};

/// What TypeScript emits, and the sources each is emitted from, in the order
/// one is preferred when several exist. A declaration file written by hand is
/// its own source.
pub(crate) const EMITTED: &[(&str, &[&str])] = &[
    (".d.ts", &[".ts", ".tsx", ".js", ".jsx", ".d.ts"]),
    (".d.mts", &[".mts", ".mjs", ".d.mts"]),
    (".d.cts", &[".cts", ".cjs", ".d.cts"]),
    (".js", &[".ts", ".tsx", ".js", ".jsx"]),
    (".jsx", &[".tsx", ".jsx"]),
    (".mjs", &[".mts", ".mjs"]),
    (".cjs", &[".cts", ".cjs"]),
    (".json", &[".json"]),
];

/// One `outDir` and every `rootDir` it mirrors, spelled under the directory
/// that declared them, so a path reached through a workspace symlink maps
/// without leaving it.
pub(crate) struct Layout {
    pub(crate) out: PathBuf,
    pub(crate) sources: Vec<Mirror>,
}

/// A `rootDir`, and whether its config writes code into the `outDir` or only
/// declarations.
pub(crate) struct Mirror {
    pub(crate) root: PathBuf,
    pub(crate) code: bool,
}

/// What a directory knows, carried down from its parent: the layout it lies
/// in, the layouts whose `outDir` is one of its children, and those declared at
/// or above it whose `outDir` lies deeper, nearest declaration first.
#[derive(Default)]
struct Place {
    /// A path git vouches is a regular file, beneath which nothing is.
    file: bool,
    within: Option<Arc<Layout>>,
    outputs: Vec<(OsString, Arc<Layout>)>,
    deeper: Vec<Arc<Layout>>,
}

impl Place {
    /// The layout a child of this directory lies in: the deepest `outDir`.
    fn layout(&self, name: &OsStr) -> Option<Arc<Layout>> {
        self.outputs
            .iter()
            .find(|(output, _)| output == name)
            .map(|(_, layout)| Arc::clone(layout))
            .or_else(|| self.within.clone())
    }
}

/// Where a path's answer comes from.
pub enum Origin {
    /// Not built output: the disk answers.
    Disk,
    /// A directory of output, which is there when its source directory is.
    Directory,
    /// Emitted output, answered by its source.
    Source(PathBuf),
    /// Emitted output with no source behind it.
    Nowhere,
}

type Memo<T> = Arc<DashMap<PathBuf, T, FxBuildHasher>>;

#[derive(Clone, Default)]
pub struct Emitted {
    places: Memo<Arc<Place>>,
    /// One cell per directory, so resolvers asking at once read it once.
    declared: Memo<Arc<OnceLock<Arc<[Arc<Layout>]>>>>,
    /// The canonical root and what git lists under it.
    listed: Option<(PathBuf, Arc<Listing>)>,
    /// The names each directory under the root holds, read once; `None` for
    /// one that could not be read, whose paths are each looked at.
    entries: Memo<Arc<OnceLock<Option<Arc<Names>>>>>,
    /// The configs a layout or a condition set is read from, each read once.
    pub(crate) configs: Configs,
}

impl Emitted {
    /// A file system that reads which configs a directory holds from git's
    /// listing of `root`, and from the disk where git has none.
    pub fn listed(root: &Path, listing: Option<Arc<Listing>>) -> Self {
        let listed = listing.and_then(|listing| Some((std::fs::canonicalize(root).ok()?, listing)));
        Self { listed, ..Self::default() }
    }

    pub fn origin(&self, path: &Path) -> Origin {
        let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
            return Origin::Disk;
        };
        let place = self.place(parent);
        // Every file an import is written in is asked for a `tsconfig.json`
        // beneath it, and a file git vouches for holds nothing.
        if place.file {
            return Origin::Nowhere;
        }
        let Some(layout) = place.layout(name) else {
            return Origin::Disk;
        };
        let Ok(rest) = path.strip_prefix(&layout.out) else {
            return Origin::Disk;
        };
        let emitted = name.to_str().and_then(|name| {
            let (output, sources) = EMITTED
                .iter()
                .find(|(output, _)| name.len() > output.len() && name.ends_with(output))?;
            Some((&name[..name.len() - output.len()], output.starts_with(".d."), *sources))
        });
        let wrote = |mirror: &Mirror| emitted.is_some_and(|(_, declaration, _)| declaration || mirror.code);
        for mirror in &layout.sources {
            let counterpart = mirror.root.join(rest);
            if self.stat(&counterpart).is_ok_and(FileMetadata::is_dir) {
                return Origin::Directory;
            }
            let Some((stem, _, sources)) = emitted.filter(|_| wrote(mirror)) else {
                continue;
            };
            let found = sources
                .iter()
                .map(|extension| counterpart.with_file_name(format!("{stem}{extension}")))
                .find(|source| self.stat(source).is_ok_and(FileMetadata::is_file));
            if let Some(source) = found {
                return Origin::Source(source);
            }
        }
        // Output none of the configs wrote is some other tool's, and the disk
        // answers for it.
        if layout.sources.iter().any(wrote) { Origin::Nowhere } else { Origin::Disk }
    }

    /// What git lists at a path spelled from the listed root, or `None` with
    /// no listing, or one git did not answer.
    pub(crate) fn spelled(&self, spelled: &str) -> Option<Entry> {
        self.listed.as_ref()?.1.spelled(spelled)
    }

    /// Whether a path lies in a build's output, where what is there is read
    /// from its source rather than from the disk.
    pub(crate) fn emits(&self, path: &Path) -> bool {
        self.layout(path).is_some()
    }

    /// The layout a path lies in: the deepest `outDir` above it.
    fn layout(&self, path: &Path) -> Option<Arc<Layout>> {
        self.place(path.parent()?).layout(path.file_name()?)
    }

    fn place(&self, directory: &Path) -> Arc<Place> {
        if let Some(known) = self.places.get(directory) {
            return Arc::clone(&known);
        }
        let place = Arc::new(self.placed(directory));
        Arc::clone(&self.places.entry(directory.to_owned()).or_insert(place))
    }

    fn placed(&self, directory: &Path) -> Place {
        let above = directory.parent().map(|parent| self.place(parent));
        if above.as_ref().is_some_and(|above| above.file) || self.vouched(directory) {
            return Place { file: true, ..Place::default() };
        }
        let within = above.as_ref().zip(directory.file_name()).and_then(|(above, name)| above.layout(name));
        // A directory inside output declares nothing, and what was declared
        // above it is carried through.
        let own = within.is_none().then(|| self.declared(directory));
        let carried = above.iter().flat_map(|above| above.deeper.iter()).filter(|layout| layout.out.starts_with(directory));
        let mut place = Place { within, ..Place::default() };
        for layout in own.iter().flat_map(|own| own.iter()).chain(carried) {
            match (layout.out.parent() == Some(directory), layout.out.file_name()) {
                (true, Some(name)) => {
                    if !place.outputs.iter().any(|(output, _)| output == name) {
                        place.outputs.push((name.to_owned(), Arc::clone(layout)));
                    }
                }
                _ => place.deeper.push(Arc::clone(layout)),
            }
        }
        place
    }

    /// What the listing says is at a path, or `None` where the disk answers.
    fn known(&self, path: &Path) -> Option<Known> {
        let (root, listing) = self.listed.as_ref()?;
        listing.known(path.strip_prefix(root).ok()?)
    }

    /// A path's metadata, links followed: from the listing, or the disk.
    fn stat(&self, path: &Path) -> io::Result<FileMetadata> {
        match self.known(path) {
            Some(known) => listed(known),
            None if self.absent(path) => Err(not_found()),
            None => FileSystemOs::metadata(path),
        }
    }

    /// Whether the directory a path is in, read once, holds no such name.
    /// Only a path under a listed root is answered: elsewhere, and on a disk
    /// that may ignore case, the path is looked at.
    fn absent(&self, path: &Path) -> bool {
        let Some((root, _)) = &self.listed else { return false };
        let (Some(directory), Some(name)) = (path.parent(), path.file_name()) else {
            return false;
        };
        if !directory.starts_with(root) {
            return false;
        }
        let known = self.entries.get(directory).map(|cell| Arc::clone(&cell));
        let cell = known.unwrap_or_else(|| Arc::clone(&self.entries.entry(directory.to_owned()).or_default()));
        cell.get_or_init(|| Names::of(directory)).as_ref().is_some_and(|names| !names.may_hold(name))
    }

    /// Whether git vouches the path is a regular file.
    pub fn vouched(&self, path: &Path) -> bool {
        self.listed
            .as_ref()
            .is_some_and(|(root, listing)| path.strip_prefix(root).is_ok_and(|rest| listing.is_file(rest)))
    }

    /// The layouts the `tsconfig*.json` files of a package directory declare,
    /// `tsconfig.json` first.
    pub(crate) fn declared(&self, directory: &Path) -> Arc<[Arc<Layout>]> {
        let known = self.declared.get(directory).map(|cell| Arc::clone(&cell));
        let cell = known.unwrap_or_else(|| Arc::clone(&self.declared.entry(directory.to_owned()).or_default()));
        let listed = self.listed.as_ref().map(|(root, listing)| (root.as_path(), listing.as_ref()));
        Arc::clone(cell.get_or_init(|| layouts_of(&self.configs, directory, listed).into_iter().map(Arc::new).collect()))
    }

    /// The directory a mapped path would be in on disk: its nearest ancestor
    /// outside every layout, canonicalized, with the rest spelled as asked.
    fn canonical(&self, path: &Path) -> io::Result<PathBuf> {
        let mut real = path;
        while self.layout(real).is_some() {
            real = real.parent().ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
        }
        let rest = path.strip_prefix(real).map_err(|_| io::Error::from(io::ErrorKind::NotFound))?;
        Ok(FileSystemOs::canonicalize(real)?.join(rest))
    }
}

fn layouts_of(configs: &Configs, directory: &Path, listed: Option<(&Path, &Listing)>) -> Vec<Layout> {
    let under = listed.and_then(|(root, listing)| Some((listing, directory.strip_prefix(root).ok()?)));
    if let Some((listing, rest)) = under {
        // Git keeps nothing beneath a symlink, so a directory it lists is its
        // own real path, and holds what git lists in it.
        if let Some(names) = listing.directories.get(rest) {
            return declare(configs, directory, directory, names);
        }
    }
    if !directory.join("package.json").is_file() {
        return Vec::new();
    }
    let Ok(real) = std::fs::canonicalize(directory) else {
        return Vec::new();
    };
    if published(&real) {
        return Vec::new();
    }
    let listing = listed.and_then(|(root, listing)| listing.directories.get(real.strip_prefix(root).ok()?));
    if let Some(names) = listing {
        return declare(configs, directory, &real, names);
    }
    let Ok(entries) = std::fs::read_dir(&real) else {
        return Vec::new();
    };
    let names: Vec<OsString> = entries.filter_map(Result::ok).map(|entry| entry.file_name()).collect();
    if !names.iter().any(|name| name == "package.json") {
        return Vec::new();
    }
    declare(configs, directory, &real, &names)
}

/// The layouts a package directory declares, from the names in it; `real` is
/// where it is, and `directory` how it was reached.
fn declare(kept: &Configs, directory: &Path, real: &Path, names: &[OsString]) -> Vec<Layout> {
    if published(real) || !names.iter().any(|name| name == "package.json") {
        return Vec::new();
    }
    // `is_config` admits only names that are UTF-8.
    let mut configs: Vec<&str> = names.iter().filter(|name| is_config(name)).filter_map(|name| name.to_str()).collect();
    configs.sort_by(|a, b| (*a != "tsconfig.json").cmp(&(*b != "tsconfig.json")).then_with(|| crate::order::code_unit(a, b)));
    let mut layouts: Vec<Layout> = Vec::new();
    for config in configs {
        let path = real.join(config);
        let set = |name: &str| matches!(kept.setting(&path, name), Some((Value::Bool(true), _)));
        if set("noEmit") {
            continue;
        }
        let option = |name: &str| path_option(kept, &path, real, name);
        let (Some(out), Some(source)) = (option("outDir"), option("rootDir")) else {
            continue;
        };
        let Ok(inside) = out.strip_prefix(real) else {
            continue;
        };
        if inside.as_os_str().is_empty() || source.starts_with(&out) {
            continue;
        }
        let (out, root, code) = (directory.join(inside), spelled(&source, real, directory), !set("emitDeclarationOnly"));
        let Some(layout) = layouts.iter_mut().find(|known| known.out == out) else {
            layouts.push(Layout { out, sources: vec![Mirror { root, code }] });
            continue;
        };
        match layout.sources.iter_mut().find(|known| known.root == root) {
            Some(known) => known.code |= code,
            None => layout.sources.push(Mirror { root, code }),
        }
    }
    layouts
}

/// Whether a real path is inside a package somebody installed.
fn published(real: &Path) -> bool {
    real.components().any(|part| part == Component::Normal("node_modules".as_ref()))
}

pub(crate) fn is_config(name: &OsStr) -> bool {
    name.to_str().is_some_and(|name| name.starts_with("tsconfig") && name.ends_with(".json"))
}

/// A path under the real directory, spelled under the directory it was asked
/// through.
fn spelled(path: &Path, real: &Path, directory: &Path) -> PathBuf {
    path.strip_prefix(real).map_or_else(|_| path.to_owned(), |rest| directory.join(rest))
}

/// A path option, unset or cleared by `null` alike. A relative value is
/// relative to the config that wrote it, and `${configDir}` is the directory of
/// the config being built.
fn path_option(configs: &Configs, path: &Path, leaf: &Path, name: &str) -> Option<PathBuf> {
    let (value, directory) = configs.setting(path, name)?;
    let value = value.as_str()?;
    Some(normalize(&match value.strip_prefix("${configDir}") {
        Some(rest) => {
            let mut placed = leaf.as_os_str().to_owned();
            placed.push(rest);
            PathBuf::from(placed)
        }
        None => directory.join(value),
    }))
}

/// The names one directory holds, and each folded to lower case, for a disk
/// that may ignore it. A name outside ASCII may be held, unless held exactly:
/// a disk may open it through another Unicode spelling, as APFS opens a
/// decomposed name through the composed one, and the disk is asked.
struct Names {
    exact: HashSet<OsString, FxBuildHasher>,
    folded: HashSet<String, FxBuildHasher>,
}

impl Names {
    /// A directory that is not there, or is a file, holds nothing.
    fn of(directory: &Path) -> Option<Arc<Self>> {
        let entries = match std::fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if matches!(error.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory) => {
                return Some(Arc::new(Self { exact: HashSet::default(), folded: HashSet::default() }));
            }
            Err(_) => return None,
        };
        let mut exact = HashSet::default();
        for entry in entries {
            exact.insert(entry.ok()?.file_name());
        }
        let folded = exact.iter().map(|name: &OsString| name.to_string_lossy().to_lowercase()).collect();
        Some(Arc::new(Self { exact, folded }))
    }

    fn may_hold(&self, name: &OsStr) -> bool {
        self.exact.contains(name) || !name.is_ascii() || self.folded.contains(&name.to_string_lossy().to_lowercase())
    }
}

#[path = "emitted_file_system.rs"]
mod file_system;
use file_system::{listed, not_found};

#[cfg(all(test, unix))]
#[path = "emitted_tests.rs"]
mod tests;
