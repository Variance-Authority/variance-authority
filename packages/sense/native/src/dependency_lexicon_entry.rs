//! One entry of the lexicon: what a specifier resolves to from its importer, and
//! the public names its declarations publish, or why it publishes none.
//!
//! An entry whose resolution and digested sources are where the last refresh left
//! them is carried whole; everything else is read again from the declaration graph.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, HashMap, HashSet};
use std::{fs, path::{Path, PathBuf}};
use std::sync::{Arc, OnceLock, atomic::{AtomicUsize, Ordering}};
use dashmap::{DashMap, DashSet};
use sha2::{Digest, Sha256};
use crate::harvest::SourceSymbol;
use crate::resolve::Resolvers;
use super::purposes::purpose;
use super::skilled::skills;
use super::{boundary, relative, Api, Identity, Name, Readme, Source};

#[path = "dependency_lexicon_code.rs"]
mod code;
use code::Code;

/// One refresh's installed manifest readings and declaration syntax facts.
/// Digests name the bytes those facts came from; API traversal stays separate.
pub(super) struct Readings {
    readings: DashMap<PathBuf, Arc<OnceLock<Option<Manifest>>>>,
    declarations: DashMap<PathBuf, Arc<OnceLock<Option<Arc<Code>>>>>,
    counts: Option<Counts>,
}

#[derive(Default)]
struct Counts {
    declarations: AtomicUsize,
    declaration_calls: AtomicUsize,
    declaration_bytes: AtomicUsize,
    declaration_fact_text_bytes: AtomicUsize,
    declaration_paths: DashSet<PathBuf>,
    declaration_digests: AtomicUsize,
    manifests: AtomicUsize,
    manifest_digests: AtomicUsize,
}

impl Default for Readings {
    fn default() -> Self {
        Self { readings: DashMap::new(), declarations: DashMap::new(), counts: crate::timings::enabled().then(Counts::default) }
    }
}

struct Manifest {
    value: Option<serde_json::Value>,
    digest: String,
}

impl Readings {
    fn code(&self, path: &Path) -> Option<Arc<Code>> {
        if let Some(counts) = &self.counts { counts.declaration_calls.fetch_add(1, Ordering::Relaxed); }
        let cell = self.declarations.entry(path.to_owned()).or_default().clone();
        cell.get_or_init(|| {
            let (code, bytes) = Code::read(path)?;
            if let Some(counts) = &self.counts {
                counts.declarations.fetch_add(1, Ordering::Relaxed);
                counts.declaration_bytes.fetch_add(bytes, Ordering::Relaxed);
                counts.declaration_paths.insert(path.to_owned());
                counts.declaration_fact_text_bytes.fetch_add(code.text_bytes(), Ordering::Relaxed);
            }
            Some(Arc::new(code))
        }).clone()
    }

    fn reading<T>(&self, path: &Path, read: impl FnOnce(&Manifest) -> T) -> Option<T> {
        let cell = self.readings.entry(path.to_owned()).or_default().clone();
        cell.get_or_init(|| {
            let bytes = fs::read(path).ok()?;
            if let Some(counts) = &self.counts { counts.manifests.fetch_add(1, Ordering::Relaxed); }
            Some(Manifest { value: serde_json::from_slice(&bytes).ok(), digest: bytes_digest(&bytes) })
        }).as_ref().map(read)
    }

    pub(super) fn with<T>(&self, path: &Path, read: impl FnOnce(&serde_json::Value) -> T) -> Option<T> {
        self.reading(path, |manifest| manifest.value.as_ref().map(read)).flatten()
    }

    fn digest(&self, path: &Path) -> Option<String> {
        self.reading(path, |manifest| {
            if let Some(counts) = &self.counts { counts.manifest_digests.fetch_add(1, Ordering::Relaxed); }
            manifest.digest.clone()
        })
    }

