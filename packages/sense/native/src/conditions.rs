//! The export conditions a `tsconfig` adds: `compilerOptions.customConditions`.
//!
//! A workspace that points its packages' `exports` at source under a condition
//! of its own — `"@tanstack/custom-condition": "./src/index.ts"` beside an
//! `import` that names a `build/` directory git does not track — tells
//! TypeScript so in `customConditions`, and TypeScript is the owner of what the
//! specifier means. `oxc_resolver` finds the `tsconfig` that governs a file
//! (`Resolver::find_tsconfig`) but does not parse this option, so this module
//! reads it from the file that resolver chose, following `extends` the way
//! TypeScript does: a config that sets the option replaces what it inherits,
//! `null` clears it, and of several bases the last one wins.
//!
//! The JavaScript oracle reads the same option by the same rule
//! (`src/conditions.ts`), and the two are compared on a fixture.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use serde_json::Value;

/// What a config chain says about `customConditions`: nothing, or a list,
/// where a `null` in the chain is the empty list.
pub fn custom_conditions(tsconfig: &Path) -> Option<Vec<String>> {
    declared(tsconfig, &mut HashSet::new())
}

fn declared(path: &Path, seen: &mut HashSet<PathBuf>) -> Option<Vec<String>> {
    if !seen.insert(path.to_owned()) {
        return None;
    }
    let config = read(path)?;
    if let Some(value) = config
        .get("compilerOptions")
        .and_then(Value::as_object)
        .and_then(|options| options.get("customConditions"))
    {
        return Some(match value {
            Value::Array(names) => names
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
            _ => Vec::new(),
        });
    }
    let directory = path.parent()?;
    let bases: Vec<&str> = match config.get("extends") {
        Some(Value::String(one)) => vec![one.as_str()],
        Some(Value::Array(many)) => many.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    bases
        .into_iter()
        .rev()
        .filter_map(|base| extended(directory, base))
        .find_map(|base| declared(&base, seen))
}

fn read(path: &Path) -> Option<Value> {
    let mut bytes = std::fs::read(path).ok()?;
    if bytes.starts_with(b"\xEF\xBB\xBF") {
        bytes.drain(..3);
    }
    json_strip_comments::strip_slice(&mut bytes).ok()?;
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Some(Value::Null);
    }
    serde_json::from_slice(&bytes).ok()
}

/// The file an `extends` entry names: a path, or a package under a
/// `node_modules` above the config. A `#` import is not followed.
fn extended(directory: &Path, specifier: &str) -> Option<PathBuf> {
    if specifier.starts_with('/') || specifier.starts_with('.') {
        return config_file(&normalize(&directory.join(specifier)));
    }
    if specifier.starts_with('#') || specifier.is_empty() {
        return None;
    }
    directory
        .ancestors()
        .find_map(|at| config_file(&at.join("node_modules").join(specifier)))
}

/// The order `oxc_resolver` loads an extended config in: the file, a
/// directory's `tsconfig.json`, then the name with `.json` added.
fn config_file(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        return Some(path.to_owned());
    }
    let chosen = if path.is_dir() {
        path.join("tsconfig.json")
    } else {
        let mut named = path.as_os_str().to_owned();
        named.push(".json");
        PathBuf::from(named)
    };
    chosen.is_file().then_some(chosen)
}

fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(files: &[(&str, &str)]) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "sense-conditions-{}-{}",
            std::process::id(),
            files.len()
        ));
        let _ = std::fs::remove_dir_all(&root);
        for (path, text) in files {
            let at = root.join(path);
            std::fs::create_dir_all(at.parent().unwrap()).unwrap();
            std::fs::write(at, text).unwrap();
        }
        root
    }

    #[test]
    fn a_child_replaces_and_null_clears() {
        let root = fixture(&[
            (
                "tsconfig.json",
                "{ // comment\n \"compilerOptions\": { \"customConditions\": [\"@acme/source\"], }, }",
            ),
            ("a/tsconfig.json", "{ \"extends\": \"../tsconfig.json\" }"),
            (
                "b/tsconfig.json",
                "{ \"extends\": \"../tsconfig\", \"compilerOptions\": { \"customConditions\": null } }",
            ),
            (
                "c/tsconfig.json",
                "{ \"extends\": [\"../tsconfig.json\", \"./other.json\"] }",
            ),
            (
                "c/other.json",
                "{ \"compilerOptions\": { \"customConditions\": [\"other\"] } }",
            ),
            ("d/tsconfig.json", "{}"),
        ]);
        let of = |dir: &str| custom_conditions(&root.join(dir).join("tsconfig.json"));

        assert_eq!(of(""), Some(vec!["@acme/source".to_owned()]));
        assert_eq!(of("a"), Some(vec!["@acme/source".to_owned()]));
        assert_eq!(of("b"), Some(Vec::new()));
        assert_eq!(of("c"), Some(vec!["other".to_owned()]));
        assert_eq!(of("d"), None);
        let _ = std::fs::remove_dir_all(&root);
    }
}
