//! Component attribution and source identity from one opened publication.
//! The record owns membership and declared names; its parse owns their sites.

// compass: variance-authority.reach.source-index

use std::collections::HashSet;

use napi_derive::napi;
use sha2::{Digest, Sha256};

use crate::compact::{Layer, ParseView};
use crate::help_publish::OpenedIndex;

#[napi(object)]
pub struct ComponentSource {
    pub name: String,
    pub file: String,
    pub line: u32,
    pub via: String,
}

#[napi(object)]
pub struct ComponentSources {
    pub components: Vec<ComponentSource>,
    pub digest: String,
    pub files: u32,
}

#[napi]
impl OpenedIndex {
    /// Scoped declarations and identity from the held publication, without source reads.
    #[napi(catch_unwind)]
    pub fn component_sources(&self, dirs: Vec<String>, extensions: Option<Vec<String>>, exclude: Option<Vec<String>>) -> napi::Result<ComponentSources> {
        let held = self.snapshot()?.ok_or_else(|| napi::Error::from_reason("no source index is published for component attribution"))?;
        let owned = |given: Option<Vec<String>>, default: &[&str]| given.unwrap_or_else(|| default.iter().map(|&item| item.to_owned()).collect());
        components(held.layers(), &dirs, &owned(extensions, EXTENSIONS), &owned(exclude, EXCLUDE)).map_err(napi::Error::from_reason)
    }
}

/// The files that hold components, where the caller names no others.
const EXTENSIONS: &[&str] = &[".tsx", ".jsx", ".ts", ".js"];
/// Skipped anywhere in a path: a story or a test that declares a component's
/// name is not where the component lives, and would make the name ambiguous.
const EXCLUDE: &[&str] = &["node_modules", ".test.", ".spec.", ".stories.", "dist/", "storybook-static"];

fn components(layers: &[Layer<'_>], dirs: &[String], extensions: &[String], exclude: &[String]) -> Result<ComponentSources, String> {
    let mut files: Vec<_> = crate::chain_lookup::fold(layers).into_iter().filter(|(file, _)| {
        dirs.iter().any(|dir| {
            let dir = dir.trim_end_matches('/');
            dir.is_empty() || dir == "." || *file == dir || file.strip_prefix(dir).is_some_and(|rest| rest.starts_with('/'))
        }) && extensions.iter().any(|extension| file.ends_with(extension.as_str()))
            && !exclude.iter().any(|fragment| file.contains(fragment.as_str()))
    }).collect();
    files.sort_by(|(a, _), (b, _)| crate::order::code_unit(a, b));
    let mut identity = Vec::with_capacity(files.len());
    let mut components = Vec::new();
    for (file, (layer, row)) in &files {
        let layer = &layers[*layer];
        let digest = layer.stored.optional(layer.records.digest.at(*row))
            .ok_or_else(|| format!("the published source record for {file} has no content identity"))?;
        identity.push((*file, digest));
        let declared: HashSet<_> = layer.records.declares_of(&layer.stored, *row).into_iter().flatten().collect();
        if declared.is_empty() { continue; }
        let (layer, row) = crate::chain_lookup::parse(layers, digest, &crate::index::way(file))
            .ok_or_else(|| format!("the published component declarations for {file} have no parse"))?;
        let parsed = ParseView::of(&layers[layer], row);
        let mut seen = HashSet::new();
        for symbol in parsed.columns.symbols.range(parsed.row) {
            let name = parsed.stored.text(parsed.columns.symbol_name.at(symbol));
            let kind = parsed.stored.text(parsed.columns.symbol_kind.at(symbol));
            let via = match kind { "function" | "class" | "const" => kind, "let" => "const", _ => continue };
            if !declared.contains(name) || !seen.insert(name) { continue; }
            components.push(ComponentSource { name: name.to_owned(), file: (*file).to_owned(),
                line: parsed.columns.symbol_line.at(symbol), via: via.to_owned() });
        }
    }
    let mut hashed = Sha256::new();
    hashed.update(b"component-sources\0v1\0");
    for (file, digest) in identity {
        for value in [file, digest] {
            hashed.update((value.len() as u64).to_be_bytes());
            hashed.update(value.as_bytes());
        }
    }
    Ok(ComponentSources { components, digest: crate::digest::of_sha256(hashed.finalize().as_slice()), files: files.len() as u32 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generation::{encode_generation, Deleted, Generation};
    use crate::record::{FileRecord, Indexed};

    #[test]
    fn identity_changes_with_content_deletion_and_path_but_not_record_insertion_order() {
        let row = |file: &str, digest: &str| Indexed {
            record: FileRecord { file: file.into(), digest: Some(digest.into()), ..FileRecord::default() },
            witnesses: Vec::new(), targets: None,
        };
        let a = row("src/a.ts", "git:a");
        let b = row("src/b.ts", "git:b");
        let base = encode_generation::<crate::read::Read>(&Generation { config: None, directories: &[], parses: &[],
            records: &[("src/a.ts", &a), ("src/b.ts", &b)], deleted: Deleted::default() });
        let digest = |extra: Option<&[u8]>| {
            let mut layers = vec![Layer::open(&base).unwrap()];
            if let Some(extra) = extra { layers.push(Layer::open(extra).unwrap()); }
            components(&layers, &["src".into()], &[".ts".into()], &[".stories.".into()]).unwrap().digest
        };
        let original = digest(None);
        let changed = row("src/a.ts", "git:changed");
        let renamed = row("src/renamed.ts", "git:a");
        for (rows, deleted) in [
            (vec![("src/a.ts", &changed)], vec![]),
            (vec![], vec!["src/a.ts".into()]),
            (vec![("src/renamed.ts", &renamed)], vec!["src/a.ts".into()]),
        ] {
            let delta = encode_generation::<crate::read::Read>(&Generation { config: None, directories: &[], parses: &[],
                records: &rows, deleted: Deleted { records: &deleted, ..Deleted::default() } });
            assert_ne!(digest(Some(&delta)), original);
        }
        let repeated = encode_generation::<crate::read::Read>(&Generation { config: None, directories: &[], parses: &[],
            records: &[("src/b.ts", &b)], deleted: Deleted::default() });
        assert_eq!(digest(Some(&repeated)), original);
        let story = row("src/a.stories.ts", "git:story");
        let style = row("src/a.css", "git:style");
        let skipped = encode_generation::<crate::read::Read>(&Generation { config: None, directories: &[], parses: &[],
            records: &[("src/a.stories.ts", &story), ("src/a.css", &style)], deleted: Deleted::default() });
        assert_eq!(digest(Some(&skipped)), original);
    }
}
