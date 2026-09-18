//! Repository-local module resolution, matching the JavaScript oracle.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use oxc_resolver::{
    ResolveOptions, Resolver, TsconfigDiscovery, TsconfigOptions, TsconfigReferences,
};

const MODULE_EXTENSIONS: &[&str] = &[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const STYLE_EXTENSIONS: &[&str] = &[".css", ".scss", ".sass", ".less"];
pub struct Resolvers {
    modules: Resolver,
    exact: Resolver,
    canonical: Mutex<HashMap<PathBuf, PathBuf>>,
}

impl Resolvers {
    pub fn new(tsconfig: Option<String>, condition_names: Option<Vec<String>>) -> Self {
        let options = ResolveOptions {
            extensions: MODULE_EXTENSIONS
                .iter()
                .chain(STYLE_EXTENSIONS)
                .copied()
                .chain(std::iter::once(".json"))
                .map(str::to_owned)
                .collect(),
            condition_names: condition_names.unwrap_or_else(|| {
                ["source", "import", "require", "default"]
                    .map(str::to_owned)
                    .to_vec()
            }),
            main_fields: ["source", "module", "main"].map(str::to_owned).to_vec(),
            extension_alias: vec![
                (
                    ".js".to_owned(),
                    [".ts", ".tsx", ".js", ".jsx"].map(str::to_owned).to_vec(),
                ),
                (
                    ".mjs".to_owned(),
                    [".mts", ".mjs"].map(str::to_owned).to_vec(),
                ),
                (
                    ".cjs".to_owned(),
                    [".cts", ".cjs"].map(str::to_owned).to_vec(),
                ),
            ],
            tsconfig: match tsconfig.as_deref() {
                None | Some("auto") => Some(TsconfigDiscovery::Auto),
                Some(path) => Some(TsconfigDiscovery::Manual(TsconfigOptions {
                    config_file: PathBuf::from(path),
                    references: TsconfigReferences::Auto,
                })),
            },
            symlinks: true,
            builtin_modules: true,
            ..ResolveOptions::default()
        };

        let modules = Resolver::new(options);
        // `cloneWithOptions` normalizes against OXC defaults; it does not merge
        // with the factory's current settings. The oracle supplies only an empty
        // extension alias, so the exact resolver intentionally has no tsconfig.
        let exact = modules.clone_with_options(ResolveOptions::default());
        Self {
            modules,
            exact,
            canonical: Mutex::new(HashMap::new()),
        }
    }

    pub fn resolve(
        &self,
        root: &Path,
        from: &Path,
        written: &str,
        known: Option<&HashMap<String, u32>>,
    ) -> Option<String> {
        let request = request_of(written)?;
        for resolver in [&self.modules, &self.exact] {
            let Ok(answer) = resolver.resolve_file(from, request) else {
                continue;
            };
            let resolved = answer.path();
            if let Some(file) = to_repo_path(root, resolved) {
                if known.is_some_and(|paths| paths.contains_key(&file)) {
                    if !case_folded(request, resolved) {
                        return Some(file);
                    }
                    continue;
                }
            }
            let canonical = self.canonical(resolved);
            if case_folded(request, &canonical) {
                continue;
            }
            if let Some(file) = to_repo_path(root, &canonical) {
                return Some(file);
            }
        }
        None
    }

    fn canonical(&self, path: &Path) -> PathBuf {
        if let Ok(held) = self.canonical.lock() {
            if let Some(known) = held.get(path) {
                return known.clone();
            }
        }
        let answer = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_owned());
        if let Ok(mut held) = self.canonical.lock() {
            held.insert(path.to_owned(), answer.clone());
        }
        answer
    }
}

pub fn request_of(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") || trimmed.starts_with("node:") {
        return None;
    }
    let cut = [trimmed.find('?'), trimmed.find('#')]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(trimmed.len());
    (cut > 0).then(|| &trimmed[..cut])
}

fn case_folded(request: &str, resolved: &Path) -> bool {
    let asked = Path::new(request)
        .file_name()
        .and_then(|name| name.to_str())
        .map(stem)
        .unwrap_or(request);
    let found = resolved
        .file_name()
        .and_then(|name| name.to_str())
        .map(stem)
        .unwrap_or_default();
    asked != found && asked.eq_ignore_ascii_case(found)
}

fn stem(name: &str) -> &str {
    match name.rfind('.') {
        Some(0) | None => name,
        Some(at) => &name[..at],
    }
}

fn to_repo_path(root: &Path, absolute: &Path) -> Option<String> {
    let relative = absolute.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return None;
        };
        let part = part.to_str()?;
        if crate::path::excluded(part) {
            return None;
        }
        parts.push(part);
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_build_suffixes() {
        assert_eq!(request_of(" ./button.ts?raw#x "), Some("./button.ts"));
        assert_eq!(request_of("node:fs"), None);
    }
}
