//! What `containment` reads of a path: the listed package it is in, the tree
//! it counts in, and whether it is a test or source. Every file `HEAD` holds is
//! read here once, so only the trees that hold source cross to JavaScript; a
//! commit's own files are read by the same rule, a commit at a time.

// compass: variance-authority.report.agent-surface

use std::collections::HashSet;

use napi_derive::napi;

use crate::path::{extension, is_test_path, package_owner};

/// How `HEAD`'s files are listed, as a refusal names it.
const LS_TREE: [&str; 5] = ["ls-tree", "-r", "-z", "--name-only", "HEAD"];

/// The files `HEAD` holds under `root`, spelled from it: the tree the log ends
/// at, not what is staged. A refusal names the command and what git said.
pub(crate) fn head_files(root: &str) -> Result<Vec<String>, String> {
    let listed = crate::git::answer_or_refusal(root, &LS_TREE)?;
    Ok(String::from_utf8_lossy(&listed).split('\0').filter(|path| !path.is_empty()).map(str::to_owned).collect())
}

/// A listed package set and the extensions source is written in: what one
/// path says under them.
#[napi]
pub struct PathKinds {
    packages: HashSet<String>,
    extensions: HashSet<String>,
}

/// What one path says.
#[napi(object)]
#[derive(Debug, PartialEq)]
pub struct PathKind {
    /// The deepest listed package holding it, or `.` when none does.
    pub owner: String,
    /// Its package, or its top folder when it is in none: `.` for a file at the root.
    pub tree: String,
    /// Named as a test, or with the tests, read from inside its package.
    pub test: bool,
    /// One of the source extensions, and no test.
    pub source: bool,
}

/// The trees of a checkout that hold source, or why git could not list them.
#[napi(object)]
pub struct SourceTrees {
    /// In code-unit order.
    /// bound: the checkout's listed packages and top-level folders
    pub trees: Vec<String>,
    /// What the addon ran and what git said, when it could not list the files `HEAD` holds; then there are no trees.
    pub refused: Option<String>,
}

/// The rule [`PathKinds`] reads paths by, over `packages` and `extensions`.
///
/// bound: the checkout's listed packages and the source extensions
#[napi]
pub fn path_kinds(packages: Vec<String>, extensions: Vec<String>) -> PathKinds {
    PathKinds { packages: packages.into_iter().collect(), extensions: extensions.into_iter().collect() }
}

impl PathKinds {
    fn owner_of<'a>(&self, file: &'a str) -> &'a str {
        package_owner(&self.packages, file)
    }

    fn tree_of<'a>(&self, file: &'a str) -> (&'a str, &'a str) {
        let owner = self.owner_of(file);
        let tree = match file.find('/') {
            Some(slash) if owner == "." => &file[..slash],
            _ => owner,
        };
        (owner, tree)
    }

    fn test(&self, file: &str, owner: &str) -> bool {
        is_test_path(if owner == "." { file } else { &file[owner.len() + 1..] })
    }

    fn source(&self, file: &str, test: bool) -> bool {
        !test && self.extensions.contains(extension(file))
    }
}

#[napi]
impl PathKinds {
    /// The deepest listed package holding `file`, or `.`.
    #[napi]
    pub fn owner(&self, file: String) -> String {
        self.owner_of(&file).to_owned()
    }

    /// What each of `files` says, in order.
    ///
    /// bound: the files the caller asked, one commit's
    #[napi]
    pub fn of(&self, files: Vec<String>) -> Vec<PathKind> {
        files
            .iter()
            .map(|file| {
                let (owner, tree) = self.tree_of(file);
                let test = self.test(file, owner);
                PathKind { owner: owner.to_owned(), tree: tree.to_owned(), test, source: self.source(file, test) }
            })
            .collect()
    }

    /// The trees of the files `HEAD` holds under `root` that hold source: each
    /// listed package holding a source file, and each top folder holding one
    /// outside every package. What `containment` counts a package or a
    /// test-only tree by.
    ///
    /// bound: the checkout's listed packages and top-level folders
    #[napi]
    pub fn source_trees(&self, root: String) -> SourceTrees {
        let listed = match head_files(&root) {
            Ok(listed) => listed,
            Err(refused) => return SourceTrees { trees: Vec::new(), refused: Some(refused) },
        };
        let mut trees: HashSet<&str> = HashSet::new();
        for file in &listed {
            let (owner, tree) = self.tree_of(file);
            if self.source(file, self.test(file, owner)) {
                trees.insert(tree);
            }
        }
        let mut trees: Vec<String> = trees.into_iter().map(str::to_owned).collect();
        trees.sort_unstable_by(|a, b| crate::order::code_unit(a, b));
        SourceTrees { trees, refused: None }
    }
}

#[cfg(test)]
#[path = "source_trees_tests.rs"]
mod tests;