    pub(super) fn note(&self, phases: &crate::timings::Phases) {
        let Some(counts) = &self.counts else { return };
        phases.note(format_args!("declaration read calls={}, successful reads={}, unique declaration paths={}, declaration bytes={}, retained declaration fact text bytes={}, declaration digest reopens avoided={}, manifest reads={}, manifest digest requests={}",
            counts.declaration_calls.load(Ordering::Relaxed), counts.declarations.load(Ordering::Relaxed), counts.declaration_paths.len(),
            counts.declaration_bytes.load(Ordering::Relaxed), counts.declaration_fact_text_bytes.load(Ordering::Relaxed), counts.declaration_digests.load(Ordering::Relaxed),
            counts.manifests.load(Ordering::Relaxed), counts.manifest_digests.load(Ordering::Relaxed)));
    }
}

fn bytes_digest(bytes: &[u8]) -> String {
    crate::journeys::hex(&Sha256::digest(bytes))
}

fn digest(path: &Path) -> Option<String> {
    Some(bytes_digest(&fs::read(path).ok()?))
}

fn identity(root: &Path, resolution: &oxc_resolver::Resolution, manifests: &Readings) -> Option<Identity> {
    let path = resolution.package_json()?.path();
    manifests.with(path, |value| Some(Identity {
        name: value.get("name")?.as_str()?.to_owned(),
        version: value.get("version")?.as_str()?.to_owned(),
        manifest: relative(root, path),
    })).flatten()
}

/// The README beside the runtime package's manifest — named by the resolver's answer, not found by a walk.
fn readme(root: &Path, runtime: &Option<Identity>) -> Option<Readme> {
    let manifest = root.join(&runtime.as_ref()?.manifest);
    let path = manifest.parent()?.join("README.md");
    if !path.exists() { return None; }
    let at = relative(root, &path);
    Some(match fs::read_to_string(&path) {
        Ok(text) => Readme { at, lines: Some(text.lines().count() as u32), unreadable: None },
        Err(error) => Readme { at, lines: None, unreadable: Some(error.to_string()) },
    })
}

fn unchanged(root: &Path, prior: &Api, runtime: &Option<Identity>, declarations: &Option<Identity>, at: &str) -> bool {
    prior.entrypoint.as_deref() == Some(at) && &prior.runtime == runtime && &prior.declarations == declarations
        && prior.sources.as_ref().is_some_and(|sources| sources.iter().all(|source|
            digest(&root.join(&source.at)).as_deref() == Some(source.digest.as_str())))
}

struct Reader<'a> {
    root: &'a Path, package: boundary::Selected,
    resolver: &'a Resolvers,
    manifests: &'a Readings,
    cache: HashMap<PathBuf, Vec<Name>>,
    stack: HashSet<PathBuf>,
    sources: BTreeMap<PathBuf, Option<String>>,
}

