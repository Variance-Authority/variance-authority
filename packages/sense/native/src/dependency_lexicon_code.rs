//! Declaration syntax facts shared across one refresh's API traversals.

// compass: variance-authority.reach.relations

use std::collections::{HashMap, HashSet};
use std::path::Path;

use oxc_allocator::Allocator;

use crate::dependency_namespace::{exported_import, exported_namespace, NamespaceSymbol};
use crate::harvest::{SourceSymbol, TextSpan};
use crate::read_rows::Export;

/// Source-local facts only: no resolver answer, package selection or traversal
/// result belongs here. The source and AST are dropped when this is made.
pub(super) struct Code {
    pub digest: String,
    pub exports: Vec<Export>,
    symbols: Vec<SourceSymbol>,
    pub imports: HashMap<String, (String, String)>,
    pub namespace: Vec<NamespaceSymbol>,
    pub assigned_imports: Vec<String>,
    pub unknown: bool,
}

impl Code {
    pub(super) fn read(file: &Path) -> Option<(Self, usize)> {
        let source = std::fs::read_to_string(file).ok()?;
        let digest = super::bytes_digest(source.as_bytes());
        let path = file.to_string_lossy();
        let allocator = Allocator::default();
        let crate::module_syntax::ModuleSyntax {
            program, lines, harvest, requests, mut exports, unknown, ..
        } = crate::module_syntax::read(&path, &source, &allocator, true);
        let mut symbols = harvest.symbols;
        {
            let texts = crate::span_text::Source::new(&source, lines.starts());
            texts.symbols(&mut symbols);
            texts.exports(&mut exports, &symbols);
        }
        let unknown = unknown.is_some();
        // These two facts need the AST, and are independent of the API that
        // later follows the file's exports under its own package boundary.
        let namespace = if unknown { Vec::new() } else { exported_namespace(&path, &source, &program, &symbols) };
        let assigned_imports = if unknown { Vec::new() } else { exported_import(&program) };
        let mut imports = HashMap::new();
        for request in &requests {
            for binding in &request.bindings {
                imports.insert(binding.local.clone(), (request.value.clone(), binding.imported.clone()));
            }
        }
        // A file's exports ask by name repeatedly. Stable sorting retains the
        // source order of overloads while each lookup visits only its name.
        symbols.sort_by(|a, b| crate::order::code_unit(&a.name, &b.name));
        Some((Self { digest, exports, symbols, imports, namespace, assigned_imports, unknown }, source.len()))
    }

    pub(super) fn symbols_named(&self, name: &str) -> &[SourceSymbol] {
        let start = self.symbols.partition_point(|symbol| crate::order::code_unit(&symbol.name, name).is_lt());
        let count = self.symbols[start..].partition_point(|symbol| symbol.name == name);
        &self.symbols[start..start + count]
    }

    /// Logical retained text payload, excluding collection and allocator overhead.
    pub(super) fn text_bytes(&self) -> usize {
        let mut held = HashSet::new();
        let spans = self.exports.iter().flat_map(|export| [export.signature.as_ref(), export.doc.as_ref()])
            .chain(self.symbols.iter().flat_map(|symbol| [symbol.signature.as_ref(), symbol.doc.as_ref()]));
        let span_bytes = spans.flatten().filter_map(|span| span.text.as_ref())
            .filter(|text| held.insert(text.as_ptr())).map(|text| text.len()).sum::<usize>();
        let exports = self.exports.iter().flat_map(|export| [&export.exported, &export.local, &export.from, &export.imported])
            .flatten().map(String::len).sum::<usize>();
        let imports = self.imports.iter().map(|(local, (request, imported))| local.len() + request.len() + imported.len()).sum::<usize>();
        let namespace = self.namespace.iter().map(|symbol|
            symbol.name.len() + symbol.kind.len() + symbol.signature.as_ref().map_or(0, String::len) + symbol.doc.as_ref().map_or(0, String::len)).sum::<usize>();
        self.digest.len() + span_bytes + exports + imports + namespace
            + self.symbols.iter().map(|symbol| symbol.name.len()).sum::<usize>()
            + self.assigned_imports.iter().map(String::len).sum::<usize>()
    }
}

pub(super) fn text(span: Option<&TextSpan>) -> Option<String> {
    Some(span?.text.as_deref()?.trim().to_owned())
}

pub(super) fn doc(span: Option<&TextSpan>) -> Option<String> {
    crate::dependency_namespace::cut(&text(span)?)
}

#[cfg(test)]
#[path = "dependency_lexicon_code_tests.rs"]
mod tests;
