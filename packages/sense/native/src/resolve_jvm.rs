//! Where a Java or Kotlin import lands: `resolveJvm` in `jvm.ts`. A package is
//! a directory under a source root, and the roots are derived once per world
//! from the package each directory's first JVM file declares, so asking is a lookup.

// compass: variance-authority.reach.source-index

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;

use crate::order::code_unit;
use crate::world::World;

/// Extensions a JVM import can land on. A Kotlin file may import a Java class and back.
const JVM_FILES: [&str; 2] = [".java", ".kt"];

/// The suffix that makes a request name a package directory rather than a file.
const WHOLE_PACKAGE: &str = ".*";

/// `packageOf` in `jvm.ts`: `\w` is ASCII there, and `^` follows `\r` as well as `\n`.
static PACKAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?mR)^[^\S\n]*package[^\S\n]+([A-Za-z0-9_.]+)").expect("a valid pattern"));

/// Every source root in the tree, shortest first, so the outermost root is
/// tried before a directory that is only a root because nothing in it said otherwise.
pub(crate) fn roots(world: &World) -> Vec<String> {
    let mut directories: Vec<&str> = Vec::new();
    let mut seen = HashSet::new();
    for path in world.below("") {
        if is_jvm(path) {
            let directory = path.rfind('/').map_or("", |cut| &path[..cut]);
            if seen.insert(directory) {
                directories.push(directory);
            }
        }
    }
    let mut roots: Vec<String> = Vec::new();
    for directory in directories {
        let sample = world.under(directory).find(|path| is_jvm(path));
        let text = sample.and_then(|sample| world.text(sample));
        let declared = text.as_deref().and_then(|text| PACKAGE.captures(text)).and_then(|found| found.get(1));
        let suffix = declared.map(|name| name.as_str().replace('.', "/"));
        let root = match suffix {
            Some(suffix) if directory == suffix => String::new(),
            Some(suffix) if directory.ends_with(&format!("/{suffix}")) => directory[..directory.len() - suffix.len() - 1].to_owned(),
            _ => directory.to_owned(),
        };
        roots.push(root);
    }
    roots.sort_by(|left, right| left.len().cmp(&right.len()).then_with(|| code_unit(left, right)));
    roots.dedup();
    roots
}

/// Every file a JVM import could mean: a whole package, the file the longest
/// prefix names, or, for a Kotlin name that is no file, every Kotlin file of its package.
pub(crate) fn resolve(world: &World, from: &str, request: &str) -> Vec<String> {
    let roots = world.jvm_roots();
    if let Some(package) = request.strip_suffix(WHOLE_PACKAGE) {
        let directory = package.replace('.', "/");
        return sources_in(world, roots, &directory).filter(|path| *path != from).map(str::to_owned).collect();
    }
    let segments: Vec<&str> = request.split('.').collect();
    // The longest prefix that is a file: `a.b.C.Inner` is the file `a/b/C`.
    for depth in (1..=segments.len()).rev() {
        let relative = segments[..depth].join("/");
        for root in roots {
            for extension in JVM_FILES {
                let path = at(root, &format!("{relative}{extension}"));
                if world.has(&path) && path != from {
                    return vec![path];
                }
            }
        }
    }
    // Kotlin's exception: the name was never a filename. Its package is.
    if segments.len() > 1 {
        let directory = segments[..segments.len() - 1].join("/");
        let kotlin: Vec<&str> = sources_in(world, roots, &directory).filter(|path| path.ends_with(".kt")).collect();
        if !kotlin.is_empty() {
            return kotlin.into_iter().filter(|path| *path != from).map(str::to_owned).collect();
        }
    }
    Vec::new()
}

fn sources_in<'w>(world: &World<'w>, roots: &[String], directory: &str) -> std::vec::IntoIter<&'w str> {
    let mut sources = Vec::new();
    for root in roots {
        sources.extend(world.under(&at(root, directory)).filter(|path| is_jvm(path)));
    }
    sources.into_iter()
}

fn is_jvm(path: &str) -> bool {
    JVM_FILES.iter().any(|end| path.ends_with(end))
}

fn at(root: &str, rest: &str) -> String {
    if root.is_empty() { rest.to_owned() } else { format!("{root}/{rest}") }
}

#[cfg(test)]
#[path = "resolve_jvm_tests.rs"]
mod tests;
