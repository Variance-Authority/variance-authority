//! Repository-local module resolution, matching the JavaScript oracle.
//!
//! The resolver reads the disk through `Emitted`, so an import that lands in a
//! workspace package's built output answers with the source it is built from.

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use oxc_resolver::{
    ResolveOptions, ResolverGeneric, TsconfigDiscovery, TsconfigOptions, TsconfigReferences,
};

use crate::emitted::{Emitted, Origin};

type Resolver = ResolverGeneric<Emitted>;

const MODULE_EXTENSIONS: &[&str] = &[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
/// What a declaration file ends in, which is also where its stem ends:
/// `context.d.ts` is `context`, as a request names it.
const DECLARATION_SUFFIXES: [&str; 3] = [".d.ts", ".d.mts", ".d.cts"];
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
    /// Condition set → the resolver that finds only declarations under it.
    declarations: Mutex<HashMap<Vec<String>, Arc<Resolver>>>,
    canonical: Mutex<HashMap<PathBuf, PathBuf>>,
    /// The file system every resolver here reads, shared so an answer is
    /// mapped by the layouts that produced it.
    emitted: Emitted,
}

impl Resolvers {
    pub fn new(tsconfig: Option<String>, condition_names: Option<Vec<String>>) -> Self {
        Self::over(tsconfig, condition_names, Emitted::default())
    }

