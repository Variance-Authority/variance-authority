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
//! pattern is matched the way rolldown matches it. A pattern names what the
//! package publishes, and the graph holds the source it is built from, so a
//! source is matched as itself and as every file its package's `tsconfig`
//! writes it to.

use std::borrow::Cow;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use napi_derive::napi;
use serde_json::Value;

use crate::emitted::{Emitted, EMITTED};
use crate::resolve::Resolvers;

/// Where each source a file imports from lands: the repository path, the
/// absolute path of a file outside the checkout, or an empty string when
/// nothing resolves. The sources a diff added or removed are the ones the
/// graph cannot name, because it holds edges and not the words that wrote them.
///
/// `listed` is the listing's word on the paths the disk alone declines: the
/// files the caller's graph holds under a tracked `build/`. A scan records a
/// file there only where Git lists it, so the graph carries that word, and a
/// landing there answers with the repository path the graph names it by.
#[napi(catch_unwind)]
pub fn resolve_sources(root: String, file: String, sources: Vec<String>, listed: Option<Vec<String>>) -> Vec<String> {
    let listed: Option<HashMap<String, u32>> = listed.map(|paths| paths.into_iter().zip(0..).collect());
    let resolvers = Resolvers::new(None, None);
    // The resolver answers with the path a symlink leads to, and a repository
    // path is cut from the root that path lies under.
    let root = std::fs::canonicalize(&root).unwrap_or_else(|_| PathBuf::from(&root));
    let from = root.join(&file);
    sources
        .iter()
        .map(|source| {
            resolvers
                .resolve(&root, &from, source, listed.as_ref())
                .or_else(|| resolvers.resolution(&from, source).map(|found| found.path().to_string_lossy().into_owned()))
                .unwrap_or_default()
        })
        .collect()
}

/// Of these files, repository-relative or absolute, those whose package
/// declares that loading them does something, in the order asked.
#[napi(catch_unwind)]
pub fn declared_effects(root: String, files: Vec<String>) -> Vec<String> {
    let root = Path::new(&root);
    let (mut manifests, emitted) = (HashMap::new(), Emitted::default());
    files.into_iter().filter(|file| declared(&mut manifests, &emitted, &root.join(file))).collect()
}

fn declared(manifests: &mut HashMap<PathBuf, Option<Value>>, emitted: &Emitted, path: &Path) -> bool {
    for directory in path.ancestors().skip(1) {
        let manifest = manifests.entry(directory.to_owned()).or_insert_with(|| {
            let text = std::fs::read_to_string(directory.join("package.json")).ok()?;
            Some(serde_json::from_str::<Value>(&text).unwrap_or(Value::Null))
        });
        let Some(manifest) = manifest else { continue };
        let spelled = spellings(emitted, directory, path);
        let matched = |pattern: &str| spelled.iter().any(|path| matches(pattern, path));
        return match manifest.get("sideEffects") {
            Some(Value::Bool(declared)) => *declared,
            Some(Value::String(pattern)) => matched(pattern),
            Some(Value::Array(patterns)) => patterns.iter().filter_map(Value::as_str).any(matched),
            _ => false,
        };
    }
    false
}

/// A file's path relative to its package, then every path the package's
/// `tsconfig` writes it to as code.
fn spellings(emitted: &Emitted, directory: &Path, path: &Path) -> Vec<String> {
    let relative = |path: &Path| path.strip_prefix(directory).unwrap_or(path).to_string_lossy().replace('\\', "/");
    let mut spelled = vec![relative(path)];
    let name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
    let code = EMITTED.iter().filter(|(output, _)| !output.starts_with(".d."));
    for layout in emitted.declared(directory).iter() {
        for mirror in layout.sources.iter().filter(|mirror| mirror.code) {
            let Ok(rest) = path.strip_prefix(&mirror.root) else { continue };
            for (output, sources) in code.clone() {
                let from = sources.iter().find(|extension| name.len() > extension.len() && name.ends_with(*extension));
                if let Some(extension) = from {
                    let out = layout.out.join(rest).with_file_name(format!("{}{output}", &name[..name.len() - extension.len()]));
                    spelled.push(relative(&out));
                }
            }
        }
    }
    spelled
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
    use super::{declared_effects, matches};

    #[test]
    fn a_pattern_without_a_directory_matches_anywhere() {
        assert!(matches("*.css", "src/theme/button.css"));
        assert!(matches("./src/register.ts", "src/register.ts"));
        assert!(!matches("./src/register.ts", "lib/src/register.ts"));
        assert!(matches("src/**/*.ts", "src/deep/polyfill.ts"));
    }

    #[test]
    fn a_pattern_naming_output_matches_the_source_it_is_built_from() {
        let root = std::env::temp_dir().join(format!("sense-effects-emitted-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for (path, text) in [
            ("packages/b/package.json", r#"{ "name": "@s/b", "sideEffects": ["./dist/register.js", "*.css"] }"#),
            ("packages/b/tsconfig.json", r#"{ "compilerOptions": { "outDir": "./dist", "rootDir": "./src" } }"#),
            ("packages/b/src/register.ts", "globalThis.registered = true;\n"),
            ("packages/b/src/index.ts", "export {};\n"),
            ("packages/b/src/theme.css", "a {}\n"),
        ] {
            std::fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
            std::fs::write(root.join(path), text).unwrap();
        }
        let files = ["packages/b/src/register.ts", "packages/b/src/index.ts", "packages/b/src/theme.css"];
        let declared = declared_effects(root.to_string_lossy().into_owned(), files.map(str::to_owned).to_vec());
        assert_eq!(declared, ["packages/b/src/register.ts", "packages/b/src/theme.css"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
