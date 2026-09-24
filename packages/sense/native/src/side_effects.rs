//! Whether a package declares that loading a module does something.
//!
//! The reading assumes loading a module only declares what it exports, and
//! charges a change by who uses it. A package can say otherwise, in the field
//! every bundler reads for exactly this question: `sideEffects`. `true`, or a
//! pattern matching the file, is the author saying that loading it runs
//! something the importer never names, so an import of it is a use by
//! whatever loads the importer. `false`, or no field, leaves the assumption
//! standing.
//!
//! The manifest is found by the resolver that resolves the import, so the
//! package that answers is the one the import lands in, and a pattern is
//! matched the way rolldown matches it.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use napi_derive::napi;
use oxc_resolver::SideEffects;

use crate::resolve::Resolvers;

/// Of a changed file and the sources it imports from, those whose package
/// declares that loading them does something: the file first, under its own
/// name, then each source as written.
#[napi]
pub fn declared_effects(root: String, file: String, sources: Vec<String>) -> Vec<String> {
    let resolvers = Resolvers::new(None, None);
    let from = Path::new(&root).join(&file);
    let mut declared = Vec::new();
    if effectful(&resolvers, &from, &from.to_string_lossy()) {
        declared.push(file);
    }
    declared.extend(sources.into_iter().filter(|source| effectful(&resolvers, &from, source)));
    declared
}

fn effectful(resolvers: &Resolvers, from: &Path, request: &str) -> bool {
    let Some(resolution) = resolvers.resolution(from, request) else {
        return false;
    };
    let Some(manifest) = resolution.package_json() else {
        return false;
    };
    let within = |pattern: &str| {
        let relative: PathBuf = resolution.path().strip_prefix(manifest.directory()).unwrap_or(resolution.path()).into();
        matches(pattern, &relative.to_string_lossy().replace('\\', "/"))
    };
    match manifest.side_effects() {
        Some(SideEffects::Bool(declared)) => declared,
        Some(SideEffects::String(pattern)) => within(pattern),
        Some(SideEffects::Array(patterns)) => patterns.into_iter().any(within),
        None => false,
    }
}

/// A `sideEffects` pattern against a path relative to its package: a pattern
/// with no `/` matches the name in any directory.
fn matches(pattern: &str, path: &str) -> bool {
    let pattern = pattern.trim_start_matches("./");
    let pattern = if pattern.contains('/') { Cow::Borrowed(pattern) } else { Cow::Owned(format!("**/{pattern}")) };
    fast_glob::glob_match(pattern.as_bytes(), path.trim_start_matches("./").as_bytes())
}

#[cfg(test)]
mod tests {
    use super::matches;

    #[test]
    fn a_pattern_without_a_directory_matches_anywhere() {
        assert!(matches("*.css", "src/theme/button.css"));
        assert!(matches("./src/register.ts", "src/register.ts"));
        assert!(!matches("./src/register.ts", "lib/src/register.ts"));
        assert!(matches("src/**/*.ts", "src/deep/polyfill.ts"));
    }
}
