//! The files a catalog shows, read off the tests' side of the code map.
//!
//! A catalog — a `*.stories.*` or `*.examples.*` file — is a test by its path,
//! so a file only catalogs reach lands on the tests' side (`tests` in
//! `orient_map_read.rs`). The component a catalog shows is not test code,
//! though: it is written for the product, wired in or not yet. Which import is
//! that component is read by collocation, never from the catalog's own format:
//! the import beside the catalog that carries its stem (`Button.stories.tsx`
//! takes `./Button`), or that stem's directory index (`./Button/index.tsx`).
//! Whatever else a catalog imports — a decorator, a mock, a fixture — is its
//! helper, and a catalog with no collocated import shows nothing.

// compass: variance-authority.reach.relations

use regex::Regex;

/// A catalog by its path: the directory it is in, and the stem it shows.
const CATALOG: &str = r"(?i)^(.*/)?([^/]+)\.(?:stories|examples)\.[cm]?[jt]sx?$";

/// The files on the tests' side that a catalog's component reaches, the
/// component included, in the order of `paths`. The walk stops at a file that
/// is a test by its path, because a test the component imports is not shown.
pub(crate) fn catalogued(paths: &[&str], outgoing: &[Vec<usize>], named: &[bool], test: &[bool]) -> Vec<String> {
    let catalog = Regex::new(CATALOG).expect("the pattern is fixed");
    let mut seen = vec![false; paths.len()];
    let mut queue = Vec::new();
    for (at, path) in paths.iter().enumerate() {
        let Some(captures) = catalog.captures(path) else { continue };
        let (directory, stem) = (captures.get(1).map_or("", |directory| directory.as_str()), &captures[2]);
        for &to in outgoing[at].iter().filter(|&&to| !named[to] && shows(directory, stem, paths[to])) {
            if !seen[to] {
                seen[to] = true;
                queue.push(to);
            }
        }
    }
    while let Some(at) = queue.pop() {
        for &to in &outgoing[at] {
            if !seen[to] && !named[to] {
                seen[to] = true;
                queue.push(to);
            }
        }
    }
    paths.iter().enumerate().filter(|&(at, _)| seen[at] && test[at]).map(|(_, path)| (*path).to_owned()).collect()
}

/// Whether `file` is the `stem` a catalog in `directory` shows: `stem` with one
/// extension beside it, or the index of a directory named `stem`.
fn shows(directory: &str, stem: &str, file: &str) -> bool {
    let Some(rest) = file.strip_prefix(directory).and_then(|rest| rest.strip_prefix(stem)) else { return false };
    let extension = rest.strip_prefix('.').or_else(|| rest.strip_prefix("/index."));
    extension.is_some_and(|extension| !extension.is_empty() && !extension.contains(['.', '/']))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_catalog_shows_the_import_beside_it_that_carries_its_stem() {
        assert!(shows("src/", "Button", "src/Button.tsx"));
        assert!(shows("src/", "Button", "src/Button/index.ts"));
        assert!(shows("", "Button", "Button.jsx"));
        assert!(!shows("src/", "Button", "src/ButtonGroup.tsx"));
        assert!(!shows("src/", "Button", "src/Button.styles.ts"));
        assert!(!shows("src/", "Button", "src/Button/Icon.tsx"));
        assert!(!shows("src/", "Button", "lib/Button.tsx"));
    }

    #[test]
    fn the_component_and_what_it_reaches_are_shown_and_the_catalogs_helpers_are_not() {
        let paths = ["src/Button.stories.tsx", "src/Button.tsx", "src/decorate.ts", "src/icon.ts", "src/index.ts", "src/theme.ts"];
        let outgoing = vec![vec![1, 2], vec![3, 5], vec![], vec![], vec![5], vec![]];
        let named = [true, false, false, false, false, false];
        let test = [true, true, true, true, false, false];
        assert_eq!(catalogued(&paths, &outgoing, &named, &test), ["src/Button.tsx", "src/icon.ts"]);
    }

    #[test]
    fn a_catalog_with_no_collocated_import_shows_nothing() {
        let paths = ["src/all.examples.tsx", "src/Button.tsx"];
        let outgoing = vec![vec![1], vec![]];
        assert!(catalogued(&paths, &outgoing, &[true, false], &[true, true]).is_empty());
    }
}
