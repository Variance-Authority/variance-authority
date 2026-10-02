//! The files a catalog shows, read off the tests' side of the code map.
//!
//! A catalog — a `*.stories.*`, `*.story.*` or `*.examples.*` file — is a test
//! by its path, so a file only catalogs reach lands on the tests' side (`tests`
//! in `orient_map_read.rs`). The component a catalog shows is not test code,
//! though: it is written for the product, wired in or not yet. Which import is
//! that component is read by collocation, never from the catalog's own format
//! and never from names, since a story and its component can be named anything:
//! every import in the catalog's directory or below it is shown
//! (`Checkout.stories.tsx` takes `./PayButton` and `./parts/Total`). What a
//! catalog imports from outside its directory — a decorator in `.storybook/`, a
//! mock in `test-utils/` — is its helper.

// compass: variance-authority.reach.relations

use regex::Regex;

/// A catalog by its path, capturing the directory it is in.
const CATALOG: &str = r"(?i)^(.*/)?[^/]+\.(?:stories|story|examples)\.[cm]?[jt]sx?$";

/// The files on the tests' side that a catalog's components reach, the
/// components included, in the order of `paths`. The walk stops at a file that
/// is a test by its path, because a test a component imports is not shown.
pub(crate) fn catalogued(paths: &[&str], outgoing: &[Vec<usize>], named: &[bool], test: &[bool]) -> Vec<String> {
    let catalog = Regex::new(CATALOG).expect("the pattern is fixed");
    let mut seen = vec![false; paths.len()];
    let mut queue = Vec::new();
    for (at, path) in paths.iter().enumerate() {
        let Some(captures) = catalog.captures(path) else { continue };
        let directory = captures.get(1).map_or("", |directory| directory.as_str());
        for &to in outgoing[at].iter().filter(|&&to| !named[to] && paths[to].starts_with(directory)) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_catalog_shows_what_it_imports_from_its_directory_whatever_the_names() {
        let paths = ["src/checkout/Checkout.stories.tsx", "src/checkout/PayButton.tsx", "src/checkout/parts/Total.tsx", "src/Card.examples.tsx", "src/Card.tsx"];
        let outgoing = vec![vec![1, 2], vec![], vec![], vec![4], vec![]];
        let named = [true, false, false, true, false];
        let test = [true, true, true, true, true];
        assert_eq!(catalogued(&paths, &outgoing, &named, &test), ["src/checkout/PayButton.tsx", "src/checkout/parts/Total.tsx", "src/Card.tsx"]);
    }

    #[test]
    fn the_components_and_what_they_reach_are_shown_and_what_the_catalog_imports_from_elsewhere_is_not() {
        let paths = [".storybook/decorate.ts", "src/Button.stories.tsx", "src/Button.tsx", "src/icon.ts", "src/index.ts", "src/theme.ts"];
        let outgoing = vec![vec![], vec![0, 2], vec![3, 5], vec![], vec![5], vec![]];
        let named = [false, true, false, false, false, false];
        let test = [true, true, true, true, false, false];
        assert_eq!(catalogued(&paths, &outgoing, &named, &test), ["src/Button.tsx", "src/icon.ts"]);
    }

    #[test]
    fn a_test_a_catalog_imports_is_not_shown() {
        let paths = ["Button.stories.jsx", "Button.test.jsx"];
        let outgoing = vec![vec![1], vec![]];
        assert!(catalogued(&paths, &outgoing, &[true, true], &[true, true]).is_empty());
    }
}
