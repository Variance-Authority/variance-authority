//! One entry of the lexicon: what a specifier resolves to from its importer, and
//! the public names its declarations publish, or why it publishes none.
//!
//! An entry whose resolution and digested sources are where the last refresh left
//! them is carried whole; everything else is read again from the declaration graph.

// compass: variance-authority.reach.relations

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use crate::harvest::SourceSymbol;
use crate::resolve::Resolvers;
use super::purposes::purpose;
use super::files::Files;
use super::skilled::skills;
use super::{boundary, relative, Api, Identity, Name, Readme, Source};

fn identity(root: &Path, resolution: &oxc_resolver::Resolution, files: &Files) -> Option<Identity> {
    let path = resolution.package_json()?.path();
    let value = files.manifest(path)?;
    Some(Identity {
        name: value.get("name")?.as_str()?.to_owned(),
        version: value.get("version")?.as_str()?.to_owned(),
        manifest: relative(root, path),
    })
}

/// The README beside the runtime package's manifest — named by the resolver's answer, not found by a walk.
fn readme(root: &Path, runtime: &Option<Identity>, files: &Files) -> Option<Readme> {
    let manifest = root.join(&runtime.as_ref()?.manifest);
    let path = manifest.parent()?.join("README.md");
    if !path.exists() { return None; }
    let at = relative(root, &path);
    let lines = files.read(&path).map_err(|error| error.to_string()).and_then(|file| file.text().map(|text| text.lines().count() as u32).map_err(|error| error.to_string()));
    Some(match lines {
        Ok(lines) => Readme { at, lines: Some(lines), unreadable: None },
        Err(error) => Readme { at, lines: None, unreadable: Some(error) },
    })
}

fn unchanged(root: &Path, prior: &Api, runtime: &Option<Identity>, declarations: &Option<Identity>, at: &str, files: &Files) -> bool {
    prior.entrypoint.as_deref() == Some(at) && &prior.runtime == runtime && &prior.declarations == declarations
        && prior.sources.as_ref().is_some_and(|sources| sources.iter().all(|source|
            files.digest(&root.join(&source.at)).as_deref() == Some(source.digest.as_str())))
}

