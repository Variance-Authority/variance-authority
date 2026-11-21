//! Where a Rust path lands. A `mod` line declares a file, a `use` or a path in
//! code walks the module tree those lines build, segment by segment, and the
//! file the walk stands in is the answer. The tree is read once per world, off
//! every `.rs` file's parse, so asking is a lookup. The reader
//! ([`rust.rs`](./languages/rust.rs)) is held to the argument here.
//!
//! There is no specifier that names a path. There is a *module tree*, declared
//! statement by statement, and a set of paths that follow from it.
//!
//! ## Two statements, two certainties
//!
//! `mod order;` is a declaration: a module named `order` exists as a file, and
//! if the file is missing the crate does not compile. So it is written fact, and
//! a `mod` that lands nowhere is a **hole**, as a broken relative import is in
//! every other language here.
//!
//! `use crate::read::harvest::Harvest;` is not. It names an *item*, and which
//! prefix is the module is a fact about the disk: `Harvest` may be a type in
//! `read/harvest.rs`, or `harvest` the type and `read.rs` the module. So every
//! `use` is guessed, and the walk follows the module tree until a segment is no
//! module: the file it stands in declares the item. A `use` that finds nothing
//! is an external crate — the common case — and silence is the honest answer.
//!
//! A path in a type or an expression, `crate::graph::Limits` or
//! `super::reach()`, is read the same way with one more doubt:
//! `crate::map::JourneyMap::new()` may be a function of the type as well as of
//! a module. So every prefix is asked as an item, and only the one leaving a
//! single segment past the modules lands, and only where the file the walk
//! stands in declares that segment: `crate::shapes::inner::Thing` passes
//! through the inline `mod inner` of `shapes.rs`, and its prefix
//! `crate::shapes::inner` names no item there. A single name is not asked:
//! which item it means is scope, and the `use` that brought it in is counted.
//!
//! The split keeps the two from poisoning each other: an inline `mod tests { … }`
//! declares no file, and a written-certain `use super::*` in one would be
//! reported as a missing file.
//!
//! ## `#[path]` names a file directly
//!
//! At the top of a file it is relative to the file's directory, and is emitted
//! as written. Inside an inline module it starts at that module's directory, so
//! the reader emits the module first, `self::inline/other.rs`, and the
//! directory is decided here, where `lib.rs`, `main.rs`, `mod.rs` and a file a
//! `#[path]` loads are known to own theirs. A module path is `::`-joined
//! identifiers, so anything carrying `.` or `/` is a filename. A file a
//! `#[path]` loads keeps its children beside it, as a `mod.rs` does, which is
//! why `super` is read from the `mod` lines and never from where a file sits.
//!
//! ## What is unknown
//!
//! A parse error **where an import could have been** — the top level and the
//! body of an inline `mod` — and a missing grammar. An `ERROR` node inside a
//! function body hides no import, so it costs nothing. `include!` and the paths
//! a macro expands to are invisible, which is why the answer is a floor.

// compass: variance-authority.reach.source-scan

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use rayon::prelude::*;
use regex::Regex;

use crate::harvest::SourceSymbol;
use crate::world::World;

/// What a crate's source sits under, by universal convention and by Cargo.
const SOURCE: &str = "src";

/// The files that are a module without naming one: a crate root, or a directory's own.
const ROOT_FILES: [&str; 3] = ["lib.rs", "main.rs", "mod.rs"];

/// The files a crate's own `src` starts at.
const ROOTS: [&str; 2] = ["lib.rs", "main.rs"];

/// The name a `mod` line takes its file whole under: `NAMESPACE_NAME` in `read.ts`.
const NAMESPACE_NAME: &str = "*";

/// A module: the file it is written in, and the inline modules it sits inside there.
#[derive(Clone, Debug)]
struct Place {
    file: String,
    inline: Vec<String>,
}

impl Place {
    fn file(file: &str) -> Self {
        Self { file: file.to_owned(), inline: Vec::new() }
    }
}

