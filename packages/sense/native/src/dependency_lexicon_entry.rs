//! One entry of the lexicon: what a specifier resolves to from its importer, and
//! the public names its declarations publish, or why it publishes none.
//!
//! An entry whose resolution and digested sources are where the last refresh left
//! them is carried whole; everything else is read again from the declaration graph.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::{fs, path::{Path, PathBuf}};
use oxc_allocator::Allocator;
use sha2::{Digest, Sha256};
use crate::read::read_module;
use crate::resolve::Resolvers;
use super::purposes::purpose;
use super::{boundary, relative, Api, Identity, Name, Readme, Source};

fn digest(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(format!("{:x}", Sha256::digest(bytes)))
}

fn identity(root: &Path, resolution: &oxc_resolver::Resolution) -> Option<Identity> {
    let path = resolution.package_json()?.path();
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    Some(Identity {
        name: value.get("name")?.as_str()?.to_owned(),
        version: value.get("version")?.as_str()?.to_owned(),
        manifest: relative(root, path),
    })
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
    root: &'a Path, package: Option<PathBuf>,
    resolver: &'a Resolvers,
    cache: HashMap<PathBuf, Vec<Name>>,
    stack: HashSet<PathBuf>,
    sources: BTreeSet<PathBuf>,
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
        let Ok(source) = fs::read_to_string(file) else { return Vec::new() };
        self.sources.insert(file.to_owned());
        let parsed = read_module(&file.to_string_lossy(), &source, &Allocator::default(), true);
        if parsed.unknown.is_some() { return Vec::new(); }
        let utf16: Vec<u16> = source.encode_utf16().collect();
        let mut names = BTreeMap::<(String, String), Name>::new();
        let mut imports = HashMap::<String, (String, String)>::new();
        for request in &parsed.requests {
            for binding in &request.bindings {
                imports.insert(binding.local.clone(), (request.value.clone(), binding.imported.clone()));
            }
        }
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
                        signature: crate::dependency_namespace::text(&utf16, export.signature),
                        doc: crate::dependency_namespace::doc(&utf16, export.doc) };
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
            let matched: Vec<_> = parsed.symbols.iter().filter(|symbol| symbol.name == local).collect();
            if !matched.is_empty() {
                for symbol in matched {
                    let name = Name { name: public.clone(), kind: symbol.kind.to_owned(),
                        at: relative(self.root, file), line: symbol.line,
                        signature: crate::dependency_namespace::text(&utf16, symbol.signature),
                        doc: crate::dependency_namespace::doc(&utf16, symbol.doc.or(export.doc)) };
                    names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                }
            } else if let Some((request, imported)) = imports.get(local) {
                if let Some(target) = self.target(file, request) {
                    for mut name in self.names(&target).into_iter().filter(|name| &name.name == imported) {
                        name.name = public.clone();
                        names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                    }
                }
            } else {
                let name = Name { name: public.clone(), kind: "export".to_owned(),
                    at: relative(self.root, file), line: export.line,
                    signature: crate::dependency_namespace::text(&utf16, export.signature),
                    doc: crate::dependency_namespace::doc(&utf16, export.doc) };
                names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
            }
        }
        if names.is_empty() && source.contains("export =") {
            for symbol in crate::dependency_namespace::exported_namespace(&file.to_string_lossy(), &source) {
                let name = Name { name: symbol.name, kind: symbol.kind,
                    at: relative(self.root, file), line: symbol.line,
                    signature: symbol.signature, doc: symbol.doc };
                names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
            }
            if names.is_empty() {
                for request in crate::dependency_namespace::exported_import(&source) {
                    if let Some(target) = self.target(file, &request) {
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
        if !boundary::permits(self.package.as_deref(), answer.package_json().map(|manifest| manifest.path()), answer.path(), specifier) { return None; }
        if let Some(manifest) = answer.package_json() { self.sources.insert(manifest.path().to_owned()); }
        Some(answer.path().to_owned())
    }
}
pub(super) fn api(root: &Path, importer: &Path, specifier: &str, resolver: &Resolvers, previous: Option<&Api>) -> (Api, bool) {
    let runtime_resolution = resolver.resolution(importer, specifier);
    let declaration_resolution = resolver.declaration_resolution(importer, specifier);
    let runtime = runtime_resolution.as_ref().and_then(|resolution| identity(root, resolution));
    let declarations = declaration_resolution.as_ref().and_then(|resolution| identity(root, resolution));
    let Some(declaration) = declaration_resolution else {
        let reason = if runtime_resolution.is_some() {
            format!("the project resolver found no declarations for `{specifier}` from {}", relative(root, importer))
        } else {
            format!("the project resolver could not resolve `{specifier}` from {}", relative(root, importer))
        };
        let readme = readme(root, &runtime);
        let purpose = purpose(root, &runtime, &declarations, None);
        return (Api { runtime, declarations, entrypoint: None, names: None, sources: None, unavailable: Some(reason), readme, purpose }, false);
    };
    let entrypoint = relative(root, declaration.path());
    if let Some(prior) = previous.filter(|prior| unchanged(root, prior, &runtime, &declarations, &entrypoint)) {
        // A README is not among the digested sources, so an entry that publishes no names reads it again.
        let readme = prior.unavailable.is_some().then(|| readme(root, &runtime)).flatten();
        // Nor is it: the words a package says about itself are read again, so a README edit reaches the next refresh.
        let purpose = purpose(root, &runtime, &declarations, prior.names.as_deref());
        return (Api { readme, purpose, ..prior.clone() }, true);
    }
    let mut reader = Reader { root, package: declaration.package_json().map(|manifest| manifest.path().to_owned()), resolver, cache: HashMap::new(), stack: HashSet::new(), sources: BTreeSet::new() };
    if let Some(resolution) = runtime_resolution.as_ref() {
        if let Some(manifest) = resolution.package_json() { reader.sources.insert(manifest.path().to_owned()); }
    }
    if let Some(manifest) = declaration.package_json() { reader.sources.insert(manifest.path().to_owned()); }
    let names = reader.names(declaration.path());
    let sources = reader.sources.iter().filter_map(|path|
        Some(Source { at: relative(root, path), digest: digest(path)? })).collect();
    let unavailable = names.is_empty().then(|| format!("the declarations for `{specifier}` publish no names this reader can enumerate"));
    let readme = unavailable.is_some().then(|| readme(root, &runtime)).flatten();
    let purpose = purpose(root, &runtime, &declarations, Some(&names));
    (Api { runtime, declarations, entrypoint: Some(entrypoint), names: Some(names), sources: Some(sources), unavailable, readme, purpose }, false)
}
