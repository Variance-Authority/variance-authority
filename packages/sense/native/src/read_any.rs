//! Which reader a file is read by, and which resolution its requests take:
//! `languageOf` in `language.ts` names the same languages, so a file is read
//! as the same language on both sides.

// compass: variance-authority.reach.source-scan

use oxc_allocator::Allocator;

use crate::read::{read_module, Read};

/// A language some reader claims, as `LanguageId` in `language.ts` names it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Language {
    Module,
    Style,
    Python,
    Rust,
    Java,
    Kotlin,
    Swift,
}

impl Language {
    /// Its name, as `LanguageId` spells it and a tree-sitter reader is asked by.
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Module => "module",
            Self::Style => "style",
            Self::Python => "python",
            Self::Rust => "rust",
            Self::Java => "java",
            Self::Kotlin => "kotlin",
            Self::Swift => "swift",
        }
    }
}

/// Every suffix the standalone source updater may seed.
#[cfg(feature = "standalone-cli")]
pub(crate) const EXTENSIONS: &[&str] = &[
    ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".sass",
    ".less", ".py", ".pyi", ".rs", ".java", ".kt", ".kts", ".swift",
];

/// The language a path is read as, by the extension its name ends in, or
/// nothing when no reader claims it.
pub(crate) fn language_of(file: &str) -> Option<Language> {
    let name = file.rsplit('/').next().unwrap_or(file);
    let extension = &name[name.rfind('.')?..];
    match extension {
        ".ts" | ".tsx" | ".mts" | ".cts" | ".js" | ".jsx" | ".mjs" | ".cjs" => Some(Language::Module),
        ".css" | ".scss" | ".sass" | ".less" => Some(Language::Style),
        ".py" | ".pyi" => Some(Language::Python),
        ".rs" => Some(Language::Rust),
        ".java" => Some(Language::Java),
        ".kt" | ".kts" => Some(Language::Kotlin),
        ".swift" => Some(Language::Swift),
        _ => None,
    }
}

/// One file's read, by the reader its language names. A path no reader
/// claims is read as a module, as the batch always has.
pub(crate) fn read_file(file: &str, source: &str, allocator: &Allocator, symbols: bool) -> Read {
    match language_of(file) {
        Some(Language::Style) => crate::style::read_style(source),
        Some(Language::Module) | None => read_module(file, source, allocator, symbols),
        Some(language) => read_language(language, source),
    }
}

/// A tree-sitter language's read: the reader's answer, or *unknown* without grammars.
#[cfg(feature = "grammars")]
fn read_language(language: Language, source: &str) -> Read {
    crate::languages::read(language.name(), source).map_or_else(|| without_grammars(language), from_shape)
}

#[cfg(not(feature = "grammars"))]
fn read_language(language: Language, _source: &str) -> Read {
    without_grammars(language)
}

fn without_grammars(language: Language) -> Read {
    let name = language.name();
    Read {
        unknown: Some(format!("the native addon on this machine was built without the tree-sitter grammars that read {name}, so what it asks for is unknown.")),
        ..Read::default()
    }
}

/// A reader's answer in the module read's shape: what JavaScript holds once it
/// parses the reader's JSON.
#[cfg(feature = "grammars")]
fn from_shape(read: crate::languages::shape::Read) -> Read {
    use crate::languages::shape;
    use crate::read::{Binding, Export, Kind, Request};
    let kind = |kind: shape::Kind| match kind {
        shape::Kind::Imports => Kind::Imports,
        shape::Kind::Reexports => Kind::Reexports,
        shape::Kind::Dynamic => Kind::Dynamic,
        shape::Kind::Type => Kind::Type,
    };
    let requests = read.requests.into_iter().map(|request| Request {
        value: request.value,
        kind: kind(request.kind),
        bindings: request.bindings.into_iter().map(|binding| Binding {
            imported: binding.imported,
            local: binding.local,
            type_only: binding.type_only,
            line: binding.line,
        }).collect(),
        line: request.line,
        republishes: false,
        guessed: request.guessed,
        item: request.item,
    });
    let exports = read.exports.unwrap_or_default().into_iter().map(|export| Export {
        exported: export.exported,
        local: export.local,
        from: export.from,
        imported: export.imported,
        type_only: export.type_only,
        line: export.line,
        signature: None,
        doc: None,
        tags: 0,
        assigned: false,
        line_text: export.line_text,
    });
    Read {
        requests: requests.collect(),
        exports: exports.collect(),
        symbols: read.symbols,
        harvested: read.harvested,
        own_uses: read.own_uses,
        unknown: read.unknown,
        size: read.size,
        ..Read::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_read_without_grammars_names_the_language_and_no_file() {
        let unknown = without_grammars(Language::Kotlin).unknown;
        assert_eq!(
            unknown.as_deref(),
            Some("the native addon on this machine was built without the tree-sitter grammars that read kotlin, so what it asks for is unknown."),
        );
    }

    #[test]
    fn a_name_takes_the_language_of_its_last_extension() {
        assert_eq!(language_of("a/b.module.css"), Some(Language::Style));
        assert_eq!(language_of("a/b.d.ts"), Some(Language::Module));
        assert_eq!(language_of("a.d/b"), None);
        assert_eq!(language_of("a/README"), None);
    }

    #[test]
    fn a_stylesheet_is_read_as_one() {
        let read = read_file("a.scss", "@use './b';", &Allocator::default(), true);
        assert_eq!(read.requests.len(), 1);
        assert_eq!(read.requests[0].kind, crate::read::Kind::Asset);
        assert!(read.harvested);
    }
}