/// A file's top-level names: those it declares as an item, and those it declares as an inline `mod`.
#[derive(Debug)]
pub(crate) struct Items {
    pub(crate) declared: HashSet<String>,
    pub(crate) inline: HashSet<String>,
}

/// `ModuleTree` and `Crates` in `rust.ts`: which module declares each file,
/// the files each declares keyed by the path from it, the files a `#[path]`
/// loads, each read file's top-level items, and each crate's directory by the
/// name a `use` spells it.
#[derive(Debug, Default)]
pub(crate) struct Index {
    parent: HashMap<String, Place>,
    children: HashMap<String, HashMap<String, String>>,
    spelled: HashSet<String>,
    items: HashMap<String, Items>,
    crates: HashMap<String, String>,
}

impl Index {
    /// The tree `world`'s `.rs` files declare, read together, and its crates.
    /// What one file says is its own, so the files are taken on every core and
    /// folded in path order, and the crates are read beside the tree: the
    /// index is the one a single thread reading in path order builds.
    pub(crate) fn of(world: &World) -> Self {
        let (mut index, crates) = rayon::join(|| Self::tree(world), || crates(world));
        index.crates = crates;
        index
    }

    /// The module tree alone.
    fn tree(world: &World) -> Self {
        let mut index = Self::default();
        let rust: Vec<&str> = world.below("").par_iter().copied().filter(|file| file.ends_with(".rs")).collect();
        let own: Vec<Option<Own>> = world.parsed(&rust).into_par_iter().map(|read| read.map(own)).collect();
        let mut declared: Vec<(&str, String, String)> = Vec::new();
        for (file, own) in rust.iter().zip(own) {
            let Some(own) = own else { continue };
            index.children.insert((*file).to_owned(), HashMap::new());
            declared.extend(own.declared.into_iter().map(|(value, local)| (*file, value, local)));
            if let Some(items) = own.items {
                index.items.insert((*file).to_owned(), items);
            }
        }

        // Spelled first: they say which files keep their children beside them.
        // A top-level one is placed before one inside an inline module, whose
        // directory depends on whether its own file is one of them.
        let spelled = declared.iter().filter(|(_, value, _)| spelled_path(value));
        let (top, nested): (Vec<_>, Vec<_>) = spelled.partition(|(_, value, _)| !inline_spelled(value));
        for (file, value, name) in top.into_iter().chain(nested) {
            let Some(child) = spelled_file(file, value, &index.spelled).filter(|child| world.has(child)) else { continue };
            index.spelled.insert(child.clone());
            let inline = inline_of(value);
            let key = inline.iter().map(String::as_str).chain([name.as_str()]).collect::<Vec<_>>().join("::");
            index.place(file, key, child, inline);
        }
        for (file, value, _) in &declared {
            if spelled_path(value) {
                continue;
            }
            let path: Vec<String> = value.split("::").skip(1).map(str::to_owned).collect();
            let Some((name, inline)) = path.split_last() else { continue };
            if let Some(child) = declared_file(world, file, inline, name, &index.spelled) {
                index.place(file, path.join("::"), child, inline.to_vec());
            }
        }
        index
    }

    fn place(&mut self, file: &str, key: String, child: String, inline: Vec<String>) {
        if child == file {
            return;
        }
        self.parent.insert(child.clone(), Place { file: file.to_owned(), inline });
        if let Some(children) = self.children.get_mut(file) {
            children.insert(key, child);
        }
    }
}

/// What one `.rs` file says about the tree: each `mod` line, as written and
/// by the name it binds, and its top-level items when its symbols were read.
struct Own {
    declared: Vec<(String, String)>,
    items: Option<Items>,
}

