//! Where a Python specifier lands. A dotted name is a file under one of the
//! tree's source roots, and a leading dot climbs from the importing file's
//! package. The reader ([`python.rs`](./languages/python.rs)) is the walk; the
//! argument for what it emits is here, because resolution is what makes it true.
//!
//! ## One statement is several modules
//!
//! `from briefcase.platform.answer import diagnose` runs four files: the three
//! package `__init__.py` on the way down, and then either `answer/diagnose.py`
//! — if `diagnose` is a module — or nothing more, if it is a name that
//! `answer/__init__.py` defines. **Which of the two is a fact about the disk,
//! not about the statement**, and the language offers no way to tell them apart
//! by reading.
//!
//! So the reader emits every module path the statement could have meant and
//! marks the ones it derived as guessed. A guess that lands is an edge; one
//! that does not is silence — not an unresolved specifier, not a hole, not an
//! `unknown`. Measured over `briefcase`, 299 files and 597 first-party
//! requests: resolving only the written module misses **64 edges**, a tenth of
//! them, and the shape it misses is a test importing three sibling modules from
//! their package. A change to one of those modules would not select that test.
//!
//! ## An import executes the packages above it
//!
//! `import a.b.c` runs `a/__init__.py` and `a/b/__init__.py` before `a/b/c.py`,
//! so a change to either reaches every importer: 246 edges over `briefcase` that
//! nothing else reaches. They are guessed for a different reason than
//! submodules are: a package directory with no `__init__.py` is a namespace
//! package (PEP 420), ordinary, with no file to depend on, so a prefix that does
//! not land is not a hole either.
//!
//! ## `if TYPE_CHECKING:` is `import type`
//!
//! The block is erased before anything runs, as a TypeScript type import is, so
//! it is read as one. Its `else:` branch is the runtime half and is not.
//!
//! ## What is unknown
//!
//! A parse error, and a non-literal `importlib.import_module(x)` or
//! `__import__(x)`. A literal one is a `dynamic` edge, as a literal `require` is.

// compass: variance-authority.reach.source-scan

use crate::order::code_unit;
use crate::world::World;

/// Files a package is made of, in the order Python looks for them.
const MODULE_FILES: [&str; 4] = [".py", "/__init__.py", ".pyi", "/__init__.pyi"];

/// Manifests whose directory is a source root, and whose `src/` is one too.
const MANIFESTS: [&str; 3] = ["pyproject.toml", "setup.py", "setup.cfg"];

/// Each manifest's directory, after its `src/` when something is under it,
/// in the order `paths` names them, then the repository root: `pythonRootsOf`.
#[cfg(test)]
pub(crate) fn roots_of(paths: &[&str]) -> Vec<String> {
    let mut sorted = paths.to_vec();
    sorted.sort_unstable_by(|left, right| code_unit(left, right));
    roots_in(paths, &sorted)
}

/// [`roots_of`] for a tree whose paths are already sorted, as a world's are.
pub(crate) fn roots_in(paths: &[&str], sorted: &[&str]) -> Vec<String> {
    // `src/` counts when something is under it, not when it is merely named.
    let holds = |src: &str| {
        let prefix = format!("{src}/");
        let at = sorted.partition_point(|path| code_unit(path, &prefix).is_lt());
        sorted.get(at).is_some_and(|path| path.starts_with(&prefix))
    };
    let mut roots: Vec<String> = Vec::new();
    let add = |root: String, roots: &mut Vec<String>| {
        if !roots.contains(&root) {
            roots.push(root);
        }
    };
    for path in paths {
        let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
        if !MANIFESTS.contains(&name) {
            continue;
        }
        let src = if dir.is_empty() { "src".to_owned() } else { format!("{dir}/src") };
        if holds(&src) {
            add(src, &mut roots);
        }
        add(dir.to_owned(), &mut roots);
    }
    add(String::new(), &mut roots);
    roots
}

/// The file `request` names from `from`, as a one-element list, or nothing.
pub(crate) fn resolve(world: &World, from: &str, request: &str) -> Vec<String> {
    let dots = request.bytes().take_while(|byte| *byte == b'.').count();
    let tail = request[dots..].replace('.', "/");
    if dots > 0 {
        // One dot is this package — the directory the file is in. Each further dot is one package up.
        let parts: Vec<&str> = from.split('/').collect();
        let parts = &parts[..parts.len() - 1];
        if dots - 1 > parts.len() {
            return Vec::new();
        }
        let base = parts[..parts.len() - (dots - 1)].join("/");
        let named = if base.is_empty() { tail } else if tail.is_empty() { base } else { format!("{base}/{tail}") };
        return found(world, &named).into_iter().collect();
    }
    for root in world.python_index().holding(tail.split('/').next().unwrap_or("")) {
        let named = if root.is_empty() { tail.clone() } else { format!("{root}/{tail}") };
        if let Some(landed) = found(world, &named) {
            return vec![landed];
        }
    }
    Vec::new()
}

fn found(world: &World, base: &str) -> Option<String> {
    if base.is_empty() {
        return None;
    }
    MODULE_FILES.iter().map(|end| format!("{base}{end}")).find(|candidate| world.has(candidate))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    const TREE: [&str; 7] = [
        "pyproject.toml",
        "a/pyproject.toml",
        "a/src/pkg/__init__.py",
        "a/src/pkg/one.py",
        "b/pyproject.toml",
        "b/src/pkg/two.py",
        "b/src/pkg/deep/three.py",
    ];

    fn known() -> HashMap<String, u32> {
        TREE.iter().zip(0..).map(|(path, at)| ((*path).to_owned(), at)).collect()
    }

    fn landed(world: &World, from: &str, request: &str) -> Vec<String> {
        world.resolve(crate::read_any::Language::Python, from, request, false)
    }

    /// `python.test.ts`: takes a source root from every manifest, and from `src` under each.
    #[test]
    fn a_root_comes_from_every_manifest_and_the_src_under_it() {
        assert_eq!(roots_of(&TREE), ["", "a/src", "a", "b/src", "b"]);
        // A scan asks in the tree's sorted order, so a nested manifest comes first.
        let known = known();
        let world = World::new(Some(&known), None);
        assert_eq!(world.python_roots(), ["a/src", "a", "b/src", "b", ""]);
    }

    /// `python.test.ts`: unions the source roots, because one package can be spread across them.
    #[test]
    fn one_package_spread_over_two_roots_resolves_through_their_union() {
        let known = known();
        let world = World::new(Some(&known), None);
        assert_eq!(landed(&world, "a/src/pkg/one.py", "pkg.two"), ["b/src/pkg/two.py"]);
        assert_eq!(landed(&world, "b/src/pkg/two.py", "pkg.one"), ["a/src/pkg/one.py"]);
    }

    /// `python.test.ts`: counts the leading dots as the number of packages to climb.
    #[test]
    fn each_leading_dot_past_the_first_climbs_one_package() {
        let known = known();
        let world = World::new(Some(&known), None);
        assert_eq!(landed(&world, "b/src/pkg/deep/three.py", ".three"), ["b/src/pkg/deep/three.py"]);
        assert_eq!(landed(&world, "b/src/pkg/deep/three.py", "..two"), ["b/src/pkg/two.py"]);
        assert!(landed(&world, "top.py", "...x").is_empty());
    }

    /// `python.test.ts`: prefers the module to the package of the same name.
    #[test]
    fn a_package_lands_on_its_init() {
        let known = known();
        let world = World::new(Some(&known), None);
        assert_eq!(landed(&world, "a/src/pkg/one.py", "pkg"), ["a/src/pkg/__init__.py"]);
    }
}