impl Reader<'_> {
    fn names(&mut self, file: &Path) -> Vec<Name> {
        if let Some(found) = self.cache.get(file) { return found.clone(); }
        if !self.stack.insert(file.to_owned()) { return Vec::new(); }
        let found = self.read(file);
        self.stack.remove(file);
        self.cache.insert(file.to_owned(), found.clone());
        found
    }

    fn read(&mut self, file: &Path) -> Vec<Name> {
        let Some(parsed) = self.manifests.code(file) else { return Vec::new() };
        self.sources.insert(file.to_owned(), Some(parsed.digest.clone()));
        if parsed.unknown { return Vec::new(); }
        let mut names = BTreeMap::<(String, String), Name>::new();
        for export in &parsed.exports {
            let Some(public) = &export.exported else {
                if let Some(from) = &export.from {
                    if let Some(target) = self.target(file, from) {
                        for name in self.names(&target).into_iter().filter(|name| name.name != "default") {
                            names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                        }
                    }
                }
                continue;
            };
            if let Some(from) = &export.from {
                if export.imported.as_deref() == Some("*") {
                    let name = Name { name: public.clone(), kind: "namespace".to_owned(),
                        at: relative(self.root, file), line: export.line,
                        signature: code::text(export.signature.as_ref()),
                        doc: code::doc(export.doc.as_ref()) };
                    names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                    continue;
                }
                if let Some(target) = self.target(file, from) {
                    for mut name in self.names(&target).into_iter().filter(|name|
                        name.name == export.imported.as_deref().unwrap_or(public)) {
                        name.name = public.clone();
                        names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                    }
                }
                continue;
            }
            let local = export.local.as_deref().unwrap_or(public);
            let mut matched: Vec<_> = parsed.symbols_named(local).iter().collect();
            // A name is a spelling: a statement that declares what it exports
            // binds that declaration, and `export { Kind }` every one spelled so.
            let written = |symbol: &&SourceSymbol| symbol.signature.as_ref().zip(export.signature.as_ref())
                .is_some_and(|(own, statement)| statement.start <= own.start && own.end <= statement.end);
            if matched.iter().any(written) {
                matched.retain(written);
            }
            if !matched.is_empty() {
                for symbol in matched {
                    let name = Name { name: public.clone(), kind: symbol.kind.to_owned(),
                        at: relative(self.root, file), line: symbol.line,
                        signature: code::text(symbol.signature.as_ref()),
                        doc: code::doc(symbol.doc.as_ref().or(export.doc.as_ref())) };
                    names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                }
            } else if let Some((request, imported)) = parsed.imports.get(local) {
                if let Some(target) = self.target(file, request) {
                    for mut name in self.names(&target).into_iter().filter(|name| &name.name == imported) {
                        name.name = public.clone();
                        names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                    }
                }
            } else {
                let name = Name { name: public.clone(), kind: "export".to_owned(),
                    at: relative(self.root, file), line: export.line,
                    signature: code::text(export.signature.as_ref()),
                    doc: code::doc(export.doc.as_ref()) };
                names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
            }
        }
        if names.is_empty() {
            for symbol in &parsed.namespace {
                let name = Name { name: symbol.name.clone(), kind: symbol.kind.clone(),
                    at: relative(self.root, file), line: symbol.line,
                    signature: symbol.signature.clone(), doc: symbol.doc.clone() };
                names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
            }
            if names.is_empty() {
                for request in &parsed.assigned_imports {
                    if let Some(target) = self.target(file, request) {
                        for name in self.names(&target) {
                            names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                        }
                    }
                }
            }
        }
        names.into_values().collect()
    }

    fn target(&mut self, from: &Path, specifier: &str) -> Option<PathBuf> {
        let answer = self.resolver.declaration_resolution(from, specifier)?;
        if !self.package.permits(&answer, specifier) { return None; }
        if let Some(manifest) = answer.package_json() { self.sources.entry(manifest.path().to_owned()).or_default(); }
        Some(answer.path().to_owned())
    }
}
pub(super) fn api(root: &Path, importer: &Path, specifier: &str, resolver: &Resolvers, manifests: &Readings, previous: Option<&Api>) -> (Api, bool) {
    let runtime_resolution = resolver.resolution(importer, specifier);
    let declaration_resolution = resolver.declaration_resolution(importer, specifier);
    let runtime = runtime_resolution.as_ref().and_then(|resolution| identity(root, resolution, manifests));
    let declarations = declaration_resolution.as_ref().and_then(|resolution| identity(root, resolution, manifests));
    let Some(declaration) = declaration_resolution else {
        let reason = if runtime_resolution.is_some() {
            format!("the project resolver found no declarations for `{specifier}` from {}", relative(root, importer))
        } else {
            format!("the project resolver could not resolve `{specifier}` from {}", relative(root, importer))
        };
        let readme = readme(root, &runtime);
        let skills = skills(root, &runtime, &declarations);
        let purpose = purpose(root, &runtime, &declarations, None);
        return (Api { runtime, declarations, entrypoint: None, names: None, sources: None, unavailable: Some(reason), readme, purpose, skills }, false);
    };
    let entrypoint = relative(root, declaration.path());
    if let Some(prior) = previous.filter(|prior| unchanged(root, prior, &runtime, &declarations, &entrypoint)) {
        // A README is not among the digested sources, so an entry that publishes no names reads it again.
        let readme = prior.unavailable.is_some().then(|| readme(root, &runtime)).flatten();
        // Nor is it: the words a package says about itself are read again, so a README edit reaches the next refresh.
        // Nor are its skills: a `SKILL.md` is read again on every refresh.
        let skills = skills(root, &runtime, &declarations);
        let purpose = purpose(root, &runtime, &declarations, prior.names.as_deref());
        return (Api { readme, purpose, skills, ..prior.clone() }, true);
    }
    let mut reader = Reader { root, package: boundary::Selected::new(declaration.package_json().map(|manifest| manifest.path())), resolver, manifests, cache: HashMap::new(), stack: HashSet::new(), sources: BTreeMap::new() };
    if let Some(resolution) = runtime_resolution.as_ref() {
        if let Some(manifest) = resolution.package_json() { reader.sources.entry(manifest.path().to_owned()).or_default(); }
    }
    if let Some(manifest) = declaration.package_json() { reader.sources.entry(manifest.path().to_owned()).or_default(); }
    let names = reader.names(declaration.path());
    let sources = reader.sources.iter().filter_map(|(path, read)| {
        let digest = match read {
            Some(digest) => {
                if let Some(counts) = &manifests.counts { counts.declaration_digests.fetch_add(1, Ordering::Relaxed); }
                digest.clone()
            }
            None => manifests.digest(path)?,
        };
        Some(Source { at: relative(root, path), digest })
    }).collect();
    let unavailable = names.is_empty().then(|| format!("the declarations for `{specifier}` publish no names this reader can enumerate"));
    let readme = unavailable.is_some().then(|| readme(root, &runtime)).flatten();
    let skills = skills(root, &runtime, &declarations);
    let purpose = purpose(root, &runtime, &declarations, Some(&names));
    (Api { runtime, declarations, entrypoint: Some(entrypoint), names: Some(names), sources: Some(sources), unavailable, readme, purpose, skills }, false)
}