fn own(read: crate::read::Read) -> Own {
    let mut files = HashSet::new();
    let mut declared = Vec::new();
    for request in read.requests {
        // A `mod` line: written, and the file taken whole under its name.
        let Some(binding) = request.bindings.first() else { continue };
        if request.guessed || binding.imported != NAMESPACE_NAME {
            continue;
        }
        let local = binding.local.clone();
        if request.value == format!("self::{local}") || (spelled_path(&request.value) && !inline_spelled(&request.value)) {
            files.insert(local.clone());
        }
        declared.push((request.value, local));
    }
    let items = read.harvested.then(|| top_level_items(&read.symbols, &files));
    Own { declared, items }
}

/// Where `request`, asked from `from`, lands: at most one file, never `from`.
/// With `item`, the whole path is the item, so it lands only with one segment
/// left past the modules, and only where that file declares it.
pub(crate) fn resolve(world: &World, from: &str, request: &str, item: bool) -> Vec<String> {
    let modules = world.rust_index();
    if spelled_path(request) {
        let at = spelled_file(from, request, &modules.spelled);
        return at.filter(|at| at != from && world.has(at)).into_iter().collect();
    }
    let written: Vec<&str> = request.split("::").filter(|segment| !segment.is_empty()).collect();
    let Some(first) = written.first() else { return Vec::new() };

    let (mut at, rest) = match *first {
        "crate" => (Some(Place::file(&root_of(from, world, modules))), &written[1..]),
        "self" => (Some(Place::file(from)), &written[1..]),
        "super" => {
            let mut at = Some(Place::file(from));
            let mut climbed = 0;
            while written.get(climbed) == Some(&"super") {
                let Some(place) = at else { break };
                at = if place.inline.is_empty() {
                    parent_of(&place.file, world, modules)
                } else {
                    Some(Place { inline: place.inline[..place.inline.len() - 1].to_vec(), file: place.file })
                };
                climbed += 1;
            }
            (at, &written[climbed..])
        }
        // A crate name. The crate's own name reaches its own files too: Rust
        // allows `use my_crate::x` from inside `my_crate`.
        name => {
            let root = modules.crates.get(name).and_then(|directory| {
                let source = if directory.is_empty() { SOURCE.to_owned() } else { format!("{directory}/{SOURCE}") };
                ROOTS.iter().map(|root| format!("{source}/{root}")).find(|path| world.has(path))
            });
            (root.map(|root| Place::file(&root)), &written[1..])
        }
    };
    let Some(mut place) = at.take() else { return Vec::new() };

    // Down the tree while a segment is a module: a file one declares, or an
    // inline module a file is declared in. The first that is neither is the
    // item, and the file the walk stands in declares it.
    let mut walked = 0;
    for segment in rest {
        if let Some(child) = child_of(&place, segment, world, modules) {
            place = Place::file(&child);
        } else if holds_inline(&place, segment, world, modules) {
            place.inline.push((*segment).to_owned());
        } else {
            break;
        }
        walked += 1;
    }
    if item && (rest.len() - walked != 1 || !declares_item(&place, rest[walked], modules)) {
        return Vec::new();
    }
    if place.file == from { Vec::new() } else { vec![place.file] }
}

/// What a file declares at its top level; `files` are the names its `mod name;` lines take.
pub(crate) fn top_level_items(symbols: &[SourceSymbol], files: &HashSet<String>) -> Items {
    // An item inside an inline module is named on its path, `tests::fixture`,
    // and is the module's, not the file's.
    let top = || symbols.iter().filter(|symbol| !symbol.name.contains("::"));
    Items {
        declared: top().filter(|symbol| symbol.kind != "module").map(|symbol| symbol.name.clone()).collect(),
        // A `mod` that is no `mod name;` line is written inline.
        inline: top().filter(|symbol| symbol.kind == "module" && !files.contains(&symbol.name)).map(|symbol| symbol.name.clone()).collect(),
    }
}

/// Whether a request names a file: a module path is `::`-joined identifiers.
fn spelled_path(request: &str) -> bool {
    request.contains('/') || request.contains('.')
}