struct Reader<'a> {
    root: &'a Path, package: Option<PathBuf>,
    resolver: &'a Resolvers,
    files: &'a Files,
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
        let Some(module) = self.files.module(file) else { return Vec::new() };
        self.sources.insert(file.to_owned());
        if module.unknown { return Vec::new(); }
        let utf16 = &module.utf16;
        let mut names = BTreeMap::<(String, String), Name>::new();
        for export in &module.exports {
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
                        signature: crate::dependency_namespace::text(&utf16, export.signature.as_ref()),
                        doc: crate::dependency_namespace::doc(&utf16, export.doc.as_ref()) };
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
            let mut matched: Vec<_> = module.symbols.iter().filter(|symbol| symbol.name == local).collect();
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
                        signature: crate::dependency_namespace::text(&utf16, symbol.signature.as_ref()),
                        doc: crate::dependency_namespace::doc(&utf16, symbol.doc.as_ref().or(export.doc.as_ref())) };
                    names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                }
            } else if let Some((request, imported)) = module.imports.get(local) {
                if let Some(target) = self.target(file, request) {
                    for mut name in self.names(&target).into_iter().filter(|name| &name.name == imported) {
                        name.name = public.clone();
                        names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
                    }
                }
            } else {
                let name = Name { name: public.clone(), kind: "export".to_owned(),
                    at: relative(self.root, file), line: export.line,
                    signature: crate::dependency_namespace::text(&utf16, export.signature.as_ref()),
                    doc: crate::dependency_namespace::doc(&utf16, export.doc.as_ref()) };
                names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
            }
        }
        if names.is_empty() {
            // `export =` publishes what the module record does not hold, so the
            // tree the record was read from answers it, for both readings.
            for symbol in &module.namespace {
                let name = Name { name: symbol.name.clone(), kind: symbol.kind.clone(),
                    at: relative(self.root, file), line: symbol.line,
                    signature: symbol.signature.clone(), doc: symbol.doc.clone() };
                names.entry((name.name.clone(), name.kind.clone())).or_insert(name);
            }
            if names.is_empty() {
                for request in &module.forwarded {
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
pub(super) fn api(root: &Path, importer: &Path, specifier: &str, resolver: &Resolvers, files: &Files, previous: Option<&Api>) -> (Api, bool) {
    let runtime_resolution = resolver.resolution(importer, specifier);
    let declaration_resolution = resolver.declaration_resolution(importer, specifier);
    let runtime = runtime_resolution.as_ref().and_then(|resolution| identity(root, resolution, files));
    let declarations = declaration_resolution.as_ref().and_then(|resolution| identity(root, resolution, files));
    let Some(declaration) = declaration_resolution else {
        let reason = if runtime_resolution.is_some() {
            format!("the project resolver found no declarations for `{specifier}` from {}", relative(root, importer))
        } else {
            format!("the project resolver could not resolve `{specifier}` from {}", relative(root, importer))
        };
        let readme = readme(root, &runtime, files);
        let skills = skills(root, &runtime, &declarations);
        let purpose = purpose(root, &runtime, &declarations, None, files);
        return (Api { runtime, declarations, entrypoint: None, names: None, sources: None, unavailable: Some(reason), readme, purpose, skills }, false);
    };
    let entrypoint = relative(root, declaration.path());
    if let Some(prior) = previous.filter(|prior| unchanged(root, prior, &runtime, &declarations, &entrypoint, files)) {
        // A README is not among the digested sources, so an entry that publishes no names reads it again.
        let readme = prior.unavailable.is_some().then(|| readme(root, &runtime, files)).flatten();
        // Nor is it: the words a package says about itself are read again, so a README edit reaches the next refresh.
        // Nor are its skills: a `SKILL.md` is read again on every refresh.
        let skills = skills(root, &runtime, &declarations);
        let purpose = purpose(root, &runtime, &declarations, prior.names.as_deref(), files);
        return (Api { readme, purpose, skills, ..prior.clone() }, true);
    }
    let mut reader = Reader { root, package: declaration.package_json().map(|manifest| manifest.path().to_owned()), resolver, files, cache: HashMap::new(), stack: HashSet::new(), sources: BTreeSet::new() };
    if let Some(resolution) = runtime_resolution.as_ref() {
        if let Some(manifest) = resolution.package_json() { reader.sources.insert(manifest.path().to_owned()); }
    }
    if let Some(manifest) = declaration.package_json() { reader.sources.insert(manifest.path().to_owned()); }
    let names = reader.names(declaration.path());
    let sources = reader.sources.iter().filter_map(|path|
        Some(Source { at: relative(root, path), digest: files.digest(path)? })).collect();
    let unavailable = names.is_empty().then(|| format!("the declarations for `{specifier}` publish no names this reader can enumerate"));
    let readme = unavailable.is_some().then(|| readme(root, &runtime, files)).flatten();
    let skills = skills(root, &runtime, &declarations);
    let purpose = purpose(root, &runtime, &declarations, Some(&names), files);
    (Api { runtime, declarations, entrypoint: Some(entrypoint), names: Some(names), sources: Some(sources), unavailable, readme, purpose, skills }, false)
}

#[cfg(test)]
mod tests {
    use super::api;
    use crate::resolve::{Resolvers, Tsconfig};

    #[test]
    fn shared_declarations_keep_each_entrys_cycles_aliases_and_package_boundary() {
        let root = std::env::temp_dir().join(format!("sense-shared-declarations-{}", std::process::id()));
        let files = [
            ("package.json", r#"{"name":"app"}"#),
            ("node_modules/kit/package.json", r#"{"name":"kit","version":"1","exports":{"./a":"./a.d.ts","./b":"./b.d.ts"}}"#),
            ("node_modules/kit/a.d.ts", "export * from './shared'; export * from './cycle-a'; export * from 'other';"),
            ("node_modules/kit/b.d.ts", "export { shared as renamed } from './shared'; export * from './cycle-b';"),
            ("node_modules/kit/shared.d.ts", "export declare const shared: true;"),
            ("node_modules/kit/cycle-a.d.ts", "export * from './cycle-b'; export declare const a: true;"),
            ("node_modules/kit/cycle-b.d.ts", "export * from './cycle-a'; export declare const b: true;"),
            ("node_modules/other/package.json", r#"{"name":"other","version":"1","types":"index.d.ts"}"#),
            ("node_modules/other/index.d.ts", "export declare const foreign: true;"),
        ];
        for (path, text) in files {
            let path = root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        let resolver = Resolvers::new(Tsconfig::Auto, None);
        let importer = root.join("app.ts");
        let files = super::Files::default();
        for (specifier, expected) in [("kit/a", vec!["a", "b", "shared"]), ("kit/b", vec!["a", "b", "renamed"])] {
            let (value, reused) = api(&root, &importer, specifier, &resolver, &files, None);
            assert!(!reused);
            assert_eq!(value.names.unwrap().iter().map(|name| name.name.as_str()).collect::<Vec<_>>(), expected);
            assert!(value.sources.unwrap().iter().all(|source| !source.at.contains("/other/")));
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