#[cfg(test)]
mod tests {
    fn declarations(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("sense-lexicon-code-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let package = root.join("node_modules/kit");
        std::fs::create_dir_all(&package).unwrap();
        for (file, source) in [
            ("package.json", r#"{"name":"kit","version":"1","exports":{"./a":{"types":"./a.d.ts"},"./b":{"types":"./b.d.ts"},"./ns":{"types":"./ns.d.ts"},"./bridge":{"types":"./bridge.d.ts"},"./merged":{"types":"./merged.d.ts"}}}"#),
            ("a.d.ts", "export { one as first } from './shared';\nexport type { Two } from './shared';\n"),
            ("b.d.ts", "export { one as second } from './shared';\nexport * as nested from './shared';\n"),
            ("shared.d.ts", "/** Shared 😀. */\nexport declare function one(value: string): number;\nexport declare function one(value: number): string;\nexport interface Two { value: string }\n"),
            ("ns.d.ts", "export = Kit;\ndeclare namespace Kit {\n/** Pulse 😀. */\nfunction pulse(): boolean;\n}\n"),
            ("bridge.d.ts", "import Kit = require('./ns');\nexport = Kit;\n"),
            ("merged.d.ts", "/** Value declaration. */\ndeclare class Joined {}\n/** Type declaration. */\ninterface Joined {}\nexport { Joined as Public };\ndeclare function ordered(value: string): number;\ndeclare function ordered(value: number): string;\nexport { ordered };\ndeclare const 𐐀: true;\ndeclare const Ｚ: true;\nexport { 𐐀, Ｚ };\n"),
        ] { std::fs::write(package.join(file), source).unwrap(); }
        std::fs::canonicalize(root).unwrap()
    }

    #[test]
    fn declaration_traversals_keep_each_export_selection_and_namespace_fallback() {
        let root = declarations("selection");
        let resolver = crate::resolve::Resolvers::new(crate::resolve::Tsconfig::Off, Some(vec!["types".to_owned()]));
        let manifests = super::Readings::default();
        let read = |specifier| super::api(&root, &root.join("consumer.ts"), specifier, &resolver, &manifests, None).0;
        for (specifier, expected) in [("kit/a", ["Two", "first"]), ("kit/b", ["nested", "second"])] {
            let api = read(specifier);
            let names = api.names.unwrap();
            assert_eq!(names.iter().map(|name| name.name.as_str()).collect::<Vec<_>>(), expected);
            let function = names.iter().find(|name| name.kind == "function").unwrap();
            assert_eq!(function.at, "node_modules/kit/shared.d.ts");
            assert!(function.signature.as_deref().unwrap().contains("one(value: string): number"));
            assert_eq!(function.doc.as_deref(), Some("Shared 😀."));
        }
        for specifier in ["kit/ns", "kit/bridge"] {
            let names = read(specifier).names.unwrap();
            let pulse = names.iter().find(|name| name.name == "pulse").unwrap();
            assert_eq!(pulse.at, "node_modules/kit/ns.d.ts");
            assert_eq!(pulse.doc.as_deref(), Some("Pulse 😀."));
        }
        let merged = read("kit/merged").names.unwrap();
        let public: Vec<_> = merged.iter().filter(|name| name.name == "Public").collect();
        assert_eq!(public.iter().map(|name| name.kind.as_str()).collect::<Vec<_>>(), ["class", "interface"]);
        assert_eq!(public.iter().map(|name| name.doc.as_deref()).collect::<Vec<_>>(), [Some("Value declaration."), Some("Type declaration.")]);
        let ordered = merged.iter().find(|name| name.name == "ordered").unwrap();
        assert!(ordered.signature.as_deref().unwrap().contains("ordered(value: string): number"));
        for name in ["𐐀", "Ｚ"] {
            assert!(merged.iter().any(|found| found.name == name && found.kind == "const"));
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shared_declaration_facts_are_read_and_parsed_once_for_one_refresh() {
        use std::sync::atomic::Ordering;
        let root = declarations("shared-once");
        let resolver = crate::resolve::Resolvers::new(crate::resolve::Tsconfig::Off, Some(vec!["types".to_owned()]));
        let manifests = super::Readings { counts: Some(Default::default()), ..Default::default() };
        let read = |specifier| super::api(&root, &root.join("consumer.ts"), specifier, &resolver, &manifests, None).0;
        let first = read("kit/a");
        let second = read("kit/b");
        assert!(first.names.as_ref().unwrap().iter().any(|name| name.name == "first"));
        assert!(second.names.as_ref().unwrap().iter().any(|name| name.name == "second"));
        assert_eq!(manifests.counts.as_ref().unwrap().declarations.load(Ordering::Relaxed), 3,
            "two entrypoints share one declaration parse, without sharing their export selection");
        let shared = "node_modules/kit/shared.d.ts";
        let digest = |api: &super::Api| api.sources.as_ref().unwrap().iter().find(|source| source.at == shared).unwrap().digest.clone();
        let initial = digest(&first);
        std::fs::write(root.join(shared), "export declare function one(value: boolean): bigint;\nexport interface Two {}\n").unwrap();
        let held = read("kit/a");
        assert_eq!(digest(&held), initial, "a refresh carries the digest of the bytes its facts came from");
        assert_eq!(held.names.unwrap().iter().find(|name| name.name == "first").unwrap().doc.as_deref(), Some("Shared 😀."));
        let later = super::Readings::default();
        let changed = super::api(&root, &root.join("consumer.ts"), "kit/a", &resolver, &later, None).0;
        assert_ne!(digest(&changed), initial, "a new refresh observes new bytes");
        assert!(changed.names.unwrap().iter().find(|name| name.name == "first").unwrap().signature.as_deref().unwrap().contains("value: boolean"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installed_manifest_readings_are_strict_and_belong_to_one_refresh() {
        let root = std::env::temp_dir().join(format!("sense-lexicon-manifests-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("package.json");
        let name = |value: &serde_json::Value| value.get("name").and_then(serde_json::Value::as_str).map(str::to_owned);
        let first = super::Readings::default();
        std::fs::write(&path, b"\xef\xbb\xbf{\"name\":\"kit\"}").unwrap();
        assert_eq!(first.with(&path, name), None, "the resolver accepting a BOM does not change the lexicon's JSON reading");
        std::fs::write(&path, br#"{"name":"kit"}"#).unwrap();
        assert_eq!(first.with(&path, name), None, "an unread manifest is also read only once");
        let later = super::Readings::default();
        assert_eq!(later.with(&path, name), Some(Some("kit".to_owned())));
        std::fs::remove_file(&path).unwrap();
        assert_eq!(later.with(&path, name), Some(Some("kit".to_owned())), "openings and identities share one reading");
        assert_eq!(super::Readings::default().with(&path, name), None, "another refresh observes the current disk");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installed_manifest_digests_belong_to_the_same_strict_reading() {
        let root = std::env::temp_dir().join(format!("sense-lexicon-manifest-digest-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("package.json");
        std::fs::write(&path, b"abc").unwrap();
        let manifests = super::Readings::default();
        assert_eq!(manifests.with(&path, |_| ()), None);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(manifests.digest(&path).as_deref(), Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        let absent = super::Readings::default();
        assert_eq!(absent.digest(&path), None);
        std::fs::write(&path, b"{}").unwrap();
        assert_eq!(absent.digest(&path), None, "failed readings are cached too");
        assert_eq!(manifests.with(&path, |_| ()), None, "raw digest does not make invalid JSON readable");
        assert_eq!(super::Readings::default().with(&path, |_| ()), Some(()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn declaration_digest_attests_to_the_bytes_that_published_its_names() {
        let root = std::env::temp_dir().join(format!("sense-lexicon-source-digest-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("index.d.ts");
        std::fs::write(&path, "export declare const pulse: true;\n").unwrap();
        let expected = super::digest(&path).unwrap();
        let resolver = crate::resolve::Resolvers::new(crate::resolve::Tsconfig::Off, None);
        let manifests = super::Readings { counts: Some(super::Counts::default()), ..Default::default() };
        let mut reader = super::Reader { root: &root, package: super::boundary::Selected::new(None), resolver: &resolver, manifests: &manifests,
            cache: std::collections::HashMap::new(), stack: std::collections::HashSet::new(), sources: std::collections::BTreeMap::new() };
        assert_eq!(reader.names(&path).iter().map(|name| name.name.as_str()).collect::<Vec<_>>(), ["pulse"]);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(reader.sources.get(&path).and_then(Option::as_deref), Some(expected.as_str()));
        let invalid = root.join("invalid.d.ts");
        std::fs::write(&invalid, [0xff]).unwrap();
        assert!(reader.names(&invalid).is_empty());
        assert!(!reader.sources.contains_key(&invalid));
        assert!(reader.names(&root.join("absent.d.ts")).is_empty());
        assert_eq!(reader.sources.len(), 1);
        let counts = manifests.counts.as_ref().unwrap();
        assert_eq!(counts.declaration_calls.load(super::Ordering::Relaxed), 3);
        assert_eq!(counts.declarations.load(super::Ordering::Relaxed), 1);
        assert_eq!(counts.declaration_paths.len(), 1);
        assert_eq!(counts.declaration_bytes.load(super::Ordering::Relaxed), "export declare const pulse: true;\n".len());
        std::fs::remove_dir_all(root).unwrap();
    }
}