/// Whether the reader wrote a `#[path]` after the inline modules it sits inside, `self::a::b/other.rs`.
fn inline_spelled(request: &str) -> bool {
    request.starts_with("self::") && request.contains('/')
}

/// The inline modules a `#[path]` sits inside, `a::b` of `self::a::b/other.rs`; none at the top of a file.
fn inline_of(request: &str) -> Vec<String> {
    if !inline_spelled(request) {
        return Vec::new();
    }
    let slash = request.find('/').unwrap_or(request.len());
    request["self::".len()..slash].split("::").map(str::to_owned).collect()
}

/// The file a `#[path]` in `file` names: beside the file at its top level, and
/// under the directory it keeps its children in, one more per inline module, inside one.
fn spelled_file(file: &str, request: &str, spelled: &HashSet<String>) -> Option<String> {
    if !inline_spelled(request) {
        return normalize(&format!("{}/{request}", directory_of(file)));
    }
    let slash = request.find('/').unwrap_or(request.len());
    let mut parts = vec![child_directories(file, spelled).swap_remove(0)];
    parts.extend(inline_of(request));
    parts.push(request[slash + 1..].to_owned());
    normalize(&parts.join("/"))
}

/// The file `mod name;` inside `inline` of `file` declares, as Cargo lays one out.
fn declared_file(world: &World, file: &str, inline: &[String], name: &str, spelled: &HashSet<String>) -> Option<String> {
    child_directories(file, spelled).into_iter().find_map(|directory| {
        let at = std::iter::once(directory).chain(inline.iter().cloned()).collect::<Vec<_>>().join("/");
        [format!("{at}/{name}.rs"), format!("{at}/{name}/mod.rs")]
            .iter()
            .filter_map(|path| normalize(path))
            .find(|path| world.has(path))
    })
}

/// Where a file's child modules can live: beside a crate or directory root
/// and a file a `#[path]` loads; in its own directory, or beside it, for any other.
fn child_directories(file: &str, spelled: &HashSet<String>) -> Vec<String> {
    let beside = directory_of(file).to_owned();
    if ROOT_FILES.contains(&name_of(file)) || spelled.contains(file) {
        return vec![beside];
    }
    vec![module_directory(file), beside]
}

fn child_of(at: &Place, segment: &str, world: &World, modules: &Index) -> Option<String> {
    if let Some(declared) = modules.children.get(&at.file) {
        return declared.get(&joined(&at.inline, &[segment], "::")).cloned();
    }
    declared_file(world, &at.file, &at.inline, segment, &modules.spelled).filter(|child| *child != at.file)
}

/// Whether `segment` is an inline module in `at`'s file: one it declares at its top level, or one a file is declared inside.
fn holds_inline(at: &Place, segment: &str, world: &World, modules: &Index) -> bool {
    if at.inline.is_empty() && modules.items.get(&at.file).is_some_and(|items| items.inline.contains(segment)) {
        return true;
    }
    if let Some(declared) = modules.children.get(&at.file) {
        let key = joined(&at.inline, &[segment, ""], "::");
        return declared.keys().any(|name| name.starts_with(&key));
    }
    child_directories(&at.file, &modules.spelled)
        .iter()
        .any(|directory| !world.below(&joined(&[directory.clone()], &[&joined(&at.inline, &[segment], "/")], "/")).is_empty())
}

/// Whether the module at `at` declares `name` as an item; inside an inline
/// module, or for a file whose declarations were not read, the walk's answer stands.
fn declares_item(at: &Place, name: &str, modules: &Index) -> bool {
    !at.inline.is_empty() || modules.items.get(&at.file).is_none_or(|items| items.declared.contains(name))
}

