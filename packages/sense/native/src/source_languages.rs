//! One scan's language resolution indexes, built only when a request needs them.

// compass: variance-authority.reach.source-index

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, OnceLock};

use regex::Regex;

use crate::resolve::Resolvers;
use crate::source_read::SourceRead;

pub(crate) struct LanguageWorld<'p> {
    paths: &'p [String],
    sorted: OnceLock<Vec<&'p str>>,
    root: PathBuf,
    python: OnceLock<Vec<String>>,
    jvm: OnceLock<Vec<String>>,
    swift: OnceLock<Targets>,
    #[cfg(feature = "grammars")]
    rust: OnceLock<std::sync::Arc<crate::rust_resolve::RustWorld>>,
}

impl<'p> LanguageWorld<'p> {
    pub(crate) fn new(paths: &'p [String], root: &Path) -> Self {
        Self {
            paths, sorted: OnceLock::new(), root: root.to_owned(),
            python: OnceLock::new(), jvm: OnceLock::new(), swift: OnceLock::new(),
            #[cfg(feature = "grammars")]
            rust: OnceLock::new(),
        }
    }

    fn files(&self) -> &[&'p str] {
        self.sorted.get_or_init(|| {
            let mut files: Vec<_> = self.paths.iter().map(String::as_str).collect();
            files.sort_by(|left, right| crate::order::code_unit(left, right));
            files.dedup();
            files
        })
    }

    fn has(&self, file: &str) -> bool {
        self.files().binary_search_by(|path| crate::order::code_unit(path, file)).is_ok()
    }

    fn below(&self, directory: &str) -> &[&'p str] {
        let files = self.files();
        if directory.is_empty() { return files }
        let prefix = format!("{directory}/");
        let start = files.partition_point(|file| crate::order::code_unit(file, &prefix).is_lt());
        let length = files[start..].partition_point(|file| file.starts_with(&prefix));
        &files[start..start + length]
    }

    #[cfg(feature = "grammars")]
    pub(crate) fn prepare_rust(&mut self, reads: &HashMap<String, &crate::languages::shape::Read>) {
        let rows = reads.iter().map(|(file, read)| (file.as_str(), *read));
        let _ = self.rust.set(std::sync::Arc::new(crate::rust_resolve::RustWorld::from_rows(self.paths, rows, &self.root)));
    }

    #[cfg(feature = "grammars")]
    pub(crate) fn prepared_rust(&self, rust: std::sync::Arc<crate::rust_resolve::RustWorld>) { let _ = self.rust.set(rust); }

    pub(crate) fn resolve(&self, file: &str, read: &SourceRead, at: usize, resolvers: &Resolvers, known: Option<&HashMap<String, u32>>) -> Vec<String> {
        let Some(request) = read.requests().nth(at) else { return Vec::new() };
        let Some(value) = crate::resolve::request_of(request.value) else { return Vec::new() };
        match crate::source_read::language(file) {
            Some("python") => self.resolve_python(file, value),
            #[cfg(feature = "grammars")]
            Some("rust") => self.rust.get().map_or_else(Vec::new, |rust| rust.resolve(file, value, request.item)),
            Some("java" | "kotlin") => self.resolve_jvm(file, value),
            Some("swift") => self.resolve_swift(file, value),
            Some(_) => Vec::new(),
            None => {
                let from = self.root.join(file);
                if crate::source_style::is_style(file) {
                    resolvers.resolve_style(&self.root, &from, value, known)
                } else {
                    resolvers.resolve(&self.root, &from, value, known)
                }.into_iter().collect()
            }
        }
    }

    fn python_roots(&self) -> &Vec<String> {
        self.python.get_or_init(|| {
            let mut roots = Vec::new();
            let mut seen = HashSet::new();
            for file in self.files() {
                if !["pyproject.toml", "setup.py", "setup.cfg"].contains(&name(file)) { continue }
                let directory = directory(file);
                let src = under(directory, "src");
                if !self.below(&src).is_empty() && seen.insert(src.clone()) { roots.push(src); }
                if seen.insert(directory.to_owned()) { roots.push(directory.to_owned()); }
            }
            if seen.insert(String::new()) { roots.push(String::new()); }
            roots
        })
    }

    fn resolve_python(&self, from: &str, request: &str) -> Vec<String> {
        let dots = request.bytes().take_while(|byte| *byte == b'.').count();
        let tail = request[dots..].replace('.', "/");
        let found = |base: String| {
            if base.is_empty() { return None }
            [".py", "/__init__.py", ".pyi", "/__init__.pyi"].iter()
                .map(|end| format!("{base}{end}")).find(|path| self.has(path))
        };
        if dots > 0 {
            let mut parts: Vec<_> = from.split('/').collect();
            parts.pop();
            if dots - 1 > parts.len() { return Vec::new() }
            parts.truncate(parts.len() - (dots - 1));
            let base = parts.join("/");
            return found(if tail.is_empty() { base } else { under(&base, &tail) }).into_iter().collect()
        }
        self.python_roots().iter().find_map(|root| found(under(root, &tail))).into_iter().collect()
    }

