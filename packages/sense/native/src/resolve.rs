//! Repository-local module resolution, matching the JavaScript oracle.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use oxc_resolver::{
    ResolveOptions, Resolver, TsconfigDiscovery, TsconfigOptions, TsconfigReferences,
};

const MODULE_EXTENSIONS: &[&str] = &[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const STYLE_EXTENSIONS: &[&str] = &[".css", ".scss", ".sass", ".less"];
const DEFAULT_CONDITIONS: [&str; 4] = ["source", "import", "require", "default"];

pub struct Resolvers {
    modules: Arc<Resolver>,
    exact: Resolver,
    /// The options `modules` was built with, which a condition set is cloned from:
    /// `clone_with_options` replaces options rather than merging them.
    options: ResolveOptions,
    /// Whether the caller named the conditions. Named conditions are the answer,
    /// and no `tsconfig` adds to them.
    named: bool,
    /// Governing `tsconfig` → the module resolver its `customConditions` select.
    governed: RwLock<HashMap<PathBuf, Arc<Resolver>>>,
    /// Condition set → its resolver, so configs that agree share one.
    conditioned: Mutex<HashMap<Vec<String>, Arc<Resolver>>>,
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
            condition_names: condition_names
                .clone()
                .unwrap_or_else(|| DEFAULT_CONDITIONS.map(str::to_owned).to_vec()),
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

        let modules = Resolver::new(options.clone());
        // `cloneWithOptions` normalizes against OXC defaults; it does not merge
        // with the factory's current settings. The oracle supplies only an empty
        // extension alias, so the exact resolver intentionally has no tsconfig.
        let exact = modules.clone_with_options(ResolveOptions::default());
        let modules = Arc::new(modules);
        let conditioned = HashMap::from([(options.condition_names.clone(), Arc::clone(&modules))]);
        Self {
            modules,
            exact,
            options,
            named: condition_names.is_some(),
            governed: RwLock::new(HashMap::new()),
            conditioned: Mutex::new(conditioned),
            canonical: Mutex::new(HashMap::new()),
        }
    }

    /// The module resolver for a request written in `from`: the default
    /// conditions plus the `customConditions` of the `tsconfig` that governs
    /// `from` — the config `oxc_resolver` already picked for its `paths`.
    fn modules_for(&self, from: &Path) -> Arc<Resolver> {
        if self.named {
            return Arc::clone(&self.modules);
        }
        let Ok(Some(tsconfig)) = self.modules.find_tsconfig(from) else {
            return Arc::clone(&self.modules);
        };
        let path = tsconfig.path();
        if let Some(found) = self.governed.read().ok().and_then(|held| held.get(path).cloned()) {
            return found;
        }
        let resolver = match crate::conditions::custom_conditions(path) {
            Some(custom) if !custom.is_empty() => self.with_conditions(custom),
            _ => Arc::clone(&self.modules),
        };
        if let Ok(mut held) = self.governed.write() {
            held.insert(path.to_owned(), Arc::clone(&resolver));
        }
        resolver
    }

    fn with_conditions(&self, custom: Vec<String>) -> Arc<Resolver> {
        let mut names = self.options.condition_names.clone();
        for name in custom {
            if !names.contains(&name) {
                names.push(name);
            }
        }
        let Ok(mut held) = self.conditioned.lock() else {
            return Arc::clone(&self.modules);
        };
        Arc::clone(held.entry(names.clone()).or_insert_with(|| {
            Arc::new(self.modules.clone_with_options(ResolveOptions {
                condition_names: names,
                ..self.options.clone()
            }))
        }))
    }

    pub fn resolve(
        &self,
        root: &Path,
        from: &Path,
        written: &str,
        known: Option<&HashMap<String, u32>>,
    ) -> Option<String> {
        let request = request_of(written)?;
        let modules = self.modules_for(from);
        for resolver in [modules.as_ref(), &self.exact] {
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

    /// What the resolver found for a request, manifest included: the answer
    /// `resolve` reduces to a repository path.
    pub fn resolution(&self, from: &Path, request: &str) -> Option<oxc_resolver::Resolution> {
        let request = request_of(request)?;
        let modules = self.modules_for(from);
        modules
            .resolve_file(from, request)
            .or_else(|_| self.exact.resolve_file(from, request))
            .ok()
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
