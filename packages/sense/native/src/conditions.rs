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
//!
//! The emit options (`emitted.rs`) inherit along the same chain, so both are
//! asked of `Configs`, which reads each file of the chain once in a scan.

// compass: variance-authority.reach.source-scan

use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use dashmap::DashMap;
use rustc_hash::FxBuildHasher;
use serde_json::{Map, Value};

/// What one config file says by itself: its `compilerOptions`, and the files
/// its `extends` names, the last first.
struct Config {
    directory: PathBuf,
    options: Map<String, Value>,
    bases: Vec<PathBuf>,
}

/// One scan's reading of its `tsconfig` files. A base a thousand packages
/// extend is asked for once per option per package, so each file is read and
/// parsed once and kept while the scan's resolvers live; the next scan reads
/// the disk again.
#[derive(Clone, Default)]
pub struct Configs {
    /// One cell per file, so resolvers asking at once read it once.
    files: Arc<DashMap<PathBuf, Arc<OnceLock<Option<Arc<Config>>>>, FxBuildHasher>>,
}

impl Configs {
    /// What a config chain says about `customConditions`: nothing, or a list,
    /// where a `null` in the chain is the empty list.
    pub fn custom_conditions(&self, tsconfig: &Path) -> Option<Vec<String>> {
        let (value, _) = self.setting(tsconfig, "customConditions")?;
        Some(match value {
            Value::Array(names) => names.iter().filter_map(Value::as_str).map(str::to_owned).collect(),
            _ => Vec::new(),
        })
    }

    /// A compiler option as the config chain sets it, with the directory of
    /// the config that wrote it. The nearest config that names it wins, and of
    /// several bases the last one.
    pub(crate) fn setting(&self, path: &Path, name: &str) -> Option<(Value, PathBuf)> {
        self.inherited(path, name, &mut Vec::new())
    }

    fn inherited(&self, path: &Path, name: &str, seen: &mut Vec<PathBuf>) -> Option<(Value, PathBuf)> {
        if seen.iter().any(|known| known == path) {
            return None;
        }
        seen.push(path.to_owned());
        let config = self.config(path)?;
        if let Some(value) = config.options.get(name) {
            return Some((value.clone(), config.directory.clone()));
        }
        config.bases.iter().find_map(|base| self.inherited(base, name, seen))
    }

    fn config(&self, path: &Path) -> Option<Arc<Config>> {
        let known = self.files.get(path).map(|cell| Arc::clone(&cell));
        let cell = known.unwrap_or_else(|| Arc::clone(&self.files.entry(path.to_owned()).or_default()));
        cell.get_or_init(|| read(path).map(Arc::new)).clone()
    }
}

fn read(path: &Path) -> Option<Config> {
    let mut bytes = std::fs::read(path).ok()?;
    if bytes.starts_with(b"\xEF\xBB\xBF") {
        bytes.drain(..3);
    }
    json_strip_comments::strip_slice(&mut bytes).ok()?;
    let mut config = match bytes.iter().all(u8::is_ascii_whitespace) {
        true => Value::Null,
        false => serde_json::from_slice(&bytes).ok()?,
    };
    let directory = path.parent()?.to_owned();
    let bases: Vec<&str> = match config.get("extends") {
        Some(Value::String(one)) => vec![one.as_str()],
        Some(Value::Array(many)) => many.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    let bases = bases.into_iter().rev().filter_map(|base| extended(&directory, base)).collect();
    let options = match config.get_mut("compilerOptions").map(Value::take) {
        Some(Value::Object(options)) => options,
        _ => Map::new(),
    };
    Some(Config { directory, options, bases })
}

/// The file an `extends` entry names: a path, or a package under a
/// `node_modules` above the config. A `#` import is not followed.
fn extended(directory: &Path, specifier: &str) -> Option<PathBuf> {
    // FIXME: a package `extends` is read as the path `node_modules/<specifier>`
    // and never through the package's `exports`, which `oxc_resolver` follows
    // for the alias table in `witness.ts`. A base published only behind
    // `exports` is missed here and found there, so the two tables can read one
    // `tsconfig` under different bases.
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

pub(crate) fn normalize(path: &Path) -> PathBuf {
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
        let of = |dir: &str| Configs::default().custom_conditions(&root.join(dir).join("tsconfig.json"));

        assert_eq!(of(""), Some(vec!["@acme/source".to_owned()]));
        assert_eq!(of("a"), Some(vec!["@acme/source".to_owned()]));
        assert_eq!(of("b"), Some(Vec::new()));
        assert_eq!(of("c"), Some(vec!["other".to_owned()]));
        assert_eq!(of("d"), None);
        let _ = std::fs::remove_dir_all(&root);
    }
}