    /// Resolvers that read the disk through `emitted`.
    pub fn over(tsconfig: Option<String>, condition_names: Option<Vec<String>>, emitted: Emitted) -> Self {
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

        let modules = Resolver::new_with_file_system(emitted.clone(), options.clone());
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
            declarations: Mutex::new(HashMap::new()),
            canonical: Mutex::new(HashMap::new()),
            emitted,
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

    /// The declaration resolver beside `modules`: its options, with `.d.ts` as
    /// the only extension and a nodenext `./context.js` read as
    /// `./context.d.ts`. `clone_with_options` shares the cache.
    fn declarations_for(&self, modules: &Resolver) -> Arc<Resolver> {
        let options = modules.options();
        let build = || {
            Arc::new(modules.clone_with_options(ResolveOptions {
                extensions: vec![".d.ts".to_owned()],
                extension_alias: [(".js", ".d.ts"), (".mjs", ".d.mts"), (".cjs", ".d.cts")]
                    .map(|(from, to)| (from.to_owned(), vec![to.to_owned()]))
                    .to_vec(),
                ..options.clone()
            }))
        };
        let Ok(mut held) = self.declarations.lock() else {
            return build();
        };
        Arc::clone(held.entry(options.condition_names.clone()).or_insert_with(build))
    }

    /// A declaration answers last, and only when nothing else was found: not
    /// beside a module, a stylesheet or `.json`, and not for a request that a
    /// package or a build's output answers. TypeScript tries `.d.ts` before
    /// `.js`, and this parts from it: an edge to the stand-in would leave a
    /// change to the `.js` a runtime loads reaching nothing, and `EMITTED`
    /// orders a declaration's sources the same way. A declaration inside a
    /// build's output never answers here, so the answer is the same whether the
    /// build ran or not.
    pub fn resolve(
        &self,
        root: &Path,
        from: &Path,
        written: &str,
        known: Option<&HashMap<String, u32>>,
    ) -> Option<String> {
        let request = request_of(written)?;
        let modules = self.modules_for(from);
        let mut elsewhere = false;
        for resolver in [modules.as_ref(), &self.exact] {
            let Ok(answer) = resolver.resolve_file(from, request) else {
                continue;
            };
            match self.land(root, request, answer.path(), known) {
                Landing::File(file) => return Some(file),
                Landing::Elsewhere => elsewhere = true,
                Landing::Folded => {}
            }
        }
        if elsewhere {
            return None;
        }
        let answer = self.declarations_for(&modules).resolve_file(from, request).ok()?;
        let path = answer.path();
        let declared = path.file_name().and_then(|name| name.to_str()).is_some_and(|name| {
            DECLARATION_SUFFIXES.iter().any(|suffix| name.len() > suffix.len() && name.ends_with(suffix))
        });
        if !declared || !matches!(self.emitted.origin(path), Origin::Disk) {
            return None;
        }
        match self.land(root, request, path, known) {
            Landing::File(file) => Some(file),
            Landing::Elsewhere | Landing::Folded => None,
        }
    }

    /// Where a path a resolver found lands: a repository file, somewhere a scan
    /// records nothing, or a file that only matched because the disk ignores case.
    fn land(&self, root: &Path, request: &str, path: &Path, known: Option<&HashMap<String, u32>>) -> Landing {
        let resolved = match self.emitted.origin(path) {
            Origin::Source(source) if self.emitted.vouched(&source) => Cow::Owned(source),
            // The resolver never saw the source, so a link there is read
            // where it points, as an import of it would be.
            Origin::Source(source) => Cow::Owned(self.canonical(&source)),
            Origin::Nowhere => return Landing::Elsewhere,
            Origin::Disk | Origin::Directory => Cow::Borrowed(path),
        };
        let resolved = resolved.as_ref();
        if let Some(file) = to_repo_path(root, resolved, known) {
            if known.is_some_and(|paths| paths.contains_key(&file)) {
                return if case_folded(request, resolved) { Landing::Folded } else { Landing::File(file) };
            }
        }
        let canonical = self.canonical(resolved);
        if case_folded(request, &canonical) {
            return Landing::Folded;
        }
        to_repo_path(root, &canonical, known).map_or(Landing::Elsewhere, Landing::File)
    }

    /// What the resolver found for a request, manifest included: the answer
    /// `resolve` reduces to a repository path before it asks for a
    /// declaration. Its path may name built output that is not on disk, which
    /// `resolve` reads as its source.
    pub fn resolution(&self, from: &Path, request: &str) -> Option<oxc_resolver::Resolution> {
        let request = request_of(request)?;
        let modules = self.modules_for(from);
        modules
            .resolve_file(from, request)
            .or_else(|_| self.exact.resolve_file(from, request))
            .ok()
    }

    /// The install's declaration answer for a request, including its provider manifest.
    pub fn declaration_resolution(&self, from: &Path, request: &str) -> Option<oxc_resolver::Resolution> {
        let request = request_of(request)?;
        let modules = self.modules_for(from);
        let direct = modules.resolve_dts(from, request).ok().filter(|answer| {
            let path = answer.path().to_string_lossy();
            path.ends_with(".d.ts") || path.ends_with(".d.mts") || path.ends_with(".d.cts")
                || path.ends_with(".ts") || path.ends_with(".mts") || path.ends_with(".cts")
                || path.ends_with(".tsx")
        });
        if direct.is_some() || request.starts_with('.') || request.starts_with("@types/") { return direct; }
        let typed = if let Some(scoped) = request.strip_prefix('@') {
            let mut parts = scoped.splitn(3, '/');
            let scope = parts.next()?;
            let name = parts.next()?;
            let rest = parts.next().map_or(String::new(), |rest| format!("/{rest}"));
            format!("@types/{scope}__{name}{rest}")
        } else {
            format!("@types/{request}")
        };
        modules.resolve_dts(from, &typed).ok().filter(|answer| {
            let path = answer.path().to_string_lossy();
            path.ends_with(".d.ts") || path.ends_with(".d.mts") || path.ends_with(".d.cts")
        })
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

/// A specifier as a resolvable request, cut at a build tool's `?` or `#`
/// suffix. A leading `#` is a subpath import the `imports` field maps, not a
/// fragment, and `specifier.ts` `requestOf` draws the same line.
pub fn request_of(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") || trimmed.starts_with("node:") {
        return None;
    }
    let fragment = trimmed.char_indices().skip(1).find(|&(_, c)| c == '#').map(|(at, _)| at);
    let cut = [trimmed.find('?'), fragment]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(trimmed.len());
    (cut > 0).then(|| &trimmed[..cut])
}

/// Where a found path lands.
enum Landing {
    File(String),
    /// Outside the repository, under an excluded directory, or built output
    /// with no source: found, and not a file a scan records.
    Elsewhere,
    /// A different name that matched only because the disk ignores case.
    Folded,
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
    let declared = DECLARATION_SUFFIXES.iter().find_map(|suffix| name.strip_suffix(suffix));
    if let Some(stem) = declared.filter(|stem| !stem.is_empty()) {
        return stem;
    }
    match name.rfind('.') {
        Some(0) | None => name,
        Some(at) => &name[..at],
    }
}

/// Where `absolute` sits in the repository, or nothing when it is outside the
/// checkout or under a directory the scan declines. A `build/` is declined
/// unless `known`, Git's listing, holds the file: the evidence the seeder
/// reads, so an import lands on every file a scan would read and on nothing
/// the disk alone put there.
fn to_repo_path(root: &Path, absolute: &Path, known: Option<&HashMap<String, u32>>) -> Option<String> {
    let relative = absolute.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    let mut only_listed = false;
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return None;
        };
        let part = part.to_str()?;
        if crate::path::excluded_when_listed(part) {
            return None;
        }
        only_listed |= crate::path::excluded(part);
        parts.push(part);
    }
    let file = parts.join("/");
    (!only_listed || known.is_some_and(|paths| paths.contains_key(&file))).then_some(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_build_suffixes() {
        assert_eq!(request_of(" ./button.ts?raw#x "), Some("./button.ts"));
        assert_eq!(request_of("node:fs"), None);
    }

    #[test]
    fn a_build_directory_is_source_where_git_lists_it() {
        let root = std::env::temp_dir().join(format!("sense-listed-build-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for (path, text) in [
            ("src/commands/b.ts", "import './build/a';\n"),
            ("src/commands/build/a.ts", "export {};\n"),
            ("src/commands/dist/c.ts", "export {};\n"),
        ] {
            std::fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
            std::fs::write(root.join(path), text).unwrap();
        }
        let root = std::fs::canonicalize(root).unwrap();
        let from = root.join("src/commands/b.ts");
        let listed = HashMap::from([
            ("src/commands/b.ts".to_owned(), 0),
            ("src/commands/build/a.ts".to_owned(), 1),
            ("src/commands/dist/c.ts".to_owned(), 2),
        ]);
        let unlisted = HashMap::from([("src/commands/b.ts".to_owned(), 0)]);
        let resolvers = Resolvers::new(None, None);
        let ask = |request, known| resolvers.resolve(&root, &from, request, known);
        assert_eq!(ask("./build/a", Some(&listed)), Some("src/commands/build/a.ts".to_owned()));
        assert_eq!(ask("./build/a", Some(&unlisted)), None);
        assert_eq!(ask("./build/a", None), None);
        assert_eq!(ask("./dist/c", Some(&listed)), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_declaration_stem_drops_the_whole_suffix() {
        assert_eq!(stem("context.d.ts"), "context");
        assert_eq!(stem("context.d.mts"), "context");
        assert_eq!(stem("context.ts"), "context");
        assert_eq!(stem(".d.ts"), ".d");
        assert!(case_folded("./Context", Path::new("/src/context.d.ts")));
        assert!(!case_folded("./context", Path::new("/src/context.d.ts")));
    }

    #[test]
    fn keeps_a_subpath_import() {
        assert_eq!(request_of("#polyfill"), Some("#polyfill"));
        assert_eq!(request_of("#internal/a.js?raw#x"), Some("#internal/a.js"));
        assert_eq!(request_of("#"), Some("#"));
    }
}