    fn jvm_roots(&self) -> &Vec<String> {
        static PACKAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^[^\S\n]*package[^\S\n]+((?-u:[\w.]+))").expect("JVM package declaration"));
        self.jvm.get_or_init(|| {
            let mut directories = HashSet::new();
            let mut roots = HashSet::new();
            for file in self.files().iter().filter(|file| is_jvm(file)) {
                let at = directory(file);
                if !directories.insert(at) { continue }
                let text = std::fs::read_to_string(self.root.join(file)).ok();
                let package = text.as_deref().and_then(|text| PACKAGE.captures(text)).map(|captures| captures[1].replace('.', "/"));
                let root = match package.as_deref() {
                    Some(package) if package == at => "",
                    Some(package) => at.strip_suffix(&format!("/{package}")).unwrap_or(at),
                    None => at,
                };
                roots.insert(root.to_owned());
            }
            let mut roots: Vec<_> = roots.into_iter().collect();
            roots.sort_by(|left, right| left.encode_utf16().count().cmp(&right.encode_utf16().count()).then_with(|| crate::order::code_unit(left, right)));
            roots
        })
    }

    fn jvm_sources(&self, relative: &str) -> Vec<String> {
        self.jvm_roots().iter().flat_map(|root| {
            let at = under(root, relative);
            self.below(&at).iter().filter(move |file| directory(file) == at && is_jvm(file)).map(|file| (*file).to_owned())
        }).collect()
    }

    fn resolve_jvm(&self, from: &str, request: &str) -> Vec<String> {
        if let Some(package) = request.strip_suffix(".*") {
            return self.jvm_sources(&package.replace('.', "/")).into_iter().filter(|file| file != from).collect()
        }
        let segments: Vec<_> = request.split('.').collect();
        for depth in (1..=segments.len()).rev() {
            let relative = segments[..depth].join("/");
            for root in self.jvm_roots() {
                for extension in [".java", ".kt"] {
                    let file = under(root, &format!("{relative}{extension}"));
                    if file != from && self.has(&file) { return vec![file] }
                }
            }
        }
        if segments.len() > 1 {
            return self.jvm_sources(&segments[..segments.len() - 1].join("/")).into_iter()
                .filter(|file| file.ends_with(".kt") && file != from).collect()
        }
        Vec::new()
    }

    fn swift_targets(&self) -> &Targets {
        self.swift.get_or_init(|| {
            let mut targets = Targets::default();
            for manifest in self.files().iter().filter(|file| is_manifest(file)) {
                let at = directory(manifest);
                for kind in ["Sources", "Tests"] {
                    let sources = under(at, kind);
                    let prefix = format!("{sources}/");
                    for file in self.below(&sources).iter().filter_map(|file| file.strip_prefix(&prefix)) {
                        if let Some((name, _)) = file.split_once('/').filter(|(name, _)| !name.is_empty()) {
                            targets.insert(name.to_owned(), under(at, &format!("{kind}/{name}")));
                        }
                    }
                }
                #[cfg(feature = "grammars")]
                if let Some(declared) = std::fs::read_to_string(self.root.join(manifest)).ok().and_then(|text| crate::languages::swift_targets(&text)) {
                    for target in declared { targets.insert(target.name, under(at, &target.path)); }
                }
            }
            let mut seen = HashSet::new();
            targets.directories = targets.names.iter().filter_map(|name| targets.by_name.get(name))
                .filter(|directory| seen.insert((*directory).clone())).cloned().collect();
            targets.directories.sort_by_key(|directory| std::cmp::Reverse(directory.encode_utf16().count()));
            targets
        })
    }

    fn resolve_swift(&self, from: &str, request: &str) -> Vec<String> {
        if is_manifest(from) { return Vec::new() }
        let targets = self.swift_targets();
        let (at, deep) = if request != "*" {
            let Some(at) = targets.by_name.get(request) else { return Vec::new() };
            (at.as_str(), true)
        } else {
            targets.directories.iter().find(|at| from.starts_with(&format!("{at}/")))
                .map_or((directory(from), false), |at| (at.as_str(), true))
        };
        self.below(at).iter().filter(|file| {
            file.ends_with(".swift") && **file != from && !is_manifest(file)
                && (deep || directory(file) == at)
        }).map(|file| (*file).to_owned()).collect()
    }
}

#[derive(Default)]
struct Targets {
    by_name: HashMap<String, String>,
    names: Vec<String>,
    directories: Vec<String>,
}

impl Targets {
    fn insert(&mut self, name: String, directory: String) {
        if !self.by_name.contains_key(&name) { self.names.push(name.clone()); }
        self.by_name.insert(name, directory);
    }
}

fn name(file: &str) -> &str { file.rsplit('/').next().unwrap_or(file) }
fn directory(file: &str) -> &str { file.rsplit_once('/').map_or("", |(directory, _)| directory) }
fn under(at: &str, rest: &str) -> String { if at.is_empty() { rest.to_owned() } else { format!("{at}/{rest}") } }
fn is_jvm(file: &str) -> bool { file.ends_with(".java") || file.ends_with(".kt") }
fn is_manifest(file: &str) -> bool { name(file) == "Package.swift" }

#[cfg(test)]
#[path = "source_languages_tests.rs"]
mod tests;
