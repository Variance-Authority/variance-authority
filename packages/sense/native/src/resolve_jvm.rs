//! Where a Java or Kotlin import lands. A package is a directory under a source
//! root, and the roots are derived once per world from the package each
//! directory's first JVM file declares, so asking is a lookup. Java and Kotlin
//! are two syntaxes over this one algorithm, and differ in one filename rule.
//!
//! ## Every import is a guess
//!
//! `import java.util.List` and `import com.ours.List` are the same statement,
//! and most imports in a real JVM file are the standard library or a
//! dependency. So every request is guessed: one that lands is an edge, one that
//! does not is silence, and a JVM file never reports an unresolved specifier.
//!
//! ## The source root is derived, not configured
//!
//! `src/main/java` is a convention, wrong for every project that does not hold
//! to it. The file says it instead: `a/b/c/Thing.java` declaring `package b.c`
//! sits under the root `a`, exact wherever the compiler's answer is.
//!
//! ## A package is implicit
//!
//! Types in the same package are visible with no import, so every file asks for
//! its own package too: over a JVM codebase the majority of the real edges.
//!
//! ## A Kotlin file need not be named after its class
//!
//! `import a.b.parse` may be a top-level function in any file of `a/b/`, so
//! when the named file is not there, every Kotlin file in the package is the
//! answer. Java has the rule, so Java stops at the file.

// compass: variance-authority.reach.source-scan

use std::collections::HashSet;
use std::sync::LazyLock;

use rayon::prelude::*;
use regex::Regex;

use crate::order::code_unit;
use crate::source_roots::SourceRoots;
use crate::world::World;

/// Extensions a JVM import can land on. A Kotlin file may import a Java class and back.
const JVM_FILES: [&str; 2] = [".java", ".kt"];

/// The suffix that makes a request name a package directory rather than a file.
const WHOLE_PACKAGE: &str = ".*";

/// A file's package line: `\w` is ASCII, and `^` follows `\r` as well as `\n`.
static PACKAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?mR)^[^\S\n]*package[^\S\n]+([A-Za-z0-9_.]+)").expect("a valid pattern"));

/// Every source root in the tree, shortest first, so the outermost root is
/// tried before a directory that is only a root because nothing in it said otherwise.
fn roots(world: &World) -> Vec<String> {
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
    // Each directory's root is its own sample's to say, so they are read on
    // every core; the roots are sorted after, so no thread's order shows.
    let mut roots: Vec<String> = directories
        .into_par_iter()
        .map(|directory| {
            let sample = world.under(directory).find(|path| is_jvm(path));
            let text = sample.and_then(|sample| world.text(sample));
            let declared = text.as_deref().and_then(|text| PACKAGE.captures(text)).and_then(|found| found.get(1));
            let suffix = declared.map(|name| name.as_str().replace('.', "/"));
            match suffix {
                Some(suffix) if directory == suffix => String::new(),
                Some(suffix) if directory.ends_with(&format!("/{suffix}")) => directory[..directory.len() - suffix.len() - 1].to_owned(),
                _ => directory.to_owned(),
            }
        })
        .collect();
    roots.sort_by(|left, right| left.len().cmp(&right.len()).then_with(|| code_unit(left, right)));
    roots.dedup();
    roots
}

/// The source roots, with the top-level packages each holds.
pub(crate) fn index(world: &World) -> SourceRoots {
    SourceRoots::of(roots(world), world.below("").iter().copied(), &JVM_FILES)
}

/// Every file a JVM import could mean: a whole package, the file the longest
/// prefix names, or, for a Kotlin name that is no file, every Kotlin file of its package.
pub(crate) fn resolve(world: &World, from: &str, request: &str) -> Vec<String> {
    let roots = world.jvm_index();
    let top = request.split('.').next().unwrap_or("");
    if let Some(package) = request.strip_suffix(WHOLE_PACKAGE) {
        let directory = package.replace('.', "/");
        return sources_in(world, roots.holding(top), &directory).filter(|path| *path != from).map(str::to_owned).collect();
    }
    let segments: Vec<&str> = request.split('.').collect();
    // The longest prefix that is a file: `a.b.C.Inner` is the file `a/b/C`.
    for depth in (1..=segments.len()).rev() {
        let relative = segments[..depth].join("/");
        for root in roots.holding(top) {
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
        let kotlin: Vec<&str> = sources_in(world, roots.holding(top), &directory).filter(|path| path.ends_with(".kt")).collect();
        if !kotlin.is_empty() {
            return kotlin.into_iter().filter(|path| *path != from).map(str::to_owned).collect();
        }
    }
    Vec::new()
}

fn sources_in<'w, 'r>(world: &World<'w>, roots: impl Iterator<Item = &'r str>, directory: &str) -> std::vec::IntoIter<&'w str> {
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