/// The module that declares a file: the one its `mod` line is in, or the parent Cargo's layout puts it under.
fn parent_of(file: &str, world: &World, modules: &Index) -> Option<Place> {
    if let Some(declared) = modules.parent.get(file) {
        return Some(declared.clone());
    }
    let name = name_of(file);
    if name == "lib.rs" || name == "main.rs" {
        return None;
    }
    // `a/b/mod.rs` is the module `a/b`, and `a/b.rs` is too: its parent is `a`'s own file.
    let module = if name == "mod.rs" { directory_of(file).to_owned() } else { module_directory(file) };
    let up = directory_of(&module);
    let roots = ROOT_FILES.iter().map(|root| if up.is_empty() { (*root).to_owned() } else { format!("{up}/{root}") });
    let beside = (!up.is_empty()).then(|| format!("{up}.rs"));
    let found = roots.chain(beside).find(|path| path != file && world.has(path))?;
    // A parent whose `mod` lines were read and do not name this file is not its parent.
    (!modules.children.contains_key(&found)).then(|| Place::file(&found))
}

/// The crate root a file's `crate` names: the top of the chain of modules that declare it.
fn root_of(file: &str, world: &World, modules: &Index) -> String {
    let mut seen = HashSet::from([file.to_owned()]);
    let mut at = file.to_owned();
    while let Some(up) = parent_of(&at, world, modules).filter(|up| !seen.contains(&up.file)) {
        at = up.file;
        seen.insert(at.clone());
    }
    at
}

/// Every Cargo manifest's directory, by the crate name a `use` spells: the
/// `[package]` name when the manifest can be read, its directory's otherwise,
/// a hyphen an underscore either way.
fn crates(world: &World) -> HashMap<String, String> {
    let manifests: Vec<&str> = world.below("").par_iter().copied().filter(|path| *path == "Cargo.toml" || path.ends_with("/Cargo.toml")).collect();
    let named: Vec<(String, &str)> = manifests
        .par_iter()
        .map(|path| {
            let directory = &path[..path.len().saturating_sub("/Cargo.toml".len())];
            let text = world.text(path);
            (text.as_deref().and_then(manifest_name).unwrap_or_else(|| name_of(directory)).replace('-', "_"), directory)
        })
        .collect();
    // In path order, so a name two manifests give goes to the later one.
    let mut by_name = HashMap::new();
    for (name, directory) in named {
        if !name.is_empty() {
            by_name.insert(name, directory.to_owned());
        }
    }
    by_name
}

static PACKAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^\s*\[package\]\s*$").expect("a valid pattern"));
static TABLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^\s*\[").expect("a valid pattern"));
static NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?m)^\s*name\s*=\s*["']([^"']+)["']"#).expect("a valid pattern"));

/// The `name` of a manifest's `[package]` table; a `[workspace]` has none, and
/// one under `[dependencies]` or `[[bin]]` is not this crate's.
fn manifest_name(text: &str) -> Option<&str> {
    let table = PACKAGE.find(text)?;
    let after = &text[table.end()..];
    let body = TABLE.find(after).map_or(after, |next| &after[..next.start()]);
    NAME.captures(body).and_then(|found| found.get(1)).map(|name| name.as_str())
}

fn directory_of(file: &str) -> &str {
    file.rfind('/').map_or("", |cut| &file[..cut])
}

fn name_of(file: &str) -> &str {
    file.rfind('/').map_or(file, |cut| &file[cut + 1..])
}

/// The directory a file's child modules live in: a root file's own, any other's named after it.
fn module_directory(file: &str) -> String {
    let (directory, name) = (directory_of(file), name_of(file));
    if ROOT_FILES.contains(&name) {
        return directory.to_owned();
    }
    let stem = name.strip_suffix(".rs").unwrap_or(name);
    if directory.is_empty() { stem.to_owned() } else { format!("{directory}/{stem}") }
}

fn joined(head: &[String], tail: &[&str], by: &str) -> String {
    head.iter().map(String::as_str).chain(tail.iter().copied()).collect::<Vec<_>>().join(by)
}

/// A path with `..` and `.` taken out, or nothing when it climbs above the root.
fn normalize(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

#[cfg(test)]
#[path = "resolve_rust_tests.rs"]
mod tests;
