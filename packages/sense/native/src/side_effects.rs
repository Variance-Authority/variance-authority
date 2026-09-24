//! Whether a package declares that loading a module does something.
//!
//! The reading assumes loading a module only declares what it exports, and
//! charges a change by who uses it. A package can say otherwise, in the field
//! every bundler reads for exactly this question: `sideEffects`. `true`, or a
//! pattern matching the file, is the author saying that loading it runs
//! something the importer never names, so an import of it is a use by
//! whatever loads the importer. `false`, or no field, leaves the assumption
//! standing — where a bundler would keep the module, this reads the absence as
//! the author's silence, and the fix for a module that is loud is its
//! declaration.
//!
//! The file graph owns which file an import lands in and what that file
//! loads; this answers only for files the caller names. A file answers to the
//! nearest `package.json` above it, which is the one a bundler reads, and a
//! pattern is matched the way rolldown matches it.

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use napi_derive::napi;
use serde_json::Value;

use crate::resolve::Resolvers;

/// Where each source a file imports from lands: the repository path, the
/// absolute path of a file outside the checkout, or an empty string when
/// nothing resolves. The sources a diff added or removed are the ones the
/// graph cannot name, because it holds edges and not the words that wrote them.
#[napi]
pub fn resolve_sources(root: String, file: String, sources: Vec<String>) -> Vec<String> {
    let resolvers = Resolvers::new(None, None);
    // The resolver answers with the path a symlink leads to, and a repository
    // path is cut from the root that path lies under.
    let root = std::fs::canonicalize(&root).unwrap_or_else(|_| PathBuf::from(&root));
    let from = root.join(&file);
    sources
        .iter()
        .map(|source| {
            resolvers
                .resolve(&root, &from, source, None)
                .or_else(|| resolvers.resolution(&from, source).map(|found| found.path().to_string_lossy().into_owned()))
                .unwrap_or_default()
        })
        .collect()
}

/// Of these files, repository-relative or absolute, those whose package
/// declares that loading them does something, in the order asked.
#[napi]
pub fn declared_effects(root: String, files: Vec<String>) -> Vec<String> {
    let root = Path::new(&root);
    let mut manifests = HashMap::new();
    files.into_iter().filter(|file| declared(&mut manifests, &root.join(file))).collect()
}

fn declared(manifests: &mut HashMap<PathBuf, Option<Value>>, path: &Path) -> bool {
    for directory in path.ancestors().skip(1) {
        let manifest = manifests.entry(directory.to_owned()).or_insert_with(|| {
            let text = std::fs::read_to_string(directory.join("package.json")).ok()?;
            Some(serde_json::from_str::<Value>(&text).unwrap_or(Value::Null))
        });
        let Some(manifest) = manifest else { continue };
        let relative = path.strip_prefix(directory).unwrap_or(path).to_string_lossy().replace('\\', "/");
        return match manifest.get("sideEffects") {
            Some(Value::Bool(declared)) => *declared,
            Some(Value::String(pattern)) => matches(pattern, &relative),
            Some(Value::Array(patterns)) => patterns.iter().filter_map(Value::as_str).any(|pattern| matches(pattern, &relative)),
            _ => false,
        };
    }
    false
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
