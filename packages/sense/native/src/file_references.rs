//! Targeted live distillation questions: the requested file stays inside Rust.
// compass: variance-authority.reach
use std::collections::{HashMap, HashSet};
use std::path::Path;
use napi_derive::napi;

#[napi(object)]
pub struct FileReference { pub file: String, pub name: String, pub line: u32, pub load: bool }
#[napi(object)]
pub struct FileReferences {
    pub references: Vec<FileReference>, pub passed: Vec<String>, pub imported: Vec<String>,
    pub effects: Vec<String>, pub untraced: bool, pub exports: Option<Vec<String>>,
}

/// Read one current-worktree module, rather than the published snapshot: distill
/// proposes edits against the current text. Only the resolved answer crosses N-API.
#[napi(catch_unwind)]
pub fn file_references(root: String, file: String, listed: Option<Vec<String>>, tsconfig: Option<napi::Either<String, bool>>) -> Option<FileReferences> {
    let bytes = std::fs::read(Path::new(&root).join(&file)).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let found = crate::module_readers::references::module_references(file.clone(), text.clone())?;
    let landed = crate::side_effects::resolve_sources(root, file.clone(), found.sources.clone(), listed, tsconfig);
    let imported = unique(landed.iter().filter(|path| !path.is_empty() && !Path::new(path).is_absolute()).cloned());
    let at: HashMap<_, _> = found.sources.into_iter().zip(landed).filter(|(_, path)| !path.is_empty() && !Path::new(path).is_absolute()).collect();
    let references = found.references.into_iter().filter_map(|row| Some(FileReference {
        file: at.get(&row.source)?.clone(), name: row.name, line: row.line, load: row.load,
    })).collect();
    let passed = unique(found.passed.into_iter().filter_map(|row| at.get(&row.source).cloned()));
    let effects = unique(found.effects.into_iter().filter_map(|source| at.get(&source).cloned()));
    let allocator = oxc_allocator::Allocator::default();
    let read = crate::read::read_module(&file, &text, &allocator, true);
    Some(FileReferences { references, passed, imported, effects, untraced: found.untraced, exports: exports_of(&read) })
}

fn unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values.into_iter().filter(|value| seen.insert(value.clone())).collect()
}

fn exports_of(read: &crate::read::Read) -> Option<Vec<String>> {
    let values: Vec<_> = read.exports.iter().filter(|entry| !entry.type_only).collect();
    if values.is_empty() || values.iter().any(|entry| entry.exported.is_none() || entry.assigned) { return None }
    let types: HashSet<_> = read.symbols.iter().filter(|symbol| symbol.kind == "interface" || symbol.kind == "type").map(|symbol| symbol.name.as_str()).collect();
    let names = unique(values.into_iter().filter(|entry| !entry.local.as_ref().is_some_and(|local| types.contains(local.as_str()))).filter_map(|entry| entry.exported.clone()));
    (!names.is_empty()).then_some(names)
}

#[cfg(test)]
mod tests {
    use super::file_references;

    #[test]
    fn live_references_resolve_only_the_asked_module_and_preserve_export_names() {
        let root = crate::git_fixture::repository("live-file-references", &[
            ("src/value.ts", b"export const value = 1;"),
            ("src/read.ts", b"import { value } from './value';\nexport const load = value;\nexport function read() { return value; }\nexport type Shape = {};"),
        ]);
        let found = file_references(root.to_string_lossy().into_owned(), "src/read.ts".into(), None, None).unwrap();
        assert_eq!(found.imported, vec!["src/value.ts"]);
        assert_eq!(found.exports.unwrap(), vec!["load", "read"]);
        assert_eq!(found.references.iter().map(|row| (row.file.as_str(), row.name.as_str(), row.line, row.load)).collect::<Vec<_>>(),
            vec![("src/value.ts", "value", 2, true), ("src/value.ts", "value", 3, false)]);
        std::fs::write(root.join("src/read.ts"), "export const after = 2;").unwrap();
        let after = file_references(root.to_string_lossy().into_owned(), "src/read.ts".into(), None, None).unwrap();
        assert_eq!(after.exports.unwrap(), vec!["after"]);
        assert!(after.imported.is_empty());
        assert!(file_references(root.to_string_lossy().into_owned(), "missing.ts".into(), None, None).is_none());
        std::fs::write(root.join("src/read.ts"), "export const = ;").unwrap();
        assert!(file_references(root.to_string_lossy().into_owned(), "src/read.ts".into(), None, None).is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
